import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { COLOR_MAP } from '../store.js';
import { IconMore } from './Icons.jsx';

function autosize(el) {
  if (!el) return;
  el.style.height = '0px';
  el.style.height = `${el.scrollHeight}px`;
}

/** Wrap occurrences of `query` in <mark> so search hits are visible on the wall. */
function highlight(text, query) {
  if (!query) return text;
  const q = query.toLowerCase();
  const lower = text.toLowerCase();
  const out = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const j = lower.indexOf(q, i);
    if (j < 0) break;
    if (j > i) out.push(text.slice(i, j));
    out.push(<mark key={k++}>{text.slice(j, j + q.length)}</mark>);
    i = j + q.length;
  }
  if (i < text.length) out.push(text.slice(i));
  return out;
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
  const bodyRef = useRef(null);
  const dirty = useRef(false);
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
    if (!editing) dirty.current = false;
  }, [editing]);

  // Enter edit mode: focus the clicked field and place the caret where the user clicked.
  useLayoutEffect(() => {
    if (!editing) return;
    autosize(titleRef.current);
    if (!fixed) autosize(bodyRef.current);
    const el = editField === 'title' ? titleRef.current : bodyRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const len = el.value.length;
    const pos = editCaret == null ? len : Math.max(0, Math.min(editCaret, len));
    el.setSelectionRange(pos, pos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, editToken]);

  useLayoutEffect(() => {
    if (!editing) return;
    autosize(titleRef.current);
    if (!fixed) autosize(bodyRef.current);
  }, [editing, note.title, note.body, note.w, fixed]);

  const change = (field, value) => {
    if (!dirty.current) {
      dirty.current = true;
      api.checkpoint();
    }
    api.update(note.id, { [field]: value });
  };

  const onFieldKey = (e, field) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      api.stopEditing(note.id);
    } else if (field === 'title' && (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey))) {
      e.preventDefault();
      api.startEdit(note.id, 'body', 0);
    } else if (field === 'body' && e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      api.startEdit(note.id, 'title', null);
    } else if (field === 'body' && e.key === 'Backspace' && e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0) {
      e.preventDefault();
      api.startEdit(note.id, 'title', null);
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
        // Outside edit mode a press should drag the note, never start a text selection.
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
              onChange={(e) => change('title', e.target.value.replace(/\n/g, ' '))}
              onKeyDown={(e) => onFieldKey(e, 'title')}
              onFocus={() => api.fieldFocus(note.id, 'title')}
            />
            <textarea
              ref={bodyRef}
              className="note-body note-input"
              value={note.body}
              placeholder="Write something…"
              spellCheck
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => change('body', e.target.value)}
              onKeyDown={(e) => onFieldKey(e, 'body')}
              onFocus={() => api.fieldFocus(note.id, 'body')}
            />
          </>
        ) : (
          <>
            {note.title && (
              <div className="note-title" data-field="title">
                {highlight(note.title, query)}
              </div>
            )}
            <div className="note-body" data-field="body" data-empty={note.body ? undefined : ''}>
              {highlight(note.body, query)}
            </div>
          </>
        )}
      </div>

      <div className="note-resize" data-resize title="Drag to resize" aria-hidden="true" />
    </div>
  );
});
