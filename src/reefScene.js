/*
 * The coral reef scene. Plain canvas drawing with no page access, so it runs in
 * the wallpaper worker on an OffscreenCanvas (or on the page as a fallback).
 *
 *   back  (painted once): water, light from the surface, the far and middle reef
 *   live  (every frame):  sunbeams, rippling light, fish, seaweed, jellyfish,
 *                         drifting specks, bubbles
 *   front (painted once): the near reef and sand, drawn over the middle fish
 *
 * createReef(canvas, { mood, reduced, width, height, dpr })
 * mood: 'light' (sunlit shallows), 'dark' (dusk, deeper), 'night' (glowing plankton)
 * returns { resize({ w, h, dpr }), visible(), setMood(m), setLightning(), strike(), destroy() }.
 */

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/* ---------------- colour ---------------- */

function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, k) {
  const A = typeof a === 'string' ? hex(a) : a;
  const B = typeof b === 'string' ? hex(b) : b;
  return [0, 1, 2].map((i) => Math.round(A[i] + (B[i] - A[i]) * k));
}
const rgb = (c, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
const shade = (c, k) => (k >= 0 ? mix(c, [255, 255, 255], k) : mix(c, [0, 0, 0], -k));

const CORALS = ['#ff6f7d', '#ff9a5c', '#ffcf5c', '#b07cff', '#ff7ac8', '#4fd1c5', '#f25f5c', '#ff8a65'];
const WEEDS = ['#3f9d5b', '#6cbf5a', '#2f8a6b', '#8bbf4a'];

const MOODS = {
  light: {
    water: ['#86e0ee', '#3bb4d6', '#1680b3', '#0b5687'],
    haze: '#3aa3cc',
    hazeFar: 0.62,
    hazeMid: 0.3,
    hazeNear: 0.05,
    dim: 0,
    rays: 0.13,
    caustics: 0.12,
    surface: 'rgba(255, 255, 235, 0.35)',
    sand: ['#efdfae', '#cdb37f'],
    rock: '#5d6f7a',
    fishDim: 0,
    snow: [235, 250, 255],
    snowAlpha: 0.45,
    jelly: 1,
    glow: false,
  },
  dark: {
    water: ['#1d6a8a', '#114a6c', '#0a304e', '#061d33'],
    haze: '#0f3d5f',
    hazeFar: 0.72,
    hazeMid: 0.45,
    hazeNear: 0.18,
    dim: 0.3,
    rays: 0.06,
    caustics: 0.06,
    surface: 'rgba(170, 220, 240, 0.16)',
    sand: ['#6f6a5c', '#4a4a48'],
    rock: '#2f3c47',
    fishDim: 0.28,
    snow: [190, 225, 245],
    snowAlpha: 0.32,
    jelly: 2,
    glow: false,
  },
  night: {
    water: ['#071a2d', '#041324', '#020b17', '#01050c'],
    haze: '#04111f',
    hazeFar: 0.82,
    hazeMid: 0.62,
    hazeNear: 0.38,
    dim: 0.62,
    rays: 0,
    caustics: 0,
    surface: 'rgba(80, 120, 170, 0.08)',
    sand: ['#1d2126', '#111317'],
    rock: '#141b22',
    fishDim: 0.62,
    snow: [120, 255, 230],
    snowAlpha: 0.9,
    jelly: 3,
    glow: true,
  },
};

/* ---------------- static pieces ---------------- */

function branching(g, x, y, len, angle, width, depth, col, rnd, tips) {
  const ex = x + Math.sin(angle) * len;
  const ey = y - Math.cos(angle) * len;
  g.strokeStyle = rgb(shade(col, -0.28 + (4 - depth) * 0.09));
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo(x + Math.sin(angle + 0.3) * len * 0.5, y - Math.cos(angle) * len * 0.5, ex, ey);
  g.stroke();
  if (depth <= 0) {
    g.fillStyle = rgb(shade(col, 0.25));
    g.beginPath();
    g.arc(ex, ey, width * 0.62, 0, TAU);
    g.fill();
    tips?.push([ex, ey, width]);
    return;
  }
  const kids = rnd() < 0.35 ? 3 : 2;
  for (let k = 0; k < kids; k++) {
    const a = angle + (k - (kids - 1) / 2) * (0.42 + rnd() * 0.3) + (rnd() - 0.5) * 0.25;
    branching(g, ex, ey, len * (0.7 + rnd() * 0.14), a, width * 0.8, depth - 1, col, rnd, tips);
  }
}

function seaFan(g, x, y, size, col, rnd) {
  const draw = (x0, y0, len, a, w, d) => {
    const ex = x0 + Math.sin(a) * len;
    const ey = y0 - Math.cos(a) * len;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(ex, ey);
    g.stroke();
    if (d > 0) {
      draw(ex, ey, len * 0.8, a - 0.32 - rnd() * 0.2, w * 0.78, d - 1);
      draw(ex, ey, len * 0.8, a + 0.32 + rnd() * 0.2, w * 0.78, d - 1);
    }
  };
  g.save();
  g.strokeStyle = rgb(col, 0.85);
  g.lineCap = 'round';
  draw(x, y, size * 0.32, 0, 2.6, 6);
  g.restore();
}

// Puffy cauliflower coral: a mound of shaded knobs.
function cauliflower(g, x, y, size, col, rnd) {
  const n = 10 + Math.floor(rnd() * 8);
  const knobs = [];
  for (let k = 0; k < n; k++) {
    const a = Math.PI + rnd() * Math.PI;
    const d = rnd() * 26 * size;
    knobs.push([x + Math.cos(a) * d * 1.3, y + Math.sin(a) * d * 0.9, (7 + rnd() * 7) * size]);
  }
  knobs.sort((p, q) => q[1] - p[1]);
  for (const [kx, ky, r] of knobs) {
    const grad = g.createRadialGradient(kx - r * 0.35, ky - r * 0.4, r * 0.1, kx, ky, r);
    grad.addColorStop(0, rgb(shade(col, 0.3)));
    grad.addColorStop(0.7, rgb(col));
    grad.addColorStop(1, rgb(shade(col, -0.35)));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(kx, ky, r, 0, TAU);
    g.fill();
  }
}

// Table coral: a wide flat plate on a short stalk.
function tableCoral(g, x, y, size, col, rnd) {
  const w = (60 + rnd() * 50) * size;
  const h = (34 + rnd() * 26) * size;
  g.fillStyle = rgb(shade(col, -0.45));
  g.beginPath();
  g.moveTo(x - 7 * size, y);
  g.lineTo(x - 4 * size, y - h);
  g.lineTo(x + 4 * size, y - h);
  g.lineTo(x + 7 * size, y);
  g.closePath();
  g.fill();
  const grad = g.createLinearGradient(0, y - h - 9 * size, 0, y - h + 7 * size);
  grad.addColorStop(0, rgb(shade(col, 0.25)));
  grad.addColorStop(0.5, rgb(col));
  grad.addColorStop(1, rgb(shade(col, -0.5)));
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(x, y - h, w / 2, 8 * size, (rnd() - 0.5) * 0.12, 0, TAU);
  g.fill();
  g.fillStyle = rgb(shade(col, 0.3), 0.7);
  for (let k = 0; k < 9; k++) {
    g.beginPath();
    g.arc(x - w / 2 + 6 + rnd() * (w - 12), y - h - 4 * size + rnd() * 3, 1.6 * size, 0, TAU);
    g.fill();
  }
}

function brain(g, x, y, r, col, rnd) {
  g.save();
  g.beginPath();
  g.ellipse(x, y, r, r * 0.72, 0, Math.PI, TAU);
  g.closePath();
  const grad = g.createRadialGradient(x - r * 0.35, y - r * 0.55, r * 0.1, x, y, r * 1.1);
  grad.addColorStop(0, rgb(shade(col, 0.25)));
  grad.addColorStop(1, rgb(shade(col, -0.35)));
  g.fillStyle = grad;
  g.fill();
  g.clip();
  g.strokeStyle = rgb(shade(col, -0.45), 0.55);
  g.lineWidth = Math.max(1, r * 0.05);
  for (let k = 0; k < 9; k++) {
    let px = x - r + rnd() * r * 2;
    let py = y - rnd() * r * 0.7;
    g.beginPath();
    g.moveTo(px, py);
    for (let s = 0; s < 6; s++) {
      px += (rnd() - 0.5) * r * 0.5;
      py += (rnd() - 0.5) * r * 0.3;
      g.lineTo(px, py);
    }
    g.stroke();
  }
  g.restore();
}

function tubes(g, x, y, size, col, rnd) {
  const n = 3 + Math.floor(rnd() * 3);
  for (let k = 0; k < n; k++) {
    const w = (9 + rnd() * 7) * size;
    const h = (34 + rnd() * 44) * size;
    const tx = x + (k - n / 2) * w * 0.9;
    const lean = (rnd() - 0.5) * 0.25;
    g.save();
    g.translate(tx, y);
    g.rotate(lean);
    const grad = g.createLinearGradient(-w / 2, 0, w / 2, 0);
    grad.addColorStop(0, rgb(shade(col, -0.4)));
    grad.addColorStop(0.45, rgb(shade(col, 0.1)));
    grad.addColorStop(1, rgb(shade(col, -0.35)));
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(-w / 2, 0);
    g.lineTo(-w / 2 * 0.85, -h);
    g.lineTo(w / 2 * 0.85, -h);
    g.lineTo(w / 2, 0);
    g.closePath();
    g.fill();
    g.fillStyle = rgb(shade(col, -0.6));
    g.beginPath();
    g.ellipse(0, -h, w * 0.43, w * 0.16, 0, 0, TAU);
    g.fill();
    g.restore();
  }
}

function rock(g, x, y, w, h, col, rnd) {
  g.beginPath();
  g.moveTo(x - w / 2, y + 4);
  const steps = 7;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = x - w / 2 + w * t;
    const py = y - Math.sin(t * Math.PI) * h * (0.75 + rnd() * 0.35);
    g.lineTo(px, py);
  }
  g.lineTo(x + w / 2, y + 4);
  g.closePath();
  const grad = g.createLinearGradient(0, y - h, 0, y);
  grad.addColorStop(0, rgb(shade(col, 0.12)));
  grad.addColorStop(1, rgb(shade(col, -0.35)));
  g.fillStyle = grad;
  g.lineJoin = 'round';
  g.fill();
}

/* One band of reef across the bottom. Taller near the edges so the middle stays open. */
function paintReefLayer(g, W, H, opts, rnd, tips) {
  const { base, height, count, scale, mood } = opts;
  const edge = (x) => 0.55 + 0.45 * Math.min(1, Math.abs(x / W - 0.5) * 2.2);
  // Rocks first, as the foundation.
  for (let x = -40; x < W + 60; x += 50 + rnd() * 70) {
    rock(g, x, base, 90 + rnd() * 120, height * (0.25 + rnd() * 0.35) * edge(x), hex(mood.rock), rnd);
  }
  const items = [];
  for (let i = 0; i < count; i++) {
    const x = rnd() * W;
    const e = edge(x);
    items.push({ x, e, y: base - height * (0.1 + rnd() * 0.18) * e, col: hex(CORALS[Math.floor(rnd() * CORALS.length)]), kind: rnd() });
  }
  // Tall things first so the low, round ones sit in front of them.
  items.sort((a, b) => (a.kind < 0.12 ? 0 : 1) - (b.kind < 0.12 ? 0 : 1));
  for (const { x, e, y, col, kind } of items) {
    g.lineCap = 'round';
    if (kind < 0.12) seaFan(g, x, y, height * (0.55 + rnd() * 0.4) * e, col, rnd);
    else if (kind < 0.36) branching(g, x, y, height * (0.15 + rnd() * 0.1) * e, (rnd() - 0.5) * 0.4, 11 * scale, 3, col, rnd, tips);
    else if (kind < 0.56) cauliflower(g, x, y + 8, scale * e * (0.8 + rnd() * 0.6), col, rnd);
    else if (kind < 0.7) brain(g, x, y + 8, (22 + rnd() * 26) * scale * e, col, rnd);
    else if (kind < 0.84) tubes(g, x, y + 6, scale * e * (0.8 + rnd() * 0.5), col, rnd);
    else tableCoral(g, x, y + 10, scale * e * (0.8 + rnd() * 0.4), col, rnd);
  }
}

// Push a painted layer back into the water: tint it toward the water colour, and darken at dusk/night.
function haze(g, W, H, mood, k) {
  g.save();
  g.globalCompositeOperation = 'source-atop';
  if (mood.dim) {
    g.fillStyle = `rgba(0, 0, 0, ${mood.dim})`;
    g.fillRect(0, 0, W, H);
  }
  g.fillStyle = rgb(hex(mood.haze), k);
  g.fillRect(0, 0, W, H);
  g.restore();
}

function paintScene(W, H, dpr, mood) {
  const back = makeCanvas(W * dpr, H * dpr);
  const b = back.getContext('2d');
  b.scale(dpr, dpr);

  // Water: bright near the surface, deep blue below.
  let grad = b.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, mood.water[0]);
  grad.addColorStop(0.35, mood.water[1]);
  grad.addColorStop(0.75, mood.water[2]);
  grad.addColorStop(1, mood.water[3]);
  b.fillStyle = grad;
  b.fillRect(0, 0, W, H);
  // Light pouring in from the surface.
  grad = b.createRadialGradient(W * 0.5, -H * 0.15, 0, W * 0.5, -H * 0.15, H * 0.9);
  grad.addColorStop(0, mood.surface);
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  b.fillStyle = grad;
  b.fillRect(0, 0, W, H);

  const tips = [];
  // Far reef: painted small and scaled up, so it's soft with distance.
  const s = 0.5;
  const far = makeCanvas(W * s, H * s);
  const f = far.getContext('2d');
  f.scale(s, s);
  paintReefLayer(f, W, H, { base: H * 1.0, height: H * 0.3, count: Math.round(W / 30), scale: 0.6, mood }, seeded(11), null);
  haze(f, W, H, mood, mood.hazeFar);
  b.drawImage(far, 0, 0, W, H);

  // Middle reef.
  const mid = makeCanvas(W, H);
  const m = mid.getContext('2d');
  paintReefLayer(m, W, H, { base: H * 1.02, height: H * 0.32, count: Math.round(W / 38), scale: 0.85, mood }, seeded(23), mood.glow ? tips : null);
  haze(m, W, H, mood, mood.hazeMid);
  b.drawImage(mid, 0, 0, W, H);

  // Front: the near reef and the sand, drawn over the middle fish each frame.
  const front = makeCanvas(W * dpr, H * dpr);
  const fr = front.getContext('2d');
  fr.scale(dpr, dpr);
  const near = makeCanvas(W, H);
  const n = near.getContext('2d');
  const sandTop = H * 0.93;
  grad = n.createLinearGradient(0, sandTop, 0, H);
  grad.addColorStop(0, mood.sand[0]);
  grad.addColorStop(1, mood.sand[1]);
  n.fillStyle = grad;
  n.beginPath();
  n.moveTo(0, H);
  for (let x = 0; x <= W; x += 40) n.lineTo(x, sandTop + Math.sin(x * 0.013) * 6 + Math.sin(x * 0.041) * 3);
  n.lineTo(W, H);
  n.closePath();
  n.fill();
  paintReefLayer(n, W, H, { base: H * 1.04, height: H * 0.3, count: Math.round(W / 60), scale: 1.15, mood }, seeded(37), mood.glow ? tips : null);
  haze(n, W, H, mood, mood.hazeNear);
  fr.drawImage(near, 0, 0, W, H);

  // At night the coral tips glow faintly.
  if (mood.glow) {
    for (const g2 of [b, fr]) {
      g2.save();
      g2.globalCompositeOperation = 'lighter';
      for (const [x, y, w] of tips) {
        if (Math.random() < 0.5) continue;
        const r = 4 + w * 1.6;
        const gg = g2.createRadialGradient(x, y, 0, x, y, r);
        const c = Math.random() < 0.5 ? '90, 255, 220' : '180, 140, 255';
        gg.addColorStop(0, `rgba(${c}, 0.35)`);
        gg.addColorStop(1, `rgba(${c}, 0)`);
        g2.fillStyle = gg;
        g2.fillRect(x - r, y - r, r * 2, r * 2);
      }
      g2.restore();
    }
  }
  // Where the front starts, so only that strip is redrawn.
  return { back, front, frontTop: Math.floor(H * 0.55) };
}

/* Rippling light: a tileable web of bright lines (the edges of a Voronoi pattern). */
function makeCaustics(size) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const pts = [];
  for (let i = 0; i < 16; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) pts.push(x + ox * size, y + oy * size);
  }
  const width = size * 0.03;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let d1 = 1e9;
      let d2 = 1e9;
      for (let i = 0; i < pts.length; i += 2) {
        const dx = pts[i] - x;
        const dy = pts[i + 1] - y;
        const d = dx * dx + dy * dy;
        if (d < d1) {
          d2 = d1;
          d1 = d;
        } else if (d < d2) d2 = d;
      }
      const v = clamp(1 - (Math.sqrt(d2) - Math.sqrt(d1)) / width, 0, 1);
      const o = (y * size + x) * 4;
      img.data[o] = 255;
      img.data[o + 1] = 255;
      img.data[o + 2] = 245;
      img.data[o + 3] = Math.round(v * v * v * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function makeRay() {
  const c = makeCanvas(96, 512);
  const g = c.getContext('2d');
  let grad = g.createLinearGradient(0, 0, 96, 0);
  grad.addColorStop(0, 'rgba(255,255,240,0)');
  grad.addColorStop(0.5, 'rgba(255,255,240,1)');
  grad.addColorStop(1, 'rgba(255,255,240,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 96, 512);
  g.globalCompositeOperation = 'destination-in';
  grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 96, 512);
  return c;
}

function makeGlow(rgbStr) {
  const c = makeCanvas(32, 32);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, `rgba(${rgbStr}, 1)`);
  grad.addColorStop(0.25, `rgba(${rgbStr}, 0.55)`);
  grad.addColorStop(1, `rgba(${rgbStr}, 0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return c;
}

function makeBubble() {
  const c = makeCanvas(32, 32);
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 1.6;
  g.beginPath();
  g.arc(16, 16, 14, 0, TAU);
  g.stroke();
  const grad = g.createRadialGradient(16, 16, 6, 16, 16, 15);
  grad.addColorStop(0, 'rgba(255,255,255,0.02)');
  grad.addColorStop(1, 'rgba(255,255,255,0.22)');
  g.fillStyle = grad;
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath();
  g.ellipse(11, 10, 3.2, 2.2, -0.6, 0, TAU);
  g.fill();
  return c;
}

/* ---------------- fish ---------------- */

const SPECIES = [
  { len: 11, h: 5, body: '#3aa7e8', belly: '#a5e1ff', fin: '#1f7fc4' }, // blue chromis
  { len: 14, h: 9, body: '#ffd23f', belly: '#fff1a8', fin: '#f2b705' }, // yellow tang
  { len: 12, h: 6, body: '#ff8c2a', belly: '#ffc38a', fin: '#e46a10', stripes: true }, // banded orange
  { len: 10, h: 5, body: '#8a4fd8', tail2: '#ffd23f', belly: '#c9a8ff', fin: '#6a35b8' }, // purple / yellow
  { len: 16, h: 7, body: '#7fd6c2', belly: '#d8fff4', fin: '#4fb3a0' }, // pale wrasse
];

function fishColors(sp, mood, depth) {
  const k = mood.fishDim * 0.7 + (1 - depth) * (mood === MOODS.light ? 0.45 : 0.55);
  const tint = (c) => rgb(mix(mix(c, [0, 0, 0], mood.fishDim * 0.6), hex(mood.haze), clamp(k, 0, 0.85)));
  return {
    body: tint(sp.body),
    belly: tint(sp.belly),
    fin: tint(sp.fin),
    tail2: sp.tail2 ? tint(sp.tail2) : null,
    stripe: tint('#ffffff'),
    eye: rgb(mix([20, 24, 32], hex(mood.haze), clamp(k, 0, 0.8))),
  };
}

function drawFish(g, f, t) {
  const sp = SPECIES[f.sp];
  const c = f.colors;
  const L = sp.len;
  const Hh = sp.h;
  const wag = Math.sin(t * f.wagHz * TAU + f.phase) * (0.35 + f.burst * 0.4);
  g.save();
  g.translate(f.x, f.y);
  g.scale(f.size * f.face, f.size);
  g.rotate(f.pitch);
  // tail
  g.fillStyle = c.tail2 || c.fin;
  g.beginPath();
  g.moveTo(-L * 0.62, 0);
  g.lineTo(-L * 1.05, -Hh * 0.75 + wag * Hh * 0.5);
  g.quadraticCurveTo(-L * 0.9, wag * Hh * 0.3, -L * 1.05, Hh * 0.75 + wag * Hh * 0.5);
  g.closePath();
  g.fill();
  // dorsal fin
  g.fillStyle = c.fin;
  g.beginPath();
  g.moveTo(-L * 0.35, -Hh * 0.7);
  g.quadraticCurveTo(0, -Hh * 1.35, L * 0.25, -Hh * 0.8);
  g.lineTo(L * 0.1, -Hh * 0.5);
  g.closePath();
  g.fill();
  // body
  g.beginPath();
  g.moveTo(L * 0.72, 0);
  g.bezierCurveTo(L * 0.55, -Hh * 1.05, -L * 0.35, -Hh * 0.95, -L * 0.66, 0);
  g.bezierCurveTo(-L * 0.35, Hh * 0.95, L * 0.55, Hh * 1.05, L * 0.72, 0);
  g.closePath();
  if (c.tail2) {
    const gr = g.createLinearGradient(L * 0.5, 0, -L * 0.6, 0);
    gr.addColorStop(0, c.body);
    gr.addColorStop(0.5, c.body);
    gr.addColorStop(0.62, c.tail2);
    gr.addColorStop(1, c.tail2);
    g.fillStyle = gr;
  } else g.fillStyle = c.body;
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = c.belly;
  g.globalAlpha = 0.75;
  g.beginPath();
  g.ellipse(L * 0.05, Hh * 0.62, L * 0.62, Hh * 0.45, 0, 0, TAU);
  g.fill();
  g.globalAlpha = 1;
  if (sp.stripes) {
    g.fillStyle = c.stripe;
    for (const sx of [L * 0.32, -L * 0.12]) {
      g.beginPath();
      g.ellipse(sx, 0, L * 0.07, Hh * 1.2, 0, 0, TAU);
      g.fill();
    }
  }
  g.restore();
  // eye
  g.fillStyle = c.eye;
  g.beginPath();
  g.arc(L * 0.45, -Hh * 0.18, Math.max(0.9, Hh * 0.16), 0, TAU);
  g.fill();
  g.restore();
}

/* ------------------------------------------------------------------ */

export function createReef(canvas, opts) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const reduced = !!opts.reduced;
  const nextFrame = self.requestAnimationFrame ? (f) => self.requestAnimationFrame(f) : (f) => setTimeout(() => f(performance.now()), 16);
  const cancelFrame = self.cancelAnimationFrame ? (id) => self.cancelAnimationFrame(id) : (id) => clearTimeout(id);
  let view = { w: opts.width, h: opts.height, dpr: opts.dpr || 1 };
  let moodName = MOODS[opts.mood] ? opts.mood : 'light';
  let mood = MOODS[moodName];

  const ray = makeRay();
  const bubble = makeBubble();
  const caustic = makeCaustics(192);
  let causticPattern = null;
  let causticLayer = null; // low-res: soft, and cheap to fill each frame
  let cctx = null;
  let causticFade = null;
  const CS = 0.4;
  let causticTick = 0;
  const plankton = makeGlow('110, 255, 225');
  const jellyGlow = [makeGlow('120, 220, 255'), makeGlow('255, 140, 220'), makeGlow('170, 150, 255')];

  let W = 0;
  let H = 0;
  let dpr = 1;
  let maxScale = 1;
  let scene = null;
  let rays = [];
  let fish = [];
  let schools = [];
  let weeds = [];
  let anemones = [];
  let snow = [];
  let bubbles = [];
  let vents = [];
  let jellies = [];
  let time = 0;
  let raf = 0;
  let last = 0;
  let alive = true;
  let slowFrames = 0;
  let sinceScale = 0;

  /* --------- population --------- */

  function makeFish(sp, depth, x, y, face) {
    const f = {
      sp,
      depth,
      x,
      y,
      face,
      size: 0.75 + depth * 1.1,
      speed: (16 + Math.random() * 14) * (0.6 + depth * 0.7),
      wagHz: rand(1.6, 2.6),
      phase: Math.random() * TAU,
      pitch: 0,
      burst: 0,
      colors: null,
    };
    f.colors = fishColors(SPECIES[sp], mood, depth);
    return f;
  }

  function newSchool(entering) {
    const depth = rand(0.15, 0.85);
    const dir = Math.random() < 0.5 ? 1 : -1;
    const sp = Math.random() < 0.6 ? 0 : Math.random() < 0.5 ? 3 : 1;
    const n = 6 + Math.floor(Math.random() * 9);
    const s = {
      depth,
      dir,
      x: entering ? (dir > 0 ? -120 : W + 120) : rand(0, W),
      baseY: rand(H * 0.18, H * 0.62),
      phase: Math.random() * TAU,
      speed: (20 + Math.random() * 16) * (0.6 + depth * 0.7),
      members: [],
    };
    for (let i = 0; i < n; i++) {
      const f = makeFish(sp, depth, s.x, s.baseY, dir);
      f.ox = rand(-60, 60) * (0.6 + depth);
      f.oy = rand(-26, 26) * (0.6 + depth);
      f.np = Math.random() * TAU;
      s.members.push(f);
    }
    return s;
  }

  function newLoner(entering) {
    const depth = rand(0.35, 1);
    const dir = Math.random() < 0.5 ? 1 : -1;
    const f = makeFish(Math.random() < 0.5 ? 2 : Math.random() < 0.5 ? 4 : 1, depth, entering ? (dir > 0 ? -60 : W + 60) : rand(0, W), rand(H * 0.2, H * 0.7), dir);
    f.loner = true;
    f.dir = dir;
    f.targetY = f.y;
    f.turn = 0; // turning animation 0..1
    f.nextTurn = rand(6, 16);
    f.speed *= 0.7;
    return f;
  }

  function populate() {
    schools = [newSchool(false), newSchool(false)];
    if (W > 900) schools.push(newSchool(false));
    fish = Array.from({ length: W > 900 ? 5 : 3 }, () => newLoner(false));
    const rnd = seeded(51);
    weeds = [];
    const weedCount = Math.round(W / 70);
    for (let i = 0; i < weedCount; i++) {
      const near = rnd() < 0.4;
      const x = rnd() * W;
      const edgeBoost = 0.6 + 0.4 * Math.min(1, Math.abs(x / W - 0.5) * 2.2);
      weeds.push({
        near,
        x,
        base: H + 6,
        h: (near ? 140 : 110) * (0.6 + rnd() * 0.8) * edgeBoost * (H / 900),
        w: near ? 9 + rnd() * 6 : 6 + rnd() * 4,
        col: hex(WEEDS[Math.floor(rnd() * WEEDS.length)]),
        phase: rnd() * TAU,
        speed: 0.6 + rnd() * 0.5,
        amp: 10 + rnd() * 14,
      });
    }
    anemones = [];
    for (const fx of [0.07, 0.9, 0.2]) {
      anemones.push({ x: W * fx + rand(-30, 30), y: H * 0.965, n: 16 + Math.floor(Math.random() * 6), len: rand(20, 30), col: hex(Math.random() < 0.5 ? '#ff7ac8' : '#b07cff'), phase: Math.random() * TAU });
    }
    snow = Array.from({ length: Math.round((W * H) / 14000) }, () => ({ x: rand(0, W), y: rand(0, H), vx: rand(-5, 5), vy: rand(2, 9), r: rand(0.5, 1.7), a: rand(0.25, 1), p: Math.random() * TAU }));
    vents = [W * rand(0.08, 0.2), W * rand(0.78, 0.94), W * rand(0.35, 0.65)].map((x) => ({ x, y: H * rand(0.78, 0.86), next: rand(0, 3) }));
    bubbles = [];
    rays = Array.from({ length: 7 }, (_, i) => ({ x: W * (0.08 + (i / 6) * 0.84) + rand(-40, 40), w: rand(0.7, 1.6), phase: Math.random() * TAU, speed: rand(0.05, 0.12) }));
    jellies = Array.from({ length: mood.jelly }, () => newJelly(false));
  }

  function newJelly(entering) {
    return {
      x: rand(W * 0.1, W * 0.9),
      y: entering ? H + 60 : rand(H * 0.2, H * 0.8),
      size: rand(16, 30),
      phase: Math.random() * TAU,
      drift: rand(-4, 4),
      glow: jellyGlow[Math.floor(Math.random() * jellyGlow.length)],
      hue: Math.random() < 0.5 ? [150, 215, 255] : [255, 170, 225],
    };
  }

  function recolor() {
    for (const s of schools) for (const f of s.members) f.colors = fishColors(SPECIES[f.sp], mood, f.depth);
    for (const f of fish) f.colors = fishColors(SPECIES[f.sp], mood, f.depth);
    while (jellies.length < mood.jelly) jellies.push(newJelly(false));
    jellies.length = mood.jelly;
  }

  /* --------- sizing --------- */

  function setScale(next) {
    dpr = next;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    scene = paintScene(W, H, dpr, mood);
    causticLayer = makeCanvas(W * CS, H * 0.55 * CS);
    cctx = causticLayer.getContext('2d');
    causticPattern = cctx.createPattern(caustic, 'repeat');
    causticFade = cctx.createLinearGradient(0, 0, 0, causticLayer.height);
    causticFade.addColorStop(0, 'rgba(0,0,0,1)');
    causticFade.addColorStop(0.55, 'rgba(0,0,0,0.45)');
    causticFade.addColorStop(1, 'rgba(0,0,0,0)');
    sinceScale = 0;
    slowFrames = 0;
  }

  function resize() {
    if (view.w === W && view.h === H && scene) return;
    W = view.w;
    H = view.h;
    setScale(Math.min(view.dpr, maxScale));
    populate();
    if (reduced) draw();
  }

  /* --------- update --------- */

  function update(dt) {
    time += dt;
    // Schools glide across, gently rising and falling; each fish wobbles around its spot.
    for (let i = 0; i < schools.length; i++) {
      const s = schools[i];
      s.x += s.dir * s.speed * dt;
      const sy = s.baseY + Math.sin(time * 0.25 + s.phase) * 26;
      for (const f of s.members) {
        const nx = Math.sin(time * 0.7 + f.np) * 10;
        const ny = Math.sin(time * 0.9 + f.np * 1.7) * 6;
        const py = f.y;
        f.x = s.x + f.ox + nx;
        f.y = sy + f.oy + ny;
        f.pitch = clamp((f.y - py) * 0.6, -0.25, 0.25) * 0.6 + f.pitch * 0.4;
      }
      if ((s.dir > 0 && s.x > W + 200) || (s.dir < 0 && s.x < -200)) schools[i] = newSchool(true);
    }
    // Loners wander, sometimes turning around (they narrow to a sliver and flip).
    for (let i = 0; i < fish.length; i++) {
      const f = fish[i];
      f.nextTurn -= dt;
      if (f.turn > 0) {
        f.turn += dt * 2.2;
        if (f.turn >= 0.5 && f.dir === f.face) f.dir = -f.dir;
        f.face = f.dir * Math.abs(Math.cos(Math.min(1, f.turn) * Math.PI));
        if (f.turn >= 1) {
          f.turn = 0;
          f.face = f.dir;
        }
      } else if (f.nextTurn <= 0) {
        f.turn = 0.001;
        f.nextTurn = rand(8, 20);
      }
      if (Math.random() < dt * 0.25) f.targetY = clamp(f.y + rand(-80, 80), H * 0.15, H * 0.75);
      if (Math.random() < dt * 0.08) f.burst = 1;
      f.burst = Math.max(0, f.burst - dt * 0.8);
      const sp = f.speed * (1 + f.burst * 1.6) * (f.turn > 0 ? 0.3 : 1);
      f.x += f.dir * sp * dt;
      const vy = (f.targetY - f.y) * 0.4 * dt;
      f.y += vy;
      f.pitch = clamp(vy * 3, -0.3, 0.3);
      if ((f.dir > 0 && f.x > W + 80) || (f.dir < 0 && f.x < -80)) fish[i] = newLoner(true);
    }
    // Marine snow (or glowing plankton at night) drifting down.
    for (const p of snow) {
      p.x += (p.vx + Math.sin(time * 0.3 + p.p) * 4) * dt;
      p.y += p.vy * dt;
      if (p.y > H + 4) {
        p.y = -4;
        p.x = rand(0, W);
      }
      if (p.x < -4) p.x = W + 4;
      if (p.x > W + 4) p.x = -4;
    }
    // Bubbles: little bursts from vents in the reef, wobbling up and speeding as they rise.
    for (const v of vents) {
      v.next -= dt;
      if (v.next <= 0) {
        const n = 3 + Math.floor(Math.random() * 6);
        for (let k = 0; k < n; k++) bubbles.push({ x: v.x + rand(-6, 6), y: v.y + k * rand(8, 16), r: rand(1.4, 4.6), ph: Math.random() * TAU, wob: rand(1.5, 4), a: 1 });
        v.next = rand(2.5, 7);
      }
    }
    for (const b of bubbles) {
      b.y -= (34 + b.r * 13) * dt * (1 + (1 - b.y / H) * 0.4);
      b.x += Math.sin(time * 3 + b.ph) * b.wob * dt * 2;
      if (b.y < H * 0.08) b.a -= dt * 1.5;
    }
    bubbles = bubbles.filter((b) => b.a > 0 && b.y > -10);
    // Jellyfish: pulse, rise a little with each pulse, sink slowly between.
    for (let i = 0; i < jellies.length; i++) {
      const j = jellies[i];
      const p = (time * 0.55 + j.phase) % 1;
      const push = p < 0.3 ? Math.sin((p / 0.3) * Math.PI) : 0;
      j.y += (-push * 26 + 4) * dt;
      j.x += (j.drift + Math.sin(time * 0.2 + j.phase) * 3) * dt;
      if (j.y < -80) jellies[i] = newJelly(true);
    }
  }

  /* --------- draw --------- */

  function drawWeeds(near) {
    for (const w of weeds) {
      if (w.near !== near) continue;
      const n = 14;
      const left = [];
      const right = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const sway = Math.sin(time * w.speed + w.phase + t * 2.4) * w.amp * Math.pow(t, 1.4);
        const x = w.x + sway;
        const y = w.base - w.h * t;
        const half = (w.w * (1 - t * 0.8)) / 2;
        left.push([x - half, y]);
        right.push([x + half, y]);
      }
      const k = near ? mood.hazeNear : mood.hazeMid;
      const col = mix(mix(w.col, [0, 0, 0], mood.dim), hex(mood.haze), k);
      ctx.fillStyle = rgb(col);
      ctx.beginPath();
      ctx.moveTo(left[0][0], left[0][1]);
      for (const [x, y] of left) ctx.lineTo(x, y);
      for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawAnemones() {
    for (const a of anemones) {
      const col = mix(mix(a.col, [0, 0, 0], mood.dim), hex(mood.haze), mood.hazeNear);
      const tip = shade(col, 0.35);
      ctx.lineCap = 'round';
      for (let i = 0; i < a.n; i++) {
        const ang = -1.15 + (i / (a.n - 1)) * 2.3;
        const sway = Math.sin(time * 1.1 + a.phase + i * 0.35) * 0.22;
        const L = a.len * (0.8 + 0.2 * Math.sin(i * 2.1));
        const ex = a.x + Math.sin(ang + sway) * L;
        const ey = a.y - Math.cos(ang + sway) * L;
        const cx = a.x + Math.sin(ang) * L * 0.5;
        const cy = a.y - Math.cos(ang) * L * 0.55;
        ctx.strokeStyle = rgb(col);
        ctx.lineWidth = 3.4;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(cx, cy, ex, ey);
        ctx.stroke();
        ctx.fillStyle = rgb(tip);
        ctx.beginPath();
        ctx.arc(ex, ey, 2, 0, TAU);
        ctx.fill();
        if (mood.glow) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.25 + 0.15 * Math.sin(time * 2 + i);
          ctx.drawImage(jellyGlow[2], ex - 6, ey - 6, 12, 12);
          ctx.restore();
        }
      }
    }
  }

  function drawJellies() {
    ctx.save();
    for (const j of jellies) {
      const p = (time * 0.55 + j.phase) % 1;
      const squeeze = p < 0.3 ? Math.sin((p / 0.3) * Math.PI) : 0;
      const bw = j.size * (1 - squeeze * 0.18);
      const bh = j.size * 0.7 * (1 + squeeze * 0.12);
      const night = mood.glow;
      if (night) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.35 + 0.2 * Math.sin(time * 1.3 + j.phase);
        ctx.drawImage(j.glow, j.x - bw * 2.2, j.y - bh * 2, bw * 4.4, bh * 4);
      }
      ctx.globalCompositeOperation = night ? 'lighter' : 'source-over';
      ctx.globalAlpha = night ? 0.5 : 0.32;
      const [r, g, b] = j.hue;
      // tentacles
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.6)`;
      ctx.lineWidth = 1;
      for (let k = 0; k < 6; k++) {
        const tx = j.x - bw * 0.7 + (k / 5) * bw * 1.4;
        ctx.beginPath();
        ctx.moveTo(tx, j.y);
        for (let s = 1; s <= 6; s++) {
          ctx.lineTo(tx + Math.sin(time * 1.6 + k + s * 0.8 + j.phase) * 3, j.y + s * j.size * 0.32);
        }
        ctx.stroke();
      }
      // bell
      const grad = ctx.createRadialGradient(j.x, j.y - bh * 0.4, 1, j.x, j.y - bh * 0.2, bw);
      grad.addColorStop(0, `rgba(255, 255, 255, 0.9)`);
      grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.6)`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.15)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(j.x, j.y, bw, bh, 0, Math.PI, TAU);
      for (let s = 0; s <= 6; s++) ctx.lineTo(j.x + bw - (s / 6) * bw * 2, j.y + (s % 2 ? 3 : 0));
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function draw() {
    if (!scene) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(scene.back, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Sunbeams fanning down from the surface, slowly swaying.
    if (mood.rays > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const r of rays) {
        const sway = Math.sin(time * r.speed * TAU + r.phase);
        ctx.globalAlpha = mood.rays * (0.55 + 0.45 * Math.sin(time * r.speed * 3.1 + r.phase * 2));
        ctx.save();
        ctx.translate(r.x + sway * 30, -30);
        ctx.rotate((r.x / W - 0.5) * -0.45 + sway * 0.04);
        ctx.drawImage(ray, -48 * r.w * 1.6, 0, 96 * r.w * 1.6, H * 0.95);
        ctx.restore();
      }
      ctx.restore();
    }
    // Rippling light across the upper water: two drifting layers, faded out with depth.
    // (The light drifts slowly, so its layer is only refreshed every other frame.)
    if (mood.caustics > 0 && cctx && causticTick++ % 2 === 0) {
      const lw = causticLayer.width;
      const lh = causticLayer.height;
      cctx.setTransform(1, 0, 0, 1, 0, 0);
      cctx.globalCompositeOperation = 'copy';
      cctx.globalAlpha = 1;
      cctx.fillStyle = 'rgba(0,0,0,0)';
      cctx.fillRect(0, 0, lw, lh);
      cctx.globalCompositeOperation = 'lighter';
      for (const [sc, vx, vy, k] of [
        [0.55, 7, 3, 1],
        [0.8, -5, 5, 0.75],
      ]) {
        const ox = (time * vx) % (192 * sc);
        const oy = (time * vy) % (192 * sc);
        cctx.setTransform(sc, 0, 0, sc, ox, oy);
        cctx.globalAlpha = k * (0.85 + 0.15 * Math.sin(time * 0.6 + sc * 5));
        cctx.fillStyle = causticPattern;
        cctx.fillRect(-ox / sc, -oy / sc, lw / sc, lh / sc);
      }
      cctx.setTransform(1, 0, 0, 1, 0, 0);
      cctx.globalAlpha = 1;
      cctx.globalCompositeOperation = 'destination-in';
      cctx.fillStyle = causticFade;
      cctx.fillRect(0, 0, lw, lh);
    }
    if (mood.caustics > 0 && cctx) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = mood.caustics;
      ctx.drawImage(causticLayer, 0, 0, W, H * 0.55);
      ctx.restore();
    }

    // Far and middle life, behind the near reef.
    for (const s of schools) if (s.depth < 0.55) for (const f of s.members) drawFish(ctx, f, time);
    for (const f of fish) if (f.depth < 0.6) drawFish(ctx, f, time);
    drawJellies();
    drawWeeds(false);

    // The near reef (only the strip it covers).
    const top = scene.frontTop;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(scene.front, 0, top * dpr, W * dpr, (H - top) * dpr, 0, top * dpr, W * dpr, (H - top) * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawWeeds(true);
    drawAnemones();
    for (const s of schools) if (s.depth >= 0.55) for (const f of s.members) drawFish(ctx, f, time);
    for (const f of fish) if (f.depth >= 0.6) drawFish(ctx, f, time);

    // Specks in the water; at night they glow and twinkle.
    ctx.save();
    if (mood.glow) {
      ctx.globalCompositeOperation = 'lighter';
      for (const p of snow) {
        ctx.globalAlpha = p.a * (0.35 + 0.65 * Math.max(0, Math.sin(time * 1.2 + p.p)));
        const r = p.r * 5;
        ctx.drawImage(plankton, p.x - r, p.y - r, r * 2, r * 2);
      }
    } else {
      ctx.fillStyle = rgb(mood.snow);
      for (const p of snow) {
        ctx.globalAlpha = p.a * mood.snowAlpha;
        ctx.fillRect(p.x, p.y, p.r, p.r);
      }
    }
    ctx.restore();

    ctx.save();
    for (const b of bubbles) {
      ctx.globalAlpha = Math.max(0, b.a) * (mood.glow ? 0.45 : 0.9);
      ctx.drawImage(bubble, b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
    }
    ctx.restore();
  }

  function frame(now) {
    if (!alive) return;
    const raw = last ? (now - last) / 1000 : 1 / 60;
    last = now;
    update(Math.min(0.05, raw));
    draw();
    adapt(raw);
    raf = nextFrame(frame);
  }

  // If frames keep running long, drop the resolution a notch (never back up).
  function adapt(raw) {
    sinceScale += raw;
    if (sinceScale < 2 || raw > 0.25) return;
    slowFrames = raw > 1 / 45 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
    if (slowFrames > 45 && dpr > 0.75) {
      maxScale = 0.75;
      setScale(0.75);
    }
  }

  resize();
  if (reduced) draw();
  else raf = nextFrame(frame);

  return {
    resize(next) {
      view = next;
      resize();
    },
    visible() {
      last = 0;
    },
    setMood(next) {
      if (!MOODS[next] || next === moodName) return;
      moodName = next;
      mood = MOODS[next];
      scene = paintScene(W, H, dpr, mood);
      recolor();
      if (reduced) draw();
    },
    setLightning() {},
    strike() {},
    destroy() {
      alive = false;
      cancelFrame(raf);
    },
  };
}
