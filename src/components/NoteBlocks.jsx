import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { uid } from '../store.js';
import { SlashMenu } from './SlashMenu.jsx';
import { Popover, MenuItem, MenuSep } from './Popover.jsx';
import { IconArrowDown, IconArrowLeft, IconArrowRight, IconArrowUp, IconMinus, IconTrash } from './Icons.jsx';
import {
  LISTS,
  TEXTUAL,
  TRIGGER,
  filterCommands,
  fromBlocks,
  imageFileToDataURL,
  locate,
  menuLayout,
  moveInMenu,
  newBlock,
  positions,
  toBlocks,
  todayString,
} from '../blocks.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Wrap occurrences of `query` in <mark> so search hits are visible on the wall. */
export function highlight(text, query) {
  if (!query || !text) return text;
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

/** Viewport rect of the caret inside a textarea (mirror-element technique). */
export function caretRect(ta) {
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
    top: '0px',
    left: '0px',
    width: `${ta.offsetWidth}px`,
  });
  div.textContent = ta.value.slice(0, ta.selectionStart);
  const mark = document.createElement('span');
  mark.textContent = '\u200b';
  div.appendChild(mark);
  ta.parentNode.appendChild(div);
  // Line the mirror up with the textarea whatever its containing block is (zoom-aware).
  const tr = ta.getBoundingClientRect();
  const dr = div.getBoundingClientRect();
  const scale = dr.width / div.offsetWidth || 1;
  div.style.left = `${(tr.left - dr.left) / scale}px`;
  div.style.top = `${(tr.top - dr.top) / scale}px`;
  const r = mark.getBoundingClientRect();
  div.remove();
  return { left: r.left, top: r.top, bottom: r.bottom };
}

/** Is the caret on the first / last visual line of the textarea? */
function caretLine(ta) {
  const r = ta.getBoundingClientRect();
  const c = caretRect(ta);
  const lh = c.bottom - c.top || 16;
  return { first: c.top - r.top < lh * 0.75, last: r.bottom - c.bottom < lh * 0.75 };
}

const stop = (e) => e.stopPropagation();
const keep = (e) => e.preventDefault(); // keep focus where it is

function AutoTextarea({ inputRef, value, sizeKey, className, ...rest }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, sizeKey]);
  return (
    <textarea
      ref={(el) => {
        ref.current = el;
        inputRef?.(el);
      }}
      rows={1}
      value={value}
      className={className}
      spellCheck
      onPointerDown={stop}
      {...rest}
    />
  );
}

const CheckMark = () => (
  <svg viewBox="0 0 12 12" aria-hidden="true">
    <path d="M2.5 6.3 5 8.6l4.6-5" />
  </svg>
);

/* ------------------------------------------------------------------ */
/* Rendering — shared by the read view and the editor so they line up  */
/* ------------------------------------------------------------------ */

function BlockList({ blocks, mode, images, query, sizeKey, ed, onToggle }) {
  const pos = positions(blocks);
  const out = [];
  let n = 0;
  blocks.forEach((b, i) => {
    n = b.type === 'number' ? n + 1 : 0;
    out.push(
      <Block
        key={b.id}
        b={b}
        i={i}
        n={n}
        start={pos[i]}
        sole={blocks.length === 1}
        mode={mode}
        images={images}
        query={query}
        sizeKey={sizeKey}
        ed={ed}
        onToggle={onToggle}
      />,
    );
    // A small progress meter under each checklist.
    if (b.type === 'check' && blocks[i + 1]?.type !== 'check') {
      let j = i;
      while (j >= 0 && blocks[j].type === 'check') j--;
      const run = blocks.slice(j + 1, i + 1);
      if (run.length >= 2) {
        const done = run.filter((x) => x.checked).length;
        out.push(
          <div
            key={`${b.id}-progress`}
            className={`blk-progress ${done === run.length ? 'is-complete' : ''}`}
            aria-label={`${done} of ${run.length} done`}
          >
            <span className="blk-progress-bar">
              <i style={{ width: `${(done / run.length) * 100}%` }} />
            </span>
            <span className="blk-progress-text">
              {done === run.length ? 'All done' : `${done}/${run.length}`}
            </span>
          </div>,
        );
      }
    }
  });
  return out;
}

const PLACEHOLDER = {
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  bullet: 'List item',
  number: 'List item',
  check: 'To-do',
  quote: 'Quote',
  code: 'Code',
};

function Block({ b, i, n, start, sole, mode, images, query, sizeKey, ed, onToggle }) {
  const edit = mode === 'edit';

  const field = (extraCls = '') =>
    edit ? (
      <AutoTextarea
        className={`blk-input ${extraCls}`}
        value={b.text}
        sizeKey={sizeKey}
        placeholder={
          PLACEHOLDER[b.type] ?? (sole ? `Write something… or type ${TRIGGER} for blocks` : `Type ${TRIGGER} for blocks`)
        }
        inputRef={ed.ref(b.id)}
        onChange={(e) => ed.change(i, e.target.value, e.target.selectionStart)}
        onKeyDown={(e) => ed.key(e, i)}
        onPaste={(e) => ed.paste(e, i)}
        onBlur={() => ed.blur(b.id)}
        onClick={() => ed.clickField(b.id)}
      />
    ) : (
      <div className={`blk-input ${extraCls}`} data-offset={start}>
        {b.text ? highlight(b.text, query) : <br />}
      </div>
    );

  const remove = (label) =>
    edit && (
      <button type="button" className="blk-remove" aria-label={label} title={label} onPointerDown={stop} onMouseDown={keep} onClick={() => ed.remove(i)}>
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="m3 3 6 6M9 3 3 9" />
        </svg>
      </button>
    );

  switch (b.type) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'quote':
      return <div className={`blk blk-${b.type}`}>{field()}</div>;
    case 'bullet':
      return (
        <div className="blk blk-bullet">
          <span className="blk-mark" aria-hidden="true" />
          {field()}
        </div>
      );
    case 'number':
      return (
        <div className="blk blk-number">
          <span className="blk-mark" aria-hidden="true">
            {n}.
          </span>
          {field()}
        </div>
      );
    case 'check':
      return (
        <div className={`blk blk-check ${b.checked ? 'is-done' : ''}`}>
          <button
            type="button"
            className="blk-box"
            role="checkbox"
            aria-checked={!!b.checked}
            aria-label={b.checked ? 'Mark as not done' : 'Mark as done'}
            onPointerDown={stop}
            onMouseDown={keep}
            onClick={(e) => {
              e.stopPropagation();
              if (edit) ed.toggle(i);
              else onToggle(i);
            }}
          >
            <CheckMark />
          </button>
          {field()}
        </div>
      );
    case 'code':
      return (
        <div className="blk blk-code">
          {field('is-mono')}
          <CopyButton text={b.text} />
        </div>
      );
    case 'hr':
      return (
        <div className="blk blk-hr" role="separator">
          <span className="hr-line" />
          <span className="hr-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="hr-line is-r" />
          {remove('Remove divider')}
        </div>
      );
    case 'image': {
      const src = b.src?.startsWith('img:') ? images?.[b.src.slice(4)] : /^(https?:|data:image\/)/.test(b.src || '') ? b.src : null;
      return (
        <div className="blk blk-image">
          {src ? <img src={src} alt={b.alt || ''} draggable={false} /> : <div className="blk-img-missing">Image not found</div>}
          {remove('Remove image')}
        </div>
      );
    }
    case 'table':
      return <TableBlock b={b} i={i} start={start} edit={edit} query={query} sizeKey={sizeKey} ed={ed} />;
    default:
      return <div className={`blk blk-text ${sole ? 'is-sole' : ''}`}>{field()}</div>;
  }
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      className={`blk-copy ${copied ? 'is-copied' : ''}`}
      onPointerDown={stop}
      onMouseDown={keep}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          })
          .catch(() => {});
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

const Dots = ({ vertical }) =>
  vertical ? (
    <svg viewBox="0 0 4 14" width="4" height="14" aria-hidden="true">
      <circle cx="2" cy="2" r="1.3" />
      <circle cx="2" cy="7" r="1.3" />
      <circle cx="2" cy="12" r="1.3" />
    </svg>
  ) : (
    <svg viewBox="0 0 14 4" width="14" height="4" aria-hidden="true">
      <circle cx="2" cy="2" r="1.3" />
      <circle cx="7" cy="2" r="1.3" />
      <circle cx="12" cy="2" r="1.3" />
    </svg>
  );

/** Table: rounded, see-through frame. While editing, hovering a cell shows row/column handles and + strips. */
function TableBlock({ b, i, start, edit, query, sizeKey, ed }) {
  const cols = b.rows[0].length;
  const [hover, setHover] = useState(null); // { r, c }
  const [menu, setMenu] = useState(null); // { kind, r, c, anchor }
  const closeMenu = useCallback(() => setMenu(null), []);
  const act = (op) => {
    ed.table(i, op, { r: menu.r, c: menu.c });
    setMenu(null);
  };
  const pill = (kind, r, c) => (
    <button
      type="button"
      className={`tbl-pill is-${kind}`}
      aria-label={kind === 'col' ? 'Column options' : 'Row options'}
      onPointerDown={stop}
      onMouseDown={keep}
      onClick={(e) => {
        e.stopPropagation();
        setMenu({ kind, r, c, anchor: e.currentTarget });
      }}
    >
      <Dots vertical={kind === 'row'} />
    </button>
  );

  return (
    <div className={`blk blk-table ${edit ? 'is-edit' : ''}`} onMouseLeave={() => !menu && setHover(null)}>
      <table>
        <tbody>
          {b.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => {
                const Tag = r === 0 ? 'th' : 'td';
                return (
                  <Tag key={c} onMouseEnter={edit ? () => setHover({ r, c }) : undefined}>
                    {edit && r === 0 && (hover?.c === c || (menu?.kind === 'col' && menu.c === c)) && pill('col', r, c)}
                    {edit && c === 0 && r > 0 && (hover?.r === r || (menu?.kind === 'row' && menu.r === r)) && pill('row', r, c)}
                    {edit ? (
                      <AutoTextarea
                        className="blk-cell"
                        value={cell}
                        sizeKey={`${sizeKey}-${cols}`}
                        placeholder={r === 0 ? 'Column' : ''}
                        inputRef={ed.ref(`${b.id}:${r}:${c}`)}
                        onChange={(e) => ed.cell(i, r, c, e.target.value)}
                        onKeyDown={(e) => ed.cellKey(e, i, r, c)}
                        onFocus={() => {
                          ed.cellFocus(b.id, r, c);
                          setHover({ r, c });
                        }}
                      />
                    ) : (
                      <div className="blk-cell" data-offset={start + r * cols + c} data-exact="">
                        {cell ? highlight(cell, query) : <br />}
                      </div>
                    )}
                  </Tag>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {edit && (
        <>
          <button
            type="button"
            className="tbl-add is-col"
            title="Add column"
            aria-label="Add column"
            onPointerDown={stop}
            onMouseDown={keep}
            onClick={() => ed.table(i, 'col-end')}
          >
            +
          </button>
          <button
            type="button"
            className="tbl-add is-row"
            title="Add row"
            aria-label="Add row"
            onPointerDown={stop}
            onMouseDown={keep}
            onClick={() => ed.table(i, 'row-end')}
          >
            +
          </button>
        </>
      )}
      {menu && (
        <Popover anchor={menu.anchor} onClose={closeMenu} className="menu tbl-menu">
          {menu.kind === 'col' ? (
            <>
              <MenuItem icon={IconArrowLeft} onClick={() => act('col-left')}>Insert column left</MenuItem>
              <MenuItem icon={IconArrowRight} onClick={() => act('col-right')}>Insert column right</MenuItem>
              <MenuItem icon={IconMinus} danger disabled={cols <= 1} onClick={() => act('col-del')}>
                Delete column
              </MenuItem>
            </>
          ) : (
            <>
              <MenuItem icon={IconArrowUp} onClick={() => act('row-above')}>Insert row above</MenuItem>
              <MenuItem icon={IconArrowDown} onClick={() => act('row-below')}>Insert row below</MenuItem>
              <MenuItem icon={IconMinus} danger disabled={b.rows.length <= 1} onClick={() => act('row-del')}>
                Delete row
              </MenuItem>
            </>
          )}
          <MenuSep />
          <MenuItem icon={IconTrash} danger onClick={() => act('delete')}>
            Delete table
          </MenuItem>
        </Popover>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Read view                                                           */
/* ------------------------------------------------------------------ */

export function NoteView({ body, images, query, onBodyChange }) {
  const blocks = useMemo(() => toBlocks(body), [body]);
  return (
    <BlockList
      blocks={blocks}
      mode="view"
      images={images}
      query={query}
      onToggle={(i) => onBodyChange(fromBlocks(blocks.map((b, j) => (j === i ? { ...b, checked: !b.checked } : b))))}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

export function BlockEditor({ note, api, focusReq, tint, onExitTop }) {
  const [blocks, setBlocks] = useState(() => toBlocks(note.body));
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const committed = useRef(note.body);
  const imagesRef = useRef(note.images);
  imagesRef.current = note.images;
  const refs = useRef(new Map());
  const pending = useRef(null);
  const dirty = useRef(false);
  const fileRef = useRef(null);
  const imageAfter = useRef(null);
  const cellAt = useRef(null);
  const [slash, setSlash] = useState(null); // { id, from, query, active, at }

  // Undo / another tab changed the text: rebuild the blocks.
  useEffect(() => {
    if (note.body !== committed.current) {
      committed.current = note.body;
      setBlocks(toBlocks(note.body));
      setSlash(null);
    }
  }, [note.body]);

  const focusKey = useCallback((key, offset) => {
    const el = refs.current.get(key);
    if (!el) return false;
    el.focus({ preventScroll: false });
    const len = el.value.length;
    const p = offset === 'end' || offset == null ? len : Math.max(0, Math.min(offset, len));
    el.setSelectionRange(p, p);
    return true;
  }, []);

  // Apply focus requested by the last edit, once the DOM has the new blocks.
  useLayoutEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    focusKey(p.key, p.offset);
    if (p.selectLen) refs.current.get(p.key)?.setSelectionRange(p.offset, p.offset + p.selectLen);
  });

  // Focus requested by the wall (a click on the note, Enter from the title, …).
  useLayoutEffect(() => {
    if (focusReq.field !== 'body') return;
    const loc = locate(blocksRef.current, focusReq.caret);
    if (loc) focusKey(loc.key, loc.offset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusReq.token, focusReq.field]);

  const commit = (next, focus, extraPatch) => {
    if (!next.length) next = [newBlock()];
    blocksRef.current = next;
    setBlocks(next);
    if (focus) pending.current = focus;
    const body = fromBlocks(next);
    if (body !== committed.current || extraPatch) {
      if (!dirty.current) {
        dirty.current = true;
        api.checkpoint();
      }
      committed.current = body;
      api.update(note.id, { body, ...extraPatch });
    }
  };

  const set = (arr, i, patch) => arr.map((b, j) => (j === i ? { ...b, ...patch } : b));
  const insertAt = (arr, i, ...items) => [...arr.slice(0, i), ...items, ...arr.slice(i)];
  const without = (arr, i) => arr.filter((_, j) => j !== i);
  const focusable = (b) => TEXTUAL.has(b.type) || b.type === 'table';
  const startKey = (b) => (b.type === 'table' ? `${b.id}:0:0` : b.id);
  const endKey = (b) => (b.type === 'table' ? `${b.id}:${b.rows.length - 1}:${b.rows[0].length - 1}` : b.id);

  const focusPrev = (i) => {
    for (let j = i - 1; j >= 0; j--) if (focusable(blocks[j])) return focusKey(endKey(blocks[j]), 'end');
    return false;
  };
  const focusNext = (i) => {
    for (let j = i + 1; j < blocks.length; j++) if (focusable(blocks[j])) return focusKey(startKey(blocks[j]), 0);
    return false;
  };

  /** Put `nb` at block i (replacing it if empty, else after it) and make sure there's a line to keep typing on. */
  const place = (arr, i, nb, focusInside) => {
    const cur = arr[i];
    let next;
    let idx;
    if (cur && cur.type === 'text' && cur.text === '') {
      next = [...arr.slice(0, i), nb, ...arr.slice(i + 1)];
      idx = i;
    } else {
      next = insertAt(arr, i + 1, nb);
      idx = i + 1;
    }
    if (!next[idx + 1] || !TEXTUAL.has(next[idx + 1].type)) next = insertAt(next, idx + 1, newBlock());
    return { next, focus: focusInside ?? { key: next[idx + 1].id, offset: 0 } };
  };

  const insertImage = async (file, afterId) => {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const url = await imageFileToDataURL(file);
      const imgId = uid('img');
      const cur = blocksRef.current;
      let i = cur.findIndex((b) => b.id === afterId);
      if (i < 0) i = cur.length - 1;
      const { next, focus } = place(cur, i, newBlock('image', '', { src: `img:${imgId}`, alt: '' }));
      commit(next, focus, { images: { ...(imagesRef.current || {}), [imgId]: url } });
    } catch {
      api.toast?.('That image couldn’t be read');
    }
  };

  const items = slash ? filterCommands(slash.query) : [];

  const pick = (cmd) => {
    const i = blocks.findIndex((b) => b.id === slash.id);
    if (i < 0) return setSlash(null);
    const b = blocks[i];
    const el = refs.current.get(b.id);
    const from = slash.from;
    const to = el ? el.selectionStart : from + 1 + slash.query.length;
    const text = b.text.slice(0, from) + b.text.slice(to);
    setSlash(null);
    const base = set(blocks, i, { text });
    switch (cmd.id) {
      case 'date': {
        const d = todayString();
        commit(set(blocks, i, { text: text.slice(0, from) + d + text.slice(from) }), { key: b.id, offset: from + d.length });
        break;
      }
      case 'table': {
        const t = newBlock('table', '', { rows: [['', ''], ['', '']] });
        const { next } = place(base, i, t);
        commit(next, { key: `${t.id}:0:0`, offset: 0 });
        break;
      }
      case 'divider': {
        const { next, focus } = place(base, i, newBlock('hr'));
        commit(next, focus);
        break;
      }
      case 'image':
        commit(base, { key: b.id, offset: from });
        imageAfter.current = b.id;
        fileRef.current?.click();
        break;
      default:
        commit(set(blocks, i, { type: cmd.id, text, checked: false }), { key: b.id, offset: from });
    }
  };

  const SHORTCUTS = [
    ['### ', 'h3'],
    ['## ', 'h2'],
    ['# ', 'h1'],
    ['[] ', 'check'],
    ['[ ] ', 'check'],
    ['- ', 'bullet'],
    ['* ', 'bullet'],
    ['1. ', 'number'],
    ['> ', 'quote'],
  ];

  const ed = {
    ref: (key) => (el) => {
      if (el) refs.current.set(key, el);
      else refs.current.delete(key);
    },

    change(i, value, caret) {
      const b = blocks[i];
      // Markdown-style shortcuts at the start of a line.
      if ((b.type === 'text' || b.type === 'bullet') && caret <= 4) {
        for (const [p, t] of SHORTCUTS) {
          if (b.type === 'bullet' && t !== 'check') continue;
          if (value.startsWith(p) && caret === p.length) {
            return commit(set(blocks, i, { type: t, text: value.slice(p.length), checked: false }), { key: b.id, offset: 0 });
          }
        }
      }
      if (b.type === 'text' && value === '```') return commit(set(blocks, i, { type: 'code', text: '' }), { key: b.id, offset: 0 });
      if (b.type === 'text' && value === '---') {
        const { next, focus } = place(set(blocks, i, { text: '' }), i, newBlock('hr'));
        return commit(next, focus);
      }

      // The block menu: open on the trigger key, then filter by what's typed after it.
      if (b.type !== 'code') {
        if (slash && slash.id === b.id) {
          const q = value.slice(slash.from + 1, caret);
          if (caret <= slash.from || value[slash.from] !== TRIGGER || /\s/.test(q) || q.length > 24) setSlash(null);
          else setSlash((s) => s && { ...s, query: q, active: 0 });
        } else if (value[caret - 1] === TRIGGER && (caret === 1 || /\s/.test(value[caret - 2])) && value.length > b.text.length) {
          const el = refs.current.get(b.id);
          if (el) setSlash({ id: b.id, from: caret - 1, query: '', active: 0, at: caretRect(el) });
        }
      }
      commit(set(blocks, i, { text: value }));
    },

    key(e, i) {
      const b = blocks[i];
      const ta = e.currentTarget;
      const s = ta.selectionStart;
      const en = ta.selectionEnd;
      const mod = e.metaKey || e.ctrlKey || e.altKey;

      if (slash && slash.id === b.id) {
        if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
          e.preventDefault();
          if (!items.length) return;
          const { rows } = menuLayout(items, slash.query);
          const cur = Math.min(slash.active, items.length - 1);
          setSlash((x) => ({ ...x, active: moveInMenu(rows, cur, e.key) }));
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

      if (e.key === 'Escape') {
        e.preventDefault();
        api.stopEditing(note.id);
        return;
      }

      if (e.key === 'Enter' && !mod) {
        if (b.type === 'code') {
          // Enter on an empty last line leaves the code block.
          if (!e.shiftKey && s === en && s === b.text.length && b.text.endsWith('\n')) {
            e.preventDefault();
            const nb = newBlock();
            commit(insertAt(set(blocks, i, { text: b.text.slice(0, -1) }), i + 1, nb), { key: nb.id, offset: 0 });
          }
          return;
        }
        if (e.shiftKey && !/^h\d$/.test(b.type)) return; // soft line break inside the block
        e.preventDefault();
        if (b.type !== 'text' && b.text === '') {
          // Enter on an empty list item / quote / heading ends it.
          commit(set(blocks, i, { type: 'text', checked: false }), { key: b.id, offset: 0 });
          return;
        }
        const nextType = LISTS.has(b.type) ? b.type : 'text';
        if (s === 0 && en === 0) {
          commit(insertAt(blocks, i, newBlock(nextType)), { key: b.id, offset: 0 });
          return;
        }
        const nb = newBlock(nextType, b.text.slice(en));
        commit(insertAt(set(blocks, i, { text: b.text.slice(0, s) }), i + 1, nb), { key: nb.id, offset: 0 });
        return;
      }

      if (e.key === 'Backspace' && s === 0 && en === 0) {
        if (b.type !== 'text' && b.type !== 'code') {
          // First Backspace turns a list item / heading / quote back into text.
          e.preventDefault();
          commit(set(blocks, i, { type: 'text', checked: false }), { key: b.id, offset: 0 });
          return;
        }
        if (b.type === 'code' && b.text !== '') return;
        e.preventDefault();
        const prev = blocks[i - 1];
        if (!prev) {
          if (b.type === 'code') commit(set(blocks, i, { type: 'text' }), { key: b.id, offset: 0 });
          else onExitTop();
          return;
        }
        if (prev.type === 'hr' || prev.type === 'image') {
          commit(without(blocks, i - 1), { key: b.id, offset: 0 });
        } else if (prev.type === 'table') {
          if (b.text === '') commit(without(blocks, i), { key: endKey(prev), offset: 'end' });
          else focusKey(endKey(prev), 'end');
        } else {
          const merged = without(blocks, i).map((x) => (x.id === prev.id ? { ...x, text: prev.text + b.text } : x));
          commit(merged, { key: prev.id, offset: prev.text.length });
        }
        return;
      }

      if (e.key === 'Delete' && s === en && s === b.text.length) {
        const nx = blocks[i + 1];
        if (!nx) return;
        if (nx.type === 'hr' || nx.type === 'image') {
          e.preventDefault();
          commit(without(blocks, i + 1), { key: b.id, offset: s });
        } else if (TEXTUAL.has(nx.type)) {
          e.preventDefault();
          commit(
            without(blocks, i + 1).map((x) => (x.id === b.id ? { ...x, text: b.text + nx.text } : x)),
            { key: b.id, offset: s },
          );
        }
        return;
      }

      if (e.key === 'ArrowUp' && !e.shiftKey && s === en && caretLine(ta).first) {
        if (focusPrev(i)) e.preventDefault();
        else if (i === 0) {
          e.preventDefault();
          onExitTop();
        }
        return;
      }
      if (e.key === 'ArrowDown' && !e.shiftKey && s === en && caretLine(ta).last) {
        if (focusNext(i)) e.preventDefault();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey && i === 0) onExitTop();
      }
    },

    paste(e, i) {
      const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
      if (!file) return;
      e.preventDefault();
      insertImage(file, blocks[i].id);
    },

    blur(id) {
      if (slash?.id === id) setSlash(null);
    },
    clickField(id) {
      if (slash?.id === id) setSlash(null);
    },

    toggle(i) {
      commit(set(blocks, i, { checked: !blocks[i].checked }));
    },

    remove(i) {
      const prev = blocks[i - 1];
      const next = without(blocks, i);
      commit(next, prev && focusable(prev) ? { key: endKey(prev), offset: 'end' } : next[i] && focusable(next[i]) ? { key: startKey(next[i]), offset: 0 } : null);
    },

    cell(i, r, c, value) {
      const rows = blocks[i].rows.map((row, ri) => (ri === r ? row.map((x, ci) => (ci === c ? value.replace(/\n/g, ' ') : x)) : row));
      commit(set(blocks, i, { rows }));
    },
    cellFocus(id, r, c) {
      cellAt.current = { id, r, c };
    },
    cellKey(e, i, r, c) {
      const b = blocks[i];
      const R = b.rows.length;
      const C = b.rows[0].length;
      const key = (rr, cc) => `${b.id}:${rr}:${cc}`;
      const addRow = (at) => b.rows.slice(0, at).concat([Array(C).fill('')], b.rows.slice(at));
      if (e.key === 'Escape') {
        e.preventDefault();
        api.stopEditing(note.id);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const k = r * C + c + (e.shiftKey ? -1 : 1);
        if (k < 0) focusPrev(i);
        else if (k >= R * C) commit(set(blocks, i, { rows: addRow(R) }), { key: key(R, 0), offset: 0 });
        else focusKey(key(Math.floor(k / C), k % C), 'end');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (r + 1 < R) focusKey(key(r + 1, c), 'end');
        else commit(set(blocks, i, { rows: addRow(R) }), { key: key(R, c), offset: 0 });
      } else if (e.key === 'ArrowUp' && caretLine(e.currentTarget).first) {
        if (r > 0) {
          e.preventDefault();
          focusKey(key(r - 1, c), 'end');
        } else if (focusPrev(i)) e.preventDefault();
      } else if (e.key === 'ArrowDown' && caretLine(e.currentTarget).last) {
        e.preventDefault();
        if (r + 1 < R) focusKey(key(r + 1, c), 'end');
        else if (!focusNext(i)) {
          const nb = newBlock();
          commit(insertAt(blocks, i + 1, nb), { key: nb.id, offset: 0 });
        }
      }
    },
    table(i, op, where) {
      const b = blocks[i];
      const R = b.rows.length;
      const C = b.rows[0].length;
      const at = where ?? (cellAt.current?.id === b.id ? cellAt.current : { r: R - 1, c: C - 1 });
      const key = (rr, cc) => `${b.id}:${rr}:${cc}`;
      const blankRow = () => Array(C).fill('');
      const insRow = (k) => commit(set(blocks, i, { rows: [...b.rows.slice(0, k), blankRow(), ...b.rows.slice(k)] }), { key: key(k, at.c), offset: 0 });
      const insCol = (k) =>
        commit(set(blocks, i, { rows: b.rows.map((row) => [...row.slice(0, k), '', ...row.slice(k)]) }), { key: key(at.r, k), offset: 0 });
      if (op === 'row-above') insRow(at.r);
      else if (op === 'row-below' || op === 'row+') insRow(at.r + 1);
      else if (op === 'row-end') insRow(R);
      else if (op === 'col-left') insCol(at.c);
      else if (op === 'col-right' || op === 'col+') insCol(at.c + 1);
      else if (op === 'col-end') insCol(C);
      else if ((op === 'row-del' || op === 'row-') && R > 1) {
        const rows = b.rows.filter((_, ri) => ri !== at.r);
        commit(set(blocks, i, { rows }), { key: key(Math.min(at.r, rows.length - 1), at.c), offset: 'end' });
      } else if ((op === 'col-del' || op === 'col-') && C > 1) {
        const rows = b.rows.map((row) => row.filter((_, ci) => ci !== at.c));
        commit(set(blocks, i, { rows }), { key: key(at.r, Math.min(at.c, C - 2)), offset: 'end' });
      } else if (op === 'delete') {
        ed.remove(i);
      }
    },
  };

  const closeSlash = useCallback(() => setSlash(null), []);

  return (
    <>
      <BlockList blocks={blocks} mode="edit" images={note.images} sizeKey={note.w} ed={ed} />
      {slash && (
        <SlashMenu
          at={slash.at}
          items={items}
          query={slash.query}
          tint={tint}
          active={Math.min(slash.active, Math.max(0, items.length - 1))}
          onPick={pick}
          onHover={(k) => setSlash((x) => x && { ...x, active: k })}
          onClose={closeSlash}
        />
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          insertImage(f, imageAfter.current);
        }}
      />
    </>
  );
}
