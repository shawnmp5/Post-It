import { useRef, useState } from 'react';
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
 * A sticker on a note: drag to move it, × to peel it off.
 * Position is the sticker's centre in the note's own (unrotated) coordinates.
 */
export function NoteSticker({ s, noteRotation, getZoom, onMove, onRemove, fresh }) {
  const [drag, setDrag] = useState(null); // { dx, dy }
  const [peeling, setPeeling] = useState(false);
  const ref = useRef(null);

  const onPointerDown = (e) => {
    if (e.target.closest('.sticker-x')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const el = ref.current;
    el.setPointerCapture?.(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    const z = getZoom() || 1;
    const a = (-noteRotation * Math.PI) / 180;
    let moved = false;
    let last = { dx: 0, dy: 0 };
    const move = (ev) => {
      const cx = (ev.clientX - sx) / z;
      const cy = (ev.clientY - sy) / z;
      if (!moved && Math.hypot(cx, cy) < 3) return;
      moved = true;
      // Undo the note's tilt so the sticker follows the pointer exactly.
      last = { dx: cx * Math.cos(a) - cy * Math.sin(a), dy: cx * Math.sin(a) + cy * Math.cos(a) };
      setDrag(last);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDrag(null);
      if (moved) onMove(s.id, s.x + last.dx, s.y + last.dy);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const peel = (e) => {
    e.stopPropagation();
    setPeeling(true);
    setTimeout(() => onRemove(s.id), 230);
  };

  const cls = ['sticker', drag && 'is-dragging', peeling && 'is-peeling', fresh && 'is-fresh'].filter(Boolean).join(' ');
  return (
    <div
      ref={ref}
      className={cls}
      style={{
        left: s.x + (drag?.dx || 0),
        top: s.y + (drag?.dy || 0),
        '--r': `${s.rot}deg`,
      }}
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
