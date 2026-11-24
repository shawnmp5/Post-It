import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MENU_COLS, TRIGGER, menuLayout, todayString } from '../blocks.js';

const ICONS = {
  bullet: (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="3.5" cy="4.5" r=".9" fill="currentColor" />
      <circle cx="3.5" cy="8" r=".9" fill="currentColor" />
      <circle cx="3.5" cy="11.5" r=".9" fill="currentColor" />
      <path d="M6.5 4.5h7M6.5 8h7M6.5 11.5h7" />
    </svg>
  ),
  number: (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M2.5 3.5h1v3M2.5 6.5h2M2.5 9.5h2l-2 2.5h2M6.5 4.5h7M6.5 8h7M6.5 11.5h7" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="m2.5 4.5 1 1 2-2M2.5 10.5l1 1 2-2M8 4.5h5.5M8 10.5h5.5" />
    </svg>
  ),
  table: (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
      <path d="M2.5 6.5h11M6.5 6.5v7" />
    </svg>
  ),
  image: (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
      <circle cx="6" cy="6" r="1.1" />
      <path d="m2.5 11.5 3.5-3.5 3 3 1.5-1.5 3 3" />
    </svg>
  ),
  quote: (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor">
      <path d="M3 9.5C3 7 4.3 5.2 6.4 4.5l.4.9C5.6 6 5 6.9 4.9 8H6.5v3.5H3zM9 9.5C9 7 10.3 5.2 12.4 4.5l.4.9c-1.2.6-1.8 1.5-1.9 2.6h1.6v3.5H9z" />
    </svg>
  ),
  code: (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3l-2 10" />
    </svg>
  ),
  divider: (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M2.5 8h11" />
    </svg>
  ),
  date: (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <rect x="2.5" y="3.5" width="11" height="10" rx="1" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
    </svg>
  ),
};

/** Block menu shown at the caret after typing the trigger key: grouped tiles tinted with the note's color. */
export function SlashMenu({ at, items, query, active, tint, onPick, onHover, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: at.left, top: at.bottom + 8 });
  const { sections } = menuLayout(items, query);
  const current = items[active];

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let top = at.bottom + 8;
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, at.top - r.height - 8);
    const left = Math.max(8, Math.min(at.left - 14, window.innerWidth - r.width - 8));
    setPos({ left, top });
  }, [at, items.length]);

  useEffect(() => {
    ref.current?.querySelector('.bm-tile.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  useEffect(() => {
    const onScroll = (e) => {
      if (!ref.current?.contains(e.target)) onClose();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const tip = !current
    ? null
    : current.id === 'date'
      ? `Adds ${todayString()}`
      : current.hint
        ? (
            <>
              Shortcut: start a line with <code>{current.hint}</code>
            </>
          )
        : current.tip;

  return createPortal(
    <div
      ref={ref}
      className="popover is-ready block-menu"
      style={{ left: pos.left, top: pos.top, '--note-bg': tint }}
      role="listbox"
      aria-label="Insert block"
      // Keep focus (and the caret) in the note while picking.
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="bm-head">
        <span className="bm-query">
          <span className="bm-trigger">{TRIGGER}</span>
          {query ? query : <span className="bm-placeholder">type to filter</span>}
        </span>
        <span className="bm-keys" aria-hidden="true">
          ← → ↑ ↓ <kbd>↵</kbd>
        </span>
      </div>
      <div className="bm-body">
        {items.length === 0 && <div className="bm-empty">Nothing matches “{query}”</div>}
        {sections.map((sec, si) => (
          <div key={sec.label ?? si} className="bm-section">
            {sec.label && <div className="bm-label">{sec.label}</div>}
            <div className="bm-grid">
              {sec.items.map(({ cmd, index }, i) => {
                // A lone tile on the last row stretches across instead of sitting by itself.
                const wide = i === sec.items.length - 1 && sec.items.length % MENU_COLS === 1;
                return (
                  <button
                    key={cmd.id}
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    aria-label={cmd.label}
                    className={`bm-tile ${wide ? 'is-wide' : ''} ${index === active ? 'is-active' : ''}`}
                    onMouseEnter={() => onHover(index)}
                    onClick={() => onPick(cmd)}
                  >
                    <span className={`bm-icon ${ICONS[cmd.icon] ? '' : 'is-glyph'}`}>{ICONS[cmd.icon] || cmd.icon}</span>
                    <span className="bm-name">{wide ? cmd.label : cmd.short}</span>
                    {wide && cmd.id === 'date' && <span className="bm-aside">{todayString()}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {current && (
        <div className="bm-foot">
          <strong>{current.label}</strong>
          {tip && <span>{tip}</span>}
        </div>
      )}
    </div>,
    document.body,
  );
}
