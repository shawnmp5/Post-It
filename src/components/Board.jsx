import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Note } from './Note.jsx';
import { NoteMenu } from './NoteMenu.jsx';
import {
  clamp,
  makeNote,
  randomTilt,
  uid,
  NOTE_MAX_H,
  NOTE_MAX_W,
  NOTE_MIN_H,
  NOTE_MIN_W,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../store.js';

const DRAG_THRESHOLD = 4;
const EST_H = 170;
const BOTTOM_ROOM = 520; // the wall always extends this far past the lowest note

/** Text offset inside `el` for a viewport point (so clicking a note puts the caret where you clicked). */
function caretOffsetAt(el, x, y) {
  if (!el) return null;
  let node = null;
  let offset = 0;
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (p) {
      node = p.offsetNode;
      offset = p.offset;
    }
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  }
  if (!node || !el.contains(node) || node.nodeType !== Node.TEXT_NODE) return null;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let total = 0;
  while (walker.nextNode()) {
    if (walker.currentNode === node) return total + offset;
    total += walker.currentNode.length;
  }
  return null;
}

const isTyping = () => {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

export const Board = forwardRef(function Board(
  { topic, notes, connections, settings, dispatch, toast, filter, isMobile, onZoomChange },
  ref,
) {
  const zoom = topic.zoom || 1;
  const scrollRef = useRef(null);
  const sizerRef = useRef(null);

  const [editing, setEditing] = useState(null); // { id, field, caret, token }
  const [selectedId, setSelectedId] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [menu, setMenu] = useState(null); // { id, anchor }
  const [connect, setConnect] = useState(null); // { from, x, y }
  const [flashId, setFlashId] = useState(null);
  const [viewport, setViewport] = useState({ w: 800, h: 600 });
  const [measureTick, setMeasureTick] = useState(0);
  const [panning, setPanning] = useState(false);
  const [hoverConn, setHoverConn] = useState(null);
  const newIds = useRef(new Set());

  const visible = useMemo(() => notes.filter((n) => !n.archived), [notes]);
  const byId = useMemo(() => Object.fromEntries(visible.map((n) => [n.id, n])), [visible]);

  /* ---------------- measuring ---------------- */

  const heights = useRef(new Map());
  const roRef = useRef(null);
  const tickPending = useRef(false);
  if (!roRef.current && typeof ResizeObserver !== 'undefined') {
    roRef.current = new ResizeObserver((entries) => {
      let changed = false;
      for (const e of entries) {
        const id = e.target.dataset.noteId;
        const h = e.target.offsetHeight;
        if (id && heights.current.get(id) !== h) {
          heights.current.set(id, h);
          changed = true;
        }
      }
      if (changed && !tickPending.current) {
        tickPending.current = true;
        requestAnimationFrame(() => {
          tickPending.current = false;
          setMeasureTick((t) => t + 1);
        });
      }
    });
  }
  useEffect(() => () => roRef.current?.disconnect(), []);
  const heightOf = useCallback((n) => n.h ?? heights.current.get(n.id) ?? EST_H, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const ro = new ResizeObserver(() => setViewport({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setViewport({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  /* ---------------- canvas size ---------------- */

  const extents = useMemo(() => {
    let r = 0;
    let b = 0;
    for (const n of visible) {
      r = Math.max(r, n.x + n.w);
      b = Math.max(b, n.y + heightOf(n));
    }
    return { r, b };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, measureTick, heightOf]);
  const boardW = Math.max(viewport.w / zoom, extents.r + 48);
  const boardH = Math.max(viewport.h / zoom, extents.b + BOTTOM_ROOM);

  /* ---------------- latest-value ref for stable callbacks ---------------- */

  const live = useRef({});
  live.current = { notes, visible, byId, zoom, editing, selectedId, connect, viewport, topic, boardW, settings, isMobile };

  /* ---------------- scroll restore / persist ---------------- */

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const apply = () => {
      el.scrollTop = topic.scrollTop || 0;
      el.scrollLeft = topic.scrollLeft || 0;
    };
    apply();
    // Re-apply once the canvas has its measured size (it may have been too short on the first pass).
    const id = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scrollSaveTimer = useRef(null);
  const onScroll = () => {
    clearTimeout(scrollSaveTimer.current);
    scrollSaveTimer.current = setTimeout(() => {
      const el = scrollRef.current;
      if (!el) return;
      dispatch({
        type: 'topic/view',
        id: live.current.topic.id,
        patch: { scrollTop: Math.round(el.scrollTop), scrollLeft: Math.round(el.scrollLeft) },
      });
    }, 220);
  };
  useEffect(() => () => clearTimeout(scrollSaveTimer.current), []);

  /* ---------------- coordinates ---------------- */

  const toCanvas = (clientX, clientY) => {
    const r = sizerRef.current.getBoundingClientRect();
    const z = live.current.zoom;
    return { x: (clientX - r.left) / z, y: (clientY - r.top) / z };
  };

  /* ---------------- zoom ---------------- */

  const zoomAnchor = useRef(null);
  const setZoom = useCallback(
    (next, anchorClient) => {
      const el = scrollRef.current;
      const z = live.current.zoom;
      const nz = clamp(Math.round(next * 100) / 100, ZOOM_MIN, ZOOM_MAX);
      if (nz === z) return;
      const r = el.getBoundingClientRect();
      const ax = anchorClient ? anchorClient.x - r.left : el.clientWidth / 2;
      const ay = anchorClient ? anchorClient.y - r.top : el.clientHeight / 2;
      zoomAnchor.current = { cx: (el.scrollLeft + ax) / z, cy: (el.scrollTop + ay) / z, ax, ay };
      dispatch({ type: 'topic/view', id: live.current.topic.id, patch: { zoom: nz } });
    },
    [dispatch],
  );
  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    if (!a) return;
    zoomAnchor.current = null;
    const el = scrollRef.current;
    el.scrollLeft = a.cx * zoom - a.ax;
    el.scrollTop = a.cy * zoom - a.ay;
  }, [zoom]);
  useEffect(() => onZoomChange?.(zoom), [zoom, onZoomChange]);

  // Ctrl / ⌘ + wheel (and trackpad pinch) zooms around the pointer.
  useEffect(() => {
    const el = scrollRef.current;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0025);
      setZoom(live.current.zoom * factor, { x: e.clientX, y: e.clientY });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setZoom]);

  /* ---------------- editing helpers ---------------- */

  const startEdit = useCallback((id, field = 'body', caret = null) => {
    setEditing({ id, field, caret, token: Math.random() });
    setSelectedId(id);
  }, []);
  const stopEditing = useCallback(() => setEditing(null), []);

  // Clicking anywhere outside the note being edited finishes editing.
  useEffect(() => {
    if (!editing) return undefined;
    const onDown = (e) => {
      const t = e.target;
      if (t.closest?.(`[data-note-id="${editing.id}"]`) || t.closest?.('.popover')) return;
      setEditing(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [editing]);

  const flash = useCallback((id) => {
    setFlashId(id);
    setTimeout(() => setFlashId((f) => (f === id ? null : f)), 1400);
  }, []);

  /* ---------------- gestures (drag / resize / pan / connect) ---------------- */

  const gesture = useRef(null);
  const raf = useRef(0);

  const endGesture = () => {
    cancelAnimationFrame(raf.current);
    gesture.current = null;
    document.body.classList.remove('is-dragging-note', 'is-resizing-note', 'is-panning');
    setDraggingId(null);
    setPanning(false);
  };

  // Runs every frame while moving a note: follows the pointer and auto-scrolls near edges.
  const dragFrame = () => {
    const g = gesture.current;
    if (!g || g.kind !== 'move' || !g.moved) return;
    const el = scrollRef.current;
    const r = el.getBoundingClientRect();
    const edge = 56;
    const speed = (d) => Math.ceil(((edge - d) / edge) * 18);
    if (g.cy > r.bottom - edge) el.scrollTop += speed(r.bottom - g.cy);
    else if (g.cy < r.top + edge && el.scrollTop > 0) el.scrollTop -= speed(g.cy - r.top);
    if (g.cx > r.right - edge && el.scrollLeft + el.clientWidth < el.scrollWidth) el.scrollLeft += speed(r.right - g.cx);
    else if (g.cx < r.left + edge && el.scrollLeft > 0) el.scrollLeft -= speed(g.cx - r.left);

    const p = toCanvas(g.cx, g.cy);
    const { viewport: vp, zoom: z } = live.current;
    const maxX = Math.max(vp.w / z - g.orig.w - 8, g.orig.x, 0);
    const x = Math.round(clamp(p.x - g.grabX, 0, maxX));
    const y = Math.round(Math.max(0, p.y - g.grabY));
    if (x !== g.lastX || y !== g.lastY) {
      g.lastX = x;
      g.lastY = y;
      dispatch({ type: 'note/update', id: g.id, patch: { x, y }, touch: false });
    }
    raf.current = requestAnimationFrame(dragFrame);
  };

  const notePointerDown = (e, id) => {
    const L = live.current;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const note = L.byId[id];
    if (!note) return;
    if (L.connect) {
      e.preventDefault();
      e.stopPropagation();
      if (id !== L.connect.from) {
        dispatch({ type: 'conn/add', id: uid('c'), topicId: note.topicId, from: L.connect.from, to: id, record: true });
        toast('Notes connected', { undo: true });
      }
      setConnect(null);
      return;
    }
    e.stopPropagation();
    const target = e.target;
    const isResize = !!target.closest('[data-resize]');
    const isGrip = !!target.closest('[data-grip]');
    const fieldEl = target.closest('[data-field]');
    const wasEditing = L.editing?.id === id;

    if (L.editing && !wasEditing) setEditing(null);
    setSelectedId(id);
    dispatch({ type: 'note/front', id });

    // Notes move only by their tape and resize from the bottom-right corner; the body is for reading and editing.
    const canMove = isGrip || isResize;
    if (canMove) {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      if (e.pointerType === 'touch') e.preventDefault();
    }
    const p = toCanvas(e.clientX, e.clientY);
    gesture.current = {
      kind: isResize ? 'resize' : 'move',
      id,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      sx: e.clientX,
      sy: e.clientY,
      cx: e.clientX,
      cy: e.clientY,
      grabX: p.x - note.x,
      grabY: p.y - note.y,
      orig: { x: note.x, y: note.y, w: note.w, h: note.h ?? heightOf(note) },
      moved: false,
      canMove,
      isGrip,
      wasEditing,
      field: fieldEl?.dataset.field || null,
      fieldEl,
      t0: performance.now(),
    };
  };

  const boardPointerDown = (e) => {
    const L = live.current;
    if (L.connect) {
      setConnect(null);
      return;
    }
    if (L.editing) setEditing(null);
    setSelectedId(null);
    const middle = e.pointerType === 'mouse' && e.button === 1;
    if (e.pointerType === 'mouse' && (e.button === 0 || middle)) {
      if (middle) e.preventDefault();
      const el = scrollRef.current;
      gesture.current = {
        kind: 'pan',
        pointerId: e.pointerId,
        sx: e.clientX,
        sy: e.clientY,
        sl: el.scrollLeft,
        st: el.scrollTop,
        moved: false,
      };
    }
  };

  useEffect(() => {
    const onMove = (e) => {
      const L = live.current;
      if (L.connect) {
        const p = toCanvas(e.clientX, e.clientY);
        setConnect((c) => (c ? { ...c, x: p.x, y: p.y } : c));
      }
      const g = gesture.current;
      if (!g || e.pointerId !== g.pointerId) return;
      g.cx = e.clientX;
      g.cy = e.clientY;
      const dx = e.clientX - g.sx;
      const dy = e.clientY - g.sy;

      if (g.kind === 'pan') {
        if (!g.moved && Math.hypot(dx, dy) < 3) return;
        if (!g.moved) {
          g.moved = true;
          setPanning(true);
          document.body.classList.add('is-panning');
        }
        const el = scrollRef.current;
        el.scrollLeft = g.sl - dx;
        el.scrollTop = g.st - dy;
        return;
      }
      if (!g.canMove) return;
      if (!g.moved) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        g.moved = true;
        dispatch({ type: 'checkpoint' });
        if (g.kind === 'move') {
          setDraggingId(g.id);
          document.body.classList.add('is-dragging-note');
          if (L.editing?.id === g.id) {
            document.activeElement?.blur?.();
          }
          raf.current = requestAnimationFrame(dragFrame);
        } else {
          document.body.classList.add('is-resizing-note');
        }
      }
      if (g.kind === 'resize') {
        const z = L.zoom;
        const w = Math.round(clamp(g.orig.w + dx / z, NOTE_MIN_W, NOTE_MAX_W));
        const h = Math.round(clamp(g.orig.h + dy / z, NOTE_MIN_H, NOTE_MAX_H));
        dispatch({ type: 'note/update', id: g.id, patch: { w, h }, touch: false });
      }
    };

    const onUp = (e) => {
      const g = gesture.current;
      if (!g || e.pointerId !== g.pointerId) return;
      if (g.kind === 'move' && !g.moved) {
        const quickTap = performance.now() - g.t0 < 600;
        if (!g.wasEditing && !g.isGrip && (g.pointerType !== 'touch' || quickTap)) {
          // A click (not a drag) opens the note for editing right where you clicked.
          let field = g.field || 'body';
          let caret = g.fieldEl ? caretOffsetAt(g.fieldEl, e.clientX, e.clientY) : null;
          if (!g.fieldEl) caret = null;
          const note = live.current.byId[g.id];
          if (note && !note.title && !note.body) field = 'title';
          startEdit(g.id, field, caret);
        }
      }
      endGesture();
    };

    const onCancel = (e) => {
      const g = gesture.current;
      if (!g || e.pointerId !== g.pointerId) return;
      endGesture();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, startEdit]);

  /* ---------------- note actions ---------------- */

  const deleteNote = useCallback(
    (id) => {
      dispatch({ type: 'note/delete', id, record: true });
      setEditing((ed) => (ed?.id === id ? null : ed));
      setSelectedId((s) => (s === id ? null : s));
      toast('Note deleted', { undo: true });
    },
    [dispatch, toast],
  );

  const placeNewNote = (w, h) => {
    const L = live.current;
    const el = scrollRef.current;
    const z = L.zoom;
    const vx = el.scrollLeft / z;
    const vy = el.scrollTop / z;
    const vw = el.clientWidth / z;
    const vh = el.clientHeight / z;
    const pad = 14;
    const rects = L.visible.map((n) => ({ x: n.x - pad, y: n.y - pad, r: n.x + n.w + pad, b: n.y + heightOf(n) + pad }));
    const free = (x, y) => !rects.some((r) => x < r.r && x + w > r.x && y < r.b && y + h > r.y);
    const margin = L.isMobile ? 14 : 32;
    const maxX = Math.max(vx + margin, vx + vw - w - margin);
    const maxY = Math.max(vy + margin, vy + vh - h - margin);
    for (let y = vy + margin; y <= maxY; y += 24) {
      for (let x = vx + margin; x <= maxX; x += 24) {
        if (free(x, y)) return { x: Math.round(x + Math.random() * 8), y: Math.round(y + Math.random() * 8) };
      }
    }
    // Wall is full here — drop it near the middle of the view, slightly offset.
    return {
      x: Math.round(clamp(vx + vw / 2 - w / 2 + (Math.random() * 60 - 30), 0, Math.max(0, vx + vw - w))),
      y: Math.round(Math.max(0, vy + vh / 2 - h / 2 + (Math.random() * 60 - 30))),
    };
  };

  const addNote = useCallback(
    (opts = {}) => {
      const L = live.current;
      const w = L.isMobile ? 196 : 220;
      const h = 150;
      const pos = opts.at ? { x: Math.max(0, Math.round(opts.at.x - w / 2)), y: Math.max(0, Math.round(opts.at.y - 28)) } : placeNewNote(w, h);
      const note = makeNote(L.topic.id, {
        ...pos,
        w,
        color: opts.color || L.settings.defaultColor || 'yellow',
        rotation: randomTilt(),
      });
      newIds.current.add(note.id);
      setTimeout(() => newIds.current.delete(note.id), 600);
      dispatch({ type: 'note/add', note, record: true });
      setEditing({ id: note.id, field: 'title', caret: 0, token: Math.random() });
      setSelectedId(note.id);
      return note.id;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dispatch],
  );

  const scrollToNote = useCallback(
    (id) => {
      const n = live.current.byId[id];
      if (!n) return;
      const el = scrollRef.current;
      const z = live.current.zoom;
      const h = heightOf(n);
      const top = (n.y + h / 2) * z - el.clientHeight / 2;
      const left = (n.x + n.w / 2) * z - el.clientWidth / 2;
      el.scrollTo({ top: Math.max(0, top), left: Math.max(0, left), behavior: 'smooth' });
      setSelectedId(id);
      dispatch({ type: 'note/front', id });
      flash(id);
    },
    [dispatch, flash, heightOf],
  );

  const tidy = useCallback(() => {
    const L = live.current;
    if (!L.visible.length) return;
    const el = scrollRef.current;
    const gap = L.isMobile ? 18 : 30;
    const left = L.isMobile ? 14 : 40;
    const colW = Math.min(300, Math.max(...L.visible.map((n) => n.w)));
    const avail = el.clientWidth / L.zoom - left * 2;
    const cols = Math.max(1, Math.floor((avail + gap) / (colW + gap)));
    const colH = new Array(cols).fill(36);
    const ordered = [...L.visible].sort((a, b) => b.pinned - a.pinned || a.y - b.y || a.x - b.x);
    const patches = {};
    for (const n of ordered) {
      let c = 0;
      for (let i = 1; i < cols; i++) if (colH[i] < colH[c] - 1) c = i;
      const w = Math.min(n.w, colW);
      patches[n.id] = {
        x: Math.round(left + c * (colW + gap) + (colW - w) / 2 + (Math.random() * 10 - 5)),
        y: Math.round(colH[c] + Math.random() * 8),
        w,
      };
      colH[c] += heightOf({ ...n, w }) + gap;
    }
    dispatch({ type: 'note/updateMany', patches, record: true });
    el.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    toast('Notes tidied up', { undo: true });
  }, [dispatch, toast, heightOf]);

  const fit = useCallback(() => {
    const L = live.current;
    const el = scrollRef.current;
    if (!L.visible.length) return setZoom(1);
    let r = 0;
    let b = 0;
    for (const n of L.visible) {
      r = Math.max(r, n.x + n.w);
      b = Math.max(b, n.y + heightOf(n));
    }
    const z = clamp(Math.min(el.clientWidth / (r + 40), el.clientHeight / (b + 40), 1), ZOOM_MIN, 1);
    dispatch({ type: 'topic/view', id: L.topic.id, patch: { zoom: Math.round(z * 100) / 100 } });
    requestAnimationFrame(() => el.scrollTo({ top: 0, left: 0, behavior: 'smooth' }));
  }, [dispatch, heightOf, setZoom]);

  useImperativeHandle(ref, () => ({ addNote, scrollToNote, tidy, fit, setZoom: (z) => setZoom(z), getZoom: () => live.current.zoom }), [
    addNote,
    scrollToNote,
    tidy,
    fit,
    setZoom,
  ]);

  /* ---------------- keyboard ---------------- */

  const nudgeAt = useRef(0);
  useEffect(() => {
    const onKey = (e) => {
      const L = live.current;
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') {
        if (L.connect) setConnect(null);
        else if (L.editing) setEditing(null);
        else if (L.selectedId) setSelectedId(null);
        return;
      }
      if (isTyping() || e.metaKey || e.ctrlKey || e.altKey) return;
      const sel = L.selectedId && L.byId[L.selectedId];
      if (!sel) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteNote(sel.id);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        startEdit(sel.id, 'body', null);
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 20 : 4;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (performance.now() - nudgeAt.current > 800) dispatch({ type: 'checkpoint' });
        nudgeAt.current = performance.now();
        dispatch({ type: 'note/update', id: sel.id, patch: { x: Math.max(0, sel.x + dx), y: Math.max(0, sel.y + dy) }, touch: false });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteNote, dispatch, startEdit]);

  /* ---------------- stable API handed to every note ---------------- */

  const api = useMemo(
    () => ({
      observe: (id, el) => el && roRef.current?.observe(el),
      unobserve: (id, el) => {
        if (el) roRef.current?.unobserve(el);
      },
      pointerDown: (e, id) => notePointerDown(e, id),
      checkpoint: () => dispatch({ type: 'checkpoint' }),
      update: (id, patch) => dispatch({ type: 'note/update', id, patch }),
      startEdit,
      stopEditing: () => setEditing(null),
      fieldFocus: () => {},
      openMenu: (id, anchor) => {
        setSelectedId(id);
        dispatch({ type: 'note/front', id });
        setMenu((m) => (m?.id === id ? null : { id, anchor }));
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dispatch, startEdit],
  );

  /* ---------------- search filter ---------------- */

  const q = filter.query.trim().toLowerCase();
  const filtering = !!q || filter.colors.length > 0;
  const matches = useMemo(() => {
    if (!filtering) return null;
    const set = new Set();
    for (const n of visible) {
      const textOk = !q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q);
      const colorOk = !filter.colors.length || filter.colors.includes(n.color);
      if (textOk && colorOk) set.add(n.id);
    }
    return set;
  }, [visible, q, filter.colors, filtering]);

  /* ---------------- connections ---------------- */

  const center = (n) => ({ x: n.x + n.w / 2, y: n.y + heightOf(n) / 2 });
  // Connections run between the facing edges of two notes, so the whole thread stays visible.
  const lines = settings.showConnections
    ? connections
        .filter((c) => byId[c.from] && byId[c.to])
        .map((c) => {
          const A = byId[c.from];
          const B = byId[c.to];
          const ah = heightOf(A);
          const bh = heightOf(B);
          const a = center(A);
          const b = center(B);
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
          const mid = {
            x: 0.125 * p1.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * p2.x,
            y: 0.125 * p1.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * p2.y,
          };
          return { id: c.id, d: `M${p1.x},${p1.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`, p1, p2, mid };
        })
    : [];

  const menuNote = menu && byId[menu.id];
  const closeMenu = useCallback(() => setMenu(null), []);
  const connectFrom = connect && byId[connect.from];

  return (
    <div className={`board-wrap ${panning ? 'is-panning' : ''} ${connect ? 'is-connecting' : ''}`}>
    <div ref={scrollRef} className="board-scroll" onScroll={onScroll}>
      <div ref={sizerRef} className="board-sizer" style={{ width: boardW * zoom, height: boardH * zoom }}>
        <div
          className="board"
          style={{ width: boardW, height: boardH, transform: `scale(${zoom})`, '--zoom': zoom }}
          onPointerDown={boardPointerDown}
          onDoubleClick={(e) => {
            if (e.target !== e.currentTarget) return;
            addNote({ at: toCanvas(e.clientX, e.clientY) });
          }}
        >
          <svg className="connections" width={boardW} height={boardH} aria-hidden="true">
            {lines.map((l) => (
              <g key={l.id} className={`conn ${hoverConn === l.id ? 'is-hover' : ''}`}>
                <path className="conn-line" d={l.d} />
                <circle className="conn-end" cx={l.p1.x} cy={l.p1.y} r="3" />
                <circle className="conn-end" cx={l.p2.x} cy={l.p2.y} r="3" />
                <path
                  className="conn-hit"
                  d={l.d}
                  onPointerEnter={() => setHoverConn(l.id)}
                  onPointerLeave={() => setHoverConn((h) => (h === l.id ? null : h))}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    dispatch({ type: 'conn/delete', id: l.id, record: true });
                    setHoverConn(null);
                    toast('Connection removed', { undo: true });
                  }}
                >
                  <title>Click to remove connection</title>
                </path>
                <g className="conn-x" transform={`translate(${l.mid.x} ${l.mid.y})`}>
                  <circle r="8" />
                  <path d="M-3,-3 L3,3 M3,-3 L-3,3" />
                </g>
              </g>
            ))}
          </svg>

          {visible.map((n) => (
            <Note
              key={n.id}
              note={n}
              api={api}
              editing={editing?.id === n.id}
              editField={editing?.id === n.id ? editing.field : null}
              editCaret={editing?.id === n.id ? editing.caret : null}
              editToken={editing?.id === n.id ? editing.token : null}
              selected={selectedId === n.id}
              dragging={draggingId === n.id}
              dimmed={!!matches && !matches.has(n.id)}
              matched={!!matches && matches.has(n.id)}
              flash={flashId === n.id}
              query={q}
              tilt={settings.tilt}
              isNew={newIds.current.has(n.id)}
              menuOpen={menu?.id === n.id}
              connecting={!!connect && connect.from !== n.id}
            />
          ))}

          {connectFrom && connect.x != null && (
            <svg className="connect-preview" width={boardW} height={boardH} aria-hidden="true">
              <line x1={center(connectFrom).x} y1={center(connectFrom).y} x2={connect.x} y2={connect.y} />
              <circle cx={connect.x} cy={connect.y} r="4" />
            </svg>
          )}
        </div>
      </div>
    </div>

      {visible.length === 0 && (
        <div className="board-empty">
          <div className="board-empty-stack" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <p className="board-empty-title">This wall is empty</p>
          <p className="board-empty-sub">
            {isMobile ? 'Tap + to stick your first note.' : 'Double-click anywhere, press N, or use New note.'}
          </p>
          <button type="button" className="btn btn-primary" onClick={() => addNote()}>
            New note
          </button>
        </div>
      )}

      {connect && (
        <div className="connect-hint" role="status">
          Click another note to connect · <kbd>Esc</kbd> to cancel
        </div>
      )}

      {menuNote && (
        <NoteMenu
          note={menuNote}
          anchor={menu.anchor}
          onClose={closeMenu}
          dispatch={dispatch}
          toast={toast}
          onDelete={() => {
            setMenu(null);
            deleteNote(menuNote.id);
          }}
          onConnect={() => {
            setMenu(null);
            setEditing(null);
            setConnect({ from: menuNote.id, x: null, y: null });
          }}
          onDuplicate={() => {
            setMenu(null);
            const newId = uid('n');
            newIds.current.add(newId);
            setTimeout(() => newIds.current.delete(newId), 600);
            dispatch({ type: 'note/duplicate', id: menuNote.id, newId, rotation: randomTilt(), record: true });
            setSelectedId(newId);
          }}
          onArchive={() => {
            setMenu(null);
            setEditing(null);
            dispatch({ type: 'note/update', id: menuNote.id, patch: { archived: true }, touch: false, record: true });
            toast('Note archived', { undo: true });
          }}
        />
      )}
    </div>
  );
});
