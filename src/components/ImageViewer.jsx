import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/*
 * Full-screen picture viewer. Tap a picture in a note and it grows out of the note to
 * fill the screen.
 *   - wheel / pinch zooms toward the pointer, double-tap or double-click toggles zoom
 *   - drag pans when zoomed in; when not zoomed, a flick down closes it
 *   - arrows (buttons or keys) step through the other pictures in the same note
 *   - Esc, the × or a tap on the backdrop closes it
 * openImageViewer() can be called from anywhere; <ImageViewer /> is mounted once per page.
 */

export function openImageViewer(images, index = 0, fromEl = null) {
  window.dispatchEvent(new CustomEvent('postit:image-view', { detail: { images, index, from: fromEl?.getBoundingClientRect() || null } }));
}

const MAX_ZOOM = 6;

export function ImageViewer() {
  const [view, setView] = useState(null); // { images, index, from }
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const on = (e) => {
      setClosing(false);
      setView(e.detail);
    };
    window.addEventListener('postit:image-view', on);
    return () => window.removeEventListener('postit:image-view', on);
  }, []);

  const close = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setView(null);
      setClosing(false);
    }, 200);
  }, []);

  if (!view) return null;
  return createPortal(<Viewer key={view.images[0]?.src} view={view} closing={closing} onClose={close} />, document.body);
}

function Viewer({ view, closing, onClose }) {
  const { images } = view;
  const [index, setIndex] = useState(view.index);
  const img = images[index];
  const stage = useRef(null);
  const pic = useRef(null);
  const t = useRef({ s: 1, x: 0, y: 0 }); // zoom and pan
  const fit = useRef({ w: 0, h: 0 });
  const pointers = useRef(new Map());
  const g = useRef(null);
  const lastTap = useRef(0);
  const [zoomed, setZoomed] = useState(false);
  const [ready, setReady] = useState(false);
  const first = useRef(true);

  const apply = (animate = false) => {
    const el = pic.current;
    if (!el) return;
    el.style.transition = animate ? 'transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
    el.style.transform = `translate(${t.current.x}px, ${t.current.y}px) scale(${t.current.s})`;
    const z = t.current.s > 1.01;
    setZoomed((old) => (old === z ? old : z));
  };

  // Keep the picture from being panned off into empty space.
  const clampPan = () => {
    const { s } = t.current;
    const st = stage.current.getBoundingClientRect();
    const mx = Math.max(0, (fit.current.w * s - st.width) / 2);
    const my = Math.max(0, (fit.current.h * s - st.height) / 2);
    t.current.x = Math.max(-mx, Math.min(mx, t.current.x));
    t.current.y = Math.max(-my, Math.min(my, t.current.y));
  };

  // Zoom to `s`, keeping the point (cx, cy) on screen where it is.
  const zoomAt = (s, cx, cy, animate) => {
    const st = stage.current.getBoundingClientRect();
    const ox = cx - (st.left + st.width / 2);
    const oy = cy - (st.top + st.height / 2);
    const k = s / t.current.s;
    t.current.x = ox - (ox - t.current.x) * k;
    t.current.y = oy - (oy - t.current.y) * k;
    t.current.s = s;
    if (s <= 1) t.current = { s: 1, x: 0, y: 0 };
    clampPan();
    apply(animate);
  };

  const measure = () => {
    const el = pic.current;
    if (!el) return;
    fit.current = { w: el.offsetWidth, h: el.offsetHeight };
  };

  // A new picture: fitted, unzoomed. The first one grows out of where it was tapped.
  // (Pictures already in the page are often decoded before `load` could be heard.)
  const shownFor = useRef(-1);
  useLayoutEffect(() => {
    if (shownFor.current === index) return;
    t.current = { s: 1, x: 0, y: 0 };
    setReady(false);
    const el = pic.current;
    if (el?.complete && el.naturalWidth) onLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const onLoad = () => {
    if (shownFor.current === index) return;
    shownFor.current = index;
    measure();
    const el = pic.current;
    const from = first.current ? view.from : null;
    first.current = false;
    if (from && el) {
      const r = el.getBoundingClientRect();
      const s = from.width / Math.max(1, r.width);
      const dx = from.left + from.width / 2 - (r.left + r.width / 2);
      const dy = from.top + from.height / 2 - (r.top + r.height / 2);
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
      el.getBoundingClientRect();
      requestAnimationFrame(() => apply(true));
    } else apply(false);
    setReady(true);
  };

  const go = useCallback(
    (d) => {
      if (images.length < 2) return;
      setIndex((i) => (i + d + images.length) % images.length);
    },
    [images.length],
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === '+' || e.key === '=') zoomAt(Math.min(MAX_ZOOM, t.current.s * 1.5), innerWidth / 2, innerHeight / 2, true);
      else if (e.key === '-') zoomAt(Math.max(1, t.current.s / 1.5), innerWidth / 2, innerHeight / 2, true);
    };
    window.addEventListener('keydown', onKey, true);
    const onResize = () => {
      measure();
      clampPan();
      apply(false);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [go, onClose]);

  const onWheel = (e) => {
    e.preventDefault();
    const s = Math.max(1, Math.min(MAX_ZOOM, t.current.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022))));
    zoomAt(s, e.clientX, e.clientY, false);
  };
  useEffect(() => {
    const el = stage.current;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const onDown = (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    stage.current.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      const [a, b] = pts;
      g.current = { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), s: t.current.s, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, x: t.current.x, y: t.current.y };
      return;
    }
    g.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, x: t.current.x, y: t.current.y, moved: false, onPic: !!e.target.closest('.iv-pic'), t0: performance.now() };
  };

  const onMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const st = g.current;
    if (!st) return;
    if (st.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      if (!b) return;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      t.current = { s: st.s, x: st.x + (cx - st.cx), y: st.y + (cy - st.cy) };
      zoomAt(Math.max(1, Math.min(MAX_ZOOM, (st.s * d) / Math.max(1, st.d))), cx, cy, false);
      return;
    }
    const dx = e.clientX - st.sx;
    const dy = e.clientY - st.sy;
    if (!st.moved && Math.hypot(dx, dy) < 5) return;
    st.moved = true;
    if (t.current.s > 1.01) {
      t.current.x = st.x + dx;
      t.current.y = st.y + dy;
      clampPan();
      apply(false);
    } else {
      // Not zoomed: the picture follows a downward drag, and the backdrop fades.
      st.dismiss = dy;
      const k = Math.max(0, Math.min(1, Math.abs(dy) / 300));
      pic.current.style.transition = 'none';
      pic.current.style.transform = `translate(${dx * 0.4}px, ${dy}px) scale(${1 - k * 0.15})`;
      stage.current.parentElement.style.setProperty('--fade', String(1 - k * 0.8));
    }
  };

  const onUp = (e) => {
    pointers.current.delete(e.pointerId);
    const st = g.current;
    if (!st) return;
    if (st.kind === 'pinch') {
      if (pointers.current.size === 0) g.current = null;
      else {
        const [p] = [...pointers.current.values()];
        g.current = { kind: 'pan', sx: p.x, sy: p.y, x: t.current.x, y: t.current.y, moved: true };
      }
      return;
    }
    g.current = null;
    if (st.dismiss != null) {
      stage.current.parentElement.style.setProperty('--fade', '1');
      if (Math.abs(st.dismiss) > 110) return onClose();
      apply(true);
      return;
    }
    if (st.moved) return;
    // A tap: double-tap zooms; a single tap on the backdrop closes.
    const now = performance.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      if (t.current.s > 1.01) zoomAt(1, e.clientX, e.clientY, true);
      else zoomAt(2.5, e.clientX, e.clientY, true);
      return;
    }
    lastTap.current = now;
    if (!st.onPic) setTimeout(() => lastTap.current && performance.now() - lastTap.current >= 290 && onClose(), 300);
  };

  return (
    <div className={`iv ${closing ? 'is-closing' : ''} ${ready ? 'is-ready' : ''} ${zoomed ? 'is-zoomed' : ''}`} role="dialog" aria-modal="true" aria-label="Picture">
      <div className="iv-backdrop" />
      <div ref={stage} className="iv-stage" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <img key={img.src} ref={pic} className="iv-pic" src={img.src} alt={img.alt || ''} draggable={false} onLoad={onLoad} />
      </div>
      <div className="iv-top">
        {images.length > 1 && (
          <span className="iv-count">
            {index + 1} / {images.length}
          </span>
        )}
        <button type="button" className="iv-btn iv-close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      {images.length > 1 && (
        <>
          <button type="button" className="iv-btn iv-nav is-prev" aria-label="Previous picture" onClick={() => go(-1)}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M10 3.5 5.5 8l4.5 4.5" />
            </svg>
          </button>
          <button type="button" className="iv-btn iv-nav is-next" aria-label="Next picture" onClick={() => go(1)}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 3.5 10.5 8 6 12.5" />
            </svg>
          </button>
        </>
      )}
      {img.alt && <div className="iv-caption">{img.alt}</div>}
    </div>
  );
}
