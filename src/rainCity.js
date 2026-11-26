/*
 * A city skyline behind the rain: towers across the river, layered into the
 * haze, windows lit, a waterfront road at their feet with a stream of traffic,
 * and the whole lot mirrored in the water. Everything is a little out of
 * focus, as if the eye were on the raindrops, and every light glows rather than
 * sitting there as a flat dot or box.
 *
 * What moves:
 *  - traffic along the waterfront: headlights one way, tail lights the other,
 *    braking in waves, now and then a bus with its windows lit
 *  - the river: the skyline's reflection wavers, the car lights shimmer in it
 *  - windows going on and off, a TV flickering, the tower crowns slowly
 *    changing colour, red beacons blinking on the tallest roofs, a plane
 *    crossing high up now and then, a lamp on the waterfront that's failing
 *
 * Flat, screen-space layout (no 3D), seeded so it holds still across resizes
 * and theme changes. Plain canvas with no page access, so it runs in the rain worker.
 *
 * createCity({ mood })
 *   returns { sky, city, small, k, glints, setMood(m), resize(w, h, dpr) (repaints),
 *             step(dt), draw(ctx, dt), drawSmall(), destroy() }
 *   sky / city: full-size canvases (city is transparent where the sky shows);
 *   small: a quarter-size copy of the whole view, for the beads to refract.
 */

function makeCanvas(w, h) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
const release = (c) => {
  if (c) c.width = c.height = 0;
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mulc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const css = (c, a = 1) => `rgba(${clamp(c[0] | 0, 0, 255)},${clamp(c[1] | 0, 0, 255)},${clamp(c[2] | 0, 0, 255)},${a})`;

function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Stable 0..1 for a window, so lit windows stay lit across repaints.
function hash(a, b, c) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function hsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/* ------------------------------------------------------------------ */
/* Lighting per mood                                                   */
/* ------------------------------------------------------------------ */

const MOODS = {
  // Evening: the city is awake.
  dark: {
    sky: [[6, 8, 18], [14, 16, 34], [44, 30, 56], [104, 58, 62]],
    pollution: [255, 132, 72, 0.26],
    cloud: [130, 96, 110],
    cloudA: 0.22,
    haze: [72, 52, 70],
    walls: [[20, 23, 36], [25, 26, 38], [30, 26, 36], [17, 21, 33], [27, 30, 42], [22, 22, 30]],
    water: [10, 12, 22],
    deck: [16, 16, 22],
    lit: 0.2,
    office: 0.4,
    windowA: 1,
    lamps: 1,
    signs: 1,
    traffic: 1,
    light: 1,
    comp: 'lighter',
    bloom: 1,
    reflect: 0.62,
    vignette: 'rgba(0, 0, 0, 0.45)',
  },
  // Late night: most windows dark, the crowns and beacons doing the work.
  night: {
    sky: [[1, 2, 6], [4, 6, 14], [14, 13, 26], [42, 28, 36]],
    pollution: [255, 120, 60, 0.13],
    cloud: [80, 62, 74],
    cloudA: 0.15,
    haze: [32, 26, 38],
    walls: [[9, 11, 18], [12, 13, 20], [14, 12, 18], [8, 10, 16], [13, 15, 22], [11, 11, 15]],
    water: [4, 5, 10],
    deck: [8, 8, 12],
    lit: 0.08,
    office: 0.2,
    windowA: 0.95,
    lamps: 1,
    signs: 1,
    traffic: 0.45,
    light: 0.95,
    comp: 'lighter',
    bloom: 1,
    reflect: 0.66,
    vignette: 'rgba(0, 0, 0, 0.62)',
  },
  // Overcast afternoon: grey towers fading into the rain, headlights on.
  light: {
    sky: [[126, 138, 154], [150, 160, 174], [176, 184, 195], [194, 200, 208]],
    pollution: null,
    cloud: [214, 219, 226],
    cloudA: 0.24,
    haze: [184, 191, 201],
    walls: [[96, 104, 116], [108, 112, 120], [86, 94, 106], [118, 120, 126], [80, 88, 100], [101, 106, 115]],
    water: [104, 114, 126],
    deck: [70, 74, 82],
    lit: 0.08,
    office: 0.92,
    windowA: 0.45,
    lamps: 0,
    signs: 0.4,
    traffic: 0.9,
    light: 0.7,
    comp: 'source-over',
    bloom: 0.2,
    reflect: 0.5,
    vignette: 'rgba(40, 52, 68, 0.2)',
  },
};

const C = {
  head: [255, 240, 214],
  tail: [255, 34, 22],
  brake: [255, 52, 36],
  lamp: [255, 196, 130],
  sodium: [255, 158, 70],
  beacon: [255, 40, 32],
  strobe: [235, 242, 255],
  navR: [255, 50, 40],
  navG: [70, 255, 150],
  tv: [120, 160, 255],
  bus: [255, 236, 200],
};
const NEON = [
  [255, 70, 160],
  [60, 240, 230],
  [255, 96, 64],
  [150, 110, 255],
  [255, 200, 80],
  [90, 170, 255],
];
const WARM = [
  [255, 208, 140],
  [255, 190, 115],
  [255, 226, 180],
  [255, 172, 96],
  [250, 214, 160],
  [255, 156, 112],
];
const COOL = [
  [214, 230, 255],
  [236, 242, 255],
  [190, 212, 245],
  [226, 236, 228],
];

/* ------------------------------------------------------------------ */
/* Sprites                                                             */
/* ------------------------------------------------------------------ */

// A soft glow: a hot centre fading smoothly into the haze around it.
function glowSprite() {
  const S = 64;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.1, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.32)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.1)');
  grad.addColorStop(0.75, 'rgba(255,255,255,0.03)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return c;
}
// A reflection on the water: a long, soft vertical smear.
function smearSprite() {
  const S = 128;
  const round = makeCanvas(S, S);
  let g = round.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const c = makeCanvas(24, 160);
  g = c.getContext('2d');
  g.drawImage(round, 0, 0, 24, 160);
  release(round);
  return c;
}

function tinter(base) {
  const cache = new Map();
  return (rgb) => {
    const key = rgb.map((v) => v | 0).join(',');
    let s = cache.get(key);
    if (!s) {
      if (cache.size > 64) cache.clear();
      s = makeCanvas(base.width, base.height);
      const g = s.getContext('2d');
      g.drawImage(base, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = css(rgb);
      g.fillRect(0, 0, s.width, s.height);
      cache.set(key, s);
    }
    return s;
  };
}

function supportsFilter() {
  try {
    const g = makeCanvas(2, 2).getContext('2d');
    g.filter = 'blur(1px)';
    return g.filter === 'blur(1px)';
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */

export function createCity(opts) {
  const seed = (Math.random() * 1e9) | 0;
  const glow = tinter(glowSprite());
  const smear = tinter(smearSprite());
  const canBlur = supportsFilter();

  let W = 0;
  let H = 0;
  let dpr = 1;
  let mood = MOODS[opts.mood] ? opts.mood : 'dark';
  let M = MOODS[mood];
  let u = 1; // layout unit: px per "metre-ish", from the screen height

  let sky = null;
  let city = null;
  let small = null;
  let refl = null; // the water's mirror image, drawn rippling every frame
  const k = 0.25;

  // Lines across the screen.
  let shore = 0; // where the buildings stand
  let deckTop = 0;
  let deckBot = 0;
  let waterY = 0;

  // Things drawn every frame, found while painting.
  let dynWindows = [];
  let beacons = [];
  let crowns = [];
  let signs = [];
  let dyingLamp = null;
  let rects = []; // every building's box, for working out what hides what
  let time = 0;

  /* ---------------- helpers ---------------- */

  // A light as a glow: wide haze, a brighter middle, a hot core.
  function light(g, x, y, r, col, a, stretch = 1) {
    if (a <= 0.004) return;
    const hot = mixc(col, [255, 255, 255], 0.55);
    g.globalAlpha = Math.min(1, 0.4 * a);
    g.drawImage(glow(col), x - r * 7 * stretch, y - r * 7, r * 14 * stretch, r * 14);
    g.globalAlpha = Math.min(1, 0.8 * a);
    g.drawImage(glow(col), x - r * 2.6 * stretch, y - r * 2.6, r * 5.2 * stretch, r * 5.2);
    g.globalAlpha = Math.min(1, a);
    g.drawImage(glow(hot), x - r * 1.1 * stretch, y - r * 1.1, r * 2.2 * stretch, r * 2.2);
  }

  // Paint something small once, softened like the rest, to draw every frame cheaply.
  function bake(x0, y0, x1, y1, blur, pad, fn) {
    const x = Math.floor(x0 - pad);
    const y = Math.floor(y0 - pad);
    const w = Math.ceil(x1 - x0 + pad * 2);
    const h = Math.ceil(y1 - y0 + pad * 2);
    const sharp = makeCanvas(w * dpr, h * dpr);
    const g = sharp.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, -x * dpr, -y * dpr);
    fn(g);
    const out = makeCanvas(w * dpr, h * dpr);
    const o = out.getContext('2d');
    if (canBlur && blur > 0) {
      o.filter = `blur(${blur * dpr}px)`;
      o.drawImage(sharp, 0, 0);
    } else o.drawImage(sharp, 0, 0);
    release(sharp);
    return { c: out, x, y, w, h };
  }

  // Hidden behind a nearer building?
  function occluded(x, y, row) {
    for (const r of rects) {
      if (r.row <= row) continue;
      if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return true;
    }
    return y > deckTop - 1;
  }

  /* ---------------- painting ---------------- */

  function paintSky() {
    const c = makeCanvas(W * dpr, H * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    let grad = g.createLinearGradient(0, 0, 0, shore);
    grad.addColorStop(0, css(M.sky[0]));
    grad.addColorStop(0.45, css(M.sky[1]));
    grad.addColorStop(0.82, css(M.sky[2]));
    grad.addColorStop(1, css(M.sky[3]));
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    // Low cloud, lit from underneath by the city.
    const r = rng32(seed ^ 0x51a9);
    const n = Math.round(26 + (W * H) / 60000);
    for (let i = 0; i < n; i++) {
      const y = shore * Math.pow(r(), 0.7);
      const x = r() * W;
      const rx = W * (0.12 + r() * 0.3);
      const ry = rx * (0.1 + r() * 0.12);
      const lit = Math.pow(y / shore, 1.6);
      g.save();
      g.translate(x, y);
      g.scale(1, ry / rx);
      grad = g.createRadialGradient(0, 0, 0, 0, 0, rx);
      const a = M.cloudA * (0.25 + 0.75 * lit) * (0.4 + r() * 0.6);
      grad.addColorStop(0, css(M.cloud, a));
      grad.addColorStop(1, css(M.cloud, 0));
      g.fillStyle = grad;
      g.fillRect(-rx, -rx, rx * 2, rx * 2);
      g.restore();
    }
    for (let i = 0; i < n * 0.5; i++) {
      const y = shore * r() * 0.75;
      const x = r() * W;
      const rx = W * (0.1 + r() * 0.25);
      g.save();
      g.translate(x, y);
      g.scale(1, 0.12 + r() * 0.1);
      grad = g.createRadialGradient(0, 0, 0, 0, 0, rx);
      grad.addColorStop(0, css(mulc(M.sky[0], 0.8), 0.35));
      grad.addColorStop(1, css(M.sky[0], 0));
      g.fillStyle = grad;
      g.fillRect(-rx, -rx, rx * 2, rx * 2);
      g.restore();
    }
    // The glow of the city on the cloud base.
    if (M.pollution) {
      const [pr, pg, pb, pa] = M.pollution;
      g.save();
      g.translate(W * 0.5, shore);
      g.scale(1, 0.4);
      const R = Math.max(W, H) * 0.95;
      grad = g.createRadialGradient(0, 0, 0, 0, 0, R);
      grad.addColorStop(0, `rgba(${pr},${pg},${pb},${pa})`);
      grad.addColorStop(0.4, `rgba(${pr},${pg},${pb},${pa * 0.4})`);
      grad.addColorStop(1, `rgba(${pr},${pg},${pb},0)`);
      g.fillStyle = grad;
      g.fillRect(-R, -R, R * 2, R * 2);
      g.restore();
    }
    return c;
  }

  // Rows of towers from far to near. Depth is scale and haze.
  const ROWS = [
    { s: 0.42, haze: 0.74, lift: 9, hMin: 30, hMax: 120, tall: 0.12, wMin: 14, wMax: 40 },
    { s: 0.58, haze: 0.54, lift: 6, hMin: 26, hMax: 120, tall: 0.12, wMin: 18, wMax: 48 },
    { s: 0.76, haze: 0.34, lift: 3, hMin: 22, hMax: 95, tall: 0.07, wMin: 22, wMax: 56 },
    { s: 1, haze: 0.14, lift: 0, hMin: 16, hMax: 62, tall: 0.03, wMin: 26, wMax: 70 },
  ];

  function paintBuildings(g, L, lk) {
    const r = rng32(seed);
    // Downtown: the tall towers bunch up somewhere off-centre.
    const downtown = W * (0.36 + r() * 0.28);
    const spread = Math.max(W * 0.2, 260 * u);
    rects = [];

    ROWS.forEach((row, ri) => {
      const s = row.s * u;
      const base = shore - row.lift * u;
      let x = -30 * u + r() * 20 * u;
      const top = H * 0.06;
      while (x < W + 30 * u) {
        const w = (row.wMin + r() * (row.wMax - row.wMin)) * s;
        const near = Math.exp(-(((x + w / 2 - downtown) / spread) ** 2));
        let h = (row.hMin + r() * (row.hMax - row.hMin)) * s;
        if (ri < 3) h *= 1 + near * (0.6 + r() * 2.6) * (ri === 0 ? 1.1 : ri === 1 ? 1 : 0.55);
        if (r() < row.tall) h *= 1.8 + r();
        h = Math.min(h, (base - top) * (ri === 0 ? 1 : 0.8), H * 0.5);
        const b = {
          row: ri,
          x0: x,
          x1: x + w,
          base,
          h,
          seed: (r() * 1e9) | 0,
          wall: Math.floor(r() * 6),
          tone: 0.85 + r() * 0.3,
          office: r() < 0.45 || h > 150 * s,
          floor: (3.3 + r() * 0.6) * s,
          bay: (2.8 + r() * 1.6) * s,
          winW: 0.4 + r() * 0.35,
          tiers: h > 120 * s && r() < 0.7 ? 1 + Math.floor(r() * 2.2) : 0,
          spire: h > 160 * s && r() < 0.4,
          mast: h > 100 * s && r() < 0.3,
          crown: h > 130 * s && r() < 0.55,
          sign: ri === 3 && r() < 0.14,
          tank: ri >= 2 && h < 60 * s && r() < 0.3,
          s,
        };
        paintTower(g, L, lk, b, row);
        x += w + (r() < 0.35 ? r() * 9 * s : -r() * 3 * s);
      }
      // Haze settling between the rows, thickest at their feet.
      if (ri < ROWS.length - 1) {
        const hz = g.createLinearGradient(0, base - 140 * u * row.s, 0, base);
        hz.addColorStop(0, css(M.haze, 0));
        hz.addColorStop(1, css(M.haze, 0.24 - ri * 0.05));
        g.fillStyle = hz;
        g.fillRect(0, base - 140 * u * row.s, W, 140 * u * row.s + 2);
      }
    });
  }

  function paintTower(g, L, lk, b, row) {
    const { s } = b;
    const wallC = mixc(mulc(M.walls[b.wall], b.tone), M.haze, row.haze);
    const w = b.x1 - b.x0;
    // Tiers: each one narrower, stacked.
    const parts = [];
    let y = b.base;
    let x0 = b.x0;
    let x1 = b.x1;
    const tierH = b.tiers ? b.h * 0.55 : b.h;
    parts.push({ x0, x1, y0: b.base - tierH, y1: b.base });
    y = b.base - tierH;
    let left = b.h - tierH;
    for (let t = 0; t < b.tiers; t++) {
      const inset = w * (0.1 + hash(b.seed, t, 1) * 0.12);
      x0 += inset;
      x1 -= inset;
      const hh = t === b.tiers - 1 ? left : left * 0.55;
      parts.push({ x0, x1, y0: y - hh, y1: y });
      y -= hh;
      left -= hh;
    }
    const topY = parts[parts.length - 1].y0;
    const cx = (parts[parts.length - 1].x0 + parts[parts.length - 1].x1) / 2;
    const pw = parts[parts.length - 1].x1 - parts[parts.length - 1].x0;

    for (const p of parts) {
      rects.push({ row: b.row, x0: p.x0, x1: p.x1, y0: p.y0, y1: p.y1 });
      // Facade: lit a little warmer from the streets below, a cool edge on one side.
      const grad = g.createLinearGradient(0, p.y0, 0, p.y1);
      grad.addColorStop(0, css(mixc(wallC, M.sky[2], 0.12)));
      grad.addColorStop(0.7, css(wallC));
      grad.addColorStop(1, css(mixc(wallC, M.lamps ? [120, 70, 50] : wallC, 0.25)));
      g.fillStyle = grad;
      g.fillRect(p.x0, p.y0, p.x1 - p.x0, p.y1 - p.y0);
      g.fillStyle = css(mixc(wallC, M.sky[3], 0.3), 0.6);
      g.fillRect(p.x1 - Math.max(0.8, (p.x1 - p.x0) * 0.06), p.y0, Math.max(0.8, (p.x1 - p.x0) * 0.06), p.y1 - p.y0);
      g.fillStyle = css(mulc(wallC, 0.75), 0.6);
      g.fillRect(p.x0, p.y0, Math.max(0.6, (p.x1 - p.x0) * 0.04), p.y1 - p.y0);
      windows(g, L, lk, b, row, p);
    }

    // Roof things.
    if (b.spire) {
      const sh = b.h * (0.18 + hash(b.seed, 9, 9) * 0.14);
      g.fillStyle = css(mulc(wallC, 0.95));
      g.beginPath();
      g.moveTo(cx - pw * 0.16, topY);
      g.lineTo(cx, topY - sh);
      g.lineTo(cx + pw * 0.16, topY);
      g.closePath();
      g.fill();
      beacons.push({ x: cx, y: topY - sh, row: b.row, s, phase: hash(b.seed, 1, 2) });
    } else if (b.mast) {
      const mh = 14 * s + hash(b.seed, 3, 3) * 18 * s;
      g.strokeStyle = css(mulc(wallC, 0.95));
      g.lineWidth = Math.max(0.7, 0.8 * s);
      g.beginPath();
      g.moveTo(cx + pw * 0.2, topY);
      g.lineTo(cx + pw * 0.2, topY - mh);
      g.stroke();
      beacons.push({ x: cx + pw * 0.2, y: topY - mh, row: b.row, s, phase: hash(b.seed, 7, 7) });
    } else if (b.h > 110 * s) {
      beacons.push({ x: parts[parts.length - 1].x0 + 1.5 * s, y: topY - 0.5 * s, row: b.row, s, phase: hash(b.seed, 5, 5) });
      beacons.push({ x: parts[parts.length - 1].x1 - 1.5 * s, y: topY - 0.5 * s, row: b.row, s, phase: hash(b.seed, 5, 5) });
    }
    if (b.tank) {
      const tw = Math.min(pw * 0.3, 7 * s);
      const tx = b.x0 + pw * (0.2 + hash(b.seed, 4, 4) * 0.5);
      g.fillStyle = css(mulc(wallC, 0.85));
      g.fillRect(tx, topY - tw * 1.4, tw, tw);
      g.beginPath();
      g.moveTo(tx - tw * 0.08, topY - tw * 1.4);
      g.lineTo(tx + tw / 2, topY - tw * 1.75);
      g.lineTo(tx + tw * 1.08, topY - tw * 1.4);
      g.fill();
      g.fillRect(tx + tw * 0.1, topY - tw * 0.4, tw * 0.1, tw * 0.4);
      g.fillRect(tx + tw * 0.8, topY - tw * 0.4, tw * 0.1, tw * 0.4);
    }
    // A lit crown, drawn live so it can drift through colours.
    if (b.crown && M !== MOODS.light) {
      const last = parts[parts.length - 1];
      crowns.push({ x0: last.x0, x1: last.x1, y: topY + 3 * s, h: 2.4 * s, row: b.row, hue: hash(b.seed, 8, 1) * 360, white: hash(b.seed, 8, 2) < 0.45, phase: hash(b.seed, 8, 3) });
    }
    // A rooftop sign facing the river.
    if (b.sign && M.signs && pw > 30 * s) {
      const sw = pw * 0.7;
      const sh = 5 * s;
      const sx = cx - sw / 2;
      const sy = topY - sh - 1.5 * s;
      g.strokeStyle = css(mulc(wallC, 0.8));
      g.lineWidth = Math.max(0.6, 0.5 * s);
      g.beginPath();
      for (let i = 0; i <= 3; i++) {
        g.moveTo(sx + (sw * i) / 3, sy + sh);
        g.lineTo(sx + (sw * i) / 3, topY);
      }
      g.stroke();
      signs.push({ x0: sx, y0: sy, x1: sx + sw, y1: sy + sh, row: b.row, c: NEON[b.seed % NEON.length], mode: hash(b.seed, 6, 6) < 0.3 ? 'blink' : hash(b.seed, 6, 7) < 0.25 ? 'flicker' : 'steady', phase: hash(b.seed, 6, 8) });
    }
  }

  function windows(g, L, lk, b, row, p) {
    const { s } = b;
    const pw = p.x1 - p.x0;
    const cols = Math.max(1, Math.floor((pw - 1.5 * s) / b.bay));
    const off = (pw - cols * b.bay) / 2;
    const floors = Math.floor((p.y1 - p.y0 - 2 * s) / b.floor);
    const gw = b.bay * b.winW;
    const gh = b.floor * 0.55;
    const wa = M.windowA * (1 - row.haze * 0.6);
    const glass = mixc(mixc(M.walls[b.wall], [40, 60, 90], 0.25), M.haze, row.haze * 0.9);
    const big = gw > 1.6;
    for (let f = 0; f < floors; f++) {
      const wy = p.y1 - (f + 1) * b.floor;
      const floorBias = b.office ? hash(b.seed, f, 777) : 0.5;
      const pLit = (b.office ? M.lit * (floorBias < 0.5 ? 0.2 : 1.7) : M.lit) * (1 - row.haze * 0.45);
      for (let j = 0; j < cols; j++) {
        const wx = p.x0 + off + j * b.bay + (b.bay - gw) / 2;
        if (wx > W + 4 || wx + gw < -4) continue;
        const hv = hash(b.seed, f * 131 + ((p.y0 * 7) | 0), j);
        const lit = hv < pLit;
        const office = b.office ? hash(b.seed, f, 4242) < 0.85 : hash(b.seed, f, j + 9) < M.office * 0.6;
        const pal = office ? COOL : WARM;
        const col = pal[((hash(b.seed, j, f) * 997) | 0) % pal.length];
        const dyn = big && dynWindows.length < 50 && row.s > 0.7 && hash(b.seed, f + 3, j + 17) < 0.03 && M.windowA > 0.6;
        if (lit && !dyn) {
          const dim = 0.5 + 0.45 * hash(b.seed, f, j + 3);
          const c2 = mixc(mulc(col, dim), M.haze, row.haze * 0.45);
          g.fillStyle = css(c2, wa);
          g.fillRect(wx, wy, Math.max(0.8, gw), Math.max(0.8, gh));
          L.fillStyle = css(col, wa * dim);
          L.fillRect(wx * lk, wy * lk, Math.max(0.5, gw * lk), Math.max(0.5, gh * lk));
        } else if (big) {
          g.fillStyle = css(glass, 0.7);
          g.fillRect(wx, wy, gw, gh);
          if (dyn) {
            const tv = hash(b.seed, j, f + 1) < 0.2;
            dynWindows.push({ x: wx + gw / 2, y: wy + gh / 2, x0: wx, y0: wy, w: gw, h: gh, row: b.row, c: tv ? C.tv : col, tv, on: lit || hash(b.seed, f, j + 1) < 0.5 ? 1 : 0, level: lit ? 1 : 0, next: 2 + Math.random() * 20 });
          }
        }
      }
    }
  }

  // The waterfront road, its embankment and the river's surface.
  function paintShore(g, L, lk) {
    // Embankment wall below the road.
    let grad = g.createLinearGradient(0, deckBot, 0, waterY);
    grad.addColorStop(0, css(mulc(M.deck, 0.9)));
    grad.addColorStop(1, css(mulc(M.deck, 0.6)));
    g.fillStyle = grad;
    g.fillRect(0, deckTop, W, waterY - deckTop);
    // The road deck: dark, a wet sheen on top.
    grad = g.createLinearGradient(0, deckTop, 0, deckBot);
    grad.addColorStop(0, css(mixc(M.deck, M.sky[3], 0.25)));
    grad.addColorStop(0.25, css(M.deck));
    grad.addColorStop(1, css(mulc(M.deck, 0.8)));
    g.fillStyle = grad;
    g.fillRect(0, deckTop, W, deckBot - deckTop);
    // Railing.
    g.fillStyle = css(mixc(M.deck, M.sky[3], 0.35), 0.8);
    g.fillRect(0, deckTop - 2.4 * u, W, Math.max(0.8, 0.7 * u));
    for (let x = (seed % 7) * u; x < W; x += 8 * u) g.fillRect(x, deckTop - 2.4 * u, Math.max(0.6, 0.5 * u), 2.4 * u);
    // Lamp posts.
    g.fillStyle = css(mixc(M.deck, M.sky[3], 0.2));
    const lamps = [];
    for (let x = ((seed >> 3) % 60) * u; x < W + 40 * u; x += 96 * u) {
      g.fillRect(x - 0.5 * u, deckTop - 26 * u, Math.max(0.8, 1 * u), 26 * u);
      g.fillRect(x - 0.5 * u, deckTop - 26 * u, 5 * u, Math.max(0.8, 0.9 * u));
      lamps.push({ x: x + 4.2 * u, y: deckTop - 24.8 * u });
    }
    // Water: picks up the sky toward the far bank.
    grad = g.createLinearGradient(0, waterY, 0, H);
    grad.addColorStop(0, css(mixc(M.water, M.sky[3], 0.35)));
    grad.addColorStop(0.3, css(M.water));
    grad.addColorStop(1, css(mulc(M.water, 0.8)));
    g.fillStyle = grad;
    g.fillRect(0, waterY, W, H - waterY);
    return lamps;
  }

  // Lights that don't move, drawn sharp after the blur so they glow cleanly.
  function paintLamps(g, lamps) {
    if (!M.lamps) return;
    g.save();
    g.globalCompositeOperation = M.comp;
    const pick = Math.floor(hash(seed, 2, 2) * lamps.length);
    lamps.forEach((l, i) => {
      if (i === pick) {
        dyingLamp = l;
        return;
      }
      lamp(g, l, 1);
    });
    g.restore();
  }
  function lamp(g, l, level) {
    const col = hash(l.x | 0, 1, 1) < 0.3 ? C.sodium : C.lamp;
    // Light pooled on the road under it.
    g.globalAlpha = 0.25 * level * M.light;
    g.drawImage(glow(col), l.x - 24 * u, deckTop - 4 * u, 48 * u, 10 * u);
    light(g, l.x, l.y, 2.4 * u, col, 0.85 * level * M.light);
    g.globalAlpha = 1;
  }

  function paint() {
    u = Math.max(0.55, H / 900);
    shore = Math.round(H * (W >= H ? 0.7 : 0.66));
    deckTop = shore + 1 * u;
    deckBot = deckTop + 10 * u;
    waterY = deckBot + 6 * u;

    release(sky);
    release(city);
    release(small);
    release(refl);
    dynWindows = [];
    beacons = [];
    crowns = [];
    signs = [];
    dyingLamp = null;
    sky = paintSky();

    // Sharp scene, blurred into `city`.
    const pre = makeCanvas(W * dpr, H * dpr);
    const pg = pre.getContext('2d');
    pg.scale(dpr, dpr);
    const lk = 0.25;
    const litC = makeCanvas(W * lk, H * lk);
    const lg = litC.getContext('2d');
    paintBuildings(pg, lg, lk);
    const lamps = paintShore(pg, lg, lk);
    // Haze over the far bank.
    const hz = pg.createLinearGradient(0, shore - H * 0.3, 0, shore + 2 * u);
    hz.addColorStop(0, css(M.haze, 0));
    hz.addColorStop(0.8, css(M.haze, 0.1));
    hz.addColorStop(1, css(M.haze, 0.2));
    pg.fillStyle = hz;
    pg.fillRect(0, shore - H * 0.3, W, H * 0.3 + 2 * u);

    city = makeCanvas(W * dpr, H * dpr);
    const g = city.getContext('2d');
    const blurPx = Math.max(0.6, 0.7 * u) * dpr;
    if (canBlur) {
      g.filter = `blur(${blurPx}px)`;
      g.drawImage(pre, 0, 0);
      g.filter = 'none';
    } else {
      const sm = makeCanvas((W * dpr) / 2, (H * dpr) / 2);
      sm.getContext('2d').drawImage(pre, 0, 0, sm.width, sm.height);
      g.drawImage(sm, 0, 0, city.width, city.height);
      release(sm);
    }
    release(pre);

    // Glow: the lit windows bleed light into the wet air.
    g.save();
    g.globalCompositeOperation = M.comp === 'lighter' ? 'lighter' : 'screen';
    if (canBlur) {
      g.globalAlpha = M.bloom * 0.65;
      g.filter = `blur(${Math.max(2, 2.5 * u) * dpr}px)`;
      g.drawImage(litC, 0, 0, city.width, city.height);
      g.globalAlpha = M.bloom * 0.45;
      g.filter = `blur(${Math.max(6, 9 * u) * dpr}px)`;
      g.drawImage(litC, 0, 0, city.width, city.height);
      g.globalAlpha = M.bloom * 0.25;
      g.filter = `blur(${Math.max(16, 26 * u) * dpr}px)`;
      g.drawImage(litC, 0, 0, city.width, city.height);
      g.filter = 'none';
    } else {
      g.globalAlpha = M.bloom * 0.7;
      const tiny = makeCanvas(litC.width / 4, litC.height / 4);
      tiny.getContext('2d').drawImage(litC, 0, 0, tiny.width, tiny.height);
      g.drawImage(tiny, 0, 0, city.width, city.height);
      release(tiny);
    }
    g.restore();
    release(litC);

    g.save();
    g.scale(dpr, dpr);
    paintLamps(g, lamps);
    g.restore();

    // Only what can be seen gets drawn live.
    beacons = beacons.filter((b) => !occluded(b.x, b.y, b.row));
    crowns = crowns.filter((c) => !occluded((c.x0 + c.x1) / 2, c.y, c.row));
    signs = signs.filter((s) => !occluded((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, s.row));
    dynWindows = dynWindows.filter((w) => !occluded(w.x, w.y, w.row));
    for (const w of dynWindows) {
      w.sprite = bake(w.x0, w.y0, w.x0 + w.w, w.y0 + w.h, 0.8 * u, 6 * u + 4, (sg) => {
        sg.fillStyle = css(w.c, 0.18);
        sg.fillRect(w.x0 - w.w * 0.6, w.y0 - w.h * 0.6, w.w * 2.2, w.h * 2.2);
        sg.fillStyle = css(w.c);
        sg.fillRect(w.x0, w.y0, w.w, w.h);
      });
    }

    // The river's mirror image of everything above it.
    const above = makeCanvas(W * dpr, waterY * dpr);
    const ag = above.getContext('2d');
    ag.drawImage(sky, 0, 0);
    ag.drawImage(city, 0, 0);
    const rh = H - waterY;
    refl = makeCanvas(W * dpr, rh * dpr);
    const rg = refl.getContext('2d');
    rg.setTransform(1, 0, 0, -1, 0, waterY * dpr);
    if (canBlur) rg.filter = `blur(${1.4 * u * dpr}px)`;
    rg.drawImage(above, 0, 0);
    // Streak it downward a little, the way rain-roughened water does.
    rg.globalCompositeOperation = 'lighter';
    for (let i = 1; i <= 3; i++) {
      rg.globalAlpha = 0.1 / i;
      rg.drawImage(above, 0, -i * 3 * u * dpr);
    }
    rg.filter = 'none';
    rg.globalAlpha = 1;
    rg.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Darker and less clear toward you.
    rg.globalCompositeOperation = 'source-over';
    const wg = rg.createLinearGradient(0, 0, 0, rh);
    wg.addColorStop(0, css(M.water, 1 - M.reflect));
    wg.addColorStop(1, css(M.water, 1 - M.reflect * 0.35));
    rg.fillStyle = wg;
    rg.fillRect(0, 0, W, rh);
    release(above);

    // Vignette, on top of everything that doesn't move.
    g.save();
    g.scale(dpr, dpr);
    const grad = g.createRadialGradient(W / 2, H * 0.46, Math.min(W, H) * 0.35, W / 2, H * 0.46, Math.hypot(W, H) * 0.62);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, M.vignette);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    g.restore();

    small = makeCanvas(W * k, H * k);
    const sg = small.getContext('2d');
    sg.drawImage(sky, 0, 0, small.width, small.height);
    sg.drawImage(city, 0, 0, small.width, small.height);
    sg.drawImage(refl, 0, waterY * k, small.width, rh * k);

    if (!cars.length) for (let i = 0; i < 400; i++) stepTraffic(0.1);
  }

  /* ------------------------------------------------------------------ */
  /* Traffic along the waterfront: flat, left and right                  */
  /* ------------------------------------------------------------------ */

  // Two lanes: the far one runs left, the near one right. Speeds in units per second.
  const LANES_2D = [
    { dir: -1, y: 3.2, mean: 2.2, v: 34 },
    { dir: 1, y: 7, mean: 1.9, v: 40 },
  ];
  let cars = [];
  const timers = [0.5, 0.2];

  function newCar(li) {
    const lane = LANES_2D[li];
    const bus = Math.random() < 0.06;
    const len = bus ? 26 : Math.random() < 0.15 ? 13 : 9;
    return {
      lane: li,
      bus,
      len,
      p: lane.dir > 0 ? -20 : W / u + 20, // position of its front, in units
      v: lane.v * (0.85 + Math.random() * 0.3),
      v0: lane.v * (bus ? 0.8 : 0.85 + Math.random() * 0.35),
      brake: 0,
      slow: 0,
      led: Math.random() < 0.45,
    };
  }

  function stepTraffic(dt) {
    const Wu = W / u;
    if (!Wu) return;
    for (let li = 0; li < 2; li++) {
      const lane = LANES_2D[li];
      const d = lane.dir;
      const list = cars.filter((c) => c.lane === li).sort((a, b) => d * (b.p - a.p));
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const lead = list[i - 1];
        // Now and then someone brakes for no reason, and a wave runs back.
        if (c.slow > 0) c.slow -= dt;
        else if (Math.random() < dt * 0.012) c.slow = 1 + Math.random() * 2;
        let target = c.slow > 0 ? c.v0 * 0.35 : c.v0;
        if (lead) {
          const gap = d * (lead.p - c.p) - lead.len;
          const want = 6 + c.v * 0.8;
          if (gap < want) target = Math.min(target, lead.v * Math.max(0, gap / want));
        }
        const acc = target < c.v ? -14 : 5;
        const prev = c.v;
        c.v = Math.max(0, acc < 0 ? Math.max(target, c.v + acc * dt) : Math.min(target, c.v + acc * dt));
        c.brake += ((c.v < prev - 0.05 || c.v < 2 ? 1 : 0) - c.brake) * Math.min(1, dt * 8);
        c.p += d * c.v * dt;
      }
      timers[li] -= dt * M.traffic;
      if (timers[li] <= 0) {
        const last = list[list.length - 1];
        const start = d > 0 ? -20 : Wu + 20;
        if (!last || d * (last.p - start) - last.len > 8) {
          const c = newCar(li);
          if (last) c.v = Math.min(c.v, last.v);
          cars.push(c);
          timers[li] = lane.mean * (0.3 + -Math.log(1 - Math.random() * 0.95) * 0.8);
        } else timers[li] = 0.3;
      }
    }
    cars = cars.filter((c) => (LANES_2D[c.lane].dir > 0 ? c.p - c.len < Wu + 30 : c.p + c.len > -30));
  }

  function drawTraffic(g) {
    g.globalCompositeOperation = M.comp;
    const A = M.light;
    for (const c of cars) {
      const lane = LANES_2D[c.lane];
      const d = lane.dir;
      const y = deckTop + lane.y * u;
      const xf = c.p * u;
      const xr = (c.p - d * c.len) * u;
      if (Math.max(xf, xr) < -40 || Math.min(xf, xr) > W + 40) continue;
      const near = c.lane === 1 ? 1 : 0.82;
      // Bus: a row of lit windows.
      if (c.bus) {
        const x0 = Math.min(xf, xr) + 2 * u;
        const bw = Math.abs(xf - xr) - 4 * u;
        g.globalAlpha = 0.45 * A;
        g.drawImage(glow(C.bus), x0 - 4 * u, y - 6 * u, bw + 8 * u, 7 * u);
        g.globalAlpha = 0.85 * A;
        g.drawImage(glow(mixc(C.bus, [255, 255, 255], 0.4)), x0, y - 4.2 * u, bw, 2.6 * u);
      }
      // Headlights: a hot glow with the beam thrown ahead.
      const head = c.led ? [228, 238, 255] : C.head;
      g.globalAlpha = 0.2 * A * near;
      g.drawImage(glow(head), xf + (d > 0 ? -4 : -30) * u, y - 3.5 * u, 34 * u, 7 * u);
      light(g, xf, y, 2.9 * u * near, head, A);
      // Tail lights, brighter when braking.
      const tI = (0.55 + 0.45 * c.brake) * A;
      light(g, xr, y - 0.4 * u, (2.1 + c.brake * 0.7) * u * near, c.brake > 0.5 ? C.brake : C.tail, tI);
      // In the river below.
      const shimmer = 0.7 + 0.3 * Math.sin(time * 7 + c.p * 0.3);
      const len = 46 * u;
      g.globalAlpha = 0.5 * A * shimmer * near;
      g.drawImage(smear(head), xf - 3 * u, waterY + 1 * u, 6 * u, len);
      g.globalAlpha = 0.45 * tI * shimmer * near;
      g.drawImage(smear(C.tail), xr - 2.5 * u, waterY + 1 * u, 5 * u, len * 0.8);
    }
    g.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------ */
  /* Everything else that moves                                          */
  /* ------------------------------------------------------------------ */

  // The river: the reflection drawn in thin bands, each nudged sideways by the swell.
  function drawWater(g) {
    if (!refl) return;
    const rh = H - waterY;
    const band = Math.max(2, Math.round(2.6 * u));
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    for (let y = 0; y < rh; y += band) {
      const t = y / rh;
      const amp = (0.5 + t * t * 5) * u;
      const dx = Math.sin(time * 1.1 + y * 0.13) * amp + Math.sin(time * 0.63 - y * 0.041) * amp * 0.7;
      const h = Math.min(band, rh - y);
      g.drawImage(refl, 0, y * dpr, refl.width, h * dpr, dx - 8, waterY + y, W + 16, h + 0.5);
    }
  }

  function drawWindows(g, dt) {
    g.globalCompositeOperation = M.comp === 'lighter' ? 'lighter' : 'source-over';
    for (const w of dynWindows) {
      w.next -= dt;
      if (w.next <= 0) {
        w.on = w.on ? 0 : 1;
        w.next = w.on ? 8 + Math.random() * 40 : 4 + Math.random() * 25;
      }
      w.level += (w.on - w.level) * Math.min(1, dt * (w.on ? 6 : 3));
      let lv = w.level;
      if (lv < 0.01) continue;
      if (w.tv && w.on) {
        if (Math.random() < dt * 1.6) w.tvLevel = 0.35 + Math.random() * 0.6;
        w.tvShown = lerp(w.tvShown ?? 0.6, w.tvLevel ?? 0.6, Math.min(1, dt * 14));
        lv *= w.tvShown;
      }
      const sp = w.sprite;
      g.globalAlpha = lv * M.windowA * 0.9;
      g.drawImage(sp.c, sp.x, sp.y, sp.w, sp.h);
    }
    g.globalAlpha = 1;
  }

  function drawBeacons(g) {
    g.globalCompositeOperation = M.comp;
    for (const b of beacons) {
      const t = (time * 0.5 + b.phase * 0.15) % 1;
      const on = t < 0.45 ? Math.sin((t / 0.45) * Math.PI) : 0;
      if (on <= 0.02) continue;
      light(g, b.x, b.y, Math.max(1.2, 1.6 * b.s), C.beacon, on * 0.95);
    }
    g.globalAlpha = 1;
  }

  function drawCrowns(g) {
    g.globalCompositeOperation = M.comp;
    for (const c of crowns) {
      const col = c.white ? [232, 238, 255] : hsl((c.hue + time * 6) % 360, 0.85, 0.62);
      const w = c.x1 - c.x0;
      const lv = (0.75 + 0.25 * Math.sin(time * 0.8 + c.phase * 6)) * M.light;
      g.globalAlpha = 0.35 * lv;
      g.drawImage(glow(col), c.x0 - w * 0.3, c.y - c.h * 5, w * 1.6, c.h * 10);
      g.globalAlpha = 0.9 * lv;
      g.drawImage(glow(mixc(col, [255, 255, 255], 0.35)), c.x0 - w * 0.05, c.y - c.h, w * 1.1, c.h * 2);
    }
    g.globalAlpha = 1;
  }

  function signLevel(s) {
    const t = time + s.phase * 10;
    if (s.mode === 'blink') return Math.sin(t * 1.8) > -0.3 ? 1 : 0.06;
    if (s.mode === 'flicker') {
      const cycle = (t * 0.22) % 1;
      if (cycle < 0.1) return Math.random() < 0.45 ? 0.15 : 1;
      return 0.94 + 0.06 * Math.sin(t * 50);
    }
    return 0.92 + 0.08 * Math.sin(t * 3);
  }

  function drawSigns(g) {
    g.globalCompositeOperation = M.comp;
    for (const s of signs) {
      const lv = signLevel(s) * M.signs * M.light;
      const w = s.x1 - s.x0;
      const h = s.y1 - s.y0;
      const cx = (s.x0 + s.x1) / 2;
      const cy = (s.y0 + s.y1) / 2;
      g.globalAlpha = 0.3 * lv;
      g.drawImage(glow(s.c), cx - w * 0.9, cy - h * 3, w * 1.8, h * 6);
      // Letters: a row of soft glowing blocks.
      const n = Math.max(3, Math.round(w / (h * 0.9)));
      const lc = mixc(s.c, [255, 255, 255], 0.4);
      g.globalAlpha = 0.95 * lv;
      for (let i = 0; i < n; i++) {
        const lx = s.x0 + (w * (i + 0.5)) / n;
        g.drawImage(glow(lc), lx - (w / n) * 0.55, cy - h * 0.7, (w / n) * 1.1, h * 1.4);
      }
    }
    g.globalAlpha = 1;
  }

  // A plane, high up, crossing slowly: red and green at the wingtips, white strobes.
  let plane = null;
  let untilPlane = 6 + Math.random() * 20;
  function stepPlane(dt) {
    if (plane) {
      plane.x += plane.v * dt;
      plane.t += dt;
      if (plane.x < -60 || plane.x > W + 60) plane = null;
    } else if ((untilPlane -= dt) <= 0) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      plane = { x: dir > 0 ? -40 : W + 40, y: H * (0.08 + Math.random() * 0.18), v: dir * (14 + Math.random() * 10) * u, t: 0, dy: (Math.random() - 0.5) * 3 * u };
      untilPlane = 35 + Math.random() * 60;
    }
  }
  function drawPlane(g) {
    if (!plane) return;
    g.globalCompositeOperation = M.comp;
    const { x, t } = plane;
    const y = plane.y + plane.dy * t * 0.05;
    const span = 3.2 * u;
    const A = M === MOODS.light ? 0.55 : 0.9;
    light(g, x - span, y, 0.7 * u, plane.v > 0 ? C.navR : C.navG, 0.75 * A);
    light(g, x + span, y, 0.7 * u, plane.v > 0 ? C.navG : C.navR, 0.75 * A);
    const s = t % 1.3;
    if (s < 0.06 || (s > 0.16 && s < 0.22)) light(g, x, y, 1.3 * u, C.strobe, A);
    if ((t + 0.4) % 1.1 < 0.5) light(g, x, y + 0.6 * u, 0.6 * u, C.beacon, 0.7 * A);
    g.globalAlpha = 1;
  }

  return {
    get sky() {
      return sky;
    },
    get city() {
      return city;
    },
    get small() {
      return small;
    },
    // No street lamps to catch the rain in this view.
    glints: [],
    k,
    resize(w, h, d) {
      const scaleX = W ? w / W : 1;
      W = w;
      H = h;
      dpr = d;
      for (const c of cars) c.p *= scaleX;
      paint();
    },
    // Takes effect at the next resize(), which repaints.
    setMood(m) {
      if (!MOODS[m]) return;
      mood = m;
      M = MOODS[m];
    },
    step(dt) {
      time += dt;
      stepTraffic(dt);
      stepPlane(dt);
    },
    draw(g, dt) {
      g.save();
      drawWater(g);
      drawWindows(g, dt);
      drawCrowns(g);
      drawSigns(g);
      drawBeacons(g);
      drawPlane(g);
      if (dyingLamp && M.lamps) {
        const t = time % 13;
        const lv = t < 0.9 ? (Math.random() < 0.5 ? 0.1 : 0.9) : t < 2.4 ? 0.05 : t < 2.8 ? Math.random() : 1;
        g.globalCompositeOperation = M.comp;
        lamp(g, dyingLamp, lv);
      }
      drawTraffic(g);
      g.restore();
    },
    drawSmall() {},
    destroy() {
      release(sky);
      release(city);
      release(small);
      release(refl);
    },
  };
}
