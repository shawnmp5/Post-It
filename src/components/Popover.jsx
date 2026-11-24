import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Floating panel anchored to an element. Rendered in a portal so it is never
 * rotated, scaled or clipped by the note / canvas it belongs to.
 */
export function Popover({ anchor, onClose, children, align = 'start', className = '', offset = 6, closeOnScroll = true }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: -9999, left: -9999, ready: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const place = () => {
      const a = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = align === 'end' ? a.right - r.width : a.left;
      left = Math.max(8, Math.min(left, vw - r.width - 8));
      let top = a.bottom + offset;
      if (top + r.height > vh - 8) {
        const above = a.top - offset - r.height;
        top = above >= 8 ? above : Math.max(8, vh - r.height - 8);
      }
      setPos({ top, left, ready: true });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [anchor, align, offset]);

  useEffect(() => {
    const onDown = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (anchor?.contains?.(e.target)) return;
      onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onScroll = (e) => {
      if (!closeOnScroll || ref.current?.contains(e.target)) return;
      onClose();
    };
    const onResize = () => onClose();
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [anchor, onClose, closeOnScroll]);

  return createPortal(
    <div
      ref={ref}
      className={`popover ${pos.ready ? 'is-ready' : ''} ${className}`}
      style={{ top: pos.top, left: pos.left }}
      role="menu"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({ icon: Icon, children, onClick, danger, hint, disabled, checked }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`menu-item ${danger ? 'is-danger' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="menu-item-icon">{Icon ? <Icon /> : null}</span>
      <span className="menu-item-label">{children}</span>
      {checked != null ? (
        <span className={`menu-check ${checked ? 'is-on' : ''}`} aria-hidden="true" />
      ) : hint ? (
        <span className="menu-item-hint">{hint}</span>
      ) : null}
    </button>
  );
}

export const MenuSep = () => <div className="menu-sep" />;
export const MenuLabel = ({ children }) => <div className="menu-label">{children}</div>;
