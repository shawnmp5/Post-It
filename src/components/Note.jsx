import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { typing, fixCaps } from '../autoCaps.js';
import { COLOR_MAP } from '../store.js';
import { IconMore, IconTrash } from './Icons.jsx';
import { BlockEditor, NoteView, highlight } from './NoteBlocks.jsx';
import { NoteSticker } from './Stickers.jsx';
import { BellIcon, ReminderChip } from './Reminders.jsx';

function autosize(el) {
  if (!el) return;
  el.style.height = '0px';
  el.style.height = `${el.scrollHeight}px`;
}

/** Small stable variation per note so the tape doesn't look copy-pasted. */
function tapeFor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  h = Math.abs(h);
  return { rot: ((h % 9) - 4) * 0.9, dx: ((h >> 4) % 15) - 7, w: 68 + ((h >> 8) % 16) };
}

export const Note = memo(function Note({
  note,
  api,
  editing,
  editField,
  editToken,
  editCaret,
  selected,
  dragging,
  dimmed,
  matched,
  flash,
  query,
  tilt,
  isNew,
  menuOpen,
  connecting,
}) {
  const ref = useRef(null);
  const titleRef = useRef(null);
  const titleDirty = useRef(false);
  const fixed = note.h != null;
  const color = COLOR_MAP[note.color] || COLOR_MAP.yellow;
  const tape = tapeFor(note.id);

  // Report rendered height so the canvas can size itself and draw connections.
  useLayoutEffect(() => {
    const el = ref.current;
    api.observe(note.id, el);
    return () => api.unobserve(note.id, el);
  }, [api, note.id]);

  useEffect(() => {
    if (!editing) titleDirty.current = false;
  }, [editing]);

  // Focus the title when asked to (the body editor focuses itself).
  useLayoutEffect(() => {
    if (!editing) return;
    autosize(titleRef.current);
    if (editField !== 'title' || !titleRef.current) return;
    const el = titleRef.current;
    el.focus({ preventScroll: true });
    const len = el.value.length;
    const pos = editCaret == null ? len : Math.max(0, Math.min(editCaret, len));
    el.setSelectionRange(pos, pos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, editToken]);

  useLayoutEffect(() => {
    if (editing) autosize(titleRef.current);
  }, [editing, note.title, note.w]);

  const onTitleKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      api.stopEditing(note.id);
    } else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      api.startEdit(note.id, 'body', 0);
    } else if (e.key === 'ArrowDown' && e.currentTarget.selectionStart === e.currentTarget.value.length) {
      e.preventDefault();
      api.startEdit(note.id, 'body', 0);
    }
  };

  const rotation = editing || !tilt ? 0 : note.rotation;
  const cls = [
    'note',
    fixed ? 'is-fixed' : 'is-auto',
    editing && 'is-editing',
    selected && 'is-selected',
    dragging && 'is-dragging',
    dimmed && 'is-dimmed',
    matched && 'is-matched',
    flash && 'is-flash',
    isNew && 'is-new',
    menuOpen && 'menu-open',
    connecting && 'is-connect-target',
    note.color === 'white' && 'is-white',
    note.reminder && note.reminder.at <= Date.now() && 'is-reminder-due',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={ref}
      className={cls}
      data-note-id={note.id}
      style={{
        '--note-bg': color.bg,
        '--note-edge': color.edge,
        '--rot': `${rotation}deg`,
        transform: `translate(${note.x}px, ${note.y}px) rotate(var(--rot))`,
        width: note.w,
        // A resized note keeps at least that size but always grows to fit its content — nothing is ever cut off.
        minHeight: fixed ? note.h : undefined,
        zIndex: dragging ? 100000 : note.z,
      }}
      onPointerDown={(e) => api.pointerDown(e, note.id)}
      onMouseDown={(e) => {
        // Outside edit mode a press should never start a text selection.
        if (!editing && !e.target.closest('button')) e.preventDefault();
      }}
    >
      <div className="note-paper" aria-hidden="true" />
      {/* The tape is the handle: grab it to move the note. */}
      <div
        className="note-tape"
        data-grip
        title="Drag to move"
        style={{ transform: `translateX(calc(-50% + ${tape.dx}px)) rotate(${tape.rot}deg)` }}
      >
        <span className="note-tape-strip" style={{ width: tape.w }} />
      </div>
      <div className="note-bar">
        <button
          type="button"
          className={`note-react note-remind ${note.reminder ? 'has-reminder' : ''}`}
          aria-label={note.reminder ? 'Change reminder' : 'Remind me'}
          title={note.reminder ? 'Change reminder' : 'Remind me'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            api.openReminder(note.id, e.currentTarget);
          }}
        >
          <BellIcon width="14" height="14" />
        </button>
        <button
          type="button"
          className="note-react"
          aria-label="Add a sticker"
          title="Add a sticker"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            api.openStickers(note.id, e.currentTarget);
          }}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" aria-hidden="true">
            <path d="M14 8.6V8A6 6 0 1 0 8.6 14" />
            <path d="M14 8.6 8.6 14c0-3 2.4-5.4 5.4-5.4Z" strokeLinejoin="round" />
            <path d="M5.6 9.8c.6.7 1.4 1 2.4 1" />
            <circle cx="5.9" cy="6.4" r=".5" fill="currentColor" />
            <circle cx="10.1" cy="6.4" r=".5" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className="note-react note-trash"
          aria-label="Delete note"
          title="Delete note"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            api.deleteNote(note.id);
          }}
        >
          <IconTrash width="14" height="14" />
        </button>
        <button
          type="button"
          className="note-more"
          aria-label="Note options"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            api.openMenu(note.id, e.currentTarget);
          }}
        >
          <IconMore />
        </button>
      </div>

      <div className="note-content">
        {editing ? (
          <>
            <textarea
              ref={titleRef}
              className="note-title note-input"
              rows={1}
              value={note.title}
              placeholder="Title"
              maxLength={200}
              spellCheck
              autoCapitalize={typing.autoCaps ? 'sentences' : 'off'}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                fixCaps(e.target, note.title);
                if (!titleDirty.current) {
                  titleDirty.current = true;
                  api.checkpoint();
                }
                api.update(note.id, { title: e.target.value.replace(/\n/g, ' ') });
              }}
              onKeyDown={onTitleKey}
            />
            <div className="note-body">
              <BlockEditor
                note={note}
                api={api}
                tint={color.bg}
                focusReq={{ field: editField, caret: editCaret, token: editToken }}
                onExitTop={() => api.startEdit(note.id, 'title', null)}
              />
            </div>
          </>
        ) : (
          <>
            {note.title && (
              <div className="note-title" data-field="title" data-offset="0">
                {highlight(note.title, query)}
              </div>
            )}
            <div className="note-body" data-field="body" data-empty={note.body ? undefined : ''}>
              {note.body && (
                <NoteView
                  body={note.body}
                  images={note.images}
                  query={query}
                  onBodyChange={(body) => {
                    api.checkpoint();
                    api.update(note.id, { body });
                  }}
                />
              )}
            </div>
          </>
        )}
        {note.reminder && (
          <ReminderChip
            reminder={note.reminder}
            onOpen={(el) => api.openReminder(note.id, el)}
            onDone={() => {
              api.checkpoint();
              api.update(note.id, { reminder: null });
              api.toast?.('Reminder done', { undo: true });
            }}
          />
        )}
      </div>

      {(note.stickers || []).map((s) => (
        <NoteSticker
          key={s.id}
          s={s}
          noteRotation={rotation}
          getZoom={api.zoom}
          fresh={Date.now() - (s.addedAt || 0) < 1500}
          onMove={(id, x, y) => {
            const w = note.w;
            const h = ref.current?.offsetHeight || 160;
            api.checkpoint();
            api.update(note.id, {
              stickers: note.stickers.map((t) =>
                t.id === id ? { ...t, x: Math.round(Math.min(w + 10, Math.max(-10, x))), y: Math.round(Math.min(h + 10, Math.max(-10, y))) } : t,
              ),
            });
          }}
          onRemove={(id) => {
            api.checkpoint();
            api.update(note.id, { stickers: note.stickers.filter((t) => t.id !== id) });
          }}
        />
      ))}

      {/* Invisible resize zones: edges resize horizontally or vertically, corners diagonally. */}
      {['n', 'e', 's', 'w'].map((c) => (
        <div key={c} className={`note-edge is-${c}`} data-resize={c} aria-hidden="true" />
      ))}
      {['nw', 'ne', 'sw', 'se'].map((c) => (
        <div key={c} className={`note-handle is-${c}`} data-resize={c} title="Drag to resize" aria-hidden="true" />
      ))}
    </div>
  );
});
