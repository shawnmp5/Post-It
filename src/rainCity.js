/*
 * City lights behind the rain: looking down a wet avenue from a window a few
 * floors up. Everything beyond the glass is out of focus, the way a camera
 * focused on the raindrops would see it: buildings go soft, every light turns
 * into a disc of bokeh, and the wet road smears each one into a long
 * reflection.
 *
 * What moves:
 *  - traffic on four lanes of the avenue, headlights coming toward you and
 *    tail lights going away, with brake lights, indicators and the odd bus or taxi
 *  - a signalled crossing: cars slow, queue at red and pull away on green, some
 *    turn right, and cross traffic passes along the side street on its own green
 *  - windows that go on and off, a television flickering, neon that blinks or
 *    buzzes, a street lamp on its way out, red beacons on the tall towers
 *
 * The world is in metres (X across, Y up, z away from you; you're at
 * X 0, Y 7, z 0) and the layout is seeded, so it doesn't change on resize or
 * when the theme changes; only the lighting does. Plain canvas, no page
 * access, so it runs in the rain worker.
 *
 * createCity({ mood, width, height, dpr })
 *   returns { sky, city, small, k, setMood(m), resize(w, h, dpr) (repaints), step(dt), draw(ctx, dt), drawSmall() }
 *   sky / city: full-size canvases (city is transparent where the sky shows);
 *   small: a quarter-size copy of the whole view, kept moving, for the beads to refract.
 */

const TAU = Math.PI * 2;
const CAM_Y = 7; // eye height, metres

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

/* ------------------------------------------------------------------ */
/* Lighting per mood                                                   */
/* ------------------------------------------------------------------ */

const MOODS = {
  // Evening: the city is awake. Lots of windows, busy traffic, warm haze.
  dark: {
    sky: [[5, 7, 14], [11, 14, 27], [30, 26, 42], [70, 48, 52]],
    pollution: [255, 138, 70, 0.22],
    cloud: [120, 92, 96],
    cloudA: 0.2,
    haze: [58, 46, 58],
    hazeDist: 230,
    walls: [[19, 22, 32], [24, 25, 34], [29, 25, 31], [16, 20, 30], [26, 29, 38], [21, 21, 26]],
    glass: [14, 18, 30],
    road: [[62, 48, 58], [12, 12, 17]],
    walk: [34, 31, 38],
    marking: [200, 190, 175],
    lit: 0.3,
    office: 0.38,
    windowA: 0.92,
    lamps: 1,
    shops: 0.7,
    signs: 1,
    traffic: 1,
    light: 1,
    comp: 'lighter',
    body: 0.16,
    bloom: 0.5,
    vignette: 'rgba(0, 0, 0, 0.5)',
  },
  // Deep night: most windows dark, a few cars, neon and lamps doing the work.
  night: {
    sky: [[1, 2, 5], [3, 5, 11], [11, 11, 20], [30, 22, 28]],
    pollution: [255, 120, 55, 0.11],
    cloud: [70, 56, 62],
    cloudA: 0.14,
    haze: [26, 22, 30],
    hazeDist: 300,
    walls: [[9, 11, 17], [12, 13, 19], [14, 12, 16], [8, 10, 15], [13, 15, 21], [11, 11, 14]],
    glass: [7, 9, 16],
    road: [[34, 26, 32], [6, 6, 9]],
    walk: [17, 16, 20],
    marking: [150, 140, 130],
    lit: 0.13,
    office: 0.2,
    windowA: 0.95,
    lamps: 1,
    shops: 0.4,
    signs: 1,
    traffic: 0.45,
    light: 0.95,
    comp: 'lighter',
    body: 0.1,
    bloom: 0.6,
    vignette: 'rgba(0, 0, 0, 0.66)',
  },
  // Overcast afternoon: grey towers fading into rain, headlights on, few lamps.
  light: {
    sky: [[128, 140, 155], [150, 161, 174], [178, 186, 196], [196, 202, 209]],
    pollution: null,
    cloud: [215, 220, 226],
    cloudA: 0.22,
    haze: [186, 193, 202],
    hazeDist: 170,
    walls: [[92, 100, 111], [106, 110, 117], [83, 91, 102], [117, 119, 124], [76, 84, 96], [99, 104, 112]],
    glass: [68, 80, 96],
    road: [[160, 166, 175], [58, 62, 69]],
    walk: [112, 116, 123],
    marking: [214, 216, 218],
    lit: 0.1,
    office: 0.92,
    windowA: 0.5,
    lamps: 0,
    shops: 0.5,
    signs: 0.35,
    traffic: 0.85,
    light: 0.7,
    comp: 'source-over',
    body: 1,
    bloom: 0.25,
    vignette: 'rgba(40, 52, 68, 0.22)',
  },
};

// Light colours.
const C = {
  head: [255, 238, 205],
  headLED: [228, 238, 255],
  tail: [255, 28, 18],
  amber: [255, 158, 30],
  sodium: [255, 162, 72],
  lampWarm: [255, 214, 165],
  lampCool: [232, 238, 255],
  sigR: [255, 40, 28],
  sigY: [255, 170, 30],
  sigG: [40, 255, 170],
  beacon: [255, 36, 30],
  tv: [120, 160, 255],
  bus: [255, 240, 210],
};
const NEON = [
  [255, 70, 160],
  [60, 240, 230],
  [255, 90, 60],
  [140, 110, 255],
  [255, 200, 70],
  [80, 160, 255],
  [120, 255, 140],
];
const WARM_WINDOWS = [
  [255, 208, 140],
  [255, 190, 115],
  [255, 226, 180],
  [255, 172, 96],
  [250, 214, 160],
  [255, 150, 110],
];
const COOL_WINDOWS = [
  [214, 230, 255],
  [236, 242, 255],
  [190, 212, 245],
  [226, 236, 228],
];
const PAINT = [
  [205, 207, 211],
  [28, 30, 34],
  [150, 154, 160],
  [120, 22, 26],
  [32, 52, 92],
  [88, 94, 102],
  [232, 232, 228],
  [58, 64, 56],
  [36, 36, 40],
  [170, 172, 176],
];

/* ------------------------------------------------------------------ */
/* Sprites                                                             */
/* ------------------------------------------------------------------ */

// Bokeh: an even disc with a slightly brighter rim and a soft edge.
function discSprite() {
  const S = 64;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.78)');
  grad.addColorStop(0.62, 'rgba(255,255,255,0.74)');
  grad.addColorStop(0.86, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.94, 'rgba(255,255,255,0.62)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return c;
}
// Glare: a soft falloff around a bright light.
function glowSprite() {
  const S = 64;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.12, 'rgba(255,255,255,0.62)');
  grad.addColorStop(0.32, 'rgba(255,255,255,0.22)');
  grad.addColorStop(0.62, 'rgba(255,255,255,0.06)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return c;
}
// A reflection on wet tarmac: a long, soft vertical smear.
function smearSprite() {
  const S = 128;
  const round = makeCanvas(S, S);
  let g = round.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.5)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.14)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const c = makeCanvas(24, 160);
  g = c.getContext('2d');
  g.drawImage(round, 0, 0, 24, 160);
  release(round);
  return c;
}

// The light under a street lamp, falling through rain: a soft-edged cone fading to the ground.
function coneSprite() {
  const Wc = 128;
  const Hc = 192;
  const c = makeCanvas(Wc, Hc);
  const g = c.getContext('2d');
  for (let y = 0; y < Hc; y++) {
    const t = y / (Hc - 1);
    const half = lerp(3, Wc / 2, Math.pow(t, 0.85));
    const a = 0.85 * Math.pow(1 - t, 1.25) * (0.35 + 0.65 * Math.min(1, t * 6));
    const gr = g.createLinearGradient(Wc / 2 - half, 0, Wc / 2 + half, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.5, `rgba(255,255,255,${a})`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(Wc / 2 - half, y, half * 2, 1);
  }
  return c;
}

function tinter(base) {
  const cache = new Map();
  return (rgb) => {
    const key = rgb.join(',');
    let s = cache.get(key);
    if (!s) {
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
/* The layout: buildings, lamps, signs. Seeded; metres.                */
/* ------------------------------------------------------------------ */

const FACADE = 13; // building line, either side of the avenue
const KERB = 9; // road edge
const LANES = [-5.3, -1.85, 1.85, 5.3];
// The signalled crossing.
const X1 = { z0: 56, z1: 70, gap: [52, 74], stopRecede: 51.2, stopOncoming: 74.8, xp: 59.5, xm: 66.5 };
const GAPS = [X1.gap, [196, 207], [358, 367]];
const END = 560; // where the avenue's buildings stop

function layout(seed) {
  const r = rng32(seed);
  const buildings = [];
  for (const side of [-1, 1]) {
    let z = 7;
    while (z < END) {
      const gap = GAPS.find((g) => z >= g[0] && z < g[1]);
      if (gap) {
        z = gap[1];
        continue;
      }
      let len = 12 + r() * 30;
      const next = GAPS.find((g) => g[0] >= z);
      if (next && z + len > next[0] - 6) len = next[0] - z;
      if (z + len > END) len = END - z;
      const near = z < 140;
      const tower = r() < (near ? 0.1 : 0.2);
      const h = tower ? 62 + r() * 80 : (near ? 22 : 14) + r() * (near ? 34 : 40);
      buildings.push({
        side,
        z0: z,
        z1: z + len,
        h,
        xf: FACADE + (r() < 0.22 ? 1 + r() * 2 : 0),
        wall: Math.floor(r() * 6),
        tone: 0.85 + r() * 0.3,
        office: r() < 0.4 || tower,
        seed: (r() * 1e9) | 0,
        floor: 3 + r() * 0.7, // storey height
        bay: 2.6 + r() * 1.4, // window spacing
        winW: 0.45 + r() * 0.35, // share of a bay that's glass
        shops: r() < 0.85,
        sign: r() < 0.45,
        signColor: Math.floor(r() * NEON.length),
        signMode: r() < 0.14 ? 'flicker' : r() < 0.22 ? 'blink' : 'steady',
        band: r() < 0.35,
        tank: !tower && h < 40 && r() < 0.25,
        mast: tower && r() < 0.6,
        crown: tower && r() < 0.5,
      });
      z += len + (r() < 0.12 ? 1 + r() * 2 : 0);
    }
  }
  buildings.sort((a, b) => b.z0 - a.z0); // far to near

  // The skyline beyond the end of the avenue.
  const skyline = [];
  for (let i = 0; i < 90; i++) {
    const z = 700 + r() * 900;
    const tower = r() < 0.16;
    skyline.push({
      x: (r() * 2 - 1) * 520,
      z,
      w: 22 + r() * 50,
      h: tower ? 140 + r() * 170 : 30 + r() * 100,
      seed: (r() * 1e9) | 0,
      spire: tower && r() < 0.5,
    });
  }
  skyline.sort((a, b) => b.z - a.z);

  // Street lamps down both sides, and along the side streets.
  const lamps = [];
  for (const side of [-1, 1]) {
    for (let z = 15 + (side > 0 ? 13 : 0); z < 520; z += 26) {
      if (GAPS.some((g) => z > g[0] - 1 && z < g[1] + 1)) continue;
      lamps.push({ X: side * 8.3, pole: side * 9.6, Y: 8.4, z, kind: z > 300 && r() < 0.5 ? 'sodium' : 'warm' });
    }
  }
  for (const g of GAPS) {
    for (const side of [-1, 1]) {
      for (let k = 0; k < 6; k++) {
        const X = side * (19 + k * 24);
        lamps.push({ X, pole: X, Y: 7.5, z: g[0] + 1.5, kind: 'sodium', cross: true });
      }
    }
  }
  // One lamp is on its way out.
  const flicker = lamps.filter((l) => !l.cross && l.z > 40 && l.z < 140);
  const dying = flicker.length ? flicker[Math.floor(r() * flicker.length)] : null;
  if (dying) dying.dying = true;

  return { buildings, skyline, lamps, seed };
}

/* ------------------------------------------------------------------ */

export function createCity(opts) {
  const world = layout((Math.random() * 1e9) | 0);
  const disc = tinter(discSprite());
  const glow = tinter(glowSprite());
  const smear = tinter(smearSprite());
  const cone = tinter(coneSprite());
  const canBlur = supportsFilter();

  let W = 0;
  let H = 0;
  let dpr = 1;
  let mood = MOODS[opts.mood] ? opts.mood : 'dark';
  let M = MOODS[mood];
  let cam = null;
  let B = 5; // smallest bokeh radius: how far out of focus the street is

  let sky = null;
  let city = null;
  let small = null;
  let smallBase = null;
  const k = 0.25; // scale of `small`

  // Things drawn every frame, found while painting.
  let dynWindows = [];
  let signs = [];
  let beacons = [];
  let dyingLamp = null;
  let signal = null; // the traffic signal heads' screen positions

  let time = 0;
  // Street-lamp cones on screen, so the rain falling through them can catch the light.
  let glints = [];
  // Car bodies are drawn small and scaled up, which blurs them for free.
  const BS = 0.4;
  let bodies = null;
  let bodiesTop = 0;

  /* ---------------- projection ---------------- */

  function makeCam() {
    const hy = H * (W >= H ? 0.6 : 0.6);
    const F = Math.max(W, H) * 0.85;
    return {
      cx: W * 0.5,
      hy,
      F,
      x: (X, z) => W * 0.5 + (X * F) / z,
      y: (Y, z) => hy - ((Y - CAM_Y) * F) / z,
    };
  }
  const fogT = (z) => 1 - Math.exp(-z / M.hazeDist);
  const hazed = (c, z) => mixc(c, M.haze, fogT(z));
  // How bright a light still reads through the rain at a distance.
  const reach = (z) => Math.exp(-z / (M.hazeDist * 1.6));

  function quad(g, ax, ay, bx, by, cx, cy, dx, dy) {
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.lineTo(cx, cy);
    g.lineTo(dx, dy);
    g.closePath();
  }
  const onScreen = (x0, y0, x1, y1, pad = 4) => x1 >= -pad && x0 <= W + pad && y1 >= -pad && y0 <= H + pad;

  // Is a point inside a convex quad [x0, y0, ... x3, y3]?
  function inQuad(p, x, y) {
    let sign = 0;
    for (let i = 0; i < 8; i += 2) {
      const ax = p[i];
      const ay = p[i + 1];
      const bx = p[(i + 2) % 8];
      const by = p[(i + 3) % 8];
      const cr = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
      if (cr === 0) continue;
      const sg = cr > 0 ? 1 : -1;
      if (!sign) sign = sg;
      else if (sg !== sign) return false;
    }
    return true;
  }
  // Hidden behind a nearer building? (Buildings are listed far to near.)
  function occluded(x, y, owner) {
    const list = world.buildings;
    for (let j = owner + 1; j < list.length; j++) {
      const s = list[j].scr;
      if (!s) continue;
      if (s.front && x >= s.front[0] && x <= s.front[1] && y >= s.front[2] && y <= s.front[3]) return true;
      if (s.facade && inQuad(s.facade, x, y)) return true;
    }
    return false;
  }

  // Paint something small once, out of focus like the rest of the street,
  // so it can be drawn every frame at any brightness for the price of one image.
  function bake(x0, y0, x1, y1, blur, fn) {
    const pad = Math.ceil(blur * 3 + 2);
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
    if (canBlur) {
      o.filter = `blur(${blur * dpr}px)`;
      o.drawImage(sharp, 0, 0);
    } else {
      const q = makeCanvas(Math.max(1, sharp.width / 3), Math.max(1, sharp.height / 3));
      q.getContext('2d').drawImage(sharp, 0, 0, q.width, q.height);
      o.drawImage(q, 0, 0, out.width, out.height);
      release(q);
    }
    release(sharp);
    return { c: out, x, y, w, h };
  }

  /* ---------------- painting ---------------- */

  function paintSky() {
    const c = makeCanvas(W * dpr, H * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    const { hy } = cam;
    let grad = g.createLinearGradient(0, 0, 0, hy);
    grad.addColorStop(0, css(M.sky[0]));
    grad.addColorStop(0.45, css(M.sky[1]));
    grad.addColorStop(0.82, css(M.sky[2]));
    grad.addColorStop(1, css(M.sky[3]));
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    // Low cloud, lit from underneath by the city.
    const r = rng32(world.seed ^ 0x51a9);
    const n = Math.round(26 + (W * H) / 60000);
    for (let i = 0; i < n; i++) {
      const y = hy * Math.pow(r(), 0.7);
      const x = r() * W;
      const rx = W * (0.12 + r() * 0.3);
      const ry = rx * (0.12 + r() * 0.12);
      const lit = Math.pow(y / hy, 1.6);
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
    // Darker cloud banks.
    for (let i = 0; i < n * 0.5; i++) {
      const y = hy * r() * 0.8;
      const x = r() * W;
      const rx = W * (0.1 + r() * 0.25);
      g.save();
      g.translate(x, y);
      g.scale(1, 0.14 + r() * 0.1);
      grad = g.createRadialGradient(0, 0, 0, 0, 0, rx);
      grad.addColorStop(0, css(mulc(M.sky[0], 0.8), 0.35));
      grad.addColorStop(1, css(M.sky[0], 0));
      g.fillStyle = grad;
      g.fillRect(-rx, -rx, rx * 2, rx * 2);
      g.restore();
    }
    // The orange glow of the city on the cloud base.
    if (M.pollution) {
      const [pr, pg, pb, pa] = M.pollution;
      g.save();
      g.translate(cam.cx, hy);
      g.scale(1, 0.42);
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

  // The street and buildings: painted sharp, then blurred into `city`.
  function paintScene(g, lit) {
    const { hy } = cam;
    const P = cam;
    const lk = lit.k;
    const L = lit.g;
    dynWindows = [];
    signs = [];
    beacons = [];

    /* Ground: wet tarmac, brighter toward the horizon where it mirrors the sky. */
    let grad = g.createLinearGradient(0, hy, 0, H);
    grad.addColorStop(0, css(M.road[0]));
    grad.addColorStop(0.08, css(mixc(M.road[0], M.road[1], 0.55)));
    grad.addColorStop(0.35, css(mixc(M.road[0], M.road[1], 0.85)));
    grad.addColorStop(1, css(M.road[1]));
    g.fillStyle = grad;
    g.fillRect(0, hy, W, H - hy);

    // Pavements.
    const walk = (x0, x1, z0, z1) => {
      if (z1 <= 2) return;
      z0 = Math.max(z0, 2);
      quad(g, P.x(x0, z0), P.y(0, z0), P.x(x1, z0), P.y(0, z0), P.x(x1, z1), P.y(0, z1), P.x(x0, z1), P.y(0, z1));
      const gr = g.createLinearGradient(0, P.y(0, z0), 0, P.y(0, z1));
      gr.addColorStop(0, css(hazed(M.walk, z0)));
      gr.addColorStop(1, css(hazed(M.walk, z1)));
      g.fillStyle = gr;
      g.fill();
    };
    const spans = [];
    let z = 2;
    for (const gp of GAPS) {
      spans.push([z, gp[0]]);
      z = gp[1];
    }
    spans.push([z, 900]);
    for (const s of [-1, 1]) {
      for (const [a, b] of spans) walk(s * KERB, s * (FACADE + 3), a, b);
      // Corners and the side streets' pavements.
      for (const gp of GAPS) {
        walk(s * KERB, s * 90, gp[0], gp[0] + 3.2);
        walk(s * KERB, s * 90, gp[1] - 3.2, gp[1]);
      }
    }
    // Kerb edges catch the light.
    g.lineWidth = 1;
    for (const s of [-1, 1]) {
      for (const [a, b] of spans) {
        const za = Math.max(a, 3);
        const gr = g.createLinearGradient(0, P.y(0, za), 0, P.y(0, b));
        gr.addColorStop(0, css(mixc(M.walk, M.marking, 0.35), 0.5));
        gr.addColorStop(1, css(M.haze, 0.2));
        g.strokeStyle = gr;
        g.beginPath();
        g.moveTo(P.x(s * KERB, za), P.y(0, za));
        g.lineTo(P.x(s * KERB, b), P.y(0, b));
        g.stroke();
      }
    }

    // Road markings: worn, wet, catching the light.
    const mark = (X0, X1, z0, z1, color, a) => {
      if (z0 < 2) z0 = 2;
      if (z1 <= z0) return;
      quad(g, P.x(X0, z0), P.y(0, z0), P.x(X1, z0), P.y(0, z0), P.x(X1, z1), P.y(0, z1), P.x(X0, z1), P.y(0, z1));
      g.fillStyle = css(hazed(color, (z0 + z1) / 2), a * (1 - fogT(z0) * 0.6));
      g.fill();
    };
    const inJunction = (zz) => GAPS.some((gp) => zz > gp[0] - 1 && zz < gp[1] + 1);
    for (let zz = 4; zz < 520; zz += 12) {
      if (inJunction(zz) || inJunction(zz + 3)) continue;
      for (const X of [-3.6, 3.6]) mark(X - 0.07, X + 0.07, zz, zz + 3, M.marking, 0.32);
    }
    for (const [a, b] of spans) {
      for (const X of [-0.22, 0.12]) mark(X, X + 0.1, a, Math.min(b, 560), [220, 180, 90], 0.28);
    }
    // Zebra crossings at the junction.
    for (const [za, zb] of [
      [X1.gap[0] + 0.6, X1.gap[0] + 3.6],
      [X1.gap[1] - 3.6, X1.gap[1] - 0.6],
    ]) {
      for (let X = -8.4; X < 8.4; X += 1.2) mark(X, X + 0.6, za, zb, M.marking, 0.36);
    }
    mark(0.3, 8.8, X1.stopRecede - 0.4, X1.stopRecede, M.marking, 0.4);
    mark(-8.8, -0.3, X1.stopOncoming, X1.stopOncoming + 0.4, M.marking, 0.3);

    /* Reflections of the windows on the wet road (faint, before the buildings). */
    const reflections = [];

    /* The skyline beyond. */
    for (const t of world.skyline) {
      const x0 = P.x(t.x - t.w / 2, t.z);
      const x1 = P.x(t.x + t.w / 2, t.z);
      const top = P.y(t.h, t.z);
      const base = P.y(0, t.z);
      if (!onScreen(x0, top, x1, base)) continue;
      const col = mixc(mulc(M.walls[t.seed % 6], 1), M.haze, Math.min(0.86, fogT(t.z) * 0.95));
      g.fillStyle = css(col);
      g.fillRect(x0, top, x1 - x0, base - top);
      if (t.spire) {
        const sx = (x0 + x1) / 2;
        const sh = (t.h * 0.25 * cam.F) / t.z;
        g.beginPath();
        g.moveTo(sx - (x1 - x0) * 0.12, top);
        g.lineTo(sx, top - sh);
        g.lineTo(sx + (x1 - x0) * 0.12, top);
        g.fill();
        beacons.push({ x: sx, y: top - sh, z: t.z, phase: hash(t.seed, 1, 2), owner: -1 });
      } else if (t.h > 120) beacons.push({ x: (x0 + x1) / 2, y: top, z: t.z, phase: hash(t.seed, 3, 4), owner: -1 });
      // Windows: specks of light.
      const fl = (3.4 * cam.F) / t.z;
      const bay = (3 * cam.F) / t.z;
      const rows = Math.floor((base - top) / fl) - 1;
      const cols = Math.floor((x1 - x0) / bay);
      const wa = M.windowA * (1 - fogT(t.z) * 0.55);
      for (let i = 1; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          const h = hash(t.seed, i, j);
          if (h > M.lit * 0.9) continue;
          const office = hash(t.seed, i, 99) < M.office;
          const col2 = office ? COOL_WINDOWS[(h * 97) & 3] : WARM_WINDOWS[((h * 131) | 0) % 6];
          const wx = x0 + j * bay + bay * 0.3;
          const wy = base - (i + 1) * fl;
          const s = Math.max(0.7, bay * 0.45);
          g.fillStyle = css(mixc(col2, M.haze, 0.4), wa * 0.8);
          g.fillRect(wx, wy, s, Math.max(0.7, fl * 0.5));
          L.fillStyle = css(col2, wa * 0.5);
          L.fillRect(wx * lk, wy * lk, Math.max(0.6, s * lk), Math.max(0.6, fl * 0.5 * lk));
        }
      }
    }

    /* The buildings along the avenue, far to near. */
    world.buildings.forEach((b, i) => paintBuilding(g, L, lk, b, i, reflections));

    // Lights that are drawn live go only where they can be seen.
    const seen = (e) => !occluded(e.x, e.y, e.owner);
    beacons = beacons.filter(seen);
    shopLights = shopLights.filter(seen);
    dynWindows = dynWindows.filter(seen);
    signs = signs.filter(seen);
    const soft = Math.max(1.2, B * 0.32);
    for (const s of signs) {
      const p = s.pts;
      const minX = Math.min(p[0], p[4]);
      const maxX = Math.max(p[0], p[4]);
      const minY = Math.min(p[3], p[5]);
      const maxY = Math.max(p[1], p[7]);
      s.box = [minX, minY, maxX, maxY];
      s.sprite = bake(minX, minY, maxX, maxY, soft, (sg) => {
        if (s.blade) {
          quad(sg, ...p);
          sg.fillStyle = css(mulc(s.c, 0.32));
          sg.fill();
          sg.fillStyle = css(mixc(s.c, [255, 255, 255], 0.4));
          const lw = Math.max(1.2, Math.abs(s.xb - s.xa));
          for (const [ya, yb] of s.letters) sg.fillRect(Math.min(s.xa, s.xb), ya, lw, Math.max(1, yb - ya));
        } else {
          quad(sg, ...p);
          sg.fillStyle = css(mixc(s.c, [255, 255, 255], 0.35));
          sg.fill();
        }
      });
    }
    for (const w of dynWindows) {
      const p = w.pts;
      const minY = Math.min(p[3], p[5]);
      const maxY = Math.max(p[1], p[7]);
      w.sprite = bake(Math.min(p[0], p[4]), minY, Math.max(p[0], p[4]), maxY, soft, (sg) => {
        quad(sg, ...p);
        const gr = sg.createLinearGradient(0, minY, 0, maxY);
        gr.addColorStop(0, css(w.c));
        gr.addColorStop(1, css(mulc(w.c, 0.6)));
        sg.fillStyle = gr;
        sg.fill();
      });
    }

    // Faint mirror images of lit windows, smeared down the wet road.
    g.save();
    g.globalCompositeOperation = M.comp === 'lighter' ? 'lighter' : 'source-over';
    for (const rf of reflections) {
      const w = Math.max(1.5, rf.w * 1.3);
      g.globalAlpha = rf.a;
      g.drawImage(smear(rf.c), rf.x - w / 2, rf.y - rf.h * 0.2, w, rf.h);
    }
    g.restore();

    /* Lamp posts and the signal mast (thin dark lines). */
    g.lineCap = 'round';
    for (const l of world.lamps) {
      if (l.cross) continue;
      const base = [P.x(l.pole, l.z), P.y(0, l.z)];
      const top = [P.x(l.pole, l.z), P.y(l.Y, l.z)];
      const head = [P.x(l.X, l.z), P.y(l.Y, l.z)];
      if (!onScreen(Math.min(base[0], head[0]), top[1], Math.max(base[0], head[0]), base[1])) continue;
      g.strokeStyle = css(hazed(mulc(M.walls[1], 0.55), l.z), 0.9);
      g.lineWidth = Math.max(0.6, (0.22 * cam.F) / l.z);
      g.beginPath();
      g.moveTo(base[0], base[1]);
      g.lineTo(top[0], top[1]);
      g.quadraticCurveTo(top[0], head[1] - (0.6 * cam.F) / l.z, head[0], head[1]);
      g.stroke();
    }
    // Signal mast over the far side of the crossing.
    {
      const z = X1.stopOncoming + 0.6;
      g.strokeStyle = css(hazed(mulc(M.walls[1], 0.5), z), 0.95);
      g.lineWidth = Math.max(0.8, (0.3 * cam.F) / z);
      g.beginPath();
      g.moveTo(P.x(9.8, z), P.y(0, z));
      g.lineTo(P.x(9.8, z), P.y(6.8, z));
      g.lineTo(P.x(0.8, z), P.y(6.6, z));
      g.stroke();
      g.fillStyle = css(hazed(mulc(M.walls[1], 0.35), z));
      signal = [];
      for (const X of [1.85, 5.3]) {
        const w = (0.42 * cam.F) / z;
        const top = P.y(6.55, z);
        const bot = P.y(5.1, z);
        g.fillRect(P.x(X, z) - w / 2, top, w, bot - top);
        signal.push({ x: P.x(X, z), y: [P.y(6.25, z), P.y(5.83, z), P.y(5.41, z)], r: (0.15 * cam.F) / z, z });
      }
      // Pedestal signal on the near right corner, and the cross street's (seen side-on).
      const zp = X1.gap[0] + 1.2;
      g.lineWidth = Math.max(0.8, (0.18 * cam.F) / zp);
      g.beginPath();
      g.moveTo(P.x(9.7, zp), P.y(0, zp));
      g.lineTo(P.x(9.7, zp), P.y(2.6, zp));
      g.stroke();
      const w = (0.38 * cam.F) / zp;
      g.fillRect(P.x(9.7, zp) - w / 2, P.y(3.7, zp), w, P.y(2.5, zp) - P.y(3.7, zp));
      signal.push({ x: P.x(9.7, zp), y: [P.y(3.45, zp), P.y(3.1, zp), P.y(2.75, zp)], r: (0.12 * cam.F) / zp, z: zp });
      signal.side = [
        { x: P.x(-9.6, zp), y: P.y(3.1, zp), z: zp },
        { x: P.x(9.9, X1.gap[1] - 1.2), y: P.y(3.1, X1.gap[1] - 1.2), z: X1.gap[1] - 1.2 },
      ];
    }

    /* Haze over the horizon: depth, and rain in the air. */
    grad = g.createLinearGradient(0, hy - H * 0.35, 0, hy + H * 0.12);
    grad.addColorStop(0, css(M.haze, 0));
    grad.addColorStop(0.72, css(M.haze, 0.42));
    grad.addColorStop(0.86, css(M.haze, 0.5));
    grad.addColorStop(1, css(M.haze, 0));
    g.fillStyle = grad;
    g.fillRect(0, hy - H * 0.35, W, H * 0.47);
  }

  function paintBuilding(g, L, lk, b, bi, reflections) {
    const P = cam;
    const s = b.side;
    const X = s * b.xf;
    const Xo = s * (b.xf + 34);
    const z0 = Math.max(b.z0, 2.5);
    const z1 = b.z1;
    const { h } = b;
    const wallC = mulc(M.walls[b.wall], b.tone);

    // Front face (toward you): seen past nearer, lower roofs and across the side streets.
    const fx0 = P.x(X, z0);
    const fx1 = P.x(Xo, z0);
    const fTop = P.y(h, z0);
    const fBase = P.y(0, z0);
    const frontC = hazed(mulc(wallC, M === MOODS.light ? 1.08 : 0.82), z0);
    b.scr = { front: [Math.min(fx0, fx1), Math.max(fx0, fx1), fTop, fBase], facade: null };
    if (onScreen(Math.min(fx0, fx1), fTop, Math.max(fx0, fx1), fBase)) {
      g.fillStyle = css(frontC);
      g.fillRect(Math.min(fx0, fx1), fTop, Math.abs(fx1 - fx0), fBase - fTop);
      // Roof line catches the sky.
      g.fillStyle = css(mixc(frontC, M.sky[3], 0.35));
      g.fillRect(Math.min(fx0, fx1), fTop, Math.abs(fx1 - fx0), Math.max(0.8, (0.35 * P.F) / z0));
      paintGrid(g, L, lk, b, bi, 'front', z0, frontC, reflections);
    }

    // Facade along the avenue.
    const ax = P.x(X, z0);
    const bx = P.x(X, z1);
    const top0 = P.y(h, z0);
    const top1 = P.y(h, z1);
    const base0 = P.y(0, z0);
    const base1 = P.y(0, z1);
    b.scr.facade = [ax, base0, ax, top0, bx, top1, bx, base1];
    if (onScreen(Math.min(ax, bx), Math.min(top0, top1), Math.max(ax, bx), Math.max(base0, base1))) {
      quad(g, ax, base0, ax, top0, bx, top1, bx, base1);
      const c0 = hazed(wallC, z0);
      const c1 = hazed(wallC, z1);
      const grad = g.createLinearGradient(ax, 0, bx, 0);
      grad.addColorStop(0, css(c0));
      grad.addColorStop(1, css(c1));
      g.fillStyle = grad;
      g.fill();
      // Street light washing up the lower floors.
      if (M.lamps) {
        const gr = g.createLinearGradient(0, Math.min(base0, base1), 0, Math.min(top0, top1));
        gr.addColorStop(0, css([255, 170, 100], 0.07 * (1 - fogT(z0))));
        gr.addColorStop(0.25, css([255, 170, 100], 0));
        g.fillStyle = gr;
        g.fill();
      }
      paintGrid(g, L, lk, b, bi, 'side', z0, c0, reflections);
      // Corner edge.
      g.strokeStyle = css(mixc(c0, M.sky[3], 0.4), 0.6);
      g.lineWidth = Math.max(0.6, (0.12 * P.F) / z0);
      g.beginPath();
      g.moveTo(ax, base0);
      g.lineTo(ax, top0);
      g.stroke();
    }

    // Roof things.
    if (b.tank && onScreen(Math.min(fx0, fx1), fTop - 200, Math.max(fx0, fx1), fTop)) {
      const tx = P.x(s * (b.xf + 6), z0 + 3);
      const tw = (3.2 * P.F) / (z0 + 3);
      const legs = P.y(h + 2.2, z0 + 3);
      const tt = P.y(h + 5.5, z0 + 3);
      g.fillStyle = css(hazed(mulc(wallC, 0.7), z0));
      g.fillRect(tx - tw / 2, tt, tw, legs - tt);
      g.beginPath();
      g.moveTo(tx - tw / 2 - tw * 0.05, tt);
      g.lineTo(tx, tt - tw * 0.35);
      g.lineTo(tx + tw / 2 + tw * 0.05, tt);
      g.fill();
      g.fillRect(tx - tw * 0.4, legs, tw * 0.08, P.y(h, z0 + 3) - legs);
      g.fillRect(tx + tw * 0.32, legs, tw * 0.08, P.y(h, z0 + 3) - legs);
    }
    if (b.mast) {
      const mz = z0 + 6;
      const mx = P.x(s * (b.xf + 10), mz);
      const mTop = P.y(h + 22, mz);
      g.strokeStyle = css(hazed(mulc(wallC, 0.8), mz));
      g.lineWidth = Math.max(0.7, (0.5 * P.F) / mz);
      g.beginPath();
      g.moveTo(mx, P.y(h, mz));
      g.lineTo(mx, mTop);
      g.stroke();
      beacons.push({ x: mx, y: mTop, z: mz, phase: hash(b.seed, 7, 7), owner: bi });
    } else if (h > 60) {
      beacons.push({ x: P.x(X + s * 1, z0 + 1), y: P.y(h + 0.6, z0 + 1), z: z0, phase: hash(b.seed, 5, 5), owner: bi });
      beacons.push({ x: P.x(Xo - s * 1, z0 + 1), y: P.y(h + 0.6, z0 + 1), z: z0, phase: hash(b.seed, 5, 5), owner: bi });
    }
    if (b.crown && M !== MOODS.light) {
      // A lit crown on the tower top.
      const cc = b.office ? C.lampCool : NEON[b.signColor];
      const yy0 = P.y(h - 2.5, z0);
      const yy1 = P.y(h - 1.2, z0);
      g.fillStyle = css(mixc(cc, M.haze, fogT(z0) * 0.5), 0.75);
      g.fillRect(Math.min(fx0, fx1), yy0, Math.abs(fx1 - fx0), yy1 - yy0);
      quad(g, ax, P.y(h - 1.2, z0), ax, P.y(h - 2.5, z0), bx, P.y(h - 2.5, z1), bx, P.y(h - 1.2, z1));
      g.fill();
      L.fillStyle = css(cc, 0.6);
      L.fillRect(Math.min(fx0, fx1) * lk, yy0 * lk, Math.abs(fx1 - fx0) * lk, Math.max(1, (yy1 - yy0) * lk));
    }
  }

  // Windows and shopfronts on one face of a building.
  function paintGrid(g, L, lk, b, bi, face, z0, wallC, reflections) {
    const P = cam;
    const s = b.side;
    const X = s * b.xf;
    const glassC = hazed(M.glass, z0);
    const tall = b.h;
    const floors = Math.floor((tall - 5.2) / b.floor);
    const glassW = b.bay * b.winW;
    const glassH = b.floor * 0.56;
    const span = face === 'side' ? b.z1 - b.z0 : 32;
    const bays = Math.floor((span - 1.2) / b.bay);

    // Each window's corners, in metres → screen.
    const corners = (j, Y0, Y1) => {
      if (face === 'side') {
        const za = b.z0 + 0.8 + j * b.bay;
        const zb = za + glassW;
        if (za < 2.5) return null;
        return [P.x(X, za), P.y(Y0, za), P.x(X, za), P.y(Y1, za), P.x(X, zb), P.y(Y1, zb), P.x(X, zb), P.y(Y0, zb), za];
      }
      const xa = s * (b.xf + 1.2 + j * b.bay);
      const xb = xa + s * glassW;
      const z = z0;
      return [P.x(xa, z), P.y(Y0, z), P.x(xa, z), P.y(Y1, z), P.x(xb, z), P.y(Y1, z), P.x(xb, z), P.y(Y0, z), z];
    };

    for (let f = 0; f < floors; f++) {
      const Y0 = 4.6 + f * b.floor + b.floor * 0.22;
      const Y1 = Y0 + glassH;
      // Office floors tend to be lit (or dark) all the way across.
      const floorBias = b.office ? hash(b.seed, f, 777) : 0.5;
      const pLit = b.office ? M.lit * (floorBias < 0.5 ? 0.25 : 1.8) : M.lit;
      for (let j = 0; j < bays; j++) {
        const q = corners(j, Y0, Y1);
        if (!q) continue;
        const [x0, y0, x1, y1, x2, y2, x3, y3, zw] = q;
        const minX = Math.min(x0, x2);
        const maxX = Math.max(x0, x2);
        const minY = Math.min(y1, y2);
        const maxY = Math.max(y0, y3);
        if (!onScreen(minX, minY, maxX, maxY)) continue;
        const wpx = maxX - minX;
        const hv = hash(b.seed, f * 131 + (face === 'side' ? 0 : 50000), j);
        const lit = hv < pLit;
        const office = b.office ? hash(b.seed, f, 4242) < 0.85 : hash(b.seed, f, j + 9) < M.office * 0.6;
        const palette = office ? COOL_WINDOWS : WARM_WINDOWS;
        const litC = palette[((hash(b.seed, j, f) * 997) | 0) % palette.length];
        const fz = fogT(zw);

        // A few windows change during the evening: painted dark here, drawn live.
        const dyn = wpx > 2.2 && wpx < 90 && dynWindows.length < 40 && hash(b.seed, f + 3, j + 17) < 0.035 && M.windowA > 0.6;
        if (lit && !dyn) {
          const dim = (office ? 0.5 : 0.48) + 0.45 * hash(b.seed, f, j + 3);
          const col = mixc(mulc(litC, dim), M.haze, fz * 0.55);
          if (wpx < 1.6) {
            g.fillStyle = css(col, M.windowA);
            g.fillRect(minX, minY, Math.max(0.8, wpx), maxY - minY);
          } else {
            quad(g, x0, y0, x1, y1, x2, y2, x3, y3);
            // Lit rooms: brighter toward the ceiling, curtains sometimes half drawn.
            const gr = g.createLinearGradient(0, minY, 0, maxY);
            gr.addColorStop(0, css(col, M.windowA));
            gr.addColorStop(0.6, css(mulc(col, 0.8), M.windowA));
            gr.addColorStop(1, css(mulc(col, 0.55), M.windowA));
            g.fillStyle = gr;
            g.fill();
            // A glazing bar, on the bigger ones.
            if (wpx > 14) {
              g.strokeStyle = css(mulc(wallC, 0.8), 0.7);
              g.lineWidth = Math.max(1, wpx * 0.05);
              g.beginPath();
              g.moveTo(lerp(x0, x3, 0.5), lerp(y0, y3, 0.5));
              g.lineTo(lerp(x1, x2, 0.5), lerp(y1, y2, 0.5));
              g.stroke();
            }
            const curtain = hash(b.seed, j, f + 55);
            if (!office && curtain < 0.35 && wpx > 4) {
              const t = 0.3 + curtain;
              quad(g, x0, y0, x1, y1, lerp(x1, x2, t), lerp(y1, y2, t), lerp(x0, x3, t), lerp(y0, y3, t));
              g.fillStyle = css(mixc(mulc(litC, 0.55), [120, 60, 40], 0.3), 0.85 * M.windowA);
              g.fill();
            }
          }
          L.fillStyle = css(litC, M.windowA * (1 - fz * 0.6));
          L.fillRect(minX * lk, minY * lk, Math.max(0.5, wpx * lk), Math.max(0.5, (maxY - minY) * lk));
          if (face === 'side' && f < 6 && fz < 0.75) {
            // Its reflection lies on the wet ground below: mirror Y about the street.
            const zr = zw;
            const ry = P.y(-(Y0 + Y1) / 2, zr);
            const gy = P.y(0, zr);
            if (ry > gy && ry < H + 200)
              reflections.push({ x: (minX + maxX) / 2, y: ry, w: wpx, h: (ry - gy) * 1.4 + 10, c: litC, a: 0.1 * M.windowA * (1 - fz) });
          }
        } else if (wpx >= 1.2) {
          quad(g, x0, y0, x1, y1, x2, y2, x3, y3);
          g.fillStyle = css(glassC, 0.8);
          g.fill();
          if (dyn) {
            const tv = hash(b.seed, j, f + 1) < 0.18;
            dynWindows.push({
              owner: bi,
              x: (minX + maxX) / 2,
              y: (minY + maxY) / 2,
              pts: [x0, y0, x1, y1, x2, y2, x3, y3],
              c: tv ? C.tv : mixc(litC, M.haze, fz * 0.5),
              tv,
              on: lit || hash(b.seed, f, j + 1) < 0.5 ? 1 : 0,
              level: lit ? 1 : 0,
              next: 2 + Math.random() * 20,
              z: zw,
            });
          }
        }
      }
    }

    // Ground floor: shopfronts.
    if (!b.shops) return;
    // A rectangle on this face: `a`..`b` along it (metres from its near end), Y0..Y1 up.
    const rect = (a, bb, Y0, Y1) => {
      if (face === 'side') {
        const za = b.z0 + a;
        const zb = b.z0 + bb;
        if (za < 3) return null;
        return [P.x(X, za), P.y(Y0, za), P.x(X, za), P.y(Y1, za), P.x(X, zb), P.y(Y1, zb), P.x(X, zb), P.y(Y0, zb)];
      }
      const xa = s * (b.xf + a);
      const xb = s * (b.xf + bb);
      return [P.x(xa, z0), P.y(Y0, z0), P.x(xa, z0), P.y(Y1, z0), P.x(xb, z0), P.y(Y1, z0), P.x(xb, z0), P.y(Y0, z0)];
    };
    const shopN = Math.max(1, Math.floor(span / 7));
    const w = span / shopN;
    for (let i = 0; i < shopN; i++) {
      const lit = hash(b.seed, i, face === 'side' ? 31 : 32) < M.shops;
      const tone = hash(b.seed, i, 33);
      const col = tone < 0.62 ? WARM_WINDOWS[((tone * 50) | 0) % 6] : tone < 0.88 ? COOL_WINDOWS[i & 3] : NEON[((tone * 100) | 0) % NEON.length];
      const q = rect(i * w + 0.6, (i + 1) * w - 0.6, 0.35, 3.1);
      if (!q) continue;
      const minX = Math.min(q[0], q[4]);
      const maxX = Math.max(q[0], q[4]);
      const minY = Math.min(q[3], q[5]);
      const maxY = Math.max(q[1], q[7]);
      if (!onScreen(minX, minY, maxX, maxY)) continue;
      const mz = face === 'side' ? b.z0 + (i + 0.5) * w : z0;
      const mX = face === 'side' ? X : s * (b.xf + (i + 0.5) * w);
      const fz = fogT(mz);
      quad(g, ...q);
      if (lit) {
        // Lit from the ceiling: bright at the top, falling off to the floor.
        const c2 = mixc(mulc(col, 0.82), M.haze, fz * 0.5);
        const gr = g.createLinearGradient(0, minY, 0, maxY);
        gr.addColorStop(0, css(c2, 0.95));
        gr.addColorStop(0.5, css(mulc(c2, 0.72), 0.92));
        gr.addColorStop(1, css(mulc(c2, 0.5), 0.9));
        g.fillStyle = gr;
        g.fill();
        // Things inside: shelves, a counter, someone standing.
        if (maxX - minX > 10) {
          g.fillStyle = css(mulc(c2, 0.35), 0.7);
          for (let k2 = 0; k2 < 3; k2++) {
            const t0 = 0.15 + hash(b.seed, i, k2 + 60) * 0.65;
            const t1 = t0 + 0.04 + hash(b.seed, i, k2 + 70) * 0.12;
            const tt = 0.35 + hash(b.seed, i, k2 + 80) * 0.4;
            quad(
              g,
              lerp(q[0], q[6], t0), lerp(q[1], q[7], t0),
              lerp(lerp(q[0], q[2], tt), lerp(q[6], q[4], tt), t0), lerp(lerp(q[1], q[3], tt), lerp(q[7], q[5], tt), t0),
              lerp(lerp(q[0], q[2], tt), lerp(q[6], q[4], tt), t1), lerp(lerp(q[1], q[3], tt), lerp(q[7], q[5], tt), t1),
              lerp(q[0], q[6], t1), lerp(q[1], q[7], t1),
            );
            g.fill();
          }
        }
        L.fillStyle = css(col, 0.75 * (1 - fz * 0.5));
        L.fillRect(minX * lk, minY * lk, Math.max(0.5, (maxX - minX) * lk), Math.max(0.5, (maxY - minY) * lk));
        shopLights.push({ owner: bi, X: mX, z: mz, c: col, side: s, face, x: (minX + maxX) / 2, y: maxY - 1, w: maxX - minX });
      } else {
        g.fillStyle = css(mixc(glassC, [0, 0, 0], 0.35));
        g.fill();
      }
      // Glazing bars.
      if (maxX - minX > 6) {
        g.strokeStyle = css(mulc(wallC, 0.6), 0.85);
        g.lineWidth = Math.max(0.7, (maxX - minX) / 70);
        const bars = Math.max(1, Math.round((w - 1.2) / 2.2));
        g.beginPath();
        for (let k2 = 1; k2 < bars; k2++) {
          const t = k2 / bars;
          g.moveTo(lerp(q[0], q[6], t), lerp(q[1], q[7], t));
          g.lineTo(lerp(q[2], q[4], t), lerp(q[3], q[5], t));
        }
        g.stroke();
      }
      // A neon band over some of them.
      if (b.band && i % 2 === 0 && M.signs) {
        const bq = rect(i * w + 1.1, (i + 1) * w - 1.1, 3.45, 3.8);
        if (bq) {
          const nc = NEON[(b.signColor + i) % NEON.length];
          signs.push({ owner: bi, pts: bq, c: nc, mode: 'steady', z: mz, phase: hash(b.seed, i, 3), X: mX, Y: 3.6, x: (bq[0] + bq[4]) / 2, y: (bq[1] + bq[3]) / 2 });
        }
      }
    }
    // A blade sign sticking out over the pavement, facing you.
    if (face === 'side' && b.sign && M.signs) {
      const z = b.z0 + 2.5;
      if (z > 6) {
        const Xa = s * b.xf;
        const Xb = s * (b.xf - 1.1);
        const Y0 = 4.8;
        const Y1 = 4.8 + 5 + hash(b.seed, 9, 9) * 5;
        const pts = [P.x(Xa, z), P.y(Y0, z), P.x(Xa, z), P.y(Y1, z), P.x(Xb, z), P.y(Y1, z), P.x(Xb, z), P.y(Y0, z)];
        // Letters: a column of lit blocks.
        const letters = [];
        const n = Math.max(3, Math.round((Y1 - Y0) / 1.1));
        for (let i = 0; i < n; i++) {
          const ya = lerp(Y1 - 0.35, Y0 + 0.35, i / n);
          const yb = ya - ((Y1 - Y0 - 0.7) / n) * 0.72;
          letters.push([P.y(ya, z), P.y(yb, z)]);
        }
        signs.push({
          owner: bi,
          x: (pts[0] + pts[4]) / 2,
          y: (pts[1] + pts[3]) / 2,
          pts,
          blade: true,
          letters,
          xa: P.x(lerp(Xa, Xb, 0.25), z),
          xb: P.x(lerp(Xa, Xb, 0.75), z),
          c: NEON[b.signColor],
          mode: b.signMode,
          z,
          phase: hash(b.seed, 2, 2),
          X: (Xa + Xb) / 2,
          Y: (Y0 + Y1) / 2,
        });
      }
    }
  }

  let shopLights = [];

  // Lights that don't move: lamps, shop glow, all drawn sharp after the blur.
  function paintStaticLights(g) {
    const P = cam;
    const comp = M.comp;
    g.save();
    g.globalCompositeOperation = comp;
    const A = M.light;

    // Shop light spilling onto the pavement, and its smear on the wet road.
    for (const s of shopLights) {
      if (s.z > 260) continue;
      const fz = fogT(s.z);
      const a = 0.42 * A * (1 - fz) * M.shops;
      if (a < 0.01) continue;
      const X = s.face === 'side' ? s.side * (FACADE - 2.2) : s.X;
      const z = s.face === 'side' ? s.z : s.z - 2.2;
      const gx = P.x(X, z);
      const gy = P.y(0, z);
      const rw = Math.max(s.w * 0.9, (3.2 * P.F) / z);
      const rh = Math.max(3, (1.3 * P.F) / z);
      g.globalAlpha = a * 0.5;
      g.drawImage(glow(s.c), gx - rw, gy - rh, rw * 2, rh * 2);
      const my = P.y(-1.8, s.z);
      const top = P.y(0, s.z);
      const len = (my - top) * 2.4 + 10;
      const w = Math.max(3, s.w * 0.7);
      g.globalAlpha = a * 0.45;
      g.drawImage(smear(s.c), s.x - w / 2, top - 2, w, len);
    }

    // Street lamps.
    if (M.lamps) {
      for (const l of world.lamps) {
        if (l.dying) {
          dyingLamp = l;
          continue;
        }
        lamp(g, l, 1);
      }
    }
    g.restore();
  }

  function lamp(g, l, level) {
    const P = cam;
    const sx = P.x(l.X, l.z);
    const sy = P.y(l.Y, l.z);
    if (sx < -200 || sx > W + 200 || sy > H + 100) return;
    const col = l.kind === 'sodium' ? C.sodium : C.lampWarm;
    const at = reach(l.z) * M.light * level;
    const rp = (0.35 * P.F) / l.z;
    const R = Math.hypot(rp, B * (l.cross ? 0.8 : 1));
    // A cone of light falling through the rain.
    const gy = P.y(0, l.z);
    const spread = (4.2 * P.F) / l.z;
    if (!l.cross && spread > 6) {
      if (level === 1 && sy < H && gy > 0) glints.push({ x: sx, y0: sy, y1: gy, r0: rp, half: spread, k: 3.2 * at });
      g.globalAlpha = 0.2 * at;
      g.drawImage(cone(col), sx - spread * 1.15, sy, spread * 2.3, gy - sy);
      // The pool on the ground.
      g.globalAlpha = 0.32 * at;
      const ph = Math.max(3, (1.2 * P.F) / l.z);
      g.drawImage(glow(col), sx - spread * 1.2, gy - ph, spread * 2.4, ph * 2);
    }
    // Reflection on the wet road, long and broken up.
    const my = P.y(-l.Y, l.z);
    const len = (my - gy) * 2.2 + R * 3;
    g.globalAlpha = 0.42 * at;
    g.drawImage(smear(col), sx - R * 0.9, gy - R, R * 1.8, len);
    // The lamp itself: glare and a bokeh disc.
    g.globalAlpha = 0.5 * at;
    g.drawImage(glow(col), sx - R * 4, sy - R * 4, R * 8, R * 8);
    g.globalAlpha = 0.85 * at;
    g.drawImage(disc(col), sx - R, sy - R, R * 2, R * 2);
    g.globalAlpha = 1;
  }

  function paint() {
    cam = makeCam();
    B = clamp(Math.min(W, H) * 0.0085, 3.2, 9);
    release(sky);
    release(city);
    release(small);
    release(smallBase);
    sky = paintSky();
    shopLights = [];
    dyingLamp = null;
    glints = [];

    // Sharp scene → blurred.
    const pre = makeCanvas(W * dpr, H * dpr);
    const pg = pre.getContext('2d');
    pg.scale(dpr, dpr);
    const lk = 0.25;
    const litC = makeCanvas(W * lk, H * lk);
    const lg = litC.getContext('2d');
    paintScene(pg, { g: lg, k: lk });

    city = makeCanvas(W * dpr, H * dpr);
    const g = city.getContext('2d');
    const blurPx = Math.max(1.2, B * 0.32) * dpr;
    if (canBlur) {
      g.filter = `blur(${blurPx}px)`;
      g.drawImage(pre, 0, 0);
      g.filter = 'none';
    } else {
      // No canvas filters: soften by going through a smaller copy.
      const sm = makeCanvas((W * dpr) / 3, (H * dpr) / 3);
      const sg = sm.getContext('2d');
      sg.drawImage(pre, 0, 0, sm.width, sm.height);
      g.globalAlpha = 0.55;
      g.drawImage(pre, 0, 0);
      g.globalAlpha = 0.6;
      g.drawImage(sm, 0, 0, city.width, city.height);
      g.globalAlpha = 1;
      release(sm);
    }
    release(pre);

    // Bloom: the lit windows glow into the rain.
    g.save();
    g.globalCompositeOperation = M.comp === 'lighter' ? 'lighter' : 'screen';
    g.globalAlpha = M.bloom;
    if (canBlur) {
      g.filter = `blur(${Math.max(4, B * 1.4) * dpr}px)`;
      g.drawImage(litC, 0, 0, city.width, city.height);
      g.filter = `blur(${Math.max(10, B * 4) * dpr}px)`;
      g.globalAlpha = M.bloom * 0.7;
      g.drawImage(litC, 0, 0, city.width, city.height);
      g.filter = 'none';
    } else {
      const tiny = makeCanvas(litC.width / 4, litC.height / 4);
      tiny.getContext('2d').drawImage(litC, 0, 0, tiny.width, tiny.height);
      g.drawImage(tiny, 0, 0, city.width, city.height);
      release(tiny);
    }
    g.restore();
    release(litC);

    g.save();
    g.scale(dpr, dpr);
    paintStaticLights(g);
    // Vignette.
    const grad = g.createRadialGradient(W / 2, H * 0.48, Math.min(W, H) * 0.35, W / 2, H * 0.48, Math.hypot(W, H) * 0.62);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, M.vignette);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    g.restore();

    // The small copy the beads refract.
    smallBase = makeCanvas(W * k, H * k);
    const sb = smallBase.getContext('2d');
    sb.drawImage(sky, 0, 0, smallBase.width, smallBase.height);
    sb.drawImage(city, 0, 0, smallBase.width, smallBase.height);
    small = makeCanvas(W * k, H * k);
    release(bodies);
    bodiesTop = Math.floor(cam.hy - 6);
    bodies = makeCanvas(W * BS, (H - bodiesTop) * BS);
  }

  /* ------------------------------------------------------------------ */
  /* Traffic                                                             */
  /* ------------------------------------------------------------------ */

  // Lanes. `p` is a car's front along the lane's axis; it moves by dir.
  const lanes = [
    { axis: 'z', dir: -1, c: LANES[0], start: 640, end: -3, stop: X1.stopOncoming, sig: 'av', v0: 13.5, mean: 9 },
    { axis: 'z', dir: -1, c: LANES[1], start: 640, end: -3, stop: X1.stopOncoming, sig: 'av', v0: 15, mean: 11.5 },
    { axis: 'z', dir: 1, c: LANES[2], start: -3, end: 650, stop: X1.stopRecede, sig: 'av', v0: 15, mean: 9 },
    { axis: 'z', dir: 1, c: LANES[3], start: -3, end: 650, stop: X1.stopRecede, sig: 'av', v0: 13, mean: 7.5, turns: 0.24 },
    { axis: 'x', dir: 1, c: X1.xp, start: -80, end: 80, stop: -10.6, sig: 'cr', v0: 11, mean: 10 },
    { axis: 'x', dir: -1, c: X1.xm, start: 80, end: -80, stop: 10.6, sig: 'cr', v0: 11, mean: 11 },
  ];
  for (const l of lanes) {
    l.cars = [];
    l.timer = Math.random() * 3;
  }
  let turning = []; // cars on the curve into the side street

  // Signals: avenue green, amber, all red, cross green, amber, all red.
  const PHASES = [
    ['g', 'r', 24],
    ['y', 'r', 3.5],
    ['r', 'r', 2],
    ['r', 'g', 10],
    ['r', 'y', 3],
    ['r', 'r', 2],
  ];
  let phase = 0;
  let phaseT = Math.random() * 10;
  const light = { av: 'g', cr: 'r' };

  const TYPES = [
    { t: 'car', w: 64, len: 4.5, wid: 1.82, h: 1.45 },
    { t: 'suv', w: 20, len: 4.9, wid: 1.95, h: 1.78 },
    { t: 'taxi', w: 8, len: 4.7, wid: 1.85, h: 1.5 },
    { t: 'van', w: 6, len: 6.2, wid: 2.1, h: 2.6 },
    { t: 'bus', w: 3, len: 12, wid: 2.55, h: 3.2 },
  ];
  const TW = TYPES.reduce((s, t) => s + t.w, 0);

  function newCar(lane) {
    let x = Math.random() * TW;
    let T = TYPES[0];
    for (const t of TYPES) {
      x -= t.w;
      if (x <= 0) {
        T = t;
        break;
      }
    }
    if (lane.axis === 'x' && T.t === 'bus') T = TYPES[0];
    return {
      T,
      len: T.len,
      p: lane.start,
      v: lane.v0 * (0.75 + Math.random() * 0.2),
      v0: lane.v0 * (0.85 + Math.random() * 0.3),
      acc: 0,
      brake: 0,
      led: Math.random() < 0.45,
      paint: T.t === 'taxi' ? [228, 178, 36] : T.t === 'bus' ? (Math.random() < 0.5 ? [180, 36, 40] : [40, 90, 150]) : PAINT[(Math.random() * PAINT.length) | 0],
      turn: lane.turns && Math.random() < lane.turns,
      blink: Math.random(),
      fade: 1,
      x: 0,
      z: 0,
      hd: 0,
      id: Math.random() * 1000,
    };
  }

  function place(car, lane) {
    if (lane.axis === 'z') {
      car.x = lane.c;
      car.z = car.p - (lane.dir * car.len) / 2;
      car.hd = lane.dir > 0 ? 0 : Math.PI;
      car.fade = 1;
    } else {
      car.z = lane.c;
      car.x = car.p - (lane.dir * car.len) / 2;
      car.hd = lane.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      // Disappears behind the corner buildings.
      const cut = (FACADE * lane.c) / X1.gap[0] + 1;
      car.fade = clamp((cut - Math.abs(car.x)) / 3, 0, 1);
    }
  }

  // Intelligent-driver model: smooth following, smooth stops.
  function idm(v, v0, gap, dv) {
    const a = 1.5;
    const b = 2.4;
    const ss = 2.2 + Math.max(0, v * 1.25 + (v * dv) / (2 * Math.sqrt(a * b)));
    const free = 1 - Math.pow(v / Math.max(0.1, v0), 4);
    return a * (free - (ss / Math.max(0.2, gap)) ** 2);
  }

  function stepTraffic(dt) {
    // Signals.
    phaseT += dt;
    if (phaseT > PHASES[phase][2]) {
      phaseT = 0;
      phase = (phase + 1) % PHASES.length;
    }
    light.av = PHASES[phase][0];
    light.cr = PHASES[phase][1];
    const dens = M.traffic;

    for (const lane of lanes) {
      const cars = lane.cars;
      const d = lane.dir;
      // Front-most first.
      cars.sort((a, b) => d * (b.p - a.p));
      const state = light[lane.sig];
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i];
        const lead = cars[i - 1];
        let v0 = car.v0;
        if (car.turn && lane.axis === 'z') {
          const toTurn = 54 - car.p;
          if (toTurn < 38) v0 = Math.min(v0, 6.5 + Math.max(0, toTurn) * 0.15);
        }
        let acc = lead ? idm(car.v, v0, d * (lead.p - car.p) - lead.len, car.v - lead.v) : idm(car.v, v0, 1e9, 0);
        // The stop line.
        const toStop = d * (lane.stop - car.p);
        if (state !== 'g' && toStop > -0.3) {
          const canStop = state === 'r' || toStop > (car.v * car.v) / (2 * 3.2) + 1;
          if (canStop) acc = Math.min(acc, idm(car.v, v0, toStop + 0.6, car.v));
        }
        car.acc = clamp(acc, -7, 2.2);
        car.v = Math.max(0, car.v + car.acc * dt);
        car.p += d * car.v * dt;
        const braking = car.acc < -0.6 || car.v < 0.4;
        car.brake += ((braking ? 1 : 0) - car.brake) * Math.min(1, dt * 10);
        car.blink = (car.blink + dt * 1.5) % 1;

        // Turning right into the side street.
        if (car.turn && lane.axis === 'z' && car.p >= 54 && !car.gone) {
          car.gone = true;
          car.arc = 0;
          turning.push(car);
        }
      }
      // Off the end.
      lane.cars = cars.filter((c) => !c.gone && d * (lane.end - c.p) > 0);
      for (const c of lane.cars) place(c, lane);

      // New arrivals.
      lane.timer -= dt;
      if (lane.timer <= 0) {
        const last = lane.cars[lane.cars.length - 1];
        const room = !last || d * (last.p - lane.start) - last.len > 10;
        if (room) {
          const car = newCar(lane);
          if (last) car.v = Math.min(car.v, last.v + 2);
          lane.cars.push(car);
          place(car, lane);
          lane.timer = (lane.mean / dens) * (0.35 + -Math.log(1 - Math.random() * 0.95) * 0.75);
        } else lane.timer = 0.5;
      }
    }

    // The curve: from (5.3, 54) heading away to (10.8, 59.5) heading right.
    const R = X1.xp - 54;
    const xp = lanes[4];
    for (const car of turning) {
      car.v += (5.5 - car.v) * Math.min(1, dt * 1.5);
      car.arc += (car.v * dt) / R;
      car.blink = (car.blink + dt * 1.5) % 1;
      const th = Math.min(Math.PI / 2, car.arc);
      const fx = LANES[3] + R * (1 - Math.cos(th));
      const fz = 54 + R * Math.sin(th);
      car.hd = th;
      car.x = fx - (Math.sin(th) * car.len) / 2;
      car.z = fz - (Math.cos(th) * car.len) / 2;
      if (car.arc >= Math.PI / 2) {
        car.done = true;
        car.p = fx;
        car.turn = false;
        car.gone = false;
        car.v0 = xp.v0;
        xp.cars.push(car);
        place(car, xp);
      }
    }
    turning = turning.filter((c) => !c.done);
  }

  // Run the street for a while first, so it opens mid-evening, not empty.
  for (let i = 0; i < 900; i++) stepTraffic(0.1);

  /* ------------------------------------------------------------------ */
  /* Drawing, every frame                                                */
  /* ------------------------------------------------------------------ */

  // A bokeh light at world point (X, Y, z) with intensity a.
  function bokeh(g, X, Y, z, col, a, size = 0.16, glare = 1) {
    if (z < 1.6 || a <= 0.004) return;
    const P = cam;
    const sx = P.x(X, z);
    const sy = P.y(Y, z);
    const rp = (size * P.F) / z;
    const R = Math.hypot(rp, B);
    if (sx < -R * 4 || sx > W + R * 4 || sy < -R * 4 || sy > H + R * 4) return;
    const at = a * reach(z) * M.light;
    // Far lights get dimmer as the disc spreads their light thinner.
    const spread = clamp((rp * 2.2 + 1) / (R * 0.7), 0.35, 1);
    if (glare > 0) {
      g.globalAlpha = Math.min(1, 0.45 * at * glare);
      g.drawImage(glow(col), sx - R * 3.6, sy - R * 3.6, R * 7.2, R * 7.2);
    }
    g.globalAlpha = Math.min(1, 0.9 * at * spread);
    g.drawImage(disc(col), sx - R, sy - R, R * 2, R * 2);
  }

  // Its smear on the wet road.
  function reflect(g, X, Y, z, col, a, size = 0.16) {
    if (z < 2 || a <= 0.004) return;
    const P = cam;
    const sx = P.x(X, z);
    const gy = P.y(0, z);
    if (sx < -60 || sx > W + 60 || gy > H + 20) return;
    const my = P.y(-Y, z);
    const R = Math.hypot((size * P.F) / z, B);
    const len = (my - gy) * 3 + R * 5;
    const shimmer = 0.75 + 0.25 * Math.sin(time * 9 + X * 3.1 + z * 0.7) * Math.sin(time * 5.3 + z);
    g.globalAlpha = Math.min(1, 0.5 * a * reach(z) * M.light * shimmer);
    g.drawImage(smear(col), sx - R * 1.1, gy - R * 0.5, R * 2.2, len);
  }

  function project(X, Y, z) {
    return [cam.x(X, z), cam.y(Y, z)];
  }

  // A box (car body) seen from above and in front: draw the faces that face you.
  function box(g, car, along, back, hw, y0, y1, col, haze, topCol = col) {
    const f = [Math.sin(car.hd), Math.cos(car.hd)];
    const r = [f[1], -f[0]];
    const cx = car.x + f[0] * along;
    const cz = car.z + f[1] * along;
    const pt = (sl, sw, Y) => {
      const X = cx + f[0] * back * sl + r[0] * hw * sw;
      const z = cz + f[1] * back * sl + r[1] * hw * sw;
      return [X, z, Y];
    };
    const corners = [pt(1, 1, 0), pt(1, -1, 0), pt(-1, -1, 0), pt(-1, 1, 0)];
    for (const c of corners) if (c[1] < 1.8) return false;
    const P = cam;
    const sp = (c, Y) => [P.x(c[0], c[1]), P.y(Y, c[1])];
    const face = (a, b, shade) => {
      // Faces whose outward normal points toward you.
      const mx = (a[0] + b[0]) / 2;
      const mz = (a[1] + b[1]) / 2;
      const nx = mx - cx;
      const nz = mz - cz;
      if (nx * -mx + nz * -mz <= 0) return;
      const [ax, ay0] = sp(a, y0);
      const [, ay1] = sp(a, y1);
      const [bx, by0] = sp(b, y0);
      const [, by1] = sp(b, y1);
      quad(g, ax, ay0, ax, ay1, bx, by1, bx, by0);
      g.fillStyle = css(mixc(mulc(col, shade), M.haze, haze));
      g.fill();
    };
    face(corners[0], corners[1], 0.9);
    face(corners[1], corners[2], 0.72);
    face(corners[2], corners[3], 0.85);
    face(corners[3], corners[0], 0.72);
    // Top.
    const t = corners.map((c) => sp(c, y1));
    quad(g, t[0][0], t[0][1], t[1][0], t[1][1], t[2][0], t[2][1], t[3][0], t[3][1]);
    g.fillStyle = css(mixc(mulc(topCol, 1.12), M.haze, haze));
    g.fill();
    return true;
  }

  // The body, on the soft layer: a shadow, the lower body, then the cabin.
  function drawBody(g, car) {
    const { T } = car;
    const z = car.z;
    if (z < 2.5 || z > 260 || car.fade <= 0.01) return;
    const haze = fogT(z);
    const f = [Math.sin(car.hd), Math.cos(car.hd)];
    const r = [f[1], -f[0]];
    const hl = car.len / 2;
    const hw = T.wid / 2;
    g.globalAlpha = car.fade;
    // Shadow on the wet road.
    const gx = cam.x(car.x, z);
    const gy = cam.y(0, z);
    const ext = Math.abs(f[0]) * car.len + Math.abs(r[0]) * T.wid;
    const dep = Math.abs(f[1]) * car.len + Math.abs(r[1]) * T.wid;
    const rw = ((ext * 0.62 + 0.4) * cam.F) / z;
    const rh = Math.max(2, cam.y(0, z - dep * 0.6) - cam.y(0, z + dep * 0.6)) * 0.62 + 2;
    g.globalAlpha = car.fade * (M === MOODS.light ? 0.5 : 0.7) * (1 - haze);
    g.drawImage(glow([0, 0, 0]), gx - rw, gy - rh, rw * 2, rh * 2);
    g.globalAlpha = car.fade;
    const paint = mixc([10, 11, 15], car.paint, M.body);
    const glass = mixc(M.glass, M.sky[3], M === MOODS.light ? 0.35 : 0.12);
    if (T.t === 'bus' || T.t === 'van') {
      if (!box(g, car, 0, hl, hw, 0.32, T.h, paint, haze)) return;
      if (T.t === 'bus') busWindows(g, car, f, r, hl, hw);
      return;
    }
    if (!box(g, car, 0, hl, hw, 0.3, 0.92, paint, haze)) return;
    box(g, car, -car.len * 0.05, hl * 0.5, hw * 0.86, 0.92, T.h, glass, haze, paint);
    if (T.t === 'taxi') {
      // Roof sign.
      const sx = cam.x(car.x, z);
      const sw = (0.45 * cam.F) / z;
      g.fillStyle = css(mixc([255, 226, 150], M.haze, haze * 0.5));
      g.fillRect(sx - sw, cam.y(T.h + 0.32, z), sw * 2, Math.max(1, (0.26 * cam.F) / z));
    }
  }

  function drawLights(g, car) {
    const { T } = car;
    const z = car.z;
    if (z < 2.5 || z > 600) return;
    const a = car.fade;
    if (a <= 0.01) return;
    const f = [Math.sin(car.hd), Math.cos(car.hd)];
    const r = [f[1], -f[0]];
    const hl = car.len / 2;
    const hw = T.wid / 2;
    g.globalCompositeOperation = M.comp;
    const toCam = (X, Z) => {
      const l = Math.hypot(X, Z) || 1;
      return [-X / l, -Z / l];
    };
    const tc = toCam(car.x, car.z);
    const kHead = f[0] * tc[0] + f[1] * tc[1];
    const head = car.led ? C.headLED : C.head;
    const hy = T.t === 'bus' ? 0.95 : T.t === 'van' ? 0.85 : 0.68;
    const ty = T.t === 'bus' ? 1.1 : T.t === 'van' ? 1.0 : 0.88;
    const sideW = hw - 0.28;
    const dyn = (X, Z, Y, c, k, size, glare) => bokeh(g, X, Y, Z, c, k * a, size, glare);

    // Headlights: blazing toward you, a soft spill otherwise.
    const hI = 0.1 + 0.9 * Math.pow(Math.max(0, kHead), 3);
    for (const sgn of [-1, 1]) {
      const X = car.x + f[0] * hl + r[0] * sideW * sgn;
      const Z = car.z + f[1] * hl + r[1] * sideW * sgn;
      dyn(X, Z, hy, head, hI * 1.05, 0.2, 1.2);
    }
    // Tail lights, brighter when braking.
    const kTail = -kHead;
    const tI = (0.2 + 0.8 * Math.max(0, kTail)) * (0.5 + 0.5 * car.brake);
    for (const sgn of [-1, 1]) {
      const X = car.x - f[0] * hl + r[0] * (hw - 0.2) * sgn;
      const Z = car.z - f[1] * hl + r[1] * (hw - 0.2) * sgn;
      dyn(X, Z, ty, C.tail, tI, 0.16 + car.brake * 0.04, 0.7 + car.brake * 0.6);
    }
    // Indicator.
    if ((car.turn || car.arc !== undefined) && car.blink < 0.5 && !car.done) {
      for (const end of [1, -1]) {
        const X = car.x + f[0] * hl * end + r[0] * (hw - 0.05);
        const Z = car.z + f[1] * hl * end + r[1] * (hw - 0.05);
        dyn(X, Z, ty - 0.05, C.amber, 0.9, 0.13, 0.8);
      }
    }
    // Taxi roof sign, bus destination board.
    if (T.t === 'taxi') dyn(car.x, car.z, T.h + 0.45, [255, 226, 150], 0.4, 0.2, 0.4);
    if (T.t === 'bus' && kHead > 0) dyn(car.x + f[0] * hl, car.z + f[1] * hl, T.h - 0.35, C.amber, 0.7 * kHead, 0.45, 0.5);
    g.globalAlpha = 1;
  }

  function busWindows(g, car, f, r, hl, hw) {
    // The lit side the bus shows you.
    for (const sgn of [-1, 1]) {
      const nX = r[0] * sgn;
      const nZ = r[1] * sgn;
      const mX = car.x + nX * hw;
      const mZ = car.z + nZ * hw;
      if (nX * -mX + nZ * -mZ <= 0) continue;
      const pa = (t, Y) => project(mX + f[0] * hl * t, Y, mZ + f[1] * hl * t);
      const [ax, ay0] = pa(0.82, 1.35);
      const [, ay1] = pa(0.82, 2.55);
      const [bx, by0] = pa(-0.9, 1.35);
      const [, by1] = pa(-0.9, 2.55);
      quad(g, ax, ay0, ax, ay1, bx, by1, bx, by0);
      g.fillStyle = css(mixc(C.bus, M.haze, fogT(car.z) * 0.5), M === MOODS.light ? 0.4 : 0.85);
      g.fill();
    }
  }

  function drawSignals(g) {
    if (!signal) return;
    g.globalCompositeOperation = M.comp;
    const state = light.av;
    for (const s of signal) {
      const idx = state === 'r' ? 0 : state === 'y' ? 1 : 2;
      const cols = [C.sigR, C.sigY, C.sigG];
      for (let i = 0; i < 3; i++) {
        const on = i === idx;
        const R = Math.hypot(s.r, B * 0.8);
        const at = reach(s.z) * M.light;
        if (on) {
          g.globalAlpha = 0.5 * at;
          g.drawImage(glow(cols[i]), s.x - R * 4, s.y[i] - R * 4, R * 8, R * 8);
          g.globalAlpha = 0.95 * at;
          g.drawImage(disc(cols[i]), s.x - R, s.y[i] - R, R * 2, R * 2);
          // On the road below.
          const gy = cam.y(0, s.z);
          const len = (cam.y(-6, s.z) - gy) * 2.4;
          g.globalAlpha = 0.32 * at;
          g.drawImage(smear(cols[i]), s.x - R, gy - R, R * 2, len);
        } else if (M.comp === 'lighter') {
          g.globalAlpha = 0.06 * at;
          g.drawImage(disc(cols[i]), s.x - R, s.y[i] - R, R * 2, R * 2);
        }
      }
    }
    // The cross street's signals, glimpsed side-on.
    const cc = light.cr === 'g' ? C.sigG : light.cr === 'y' ? C.sigY : C.sigR;
    for (const s of signal.side) {
      const R = B * 0.9;
      g.globalAlpha = 0.28 * reach(s.z) * M.light;
      g.drawImage(glow(cc), s.x - R * 2.5, s.y - R * 2.5, R * 5, R * 5);
    }
    g.globalAlpha = 1;
  }

  function signLevel(s) {
    const t = time + s.phase * 10;
    if (s.mode === 'blink') return Math.sin(t * 2.2) > -0.2 ? 1 : 0.05;
    if (s.mode === 'flicker') {
      // A tired tube: mostly on, then a burst of stutter.
      const cycle = (t * 0.25) % 1;
      if (cycle < 0.1) return Math.random() < 0.45 ? 0.15 : 1;
      return 0.94 + 0.06 * Math.sin(t * 50);
    }
    return 0.92 + 0.08 * Math.sin(t * 3 + s.phase * 6);
  }

  function drawSigns(g) {
    g.globalCompositeOperation = M.comp;
    const A = M.light * M.signs;
    for (const s of signs) {
      const lv = signLevel(s) * A * reach(s.z);
      if (lv < 0.01) continue;
      const [minX, minY, maxX, maxY] = s.box;
      if (!onScreen(minX - 40, minY - 40, maxX + 40, maxY + 40)) continue;
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const rw = Math.max(maxX - minX, B * 2) * 1.3 + B * 2;
      const rh = Math.max(maxY - minY, B * 2) * 1.3 + B * 2;
      // Glow in the wet air around it.
      g.globalAlpha = 0.45 * lv;
      g.drawImage(glow(s.c), cx - rw, cy - rh, rw * 2, rh * 2);
      const sp = s.sprite;
      g.globalAlpha = Math.min(1, lv);
      g.drawImage(sp.c, sp.x, sp.y, sp.w, sp.h);
      // On the wet road.
      reflect(g, s.X, s.Y, s.z, s.c, lv * 0.8, Math.max(0.35, ((maxX - minX) * s.z) / cam.F / 2));
    }
    g.globalAlpha = 1;
  }

  function drawWindows(g, dt) {
    g.globalCompositeOperation = 'source-over';
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
        // Scene cuts: the brightness jumps now and then, and drifts in between.
        if (Math.random() < dt * 1.6) w.tvLevel = 0.35 + Math.random() * 0.6;
        w.tvShown = lerp(w.tvShown ?? 0.6, w.tvLevel ?? 0.6, Math.min(1, dt * 14));
        lv *= w.tvShown;
      }
      const sp = w.sprite;
      g.globalAlpha = lv * M.windowA;
      g.drawImage(sp.c, sp.x, sp.y, sp.w, sp.h);
    }
    g.globalAlpha = 1;
  }

  function drawBeacons(g) {
    g.globalCompositeOperation = M.comp;
    for (const b of beacons) {
      const t = (time * 0.5 + b.phase * 0.12) % 1;
      const on = t < 0.45 ? Math.sin((t / 0.45) * Math.PI) : 0;
      if (on <= 0.02) continue;
      const R = B * 0.7;
      g.globalAlpha = 0.6 * on * reach(b.z * 0.4) * Math.max(0.5, M.light);
      g.drawImage(glow(C.beacon), b.x - R * 3, b.y - R * 3, R * 6, R * 6);
      g.globalAlpha = 0.8 * on * reach(b.z * 0.4);
      g.drawImage(disc(C.beacon), b.x - R * 0.6, b.y - R * 0.6, R * 1.2, R * 1.2);
    }
    g.globalAlpha = 1;
  }

  function allCars() {
    const list = [];
    for (const l of lanes) for (const c of l.cars) list.push(c);
    for (const c of turning) list.push(c);
    return list;
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
    get glints() {
      return glints;
    },
    k,
    resize(w, h, d) {
      W = w;
      H = h;
      dpr = d;
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
    },
    // Everything that moves, over the painted city.
    draw(g, dt) {
      g.save();
      drawWindows(g, dt);
      drawBeacons(g);
      if (M.lamps && dyingLamp) {
        // Buzzes, goes out, comes back.
        const t = time % 11;
        const lv = t < 0.9 ? (Math.random() < 0.5 ? 0.1 : 0.9) : t < 2.2 ? 0.06 : t < 2.6 ? Math.random() : 1;
        g.globalCompositeOperation = M.comp;
        lamp(g, dyingLamp, lv);
      }
      drawSigns(g);
      drawSignals(g);

      const cars = allCars().sort((a, b) => b.z - a.z);
      // Reflections first: they're on the road, under the cars.
      g.globalCompositeOperation = M.comp;
      for (const car of cars) {
        if (car.z < 2.5 || car.fade < 0.05) continue;
        const f = [Math.sin(car.hd), Math.cos(car.hd)];
        const kHead = -(f[0] * car.x + f[1] * car.z) / (Math.hypot(car.x, car.z) || 1);
        const hl = car.len / 2;
        if (kHead > 0.2) {
          const I = Math.pow(kHead, 3) * car.fade;
          reflect(g, car.x + f[0] * hl, 0.7, car.z + f[1] * hl, car.led ? C.headLED : C.head, I * 1.2, 0.9);
          // The beam lighting the wet road ahead of it.
          const bz = car.z + f[1] * (hl + 7);
          const bx = car.x + f[0] * (hl + 7);
          if (bz > 2.5) {
            const sx = cam.x(bx, bz);
            const sy = cam.y(0, bz);
            const rw = (3.2 * cam.F) / bz;
            const rh = (1.1 * cam.F) / bz;
            g.globalAlpha = 0.16 * I * reach(bz) * M.light;
            g.drawImage(glow(car.led ? C.headLED : C.head), sx - rw, sy - rh, rw * 2, rh * 2);
          }
        } else if (kHead < -0.2) {
          const I = (0.4 + 0.6 * car.brake) * -kHead * car.fade;
          reflect(g, car.x - f[0] * hl, 0.9, car.z - f[1] * hl, C.tail, I * 0.8, 0.8);
        }
      }
      // Bodies, out of focus like the rest of the street.
      const bg = bodies.getContext('2d');
      bg.setTransform(1, 0, 0, 1, 0, 0);
      bg.globalCompositeOperation = 'source-over';
      bg.clearRect(0, 0, bodies.width, bodies.height);
      bg.setTransform(BS, 0, 0, BS, 0, -bodiesTop * BS);
      for (const car of cars) drawBody(bg, car);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.drawImage(bodies, 0, bodiesTop, W, H - bodiesTop);
      for (const car of cars) drawLights(g, car);
      g.restore();
    },
    // The quarter-size view the beads refract: the city, with the traffic as dots.
    drawSmall() {
      const g = small.getContext('2d');
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.drawImage(smallBase, 0, 0);
      g.globalCompositeOperation = M.comp;
      for (const l of lanes) {
        for (const car of l.cars) {
          if (car.z < 3 || car.z > 400 || car.fade < 0.1) continue;
          const f = [Math.sin(car.hd), Math.cos(car.hd)];
          const toward = -(f[0] * car.x + f[1] * car.z) > 0;
          const c = toward ? C.head : C.tail;
          const X = car.x + (toward ? 1 : -1) * f[0] * (car.len / 2);
          const Z = car.z + (toward ? 1 : -1) * f[1] * (car.len / 2);
          const sx = cam.x(X, Z) * k;
          const sy = cam.y(0.8, Z) * k;
          const R = Math.max(1.2, (Math.hypot((0.9 * cam.F) / Z, B) * k) | 0);
          g.globalAlpha = Math.min(1, 0.9 * reach(Z)) * M.light;
          g.drawImage(glow(c), sx - R * 1.6, sy - R * 1.6, R * 3.2, R * 3.2);
        }
      }
      g.globalAlpha = 1;
    },
    destroy() {
      release(sky);
      release(city);
      release(small);
      release(smallBase);
      release(bodies);
    },
  };
}
