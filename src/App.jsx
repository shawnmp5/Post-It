import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore, uid } from './store.js';
import { Sidebar } from './components/Sidebar.jsx';
import { Workspace } from './components/Workspace.jsx';
import { ConfirmDialog } from './components/ConfirmDialog.jsx';
import { Toast } from './components/Toast.jsx';

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
  const { data, dispatch, canUndo, canRedo } = useStore();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toastState, setToastState] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const toastTimer = useRef(null);

  const toast = useCallback((message, opts = {}) => {
    clearTimeout(toastTimer.current);
    setToastState({ id: Math.random(), message, undo: !!opts.undo });
    toastTimer.current = setTimeout(() => setToastState(null), opts.undo ? 6000 : 2600);
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
      if (typing || !(e.metaKey || e.ctrlKey)) return;
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

  const activeName = data.topics.find((t) => t.id === data.activeTopicId)?.name;
  useEffect(() => {
    document.title = activeName ? `${activeName} — POST IT` : 'POST IT';
  }, [activeName]);

  return (
    <div className={`app ${isMobile ? 'is-mobile' : ''}`}>
      <Sidebar
        data={data}
        dispatch={dispatch}
        onSelectTopic={selectTopic}
        toast={toast}
        confirm={confirm}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        isMobile={isMobile}
      />
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
      />
      {toastState && (
        <Toast
          key={toastState.id}
          message={toastState.message}
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
