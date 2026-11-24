import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore, uid } from './store.js';
import { plainText } from './blocks.js';
import { Sidebar } from './components/Sidebar.jsx';
import { Workspace } from './components/Workspace.jsx';
import { ConfirmDialog } from './components/ConfirmDialog.jsx';
import { Toast } from './components/Toast.jsx';
import { Wallpaper } from './components/Wallpaper.jsx';
import { startRainSound, stopRainSound, setRainVolume } from './rainAudio.js';

const MOBILE_QUERY = '(max-width: 767px)';

function useMediaQuery(q) {
  const [match, setMatch] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setMatch(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [q]);
  return match;
}

export default function App() {
  const { data, dispatch, canUndo, canRedo, getData } = useStore();
  const [focusNote, setFocusNote] = useState(null); // { id, token } — scroll the wall to this note
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const sidebarHidden = !isMobile && !!data.settings.sidebarHidden;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toastState, setToastState] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const toastTimer = useRef(null);

  const toast = useCallback((message, opts = {}) => {
    clearTimeout(toastTimer.current);
    setToastState({ id: Math.random(), message, undo: !!opts.undo, action: opts.action || null });
    toastTimer.current = setTimeout(() => setToastState(null), opts.duration ?? (opts.undo || opts.action ? 6000 : 2600));
  }, []);
  const dismissToast = useCallback(() => {
    clearTimeout(toastTimer.current);
    setToastState(null);
  }, []);

  const confirm = useCallback(
    (opts) =>
      new Promise((resolve) => {
        setConfirmState({
          ...opts,
          resolve: (v) => {
            setConfirmState(null);
            resolve(v);
          },
        });
      }),
    [],
  );

  const selectTopic = useCallback(
    (id, opts = {}) => {
      dispatch({ type: 'topic/select', id });
      if (!opts.keepDrawer) setDrawerOpen(false);
    },
    [dispatch],
  );

  const createTopic = useCallback(() => {
    dispatch({ type: 'topic/add', id: uid('t'), name: 'Untitled topic', record: true });
  }, [dispatch]);

  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);

  // Undo / redo. Inside a text field the browser's own text undo applies instead.
  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === '\\') {
        e.preventDefault();
        dispatch({ type: 'settings', patch: { sidebarHidden: !getDataRef.current().settings.sidebarHidden } });
        return;
      }
      if (typing) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: 'undo' });
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        dispatch({ type: 'redo' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch]);

  // localStorage is limited (~5 MB); large images can fill it.
  useEffect(() => {
    let last = 0;
    const onFail = () => {
      if (Date.now() - last < 8000) return;
      last = Date.now();
      toast('Couldn\u2019t save: browser storage is full. Remove some images to free space.');
    };
    window.addEventListener('postit:save-failed', onFail);
    return () => window.removeEventListener('postit:save-failed', onFail);
  }, [toast]);

  // Reminders: check every few seconds (and when the tab comes back) for anything due.
  const getDataRef = useRef(getData);
  getDataRef.current = getData;
  useEffect(() => {
    const open = (n) => {
      dispatch({ type: 'topic/select', id: n.topicId });
      setDrawerOpen(false);
      setFocusNote({ id: n.id, token: Math.random() });
    };
    const check = () => {
      const d = getDataRef.current();
      const now = Date.now();
      for (const n of d.notes) {
        if (!n.reminder || n.reminder.fired || n.reminder.at > now || n.archived) continue;
        dispatch({ type: 'note/update', id: n.id, patch: { reminder: { ...n.reminder, fired: true } }, touch: false });
        const title = n.title || plainText(n.body).split('\n').find((l) => l.trim()) || 'Untitled note';
        toast(`Reminder: ${title}`, { action: { label: 'Open', onClick: () => open(n) }, duration: 12000 });
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
            const notice = new Notification('POST IT reminder', { body: title, tag: n.id });
            notice.onclick = () => {
              window.focus();
              open(n);
            };
          }
        } catch {
          /* notifications unavailable */
        }
      }
    };
    check();
    const t = setInterval(check, 10000);
    const onVis = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [dispatch, toast]);

  // Appearance: light, graphite dark, or follow the system.
  const themePref = data.settings.theme || 'light';
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const m = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  const clearUI = !!data.settings.clearUI;
  const dark = themePref === 'dark' || (themePref === 'system' && systemDark);
  const wallpaper = data.settings.wallpaper === 'rain' ? 'rain' : 'none';
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.clear = clearUI ? 'true' : 'false';
    root.dataset.wallpaper = wallpaper;
  }, [clearUI, wallpaper]);

  // Rain sound plays only with the rain wallpaper.
  const rainSound = wallpaper === 'rain' && !!data.settings.rainSound;
  const rainVolume = data.settings.rainVolume ?? 0.6;
  useEffect(() => {
    setRainVolume(rainVolume);
  }, [rainVolume]);
  useEffect(() => {
    if (rainSound) startRainSound();
    else stopRainSound();
  }, [rainSound]);
  useEffect(() => () => stopRainSound(), []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1c1c1e' : '#f5f5f7');
  }, [dark]);

  const activeName = data.topics.find((t) => t.id === data.activeTopicId)?.name;
  useEffect(() => {
    document.title = activeName ? `${activeName} — POST IT` : 'POST IT';
  }, [activeName]);

  return (
    <div className={`app ${isMobile ? 'is-mobile' : ''} ${sidebarHidden ? 'sidebar-hidden' : ''}`}>
      <Wallpaper kind={wallpaper} dark={dark} lightning={data.settings.lightning !== false} />
      {!sidebarHidden && <Sidebar
        onHide={() => dispatch({ type: 'settings', patch: { sidebarHidden: true } })}
        data={data}
        dispatch={dispatch}
        onSelectTopic={selectTopic}
        toast={toast}
        confirm={confirm}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        isMobile={isMobile}
      />}
      {isMobile && (
        <div
          className={`drawer-backdrop ${drawerOpen ? 'is-open' : ''}`}
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}
      <Workspace
        data={data}
        dispatch={dispatch}
        toast={toast}
        canUndo={canUndo}
        canRedo={canRedo}
        isMobile={isMobile}
        onOpenDrawer={() => setDrawerOpen(true)}
        onCreateTopic={createTopic}
        focusNote={focusNote}
        sidebarHidden={sidebarHidden}
        onShowSidebar={() => dispatch({ type: 'settings', patch: { sidebarHidden: false } })}
      />
      {toastState && (
        <Toast
          key={toastState.id}
          message={toastState.message}
          action={toastState.action}
          onUndo={
            toastState.undo
              ? () => {
                  dispatch({ type: 'undo' });
                  dismissToast();
                }
              : null
          }
          onClose={dismissToast}
        />
      )}
      {confirmState && <ConfirmDialog {...confirmState} />}
    </div>
  );
}
