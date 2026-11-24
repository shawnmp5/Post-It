import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COLOR_MAP, uid } from '../store.js';
import { Popover, MenuItem, MenuSep } from './Popover.jsx';
import { SettingsPanel } from './SettingsPanel.jsx';
import { IconPlus, IconMore, IconEdit, IconCopy, IconTrash, IconSettings, IconClose, Logo } from './Icons.jsx';

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 440;

export function Sidebar({ data, dispatch, onSelectTopic, toast, confirm, open, onClose, isMobile }) {
  const { topics, notes, activeTopicId, settings } = data;
  const [renamingId, setRenamingId] = useState(null);
  const [menu, setMenu] = useState(null); // { id, anchor }
  const [settingsAnchor, setSettingsAnchor] = useState(null);
  const [drag, setDrag] = useState(null); // { id, dy, dropIndex }
  const listRef = useRef(null);
  const dragRef = useRef(null);
  const [liveWidth, setLiveWidth] = useState(null); // width while the edge is being dragged
  const width = liveWidth ?? settings.sidebarWidth;

  // Drag the sidebar's right edge to resize it; double-click the edge to reset.
  const onResizeStart = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = e.currentTarget.parentElement.getBoundingClientRect().width;
    let w = startW;
    document.body.classList.add('is-resizing-sidebar');
    const move = (ev) => {
      w = Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + ev.clientX - startX)));
      setLiveWidth(w);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.classList.remove('is-resizing-sidebar');
      setLiveWidth(null);
      dispatch({ type: 'settings', patch: { sidebarWidth: w } });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // Active note count + most common color per topic.
  const stats = useMemo(() => {
    const out = {};
    for (const t of topics) out[t.id] = { count: 0, colors: {} };
    for (const n of notes) {
      if (n.archived) continue;
      const s = out[n.topicId];
      if (!s) continue;
      s.count++;
      s.colors[n.color] = (s.colors[n.color] || 0) + 1;
    }
    for (const id in out) {
      const entries = Object.entries(out[id].colors).sort((a, b) => b[1] - a[1]);
      out[id].color = entries[0]?.[0] ?? null;
    }
    return out;
  }, [topics, notes]);

  const addTopic = () => {
    const id = uid('t');
    dispatch({ type: 'topic/add', id, name: 'Untitled topic', record: true });
    setRenamingId(id);
    onSelectTopic(id, { keepDrawer: true });
  };

  const deleteTopic = async (topic) => {
    const count = notes.filter((n) => n.topicId === topic.id).length;
    if (count > 0) {
      const ok = await confirm({
        title: `Delete “${topic.name}”?`,
        message: `This removes the topic and its ${count} note${count === 1 ? '' : 's'}. You can undo right after.`,
        confirmLabel: 'Delete topic',
        danger: true,
      });
      if (!ok) return;
    }
    dispatch({ type: 'topic/delete', id: topic.id, record: true });
    toast(`Deleted “${topic.name}”`, { undo: true });
  };

  /* ---------------- drag to reorder ---------------- */

  // Row midpoints are measured once at pick-up so shifting rows don't feed back into the hit test.
  const measureRows = () =>
    [...listRef.current.querySelectorAll('[data-topic-row]')].map((el) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    });
  const rowIndexAt = (clientY, mids) => {
    for (let i = 0; i < mids.length; i++) if (clientY < mids[i]) return i;
    return mids.length;
  };

  const onRowPointerDown = (e, topic) => {
    if (e.button !== 0 || renamingId === topic.id) return;
    if (e.target.closest('button, input')) return;
    const st = { id: topic.id, startY: e.clientY, active: false, pointerId: e.pointerId, timer: null, el: e.currentTarget };
    if (e.pointerType === 'touch') {
      // Touch: long-press to pick up a topic so normal scrolling still works.
      st.timer = setTimeout(() => {
        st.active = true;
        st.mids = measureRows();
        st.el.setPointerCapture?.(st.pointerId);
        navigator.vibrate?.(8);
        setDrag({ id: topic.id, dy: 0, dropIndex: rowIndexAt(st.startY, st.mids) });
      }, 380);
    }
    dragRef.current = st;
  };

  useEffect(() => {
    const onMove = (e) => {
      const st = dragRef.current;
      if (!st || e.pointerId !== st.pointerId) return;
      const dy = e.clientY - st.startY;
      if (!st.active) {
        if (e.pointerType === 'touch') {
          if (Math.abs(dy) > 8) {
            clearTimeout(st.timer);
            dragRef.current = null;
          }
          return;
        }
        if (Math.abs(dy) < 5) return;
        st.active = true;
        st.mids = measureRows();
        st.el.setPointerCapture?.(st.pointerId);
      }
      setDrag({ id: st.id, dy, dropIndex: rowIndexAt(e.clientY, st.mids) });
    };
    const onUp = (e) => {
      const st = dragRef.current;
      if (!st || e.pointerId !== st.pointerId) return;
      clearTimeout(st.timer);
      dragRef.current = null;
      if (st.active) {
        const to = rowIndexAt(e.clientY, st.mids);
        dispatch({ type: 'topic/reorder', id: st.id, to, record: true });
        setDrag(null);
        // swallow the click that follows a drag
        const kill = (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        window.addEventListener('click', kill, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', kill, { capture: true }), 50);
      }
    };
    const onCancel = (e) => {
      const st = dragRef.current;
      if (!st || e.pointerId !== st.pointerId) return;
      clearTimeout(st.timer);
      dragRef.current = null;
      setDrag(null);
    };
    const onTouchMove = (e) => {
      if (dragRef.current?.active) e.preventDefault();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    const list = listRef.current;
    list?.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      list?.removeEventListener('touchmove', onTouchMove);
    };
  }, [dispatch]);

  const closeMenu = useCallback(() => setMenu(null), []);
  const closeSettings = useCallback(() => setSettingsAnchor(null), []);
  const menuTopic = menu && topics.find((t) => t.id === menu.id);
  const dragIndex = drag ? topics.findIndex((t) => t.id === drag.id) : -1;

  const initial = (settings.userName || 'You').trim().charAt(0).toUpperCase();

  return (
    <aside
      className={`sidebar ${open ? 'is-open' : ''}`}
      aria-label="Topics"
      style={!isMobile && width ? { width } : undefined}
    >
      {!isMobile && (
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          title="Drag to resize · double-click to reset"
          onPointerDown={onResizeStart}
          onDoubleClick={() => dispatch({ type: 'settings', patch: { sidebarWidth: null } })}
        />
      )}
      <div className="sidebar-brand">
        <Logo size={20} />
        <span className="wordmark">POST IT</span>
        {isMobile && (
          <button type="button" className="icon-btn sidebar-close" onClick={onClose} aria-label="Close menu">
            <IconClose />
          </button>
        )}
      </div>

      <div className="sidebar-section-head">
        <span className="section-label">My Topics</span>
        <button type="button" className="icon-btn add-topic" onClick={addTopic} title="New topic" aria-label="New topic">
          <IconPlus />
        </button>
      </div>

      <nav className="topic-list" ref={listRef}>
        {topics.length === 0 && (
          <button type="button" className="topic-empty" onClick={addTopic}>
            <IconPlus /> Create your first topic
          </button>
        )}
        {topics.map((t, i) => {
          const isActive = t.id === activeTopicId;
          const isDragging = drag?.id === t.id;
          const s = stats[t.id] || { count: 0 };
          let shift = 0;
          if (drag && !isDragging && dragIndex >= 0) {
            // Make room for the row being dragged.
            if (i > dragIndex && i < drag.dropIndex) shift = -1;
            if (i < dragIndex && i >= drag.dropIndex) shift = 1;
          }
          return (
            <div
              key={t.id}
              data-topic-row
              className={`topic-row ${isActive ? 'is-active' : ''} ${isDragging ? 'is-dragging' : ''} ${menu?.id === t.id ? 'menu-open' : ''}`}
              style={
                isDragging
                  ? { transform: `translateY(${drag.dy}px)` }
                  : shift
                    ? { transform: `translateY(${shift * 100}%)` }
                    : undefined
              }
              onPointerDown={(e) => onRowPointerDown(e, t)}
              onClick={() => renamingId !== t.id && onSelectTopic(t.id)}
              onDoubleClick={() => setRenamingId(t.id)}
              role="button"
              tabIndex={0}
              aria-current={isActive ? 'page' : undefined}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter') onSelectTopic(t.id);
                if (e.key === 'F2') setRenamingId(t.id);
              }}
            >
              <span
                className="topic-swatch"
                style={{ background: s.color ? COLOR_MAP[s.color]?.bg : 'transparent' }}
                aria-hidden="true"
              />
              {renamingId === t.id ? (
                <RenameInput
                  value={t.name}
                  onDone={(name) => {
                    setRenamingId(null);
                    if (name != null && name.trim() && name.trim() !== t.name) {
                      dispatch({ type: 'topic/rename', id: t.id, name, record: true });
                    }
                  }}
                />
              ) : (
                <span className="topic-name">{t.name}</span>
              )}
              <span className="topic-count">{s.count}</span>
              <button
                type="button"
                className="topic-more icon-btn"
                aria-label={`Options for ${t.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu(menu?.id === t.id ? null : { id: t.id, anchor: e.currentTarget });
                }}
              >
                <IconMore />
              </button>
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <button
          type="button"
          className={`profile ${settingsAnchor ? 'is-open' : ''}`}
          onClick={(e) => setSettingsAnchor(settingsAnchor ? null : e.currentTarget)}
        >
          <span className="avatar">{initial}</span>
          <span className="profile-text">
            <span className="profile-name">{settings.userName || 'You'}</span>
            <span className="profile-sub">Saved on this device</span>
          </span>
          <IconSettings className="profile-gear" />
        </button>
      </div>

      {menuTopic && (
        <Popover anchor={menu.anchor} onClose={closeMenu} align="end" className="menu">
          <MenuItem
            icon={IconEdit}
            onClick={() => {
              setMenu(null);
              setRenamingId(menuTopic.id);
            }}
          >
            Rename
          </MenuItem>
          <MenuItem
            icon={IconCopy}
            onClick={() => {
              setMenu(null);
              const newId = uid('t');
              dispatch({ type: 'topic/duplicate', id: menuTopic.id, newId, record: true });
              onSelectTopic(newId, { keepDrawer: true });
              toast(`Duplicated “${menuTopic.name}”`, { undo: true });
            }}
          >
            Duplicate
          </MenuItem>
          <MenuSep />
          <MenuItem
            icon={IconTrash}
            danger
            onClick={() => {
              setMenu(null);
              deleteTopic(menuTopic);
            }}
          >
            Delete
          </MenuItem>
        </Popover>
      )}

      {settingsAnchor && (
        <Popover anchor={settingsAnchor} onClose={closeSettings} className="settings-popover">
          <SettingsPanel data={data} dispatch={dispatch} toast={toast} confirm={confirm} onDone={closeSettings} />
        </Popover>
      )}
    </aside>
  );
}

function RenameInput({ value, onDone }) {
  const [v, setV] = useState(value);
  const ref = useRef(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (val) => {
    if (done.current) return;
    done.current = true;
    onDone(val);
  };
  return (
    <input
      ref={ref}
      className="topic-rename"
      value={v}
      maxLength={60}
      aria-label="Topic name"
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => finish(v)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(v);
        if (e.key === 'Escape') finish(null);
      }}
    />
  );
}
