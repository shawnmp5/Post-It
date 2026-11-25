import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COLOR_MAP, uid } from '../store.js';
import { Popover, MenuItem, MenuSep } from './Popover.jsx';
import { Avatar } from '../account/avatar.jsx';
import { SettingsSheet } from './SettingsSheet.jsx';
import {
  IconPlus,
  IconSidebar,
  IconMore,
  IconEdit,
  IconCopy,
  IconTrash,
  IconClose,
  IconFolder,
  IconFolderPlus,
  IconShare,
  IconGear,
  IconChevron,
  Logo,
} from './Icons.jsx';
import { MenuLabel } from './Popover.jsx';

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 440;

// What the account row says under the username: "Synced just now", "Synced 3 min ago", …
function syncLabel(account) {
  if (!account || account.mode !== 'server') return 'Account';
  const other = { saving: 'Syncing…', offline: 'Offline', 'too-big': 'Not synced', full: 'Not synced', 'signed-out': 'Signed out' }[account.sync];
  if (other) return other;
  if (!account.lastSynced) return 'Synced';
  const s = Math.round((Date.now() - account.lastSynced) / 1000);
  if (s < 60) return 'Synced just now';
  if (s < 3600) return `Synced ${Math.round(s / 60)} min ago`;
  if (s < 86400) return `Synced ${Math.round(s / 3600)} h ago`;
  return 'Synced';
}

// Keeps the "… min ago" fresh.
function SyncLabel({ account }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 20000);
    return () => clearInterval(t);
  }, []);
  return syncLabel(account);
}

export function Sidebar({ data, dispatch, onSelectTopic, toast, confirm, open, onClose, isMobile, onHide, account, onOpenAccount }) {
  const { topics, notes, activeTopicId, settings } = data;
  const groups = data.groups || [];
  const [renamingId, setRenamingId] = useState(null);
  const [menu, setMenu] = useState(null); // { kind: 'topic' | 'group', id, anchor }
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

  const addTopic = (groupId) => {
    const id = uid('t');
    dispatch({ type: 'topic/add', id, name: 'Untitled topic', groupId: typeof groupId === 'string' ? groupId : undefined, record: true });
    if (typeof groupId === 'string') {
      const g = groups.find((x) => x.id === groupId);
      if (g?.collapsed) dispatch({ type: 'group/toggle', id: groupId });
    }
    setRenamingId(id);
    onSelectTopic(id, { keepDrawer: true });
  };

  const addGroup = (topicId) => {
    const id = uid('g');
    dispatch({ type: 'group/add', id, name: 'New Group', topicId, record: true });
    setRenamingId(`g:${id}`);
  };

  // What the list shows, in order: loose topics first, then each group with its topics.
  const items = useMemo(() => {
    const ids = new Set(groups.map((g) => g.id));
    const out = topics.filter((t) => !t.groupId || !ids.has(t.groupId)).map((t) => ({ kind: 'topic', topic: t, groupId: null }));
    for (const g of groups) {
      const inside = topics.filter((t) => t.groupId === g.id);
      out.push({ kind: 'group', group: g, count: inside.length });
      if (!g.collapsed) for (const t of inside) out.push({ kind: 'topic', topic: t, groupId: g.id });
    }
    return out;
  }, [topics, groups]);

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
    [...listRef.current.querySelectorAll('[data-row]')].map((el) => {
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
        const k = rowIndexAt(e.clientY, st.mids);
        const seq = itemsRef.current;
        let ni = k;
        if (seq[ni]?.topic?.id === st.id) ni++;
        let pi = k - 1;
        if (seq[pi]?.topic?.id === st.id) pi--;
        const next = seq[ni];
        const prev = seq[pi];
        let groupId = null;
        let beforeId = null;
        if (next?.kind === 'topic') {
          groupId = next.groupId;
          beforeId = next.topic.id;
        } else if (prev) {
          groupId = prev.kind === 'topic' ? prev.groupId : prev.group.id;
        }
        dispatch({ type: 'topic/move', id: st.id, groupId, beforeId, record: true });
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

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const closeMenu = useCallback(() => setMenu(null), []);
  const menuTopic = menu?.kind === 'topic' && topics.find((t) => t.id === menu.id);
  const menuGroup = menu?.kind === 'group' && groups.find((g) => g.id === menu.id);
  const dragIndex = drag ? items.findIndex((it) => it.topic?.id === drag.id) : -1;
  const shiftFor = (i) => {
    if (!drag || dragIndex < 0 || i === dragIndex) return 0;
    if (i > dragIndex && i < drag.dropIndex) return -1;
    if (i < dragIndex && i >= drag.dropIndex) return 1;
    return 0;
  };

  const handle = account?.username || 'you';
  const [settingsAnchor, setSettingsAnchor] = useState(null);
  const closeSettings = useCallback(() => setSettingsAnchor(null), []);

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
        <Logo size={34} />
        <div className="brand-tools">
          {isMobile ? (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close menu">
              <IconClose />
            </button>
          ) : (
            <button type="button" className="icon-btn" onClick={onHide} aria-label="Hide sidebar" title="Hide sidebar (Ctrl/⌘+\\)">
              <IconSidebar />
            </button>
          )}
        </div>
      </div>


      <div className="sidebar-section-head">
        <span className="section-label">Topics</span>
        <button type="button" className="section-add" onClick={() => addTopic()} title="New topic" aria-label="New topic">
          <IconPlus />
        </button>
      </div>

      <nav className="topic-list" ref={listRef}>
        {topics.length === 0 && (
          <button type="button" className="topic-empty" onClick={() => addTopic()}>
            <IconPlus /> Create your first topic
          </button>
        )}
        {items.map((it, i) => {
          const shift = shiftFor(i);
          const shiftStyle = shift ? { transform: `translateY(${shift * 100}%)` } : undefined;
          if (it.kind === 'group') {
            const g = it.group;
            const renaming = renamingId === `g:${g.id}`;
            return (
              <div
                key={`g:${g.id}`}
                data-row
                className={`group-row ${g.collapsed ? 'is-collapsed' : ''} ${menu?.id === g.id ? 'menu-open' : ''}`}
                style={shiftStyle}
                role="button"
                tabIndex={0}
                aria-expanded={!g.collapsed}
                onClick={() => !renaming && dispatch({ type: 'group/toggle', id: g.id })}
                onDoubleClick={() => setRenamingId(`g:${g.id}`)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    dispatch({ type: 'group/toggle', id: g.id });
                  }
                }}
              >
                <IconChevron className="group-chev" />
                <IconFolder className="group-icon" />
                {renaming ? (
                  <RenameInput
                    value={g.name}
                    onDone={(name) => {
                      setRenamingId(null);
                      if (name != null && name.trim() && name.trim() !== g.name) dispatch({ type: 'group/rename', id: g.id, name, record: true });
                    }}
                  />
                ) : (
                  <span className="topic-name">{g.name}</span>
                )}
                <span className="topic-count">{it.count}</span>
                <button
                  type="button"
                  className="topic-more icon-btn"
                  aria-label={`Options for ${g.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenu(menu?.id === g.id ? null : { kind: 'group', id: g.id, anchor: e.currentTarget });
                  }}
                >
                  <IconMore />
                </button>
              </div>
            );
          }
          const t = it.topic;
          const isActive = t.id === activeTopicId;
          const isDragging = drag?.id === t.id;
          const s = stats[t.id] || { count: 0 };
          return (
            <div
              key={t.id}
              data-row
              data-topic-row
              className={`topic-row ${it.groupId ? 'in-group' : ''} ${isActive ? 'is-active' : ''} ${isDragging ? 'is-dragging' : ''} ${menu?.id === t.id ? 'menu-open' : ''}`}
              style={isDragging ? { transform: `translateY(${drag.dy}px)` } : shiftStyle}
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
                style={{ background: s.color ? COLOR_MAP[s.color]?.edge : 'transparent' }}
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
                  setMenu(menu?.id === t.id ? null : { kind: 'topic', id: t.id, anchor: e.currentTarget });
                }}
              >
                <IconMore />
              </button>
            </div>
          );
        })}
        {topics.length > 0 && (
          <button type="button" className="topic-new" onClick={() => addTopic()} title="New topic">
            <span className="topic-new-icon" aria-hidden="true">
              <IconPlus />
            </span>
            New Topic
          </button>
        )}
        {topics.length > 0 && (
          <button type="button" className="topic-new" onClick={() => addGroup()} title="New group">
            <span className="topic-new-icon" aria-hidden="true">
              <IconFolderPlus />
            </span>
            New Group
          </button>
        )}
      </nav>

      <div className="sidebar-footer">
        <button type="button" className="profile" onClick={() => onOpenAccount?.()} title="Account">
          <Avatar username={handle} />
          <span className="profile-text">
            <span className="profile-name">@{handle}</span>
            <span className="profile-sub">
              <SyncLabel account={account} />
            </span>
          </span>
        </button>
        <button
          type="button"
          className={`icon-btn settings-btn footer-settings ${settingsAnchor ? 'is-active' : ''}`}
          onClick={(e) => setSettingsAnchor(settingsAnchor ? null : e.currentTarget)}
          title="Settings"
          aria-label="Settings"
        >
          <IconGear />
        </button>
      </div>
      {settingsAnchor && (
        <SettingsSheet data={data} dispatch={dispatch} toast={toast} confirm={confirm} account={account} onClose={closeSettings} />
      )}

      {menuGroup && (
        <Popover anchor={menu.anchor} onClose={closeMenu} align="end" className="menu">
          <MenuItem
            icon={IconPlus}
            onClick={() => {
              setMenu(null);
              addTopic(menuGroup.id);
            }}
          >
            New Topic in Group
          </MenuItem>
          <MenuItem
            icon={IconEdit}
            onClick={() => {
              setMenu(null);
              setRenamingId(`g:${menuGroup.id}`);
            }}
          >
            Rename
          </MenuItem>
          <MenuSep />
          <MenuItem
            icon={IconTrash}
            danger
            onClick={() => {
              setMenu(null);
              dispatch({ type: 'group/delete', id: menuGroup.id, record: true });
              toast(`Removed group “${menuGroup.name}” — its topics are kept`, { undo: true });
            }}
          >
            Delete Group
          </MenuItem>
        </Popover>
      )}

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
          <MenuItem
            icon={IconShare}
            onClick={() => {
              setMenu(null);
              onSelectTopic(menuTopic.id);
              onClose?.(); // on phones, close the drawer so the panel can show
              // Opened on the next frame, once the topic is on screen.
              requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('postit:share')));
            }}
          >
            Share…
          </MenuItem>
          <MenuSep />
          <MenuLabel>Move to</MenuLabel>
          {groups
            .filter((g) => g.id !== menuTopic.groupId)
            .map((g) => (
              <MenuItem
                key={g.id}
                icon={IconFolder}
                onClick={() => {
                  setMenu(null);
                  dispatch({ type: 'topic/move', id: menuTopic.id, groupId: g.id, beforeId: null, record: true });
                  if (g.collapsed) dispatch({ type: 'group/toggle', id: g.id });
                }}
              >
                {g.name}
              </MenuItem>
            ))}
          {menuTopic.groupId && (
            <MenuItem
              icon={IconSidebar}
              onClick={() => {
                setMenu(null);
                dispatch({ type: 'topic/move', id: menuTopic.id, groupId: null, beforeId: null, record: true });
              }}
            >
              Out of group
            </MenuItem>
          )}
          <MenuItem
            icon={IconFolderPlus}
            onClick={() => {
              setMenu(null);
              addGroup(menuTopic.id);
            }}
          >
            New Group…
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
