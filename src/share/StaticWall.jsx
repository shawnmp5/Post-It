import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Note } from '../components/Note.jsx';
import { FONT_MAP } from '../store.js';

const noop = () => {};

/*
 * A topic's wall, read-only: the same notes, tape, stickers and connections, with
 * nothing to click. Used by shared links and by the PDF / image export.
 * Calls onReady() once every note has been measured.
 */
export function StaticWall({ notes, connections = [], settings = {}, onReady, padding = 40 }) {
  const els = useRef(new Map());
  const [heights, setHeights] = useState(null);

  const api = useMemo(
    () => ({
      observe: (id, el) => els.current.set(id, el),
      unobserve: (id) => els.current.delete(id),
      pointerDown: noop,
      startEdit: noop,
      stopEditing: noop,
      openReminder: noop,
      openStickers: noop,
      openMenu: noop,
      deleteNote: noop,
      checkpoint: noop,
      update: noop,
      toast: noop,
      zoom: 1,
    }),
    [],
  );

  useLayoutEffect(() => {
    const h = new Map();
    for (const [id, el] of els.current) h.set(id, el.offsetHeight);
    setHeights(h);
  }, [notes]);

  const ready = useRef(false);
  useLayoutEffect(() => {
    if (heights && !ready.current) {
      ready.current = true;
      onReady?.();
    }
  }, [heights, onReady]);

  const heightOf = useCallback((n) => heights?.get(n.id) ?? n.h ?? 160, [heights]);

  // Trim the wall to its notes, with a margin.
  const box = useMemo(() => {
    if (!notes.length) return { x: 0, y: 0, w: 600, h: 300 };
    let l = Infinity;
    let t = Infinity;
    let r = 0;
    let b = 0;
    for (const n of notes) {
      l = Math.min(l, n.x);
      t = Math.min(t, n.y);
      r = Math.max(r, n.x + n.w);
      b = Math.max(b, n.y + heightOf(n));
    }
    return { x: l - padding, y: t - padding, w: r - l + padding * 2, h: b - t + padding * 2 };
  }, [notes, heightOf, padding]);

  const byId = useMemo(() => Object.fromEntries(notes.map((n) => [n.id, n])), [notes]);
  const lines = settings.showConnections === false ? [] : connections.filter((c) => byId[c.from] && byId[c.to]).map((c) => line(byId[c.from], byId[c.to], heightOf));
  const font = FONT_MAP[settings.noteFont] || FONT_MAP.clean;

  return (
    <div className="static-wall" style={{ width: box.w, height: box.h }}>
      <div
        className="board"
        style={{
          width: box.w,
          height: box.h,
          transform: `translate(${-box.x}px, ${-box.y}px)`,
          '--zoom': 1,
          '--note-font': font.family,
          '--note-scale': font.scale,
          '--note-title-weight': font.titleWeight,
        }}
      >
        <svg className="connections" width={box.x + box.w} height={box.y + box.h} aria-hidden="true">
          {lines.map((l) => (
            <g key={l.id} className="conn">
              <path className="conn-line" d={l.d} />
              <circle className="conn-end" cx={l.p1.x} cy={l.p1.y} r="3" />
              <circle className="conn-end" cx={l.p2.x} cy={l.p2.y} r="3" />
            </g>
          ))}
        </svg>
        {notes.map((n) => (
          <Note key={n.id} note={n} api={api} editing={false} tilt={settings.tilt !== false} query="" />
        ))}
      </div>
    </div>
  );
}

// The same curve the wall draws between two notes' facing edges.
function line(A, B, heightOf) {
  const ah = heightOf(A);
  const bh = heightOf(B);
  const a = { x: A.x + A.w / 2, y: A.y + ah / 2 };
  const b = { x: B.x + B.w / 2, y: B.y + bh / 2 };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const horizontal = Math.abs(dx) / ((A.w + B.w) / 2) >= Math.abs(dy) / ((ah + bh) / 2);
  let p1;
  let p2;
  let c1;
  let c2;
  if (horizontal) {
    const s = Math.sign(dx) || 1;
    p1 = { x: a.x + (s * A.w) / 2, y: a.y };
    p2 = { x: b.x - (s * B.w) / 2, y: b.y };
    const k = Math.max(24, Math.abs(p2.x - p1.x) / 2);
    c1 = { x: p1.x + s * k, y: p1.y };
    c2 = { x: p2.x - s * k, y: p2.y };
  } else {
    const s = Math.sign(dy) || 1;
    p1 = { x: a.x, y: a.y + (s * ah) / 2 };
    p2 = { x: b.x, y: b.y - (s * bh) / 2 };
    const k = Math.max(24, Math.abs(p2.y - p1.y) / 2);
    c1 = { x: p1.x, y: p1.y + s * k };
    c2 = { x: p2.x, y: p2.y - s * k };
  }
  return { id: `${A.id}-${B.id}`, d: `M${p1.x},${p1.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`, p1, p2 };
}
