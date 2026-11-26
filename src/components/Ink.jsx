import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Smoother, strokePath, strokeHit, PEN_COLORS, MARKER_COLORS, PEN_SIZES, MARKER_SIZES } from '../ink.js';

/*
 * Drawing on a note. <InkStrokes> shows a note's drawing; <InkSurface> is the note in
 * draw mode: a layer that catches the pen, the stroke being drawn, and a toolbar.
 *
 * Smoothness: the stroke being drawn is updated straight on its SVG path once per
 * frame (no React re-render per pointer move), every sample the browser has is used
 * (coalesced events, so fast strokes keep their shape), the input is streamlined as
 * it comes in (ink.js), and the finished stroke is drawn as one filled outline.
 */

const uidS = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// The last tool, colours and sizes, remembered between notes and visits.
const PREFS_KEY = 'postit:ink';
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (p && p.pen && p.marker) return p;
  } catch {
    /* fall through */
  }
  return { tool: 'pen', pen: { c: PEN_COLORS[0], s: PEN_SIZES[1] }, marker: { c: MARKER_COLORS[0], s: MARKER_SIZES[1] } };
}
let prefs = loadPrefs();
function savePrefs(next) {
  prefs = next;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
}

/* A note's drawing: highlighter under the pen, both under nothing else. */
export const InkStrokes = memo(function InkStrokes({ ink, hidden }) {
  if (!ink?.length) return null;
  const shown = hidden?.size ? ink.filter((s) => !hidden.has(s.id)) : ink;
  return (
    <svg className="ink-layer" aria-hidden="true">
      <g className="ink-marker">
        {shown.map((s) => (s.t === 'marker' ? <path key={s.id} d={strokePath(s)} fill={s.c} /> : null))}
      </g>
      <g>
        {shown.map((s) => (s.t === 'pen' ? <path key={s.id} d={strokePath(s)} fill={s.c} /> : null))}
      </g>
    </svg>
  );
});

const ERASER_R = 9;

export function InkSurface({ note, api }) {
  const [tool, setToolState] = useState(prefs.tool);
  const [pen, setPen] = useState(prefs.pen);
  const [marker, setMarker] = useState(prefs.marker);
  const [erased, setErased] = useState(() => new Set());
  const surface = useRef(null);
  const livePath = useRef(null);
  const liveSvg = useRef(null);
  const cursor = useRef(null);
  const g = useRef(null); // the gesture in progress
  const frame = useRef(0);
  const sawPen = useRef(false);
  const ink = note.ink || [];
  const inkRef = useRef(ink);
  inkRef.current = ink;

  const setTool = (t) => {
    setToolState(t);
    savePrefs({ ...prefs, tool: t });
  };
  const pick = (patch) => {
    if (tool === 'marker') {
      const m = { ...marker, ...patch };
      setMarker(m);
      savePrefs({ ...prefs, marker: m, tool });
    } else {
      const p = { ...pen, ...patch };
      setPen(p);
      savePrefs({ ...prefs, pen: p, tool: 'pen' });
      if (tool === 'eraser') setTool('pen');
    }
  };

  // Screen → note pixels. In draw mode the note sits straight, only zoom scales it.
  const local = (e) => {
    const r = surface.current.getBoundingClientRect();
    const k = r.width / (surface.current.offsetWidth || 1) || 1;
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  };

  const paintLive = () => {
    frame.current = 0;
    const st = g.current;
    if (!st || st.kind !== 'draw' || !livePath.current) return;
    livePath.current.setAttribute('d', strokePath({ t: st.t, s: st.s, p: st.sm.pts }, true));
  };
  const schedule = () => {
    if (!frame.current) frame.current = requestAnimationFrame(paintLive);
  };

  const moveCursor = (x, y, show) => {
    const el = cursor.current;
    if (!el) return;
    el.style.opacity = show ? '1' : '0';
    el.style.transform = `translate(${x - ERASER_R}px, ${y - ERASER_R}px)`;
  };

  const eraseAt = (x, y) => {
    let next = null;
    for (const s of inkRef.current) {
      if ((next || g.current.erased).has(s.id)) continue;
      if (strokeHit(s, x, y, ERASER_R)) {
        if (!next) next = new Set(g.current.erased);
        next.add(s.id);
      }
    }
    if (next) {
      g.current.erased = next;
      setErased(next);
    }
  };

  const onDown = (e) => {
    e.stopPropagation();
    if (e.pointerType === 'pen') sawPen.current = true;
    // With a stylus around, a resting palm or finger doesn't draw.
    if (e.pointerType === 'touch' && sawPen.current) return;
    if (g.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    surface.current.setPointerCapture?.(e.pointerId);
    const { x, y } = local(e);
    if (tool === 'eraser') {
      g.current = { kind: 'erase', id: e.pointerId, erased: new Set() };
      moveCursor(x, y, true);
      eraseAt(x, y);
      return;
    }
    const opts = tool === 'marker' ? marker : pen;
    const real = e.pointerType === 'pen' && e.pressure > 0;
    g.current = { kind: 'draw', id: e.pointerId, t: tool, c: opts.c, s: opts.s, sm: new Smoother(x, y, real ? e.pressure : 0.5, real) };
    const lp = livePath.current;
    lp.setAttribute('fill', opts.c);
    liveSvg.current.classList.toggle('is-marker', tool === 'marker');
    paintLive();
  };

  const onMove = (e) => {
    const st = g.current;
    if (!st) {
      if (tool === 'eraser' && e.pointerType !== 'touch') {
        const { x, y } = local(e);
        moveCursor(x, y, true);
      }
      return;
    }
    if (e.pointerId !== st.id) return;
    e.preventDefault();
    const events = e.getCoalescedEvents?.() || [];
    const list = events.length ? events : [e];
    if (st.kind === 'erase') {
      for (const ev of list) {
        const { x, y } = local(ev);
        eraseAt(x, y);
      }
      const { x, y } = local(e);
      moveCursor(x, y, true);
      return;
    }
    let added = false;
    for (const ev of list) {
      const { x, y } = local(ev);
      added = st.sm.add(x, y, ev.pressure || 0.5) || added;
    }
    if (added) schedule();
  };

  const onUp = (e) => {
    const st = g.current;
    if (!st || e.pointerId !== st.id) return;
    g.current = null;
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (st.kind === 'erase') {
      if (e.pointerType === 'touch') moveCursor(0, 0, false);
      if (st.erased.size) {
        api.checkpoint();
        api.update(note.id, { ink: inkRef.current.filter((s) => !st.erased.has(s.id)) });
      }
      setErased(new Set());
      return;
    }
    const { x, y } = local(e);
    const pts = st.sm.finish(x, y);
    const stroke = { id: uidS(), t: st.t, c: st.c, s: st.s, p: pts };
    api.checkpoint();
    api.update(note.id, { ink: [...inkRef.current, stroke] });
    livePath.current?.setAttribute('d', '');
  };

  useEffect(() => () => frame.current && cancelAnimationFrame(frame.current), []);

  const undo = () => {
    if (!ink.length) return;
    api.checkpoint();
    api.update(note.id, { ink: ink.slice(0, -1) });
  };
  const clear = () => {
    if (!ink.length) return;
    api.checkpoint();
    api.update(note.id, { ink: [] });
    api.toast?.('Drawing cleared', { undo: true });
  };

  const colors = tool === 'marker' ? MARKER_COLORS : PEN_COLORS;
  const sizes = tool === 'marker' ? MARKER_SIZES : PEN_SIZES;
  const cur = tool === 'marker' ? marker : pen;

  // The toolbar lives on top of the page and follows the note: above it, or below when
  // there's no room, always kept on screen (and the same size at any zoom).
  const bar = useRef(null);
  useLayoutEffect(() => {
    let raf = 0;
    let last = '';
    const place = () => {
      raf = requestAnimationFrame(place);
      const el = bar.current;
      const noteEl = surface.current?.closest('.note');
      if (!el || !noteEl) return;
      const r = noteEl.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const m = 8;
      const left = Math.max(m, Math.min(window.innerWidth - w - m, r.left + r.width / 2 - w / 2));
      let top = r.top - h - 26;
      let below = false;
      if (top < m) {
        top = r.bottom + 16;
        below = true;
        if (top > window.innerHeight - h - m) top = Math.max(m, Math.min(window.innerHeight - h - m, r.top + 8));
      }
      const key = `${Math.round(left)},${Math.round(top)},${below}`;
      if (key === last) return;
      last = key;
      el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      el.classList.toggle('is-below', below);
      el.classList.add('is-placed');
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, []);

  const stopAll = (e) => e.stopPropagation();

  return (
    <>
      <InkStrokes ink={ink} hidden={erased} />
      <svg ref={liveSvg} className="ink-layer ink-live" aria-hidden="true">
        <path ref={livePath} d="" />
      </svg>
      <div
        ref={surface}
        className={`ink-surface is-${tool}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => !g.current && moveCursor(0, 0, false)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div ref={cursor} className="ink-eraser-cursor" style={{ width: ERASER_R * 2, height: ERASER_R * 2 }} />
      </div>

      {createPortal(
      <div
        ref={bar}
        className="ink-toolbar"
        role="toolbar"
        aria-label="Drawing tools"
        onPointerDown={stopAll}
        onMouseDown={(e) => e.preventDefault()}
      >
        <div className="ink-tools">
          <ToolBtn on={tool === 'pen'} label="Pen" onClick={() => setTool('pen')}>
            <path d="M3 13l1-3.5L11.2 2.3a1.4 1.4 0 0 1 2 0l.5.5a1.4 1.4 0 0 1 0 2L6.5 12 3 13z" />
            <path d="M10 3.5 12.5 6" />
          </ToolBtn>
          <ToolBtn on={tool === 'marker'} label="Highlighter" onClick={() => setTool('marker')}>
            <path d="M4.5 9.5 10 4l2 2-5.5 5.5H4.5z" />
            <path d="M10 4l1.3-1.3a1 1 0 0 1 1.4 0l.6.6a1 1 0 0 1 0 1.4L12 6" />
            <path d="M3 14h10" strokeWidth="2.2" className="ink-hl-bar" />
          </ToolBtn>
          <ToolBtn on={tool === 'eraser'} label="Eraser" onClick={() => setTool('eraser')}>
            <path d="M6.2 13.5 2.6 9.9a1.3 1.3 0 0 1 0-1.8l5.6-5.6a1.3 1.3 0 0 1 1.8 0l3.5 3.5a1.3 1.3 0 0 1 0 1.8L8 13.5z" />
            <path d="M5 6l5 5M8 13.5h5.5" />
          </ToolBtn>
        </div>
        <span className="ink-sep" />
        <div className="ink-colors" role="radiogroup" aria-label="Colour">
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={tool !== 'eraser' && cur.c === c}
              aria-label={`Colour ${c}`}
              className={`ink-swatch ${tool !== 'eraser' && cur.c === c ? 'is-on' : ''}`}
              style={{ '--sw': c }}
              onClick={() => pick({ c })}
            />
          ))}
        </div>
        <span className="ink-sep" />
        <div className="ink-sizes" role="radiogroup" aria-label="Size">
          {sizes.map((s, i) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={tool !== 'eraser' && cur.s === s}
              aria-label={['Thin', 'Medium', 'Thick'][i]}
              title={['Thin', 'Medium', 'Thick'][i]}
              className={`ink-size ${tool !== 'eraser' && cur.s === s ? 'is-on' : ''}`}
              onClick={() => pick({ s })}
            >
              <i style={{ width: 4 + i * 3.5, height: 4 + i * 3.5, background: tool === 'eraser' ? 'currentColor' : cur.c }} />
            </button>
          ))}
        </div>
        <span className="ink-sep" />
        <ToolBtn label="Undo stroke" onClick={undo} disabled={!ink.length}>
          <path d="M5.5 4 2.5 7l3 3" />
          <path d="M2.8 7H10a3.5 3.5 0 0 1 0 7H8" />
        </ToolBtn>
        <ToolBtn label="Clear drawing" onClick={clear} disabled={!ink.length}>
          <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
        </ToolBtn>
        <button type="button" className="ink-done" onClick={() => api.stopDraw()}>
          Done
        </button>
      </div>,
        document.body,
      )}
    </>
  );
}

function ToolBtn({ on, label, onClick, disabled, children }) {
  return (
    <button
      type="button"
      className={`ink-btn ${on ? 'is-on' : ''}`}
      aria-pressed={on === undefined ? undefined : on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}
