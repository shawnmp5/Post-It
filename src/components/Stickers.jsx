import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Popover } from './Popover.jsx';

/** Reaction stickers, in the order they appear in the picker. */
export const STICKERS = [
  { e: '👍', n: 'Thumbs up' },
  { e: '👎', n: 'Thumbs down' },
  { e: '❤️', n: 'Love' },
  { e: '😂', n: 'Haha' },
  { e: '😍', n: 'Love it' },
  { e: '😮', n: 'Wow' },
  { e: '😢', n: 'Sad' },
  { e: '😡', n: 'Angry' },
  { e: '🔥', n: 'Fire' },
  { e: '🎉', n: 'Celebrate' },
  { e: '⭐', n: 'Star' },
  { e: '💯', n: '100' },
  { e: '✅', n: 'Done' },
  { e: '❌', n: 'No' },
  { e: '👀', n: 'Looking' },
  { e: '🙌', n: 'Yay' },
  { e: '👏', n: 'Clap' },
  { e: '💡', n: 'Idea' },
  { e: '🤔', n: 'Hmm' },
  { e: '🚀', n: 'Ship it' },
  { e: '⚠️', n: 'Careful' },
  { e: '🙏', n: 'Thanks' },
  { e: '😎', n: 'Cool' },
  { e: '🧠', n: 'Smart' },
];

export function StickerPicker({ anchor, onPick, onClose }) {
  return (
    <Popover anchor={anchor} onClose={onClose} align="end" className="sticker-picker">
      <div className="sp-head">React with a sticker</div>
      <div className="sp-grid" role="listbox" aria-label="Stickers">
        {STICKERS.map((s, i) => (
          <button
            key={s.e}
            type="button"
            role="option"
            aria-label={s.n}
            title={s.n}
            className="sp-item"
            style={{ '--i': i }}
            onClick={(ev) => onPick(s.e, ev.currentTarget.getBoundingClientRect())}
          >
            <span>{s.e}</span>
          </button>
        ))}
      </div>
    </Popover>
  );
}

/**
 * A sticker on a note: drag to move it, × to peel it off (on touch screens, tap it first to show the ×).
 * Position is the sticker's centre in the note's own (unrotated) coordinates.
 *
 * Dragging moves it with a transform, straight on the element and once per frame, so
 * nothing re-renders and nothing repaints while it follows the pointer. It stays within
 * reach of the note the whole way, and the new spot is saved when it's let go.
 */
export function NoteSticker({ s, noteRotation, getZoom, getBounds, onMove, onRemove, fresh }) {
  const [peeling, setPeeling] = useState(false);
  const [active, setActive] = useState(false);
  const ref = useRef(null);
  const pending = useRef(false);

  // The saved spot has arrived: drop the drag offset in the same frame, so it doesn't jump.
  useLayoutEffect(() => {
    if (!pending.current) return;
    pending.current = false;
    if (ref.current) ref.current.style.transform = '';
  }, [s.x, s.y]);

  // Tap elsewhere and the × goes away again.
  useEffect(() => {
    if (!active) return undefined;
    const off = (e) => {
      if (!ref.current?.contains(e.target)) setActive(false);
    };
    document.addEventListener('pointerdown', off, true);
    return () => document.removeEventListener('pointerdown', off, true);
  }, [active]);

  const onPointerDown = (e) => {
    if (e.target.closest('.sticker-x')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const el = ref.current;
    el.setPointerCapture?.(e.pointerId);
    const id = e.pointerId;
    const sx = e.clientX;
    const sy = e.clientY;
    const z = getZoom() || 1;
    const a = (-noteRotation * Math.PI) / 180;
    const b = getBounds?.() || { w: 1e4, h: 1e4 };
    let moved = false;
    let raf = 0;
    let dx = 0;
    let dy = 0;
    const paint = () => {
      raf = 0;
      el.style.transform = `translate(${dx}px, ${dy}px) rotate(var(--r))`;
    };
    const move = (ev) => {
      if (ev.pointerId !== id) return;
      const cx = (ev.clientX - sx) / z;
      const cy = (ev.clientY - sy) / z;
      if (!moved && Math.hypot(cx, cy) < 3) return;
      if (!moved) {
        moved = true;
        el.classList.add('is-dragging');
      }
      // Undo the note's tilt so the sticker follows the pointer exactly, and keep it on the note.
      const rx = cx * Math.cos(a) - cy * Math.sin(a);
      const ry = cx * Math.sin(a) + cy * Math.cos(a);
      dx = Math.min(b.w + 10, Math.max(-10, s.x + rx)) - s.x;
      dy = Math.min(b.h + 10, Math.max(-10, s.y + ry)) - s.y;
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const up = (ev) => {
      if (ev.pointerId !== id) return;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (raf) cancelAnimationFrame(raf);
      el.classList.remove('is-dragging');
      if (!moved) {
        // A tap: on touch screens that's how you reach the ×.
        if (ev.pointerType !== 'mouse') setActive((v) => !v);
        return;
      }
      const nx = Math.round(s.x + dx);
      const ny = Math.round(s.y + dy);
      if (nx === s.x && ny === s.y) {
        el.style.transform = '';
        return;
      }
      paint();
      pending.current = true;
      onMove(s.id, nx, ny);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const peel = (e) => {
    e.stopPropagation();
    if (peeling) return;
    setPeeling(true);
    setTimeout(() => onRemove(s.id), 230);
  };

  const cls = ['sticker', peeling && 'is-peeling', fresh && 'is-fresh', active && 'is-active'].filter(Boolean).join(' ');
  return (
    <div
      ref={ref}
      className={cls}
      style={{ left: s.x, top: s.y, '--r': `${s.rot}deg` }}
      onPointerDown={onPointerDown}
      onMouseDown={(e) => e.preventDefault()}
      title="Drag to move"
    >
      <span className="sticker-face" aria-hidden="true">
        {s.emoji}
      </span>
      <span className="sticker-burst" aria-hidden="true" />
      <button
        type="button"
        className="sticker-x"
        aria-label="Remove sticker"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={peel}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="m2.5 2.5 5 5M7.5 2.5l-5 5" />
        </svg>
      </button>
    </div>
  );
}
