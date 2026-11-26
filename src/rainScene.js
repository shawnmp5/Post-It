/*
 * The rain scene: a soft sky, rain falling in three depths, fog and droplets
 * on the glass, beads that swell, run down and merge, and now and then
 * lightning. Plain canvas drawing with no page access, so it can run in a
 * worker (rainScene.worker.js) on an OffscreenCanvas and leave the page's own
 * thread free for scrolling, typing and dragging.
 *
 * createRain(canvas, { mood, lightning, reduced, width, height, dpr, onStrike })
 * mood: 'light' (overcast afternoon), 'dark' (evening), 'night' (deep night, moon behind cloud)
 * returns { resize({ w, h, dpr }), visible(), setMood(m), setLightning(b), strike(), destroy() }.
 */

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const ANGLE = 0.1; // wind: the rain leans this many radians

// Works on the main thread and in a worker.
function makeCanvas(w, h) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

const PALETTES = {
  dark: {
    sky: ['#06080c', '#0b1019', '#111a28', '#0a0d13'],
    glow: 'rgba(58, 84, 120, 0.32)',
    vignette: 'rgba(0, 0, 0, 0.55)',
    streak: [205, 220, 240],
    streakAlpha: 1,
    fog: '#93a3b9',
    fogOpacity: 0.3,
  },
  // Extra dark: deep night. Almost black, a moon somewhere behind the clouds,
  // dimmer cool rain and thinner fog.
  night: {
    sky: ['#010204', '#03060c', '#050a13', '#020307'],
    glow: 'rgba(22, 34, 58, 0.3)',
    moon: { x: 0.66, y: 0.2, halo: 'rgba(120, 142, 190, 0.24)', core: 'rgba(215, 225, 250, 0.36)' },
    vignette: 'rgba(0, 0, 0, 0.72)',
    streak: [190, 205, 235],
    streakAlpha: 0.78,
    fog: '#4d5a70',
    fogOpacity: 0.2,
  },
  light: {
    sky: ['#8f9cab', '#a9b5c3', '#c4ced9', '#b5c0cc'],
    glow: 'rgba(235, 240, 248, 0.45)',
    vignette: 'rgba(40, 52, 68, 0.28)',
    streak: [246, 249, 252],
    streakAlpha: 2.2,
    fog: '#f3f6fa',
    fogOpacity: 0.55,
  },
};

/* A water bead: shading only. The refracted (upside-down) world is drawn underneath. */
function makeDropSprite(dark) {
  const S = 96;
  const R = S / 2;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  g.save();
  g.beginPath();
  g.arc(R, R, R, 0, TAU);
  g.clip();

  // Body darkens toward the edge, like the curve of a lens.
  let grad = g.createRadialGradient(R, R * 0.92, 0, R, R, R);
  if (dark) {
    grad.addColorStop(0, 'rgba(255,255,255,0.03)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.16)');
    grad.addColorStop(0.88, 'rgba(0,0,0,0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0.62)');
  } else {
    grad.addColorStop(0, 'rgba(255,255,255,0.10)');
    grad.addColorStop(0.62, 'rgba(30,45,65,0.06)');
    grad.addColorStop(0.9, 'rgba(30,45,65,0.30)');
    grad.addColorStop(1, 'rgba(30,45,65,0.42)');
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);

  // Light gathered along the bottom edge.
  grad = g.createRadialGradient(R, R * 1.7, R * 0.2, R, R * 1.35, R * 1.05);
  grad.addColorStop(0, dark ? 'rgba(200,220,255,0.38)' : 'rgba(255,255,255,0.65)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  g.restore();

  // Fine rim, brighter underneath.
  const rim = g.createLinearGradient(0, 0, 0, S);
  rim.addColorStop(0, dark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.18)');
  rim.addColorStop(1, dark ? 'rgba(220,232,255,0.32)' : 'rgba(255,255,255,0.6)');
  g.strokeStyle = rim;
  g.lineWidth = S * 0.025;
  g.beginPath();
  g.arc(R, R, R - g.lineWidth / 2, 0, TAU);
  g.stroke();

  // Specular glint, top left.
  grad = g.createRadialGradient(R * 0.66, R * 0.58, 0, R * 0.66, R * 0.58, R * 0.26);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return c;
}

/* A falling streak: fades in from the top, brightest near its leading end. */
function makeStreakSprite() {
  const c = makeCanvas(4, 128);
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.75, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grad;
  g.fillRect(1, 0, 2, 128);
  g.globalAlpha = 0.35;
  g.fillRect(0, 0, 4, 128);
  return c;
}

/* The sky behind the glass. Drawn once per resize / theme change. */
function paintBackdrop(W, H, dpr, pal) {
  const c = makeCanvas(W * dpr, H * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);

  let grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, pal.sky[0]);
  grad.addColorStop(0.45, pal.sky[1]);
  grad.addColorStop(0.72, pal.sky[2]);
  grad.addColorStop(1, pal.sky[3]);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // Soft light through the low clouds.
  grad = g.createRadialGradient(W * 0.55, H * 0.78, 0, W * 0.55, H * 0.78, Math.max(W, H) * 0.7);
  grad.addColorStop(0, pal.glow);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // At night: the moon, blurred behind cloud — a wide cold halo and a soft core,
  // with a few darker cloud banks drifting across it.
  if (pal.moon) {
    const mx = W * pal.moon.x;
    const my = H * pal.moon.y;
    const R = Math.max(W, H);
    grad = g.createRadialGradient(mx, my, 0, mx, my, R * 0.55);
    grad.addColorStop(0, pal.moon.halo);
    grad.addColorStop(0.35, 'rgba(60, 75, 110, 0.06)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    grad = g.createRadialGradient(mx, my, 0, mx, my, R * 0.05);
    grad.addColorStop(0, pal.moon.core);
    grad.addColorStop(0.5, 'rgba(170, 185, 220, 0.12)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    for (const [cx, cy, rx, ry, a] of [
      [0.6, 0.18, 0.22, 0.035, 0.55],
      [0.74, 0.25, 0.2, 0.03, 0.5],
      [0.5, 0.28, 0.28, 0.045, 0.45],
      [0.7, 0.12, 0.18, 0.025, 0.4],
    ]) {
      g.save();
      g.translate(W * cx, H * cy);
      g.scale(1, (ry * H) / (rx * W));
      grad = g.createRadialGradient(0, 0, 0, 0, 0, rx * W);
      grad.addColorStop(0, `rgba(1, 2, 5, ${a})`);
      grad.addColorStop(1, 'rgba(1, 2, 5, 0)');
      g.fillStyle = grad;
      g.fillRect(-rx * W, -rx * W, rx * W * 2, rx * W * 2);
      g.restore();
    }
  }

  // Vignette.
  grad = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.45, Math.hypot(W, H) * 0.62);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, pal.vignette);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  return c;
}

/* Condensation: uneven, thicker toward the edges and the bottom of the glass. Low-res; it's soft anyway. */
const FOG_SCALE = 0.5;
function paintFog(W, H, pal) {
  const w = W * FOG_SCALE;
  const h = H * FOG_SCALE;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = pal.fog;
  g.globalAlpha = 0.78;
  g.fillRect(0, 0, w, h);
  g.globalAlpha = 1;
  const blot = (x, y, r, a) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(0,0,0,${a})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  // Thinner patches.
  g.globalCompositeOperation = 'destination-out';
  const n = Math.round((w * h) / 9000);
  for (let i = 0; i < n; i++) blot(rand(0, w), rand(0, h * 0.85), rand(30, 110), rand(0.15, 0.45));
  // Thicker patches, and thicker toward the edges and the bottom.
  g.globalCompositeOperation = 'source-over';
  const thick = (x, y, r, a) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, pal.fog);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = a;
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  for (let i = 0; i < n; i++) thick(rand(0, w), rand(0, h), rand(30, 120), rand(0.15, 0.4));
  g.globalAlpha = 1;
  let grad = g.createLinearGradient(0, h * 0.6, 0, h);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, pal.fog);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  grad = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.4, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, pal.fog);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  return c;
}

/* A jagged bolt with a few forks, drawn once per strike with its glow. */
// Painted at half size (it's a glow seen through rain and fog, so it needn't be sharp).
function paintBolt(W, H, x0) {
  const c = makeCanvas(W / 2, H / 2);
  const g = c.getContext('2d');
  g.scale(0.5, 0.5);
  const path = (x1, y1, x2, y2, rough) => {
    let pts = [[x1, y1], [x2, y2]];
    let d = rough;
    for (let k = 0; k < 7; k++) {
      const next = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1];
        const [bx, by] = pts[i];
        next.push([(ax + bx) / 2 + rand(-d, d), (ay + by) / 2 + rand(-d * 0.25, d * 0.25)]);
        next.push(pts[i]);
      }
      pts = next;
      d *= 0.55;
    }
    return pts;
  };
  const stroke = (pts, width, alpha) => {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts) g.lineTo(x, y);
    g.globalAlpha = alpha;
    g.lineWidth = width * 5;
    g.strokeStyle = 'rgba(170, 195, 255, 0.25)';
    g.shadowColor = 'rgba(170, 195, 255, 0.9)';
    g.shadowBlur = 30;
    g.stroke();
    g.shadowBlur = 8;
    g.lineWidth = width;
    g.strokeStyle = '#f4f7ff';
    g.stroke();
  };
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const endY = H * rand(0.55, 0.85);
  const main = path(x0, -10, x0 + rand(-W * 0.12, W * 0.12), endY, W * 0.06);
  stroke(main, 2.2, 1);
  const forks = 2 + Math.floor(Math.random() * 3);
  for (let f = 0; f < forks; f++) {
    const [sx, sy] = main[Math.floor(rand(0.15, 0.7) * main.length)];
    const len = rand(H * 0.12, H * 0.3);
    const dir = Math.random() < 0.5 ? -1 : 1;
    stroke(path(sx, sy, sx + dir * rand(len * 0.3, len * 0.8), sy + len, len * 0.12), 1.1, 0.6);
  }
  return c;
}

/* ------------------------------------------------------------------ */

export function createRain(canvas, opts) {
  // Opaque: the browser needn't blend the wallpaper with anything under it.
  const ctx = canvas.getContext('2d', { alpha: false });
  const reduced = !!opts.reduced;
  const nextFrame = self.requestAnimationFrame ? (f) => self.requestAnimationFrame(f) : (f) => setTimeout(() => f(performance.now()), 16);
  const cancelFrame = self.cancelAnimationFrame ? (id) => self.cancelAnimationFrame(id) : (id) => clearTimeout(id);
  let view = { w: opts.width, h: opts.height, dpr: opts.dpr || 1 };
  const streakSprite = makeStreakSprite();
  let mood = PALETTES[opts.mood] ? opts.mood : 'light';
  let dark = mood !== 'light';
  let pal = PALETTES[mood];
  let dropSprite = makeDropSprite(dark);

  let W = 0;
  let H = 0;
  let dpr = 1;
  let backdrop = null;
  let mist = null; // the glass: fog with the tiny droplets on top, one layer
  let mctx = null;
  let specks = []; // [x, y, r, alpha] for each tiny droplet on `mist`
  let fog = null; // condensation on the glass (low-res source for `mist`)
  // Resolution: start modest and step down if the machine can't keep up.
  let maxScale = 1;
  let slowFrames = 0;
  let sinceScale = 0;
  let beads = [];
  let streaks = [];
  let raf = 0;
  let last = 0;
  let alive = true;

  // Lightning.
  let lightningOn = !!opts.lightning && !reduced;
  let untilStrike = rand(5, 12);
  let strike = null; // { t, pulses, bolt, x, distance }

  const LAYERS = [
    { per: 2200, len: [16, 30], speed: [1050, 1300], w: 0.8, a: [0.07, 0.14] },
    { per: 5200, len: [34, 60], speed: [1600, 1950], w: 1, a: [0.1, 0.2] },
    { per: 16000, len: [80, 140], speed: [2500, 3000], w: 1.4, a: [0.12, 0.24] },
  ];

  function newStreak(L, anywhere) {
    const pad = H * Math.tan(ANGLE) + 60;
    return {
      L,
      x: rand(-pad, W + pad),
      y: anywhere ? rand(-H * 0.2, H) : rand(-H * 0.25, -20),
      len: rand(L.len[0], L.len[1]),
      v: rand(L.speed[0], L.speed[1]),
      a: rand(L.a[0], L.a[1]),
    };
  }

  function speck(x, y, r, alpha = rand(0.3, 0.7)) {
    specks.push([x, y, r, alpha]);
    mctx.globalAlpha = alpha;
    mctx.drawImage(dropSprite, x - r, y - r, r * 2, r * 2);
    mctx.globalAlpha = 1;
  }

  function paintFogInto(g) {
    g.save();
    g.globalAlpha = pal.fogOpacity;
    g.imageSmoothingEnabled = true;
    g.drawImage(fog, 0, 0, W, H);
    g.restore();
  }

  function redrawMist() {
    mctx.clearRect(0, 0, W, H);
    paintFogInto(mctx);
    for (const [x, y, r, a] of specks) {
      mctx.globalAlpha = a;
      mctx.drawImage(dropSprite, x - r, y - r, r * 2, r * 2);
    }
    mctx.globalAlpha = 1;
  }

  const maxSpecks = () => Math.round((W * H) / 900);
  const maxBeads = () => Math.round(Math.min(130, (W * H) / 12000));

  function newBead(x, y, r) {
    return {
      x: x ?? rand(0, W),
      y: y ?? rand(-10, H * 0.92),
      r: r ?? (Math.random() < 0.68 ? rand(2.6, 5.2) : rand(5.2, 9.2)),
      born: 0, // grow-in progress 0..1
      v: 0,
      sliding: false,
      drift: rand(-1, 1),
      trail: 0,
      gap: 12,
      seed: Math.random() * 1000,
      pause: 0,
    };
  }

  function seed() {
    specks = [];
    mctx.clearRect(0, 0, W, H);
    paintFogInto(mctx);
    const n = Math.round(maxSpecks() * 0.75);
    for (let i = 0; i < n; i++) speck(rand(0, W), rand(0, H), tinyR());
    beads = [];
    const b = Math.round(maxBeads() * 0.7);
    for (let i = 0; i < b; i++) {
      const d = newBead();
      d.born = 1;
      beads.push(d);
    }
    streaks = [];
    for (const L of LAYERS) {
      const count = Math.round((W * H) / L.per);
      for (let i = 0; i < count; i++) streaks.push(newStreak(L, true));
    }
  }

  function tinyR() {
    const t = Math.random();
    return 0.6 + t * t * 1.9;
  }

  function resize() {
    const nw = view.w;
    const nh = view.h;
    if (nw === W && nh === H && backdrop) return;
    W = nw;
    H = nh;
    release(fog);
    fog = paintFog(W, H, pal);
    setScale(Math.min(view.dpr, maxScale), true);
    if (reduced) draw(0);
  }

  // (Re)build every full-size canvas at a pixel density; keep the drops where they are.
  // Give a canvas's memory back now rather than whenever it's collected.
  const release = (c) => {
    if (c) c.width = c.height = 0;
  };

  function setScale(next, reseed) {
    dpr = next;
    release(backdrop);
    release(mist);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    backdrop = paintBackdrop(W, H, dpr, pal);
    mist = makeCanvas(W * dpr, H * dpr);
    mctx = mist.getContext('2d');
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reseed) seed();
    else redrawMist();
    sinceScale = 0;
    slowFrames = 0;
  }

  // Wipe the tiny droplets under a sliding bead (the fog under them stays).
  function wipe(x, y, r) {
    mctx.save();
    mctx.beginPath();
    mctx.arc(x, y, r, 0, TAU);
    mctx.clip();
    mctx.clearRect(x - r - 1, y - r - 1, r * 2 + 2, r * 2 + 2);
    mctx.globalAlpha = pal.fogOpacity;
    const k = fog.width / W;
    mctx.drawImage(fog, (x - r - 1) * k, (y - r - 1) * k, (r * 2 + 2) * k, (r * 2 + 2) * k, x - r - 1, y - r - 1, r * 2 + 2, r * 2 + 2);
    mctx.restore();
    const r2 = r * r;
    let j = 0;
    for (let i = 0; i < specks.length; i++) {
      const s = specks[i];
      const dx = s[0] - x;
      const dy = s[1] - y;
      if (dx * dx + dy * dy > r2) specks[j++] = s;
    }
    specks.length = j;
  }

  function startStrike() {
    const distance = Math.random();
    const amp = 1 - distance * 0.55;
    const pulses = [{ at: 0, amp, decay: 0.08 }];
    pulses.push({ at: rand(0.1, 0.18), amp: amp * rand(0.45, 0.85), decay: 0.11 });
    if (Math.random() < 0.5) pulses.push({ at: rand(0.32, 0.5), amp: amp * rand(0.3, 0.6), decay: 0.22 });
    const x = rand(W * 0.15, W * 0.85);
    strike = {
      t: 0,
      pulses,
      x,
      distance,
      bolt: distance < 0.6 ? paintBolt(W, H, x) : null,
      end: pulses[pulses.length - 1].at + 1.3,
    };
    opts.onStrike?.(distance);
  }

  function flash() {
    if (!strike) return 0;
    let v = 0;
    for (const p of strike.pulses) {
      const t = strike.t - p.at;
      if (t < 0) continue;
      v += p.amp * Math.min(1, t / 0.015) * Math.exp(-t / p.decay);
    }
    return Math.min(1, v);
  }

  function update(dt) {
    if (strike) {
      strike.t += dt;
      if (strike.t > strike.end) {
        release(strike.bolt);
        strike = null;
      }
    } else if (lightningOn) {
      untilStrike -= dt;
      if (untilStrike <= 0) {
        untilStrike = rand(14, 38);
        startStrike();
      }
    }

    // Rain outside.
    for (let i = 0; i < streaks.length; i++) {
      const s = streaks[i];
      s.y += s.v * dt;
      if (s.y - s.len > H / Math.cos(ANGLE) + 40) streaks[i] = newStreak(s.L, false);
    }

    // New mist settles on the glass.
    const room = 1 - specks.length / maxSpecks();
    if (room > 0) {
      const add = Math.random() < room * dt * 60 ? 1 + Math.floor(room * 3) : 0;
      for (let i = 0; i < add; i++) speck(rand(0, W), rand(0, H), tinyR());
    }

    // New beads land.
    if (beads.length < maxBeads() && Math.random() < dt * 10) beads.push(newBead());

    for (const b of beads) {
      if (b.born < 1) b.born = Math.min(1, b.born + dt * 3.2);
      if (!b.sliding) {
        b.r += dt * 0.05 * Math.random(); // slowly gathers water
        if (b.r > 5 && Math.random() < dt * (b.r - 4.6) * 0.28) {
          b.sliding = true;
          b.v = rand(20, 50);
        }
        continue;
      }
      // Sliding: heavier beads run faster; they hesitate and lurch like real ones.
      if (b.pause > 0) {
        b.pause -= dt;
        b.v *= 0.9;
      } else {
        const target = 60 + (b.r - 4) * 60;
        b.v += (target - b.v) * Math.min(1, dt * 2.5);
        if (Math.random() < dt * 0.45) b.pause = rand(0.1, 0.45);
      }
      const dy = b.v * dt;
      b.y += dy;
      b.x += Math.sin(b.seed + b.y * 0.045) * 0.22 * b.drift;
      wipe(b.x, b.y, b.r * 0.92);

      // Leave little beads behind, losing a bit of water.
      b.trail += dy;
      if (b.trail > b.gap) {
        b.trail = 0;
        b.gap = rand(8, 30);
        if (Math.random() < 0.6) {
          const tr = Math.min(b.r * rand(0.18, 0.34), 2.2);
          speck(b.x + rand(-1.4, 1.4), b.y - b.r * rand(1, 1.6), tr * rand(0.6, 1.2), rand(0.55, 0.95));
          b.r -= tr * 0.06;
        }
      }
      if (b.r < 3 && Math.random() < dt * 1.2) {
        b.sliding = false;
        b.v = 0;
      }
    }

    // Merge: a moving bead swallows the ones it runs into.
    for (let i = 0; i < beads.length; i++) {
      const a = beads[i];
      if (!a || a.dead || !a.sliding) continue;
      for (let j = 0; j < beads.length; j++) {
        const c = beads[j];
        if (i === j || c.dead) continue;
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        const rr = (a.r + c.r) * 0.85;
        if (dx * dx + dy * dy < rr * rr) {
          a.r = Math.min(12, Math.sqrt(a.r * a.r + c.r * c.r));
          a.v += 12;
          a.pause = 0;
          c.dead = true;
        }
      }
    }
    beads = beads.filter((b) => !b.dead && b.y - b.r < H + 10 && b.r > 1);
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(backdrop, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Lightning: the sky lights up from where it strikes, and a near bolt shows through.
    const I = flash();
    if (I > 0.003) {
      ctx.save();
      const grad = ctx.createRadialGradient(strike.x, 0, 0, strike.x, 0, Math.hypot(W, H));
      if (dark) {
        ctx.globalCompositeOperation = 'lighter';
        grad.addColorStop(0, `rgba(175, 195, 240, ${0.5 * I})`);
        grad.addColorStop(0.6, `rgba(120, 140, 190, ${0.2 * I})`);
        grad.addColorStop(1, `rgba(80, 95, 140, ${0.08 * I})`);
      } else {
        grad.addColorStop(0, `rgba(255, 255, 255, ${0.6 * I})`);
        grad.addColorStop(0.6, `rgba(240, 245, 255, ${0.3 * I})`);
        grad.addColorStop(1, `rgba(230, 236, 248, ${0.12 * I})`);
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      if (strike.bolt) {
        ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
        ctx.globalAlpha = Math.min(1, I * 1.4);
        ctx.drawImage(strike.bolt, 0, 0, W, H);
      }
      ctx.restore();
    }

    // Rain: everything shares one lean, so rotate once.
    ctx.save();
    ctx.translate(W / 2, 0);
    ctx.rotate(-ANGLE);
    ctx.translate(-W / 2, 0);
    ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
    for (const s of streaks) {
      ctx.globalAlpha = Math.min(1, s.a * pal.streakAlpha * (1 + I * 2.5));
      ctx.drawImage(streakSprite, s.x, s.y - s.len, s.L.w * 2, s.len);
    }
    ctx.restore();

    // The glass: fog and droplets, already combined in one layer.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(mist, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBeads();
  }

  function drawBeads() {
    const g = ctx;
    for (const b of beads) {
      const e = b.born < 1 ? easeOutBack(b.born) : 1;
      const r = b.r * e;
      if (r < 0.5) continue;
      const stretch = b.sliding ? 1 + Math.min(0.22, b.v / 400) : 1;
      const rx = r / Math.sqrt(stretch);
      const ry = r * stretch;
      // Refraction: a bead shows the world behind it, shrunk and upside down.
      // Too small to see on little beads, so they skip it.
      if (r >= 3.6) {
        const field = r * 5;
        g.save();
        g.beginPath();
        g.ellipse(b.x, b.y, rx, ry, 0, 0, TAU);
        g.clip();
        g.translate(b.x, b.y);
        g.scale(1, -1);
        g.drawImage(backdrop, (b.x - field) * dpr, (b.y - field) * dpr, field * 2 * dpr, field * 2 * dpr, -rx, -ry, rx * 2, ry * 2);
        g.restore();
      }
      g.drawImage(dropSprite, b.x - rx, b.y - ry, rx * 2, ry * 2);
    }
  }

  function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  let paused = false;

  function frame(now) {
    if (!alive || paused) return;
    const raw = last ? (now - last) / 1000 : 1 / 60;
    const dt = Math.min(0.05, raw);
    last = now;
    update(dt);
    draw();
    adapt(raw);
    raf = nextFrame(frame);
  }

  // If frames keep running long, drop the resolution a notch (never back up, so it can't flicker).
  function adapt(raw) {
    sinceScale += raw;
    if (sinceScale < 2 || raw > 0.25) return; // settle first; ignore hiccups like tab switches
    slowFrames = raw > 1 / 45 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
    if (slowFrames > 45 && dpr > 0.75) {
      maxScale = dpr > 1 ? 1 : 0.75;
      setScale(maxScale, false);
    }
  }

  resize();
  if (!reduced) raf = nextFrame(frame);

  return {
    resize(next) {
      view = next;
      resize();
    },
    visible() {
      last = 0; // don't jump after the tab was hidden
    },
    // Stop drawing completely while the tab is hidden.
    pause() {
      paused = true;
      cancelFrame(raf);
    },
    resume() {
      if (!paused) return;
      paused = false;
      last = 0;
      if (!reduced && alive) raf = nextFrame(frame);
    },
    setLightning(on) {
      lightningOn = !!on && !reduced;
      if (!lightningOn) strike = null;
    },
    strike() {
      if (!reduced) startStrike();
    },
    setMood(next) {
      if (!PALETTES[next] || next === mood) return;
      const wasDark = dark;
      mood = next;
      dark = mood !== 'light';
      pal = PALETTES[mood];
      if (dark !== wasDark) dropSprite = makeDropSprite(dark);
      backdrop = paintBackdrop(W, H, dpr, pal);
      fog = paintFog(W, H, pal);
      redrawMist();
      if (reduced) draw();
    },
    destroy() {
      alive = false;
      cancelFrame(raf);
    },
  };
}
