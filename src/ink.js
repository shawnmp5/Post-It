/*
 * Ink: smooth freehand strokes for drawing on notes.
 *
 * A stroke is stored as { id, t: 'pen' | 'marker', c: colour, s: size, p: [x, y, pressure, x, y, pressure, …] }
 * in the note's own pixels (from its top-left corner). Points are smoothed as they're
 * captured (see Smoother) and drawn as a filled outline whose width follows the
 * pressure, with every corner rounded off by quadratic curves through the midpoints,
 * so even a quick scribble comes out as one clean, even line.
 */

export const PEN_COLORS = ['#1f1f1d', '#2463eb', '#e0352b', '#1f9d55', '#7c3aed', '#f08c00'];
export const MARKER_COLORS = ['#ffe600', '#7dff8a', '#ff7cc0', '#6fd8ff', '#ffb05c'];
export const PEN_SIZES = [2.2, 3.6, 6];
export const MARKER_SIZES = [12, 18, 26];

const round = (v, k = 10) => Math.round(v * k) / k;

/*
 * Turns raw pointer samples into a calm line as you draw:
 *  - each new point is eased toward from the last smoothed one (streamlining), which
 *    takes the jitter out of a hand or a trackpad without making the line lag much
 *  - points closer together than a pixel are skipped
 *  - with a mouse or finger, "pressure" comes from speed: fast strokes thin out a
 *    little, slow ones fill in, like a real pen; a stylus's own pressure is used as is
 */
export class Smoother {
  constructor(x, y, pressure, real) {
    this.real = real;
    this.last = { x, y };
    this.p = real ? pressure : 0.55;
    this.pts = [round(x), round(y), round(this.p, 100)];
    this.t = performance.now();
  }

  add(x, y, pressure) {
    const prev = this.last;
    const dist = Math.hypot(x - prev.x, y - prev.y);
    // Ease more when moving slowly (wobbly), less when moving fast (so it keeps up).
    const ease = Math.min(0.75, 0.28 + dist * 0.02);
    const nx = prev.x + (x - prev.x) * ease;
    const ny = prev.y + (y - prev.y) * ease;
    const step = Math.hypot(nx - prev.x, ny - prev.y);
    if (step < 0.7) return false;
    const now = performance.now();
    const dt = Math.max(1, now - this.t);
    this.t = now;
    let p;
    if (this.real) p = pressure;
    else {
      const speed = step / dt; // px per ms
      const target = Math.max(0.25, Math.min(1, 1 - speed * 0.28));
      p = this.p + (target - this.p) * 0.25;
    }
    this.p = p;
    this.last = { x: nx, y: ny };
    this.pts.push(round(nx), round(ny), round(p, 100));
    return true;
  }

  // Pull the end onto where the pointer actually stopped.
  finish(x, y) {
    const prev = this.last;
    if (Math.hypot(x - prev.x, y - prev.y) > 0.7) this.pts.push(round(x), round(y), round(this.p, 100));
    return this.pts;
  }
}

/* The outline of a stroke as a closed polygon. */
function outline(stroke) {
  const P = stroke.p;
  const n = P.length / 3;
  const marker = stroke.t === 'marker';
  const size = stroke.s;
  const radius = (i) => {
    if (marker) return size / 2;
    const p = P[i * 3 + 2];
    // Thinning: lighter pressure, thinner line; never vanishes.
    let r = (size / 2) * (0.42 + 0.68 * p);
    // A gentle taper over the first and last few points.
    const fromStart = Math.min(i, 3);
    const fromEnd = Math.min(n - 1 - i, 3);
    r *= Math.min(1, 0.55 + 0.15 * fromStart) * Math.min(1, 0.6 + 0.135 * fromEnd);
    return Math.max(0.45, r);
  };
  // A tap: a round dot, full size.
  if (n === 1) return { dot: [P[0], P[1], marker ? size / 2 : (size / 2) * (0.5 + 0.68 * P[2])] };

  const left = [];
  const right = [];
  for (let i = 0; i < n; i++) {
    const x = P[i * 3];
    const y = P[i * 3 + 1];
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    let dx = P[b * 3] - P[a * 3];
    let dy = P[b * 3 + 1] - P[a * 3 + 1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const r = radius(i);
    left.push([x - dy * r, y + dx * r]);
    right.push([x + dy * r, y - dx * r]);
  }
  // Round caps at both ends: half circles swept from one side of the line to the other.
  const cap = (cx, cy, r, from, steps = 8) => {
    const out = [];
    for (let k = 1; k < steps; k++) {
      const t = from - (Math.PI * k) / steps;
      out.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
    }
    return out;
  };
  const ex = P[(n - 1) * 3];
  const ey = P[(n - 1) * 3 + 1];
  const endAng = Math.atan2(left[n - 1][1] - ey, left[n - 1][0] - ex);
  const sx = P[0];
  const sy = P[1];
  const startAng = Math.atan2(right[0][1] - sy, right[0][0] - sx);
  return {
    poly: [...left, ...cap(ex, ey, radius(n - 1), endAng), ...right.reverse(), ...cap(sx, sy, radius(0), startAng)],
  };
}

// Polygon → SVG path, through the midpoints with quadratic curves: no visible corners.
function toPath(poly) {
  const len = poly.length;
  if (len < 3) return '';
  const f = (v) => v.toFixed(2);
  let d = `M${f((poly[0][0] + poly[1][0]) / 2)} ${f((poly[0][1] + poly[1][1]) / 2)}`;
  for (let i = 1; i <= len; i++) {
    const a = poly[i % len];
    const b = poly[(i + 1) % len];
    d += `Q${f(a[0])} ${f(a[1])} ${f((a[0] + b[0]) / 2)} ${f((a[1] + b[1]) / 2)}`;
  }
  return `${d}Z`;
}

const cache = new WeakMap();
// The SVG path for a stroke (cached: strokes never change once drawn).
export function strokePath(stroke, live = false) {
  if (!live) {
    const hit = cache.get(stroke);
    if (hit) return hit;
  }
  const o = outline(stroke);
  let d;
  if (o.dot) {
    const [x, y, r] = o.dot;
    d = `M${x - r} ${y}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;
  } else d = toPath(o.poly);
  if (!live) cache.set(stroke, d);
  return d;
}

// Does a circle at (x, y) with radius r touch the stroke?
export function strokeHit(stroke, x, y, r) {
  const P = stroke.p;
  const reach = r + stroke.s / 2;
  const reach2 = reach * reach;
  for (let i = 0; i < P.length; i += 3) {
    const dx = P[i] - x;
    const dy = P[i + 1] - y;
    if (dx * dx + dy * dy <= reach2) return true;
    if (i + 3 < P.length) {
      // And the segment to the next point.
      const ax = P[i];
      const ay = P[i + 1];
      const bx = P[i + 3];
      const by = P[i + 4];
      const vx = bx - ax;
      const vy = by - ay;
      const l2 = vx * vx + vy * vy;
      if (l2 > 0) {
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2));
        const qx = ax + vx * t - x;
        const qy = ay + vy * t - y;
        if (qx * qx + qy * qy <= reach2) return true;
      }
    }
  }
  return false;
}

// The lowest point any stroke reaches (so the note can make room for it).
export function inkBottom(ink) {
  let max = 0;
  for (const s of ink || []) for (let i = 1; i < s.p.length; i += 3) if (s.p[i] + s.s / 2 > max) max = s.p[i] + s.s / 2;
  return max;
}

// Keep only well-formed strokes (for loading saved data).
export function cleanInk(ink) {
  if (!Array.isArray(ink)) return [];
  return ink.filter(
    (s) => s && typeof s.id === 'string' && (s.t === 'pen' || s.t === 'marker') && typeof s.c === 'string' && Number.isFinite(s.s) && Array.isArray(s.p) && s.p.length >= 3 && s.p.length % 3 === 0,
  );
}
