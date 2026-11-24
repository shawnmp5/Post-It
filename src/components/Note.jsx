import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { COLOR_MAP, uid } from '../store.js';
import { IconMore } from './Icons.jsx';
import { NoteBody, highlight } from './NoteBody.jsx';
import { SlashMenu } from './SlashMenu.jsx';
import { TRIGGER, applyCommand, continueList, filterCommands, imageFileToDataURL, toggleCheck } from '../blocks.js';

function autosize(el) {
  if (!el) return;
  el.style.height = '0px';
  el.style.height = `${el.scrollHeight}px`;
}

/** Viewport rect of the caret inside a textarea (mirror-element technique). */
function caretRect(ta) {
  const cs = getComputedStyle(ta);
  const div = document.createElement('div');
  for (const k of [
    'boxSizing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth',
    'borderBottomWidth', 'borderLeftWidth', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
    'lineHeight', 'textTransform', 'wordSpacing', 'tabSize',
  ])
    div.style[k] = cs[k];
  Object.assign(div.style, {
    position: 'absolute',
    visibility: 'hidden',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    top: `${ta.offsetTop}px`,
    left: `${ta.offsetLeft}px`,
    width: `${ta.offsetWidth}px`,
  });
  div.textContent = ta.value.slice(0, ta.selectionStart);
  const mark = document.createElement('span');
  mark.textContent = '\u200b';
  div.appendChild(mark);
  ta.parentNode.appendChild(div);
  const r = mark.getBoundingClientRect();
  div.remove();
  return { left: r.left, top: r.top, bottom: r.bottom };
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
  const pendingSel = useRef(null);
  const fileRef = useRef(null);
  const imageAt = useRef(null);
  const latestBody = useRef(note.body);
  latestBody.current = note.body;
  const [slash, setSlash] = useState(null); // { from, query, at, active }
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
    if (!editing) {
      dirty.current = false;
      setSlash(null);
    }
  }, [editing]);

  // Restore the caret after a command rewrote the text.
  useLayoutEffect(() => {
    const sel = pendingSel.current;
    if (!sel || !bodyRef.current) return;
    pendingSel.current = null;
    bodyRef.current.focus({ preventScroll: true });
    bodyRef.current.setSelectionRange(sel[0], sel[1]);
  }, [note.body]);

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

  const setBody = (res, extraPatch) => {
    if (!dirty.current) {
      dirty.current = true;
      api.checkpoint();
    }
    pendingSel.current = [res.selStart, res.selEnd];
    api.update(note.id, { body: res.value, ...extraPatch });
  };

  const closeSlash = useCallback(() => setSlash(null), []);
  const items = slash ? filterCommands(slash.query) : [];

  const pick = (cmd) => {
    const ta = bodyRef.current;
    if (!slash || !ta) return;
    const from = slash.from;
    const to = ta.selectionStart;
    setSlash(null);
    if (cmd.id === 'image') {
      const v = ta.value.slice(0, from) + ta.value.slice(to);
      setBody({ value: v, selStart: from, selEnd: from });
      imageAt.current = from;
      fileRef.current?.click();
      return;
    }
    setBody(applyCommand(ta.value, from, to, cmd.id));
  };

  const insertImage = async (file, at) => {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const url = await imageFileToDataURL(file);
      const id = uid('img');
      const body = latestBody.current;
      const pos = Math.min(at ?? body.length, body.length);
      const res = applyCommand(body, pos, pos, 'image', { imageId: id });
      api.checkpoint();
      pendingSel.current = [res.selStart, res.selEnd];
      api.update(note.id, { body: res.value, images: { ...(note.images || {}), [id]: url } });
    } catch {
      api.toast?.('That image couldn\u2019t be read');
    }
  };

  // Track the trigger key and the text typed after it.
  const onBodyChange = (e) => {
    const ta = e.target;
    const v = ta.value;
    const pos = ta.selectionStart;
    change('body', v);
    if (slash) {
      const q = v.slice(slash.from + 1, pos);
      if (pos <= slash.from || v[slash.from] !== TRIGGER || /\s/.test(q) || q.length > 24) setSlash(null);
      else setSlash((s) => s && { ...s, query: q, active: 0 });
    } else if (v[pos - 1] === TRIGGER && (pos === 1 || /\s/.test(v[pos - 2])) && v.length > note.body.length) {
      setSlash({ from: pos - 1, query: '', active: 0, at: caretRect(ta) });
    }
  };

  const onFieldKey = (e, field) => {
    if (field === 'body' && slash) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = items.length || 1;
        setSlash((s) => ({ ...s, active: (s.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n }));
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && items.length) {
        e.preventDefault();
        pick(items[Math.min(slash.active, items.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setSlash(null);
        return;
      }
    }
    if (field === 'body' && e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const ta = e.currentTarget;
      const res = continueList(ta.value, ta.selectionStart, ta.selectionEnd);
      if (res) {
        e.preventDefault();
        setBody(res);
        return;
      }
    }
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
              placeholder={`Write something… or type ${TRIGGER} for blocks`}
              spellCheck
              onPointerDown={(e) => e.stopPropagation()}
              onChange={onBodyChange}
              onKeyDown={(e) => onFieldKey(e, 'body')}
              onFocus={() => api.fieldFocus(note.id, 'body')}
              onBlur={closeSlash}
              onClick={() => slash && setSlash(null)}
              onPaste={(e) => {
                const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
                if (!file) return;
                e.preventDefault();
                insertImage(file, e.currentTarget.selectionStart);
              }}
            />
            {slash && (
              <SlashMenu
                at={slash.at}
                items={items}
                active={Math.min(slash.active, Math.max(0, items.length - 1))}
                onPick={pick}
                onHover={(i) => setSlash((s) => s && { ...s, active: i })}
                onClose={closeSlash}
              />
            )}
          </>
        ) : (
          <>
            {note.title && (
              <div className="note-title" data-field="title" data-offset="0">
                {highlight(note.title, query)}
              </div>
            )}
            <div className="note-body" data-field="body" data-empty={note.body ? undefined : ''}>
              <NoteBody
                body={note.body}
                images={note.images}
                query={query}
                onToggleCheck={(mark) => {
                  api.checkpoint();
                  api.update(note.id, { body: toggleCheck(note.body, mark) });
                }}
              />
            </div>
          </>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          insertImage(f, imageAt.current);
        }}
      />
      <div className="note-resize" data-resize title="Drag to resize" aria-hidden="true" />
    </div>
  );
});
