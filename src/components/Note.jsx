import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { COLOR_MAP } from '../store.js';
import { IconMore } from './Icons.jsx';
import { BlockEditor, NoteView, highlight } from './NoteBlocks.jsx';

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
        transform: `translate3d(${note.x}px, ${note.y}px, 0) rotate(var(--rot))`,
        width: note.w,
        height: fixed ? note.h : undefined,
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
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => {
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
      </div>

      <div className="note-resize" data-resize title="Drag to resize" aria-hidden="true" />
    </div>
  );
});
