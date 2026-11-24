import { useEffect, useRef } from 'react';

/*
 * Animated wallpapers. Only one for now: rain on a window.
 *
 * The scene is drawn in four layers on a single canvas:
 *   1. a soft night sky (or an overcast afternoon in light mode)
 *   2. rain falling outside, in three depths
 *   3. a mist of tiny droplets stuck to the glass
 *   4. bigger beads that swell, slide down, merge and wipe a clear trail
 */
export function Wallpaper({ kind, dark }) {
  if (kind !== 'rain') return null;
  return <RainWallpaper dark={dark} />;
}

function RainWallpaper({ dark }) {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);

  useEffect(() => {
    const engine = createRain(canvasRef.current, { dark });
    engineRef.current = engine;
    return () => engine.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setDark(dark);
  }, [dark]);

  return <canvas ref={canvasRef} className="wallpaper wp-rain" aria-hidden="true" />;
}

/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const ANGLE = 0.1; // wind: the rain leans this many radians

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
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
  },
  light: {
    sky: ['#8f9cab', '#a9b5c3', '#c4ced9', '#b5c0cc'],
    glow: 'rgba(235, 240, 248, 0.45)',
    vignette: 'rgba(40, 52, 68, 0.28)',
    streak: [246, 249, 252],
    streakAlpha: 1.25,
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

  // Vignette.
  grad = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.45, Math.hypot(W, H) * 0.62);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, pal.vignette);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // Grain keeps the dark gradients from banding.
  const n = makeCanvas(128, 128);
  const ng = n.getContext('2d');
  const img = ng.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 10;
  }
  ng.putImageData(img, 0, 0);
  g.fillStyle = g.createPattern(n, 'repeat');
  g.fillRect(0, 0, W, H);
  return c;
}

/* ------------------------------------------------------------------ */

function createRain(canvas, opts) {
  const ctx = canvas.getContext('2d');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const streakSprite = makeStreakSprite();
  let dark = !!opts.dark;
  let pal = dark ? PALETTES.dark : PALETTES.light;
  let dropSprite = makeDropSprite(dark);

  let W = 0;
  let H = 0;
  let dpr = 1;
  let backdrop = null;
  let mist = null; // canvas holding the tiny droplets stuck to the glass
  let mctx = null;
  let specks = []; // [x, y, r] for each tiny droplet on `mist`
  let beads = [];
  let streaks = [];
  let raf = 0;
  let last = 0;
  let alive = true;

  const LAYERS = [
    { per: 5000, len: [8, 18], speed: [520, 680], w: 0.8, a: [0.07, 0.14] },
    { per: 12000, len: [18, 34], speed: [820, 1050], w: 1, a: [0.1, 0.2] },
    { per: 45000, len: [44, 80], speed: [1350, 1700], w: 1.4, a: [0.12, 0.22] },
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

  function redrawMist() {
    mctx.clearRect(0, 0, W, H);
    for (const [x, y, r, a] of specks) {
      mctx.globalAlpha = a;
      mctx.drawImage(dropSprite, x - r, y - r, r * 2, r * 2);
    }
    mctx.globalAlpha = 1;
  }

  const maxSpecks = () => Math.round((W * H) / 900);
  const maxBeads = () => Math.round(Math.min(110, (W * H) / 15000));

  function newBead(x, y, r) {
    return {
      x: x ?? rand(0, W),
      y: y ?? rand(-10, H * 0.92),
      r: r ?? (Math.random() < 0.75 ? rand(2.6, 5.2) : rand(5.2, 8.8)),
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
    const nw = window.innerWidth;
    const nh = window.innerHeight;
    if (nw === W && nh === H && backdrop) return;
    W = nw;
    H = nh;
    dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    backdrop = paintBackdrop(W, H, dpr, pal);
    mist = makeCanvas(W * dpr, H * dpr);
    mctx = mist.getContext('2d');
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
    if (reduced) draw(0);
  }

  // Wipe the mist under a sliding bead.
  function wipe(x, y, r) {
    mctx.save();
    mctx.globalCompositeOperation = 'destination-out';
    mctx.beginPath();
    mctx.arc(x, y, r, 0, TAU);
    mctx.fill();
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

  function update(dt) {
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
    if (beads.length < maxBeads() && Math.random() < dt * 6) beads.push(newBead());

    for (const b of beads) {
      if (b.born < 1) b.born = Math.min(1, b.born + dt * 3.2);
      if (!b.sliding) {
        b.r += dt * 0.05 * Math.random(); // slowly gathers water
        if (b.r > 6.2 && Math.random() < dt * (b.r - 5.8) * 0.1) {
          b.sliding = true;
          b.v = rand(10, 30);
        }
        continue;
      }
      // Sliding: heavier beads run faster; they hesitate and lurch like real ones.
      if (b.pause > 0) {
        b.pause -= dt;
        b.v *= 0.9;
      } else {
        const target = 30 + (b.r - 4) * 34;
        b.v += (target - b.v) * Math.min(1, dt * 2.5);
        if (Math.random() < dt * 0.5) b.pause = rand(0.15, 0.6);
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
      if (b.r < 3.2 && Math.random() < dt * 1.5) {
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

    // Rain: everything shares one lean, so rotate once.
    ctx.save();
    ctx.translate(W / 2, 0);
    ctx.rotate(-ANGLE);
    ctx.translate(-W / 2, 0);
    ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
    for (const s of streaks) {
      ctx.globalAlpha = Math.min(1, s.a * pal.streakAlpha);
      ctx.drawImage(streakSprite, s.x, s.y - s.len, s.L.w * 2, s.len);
    }
    ctx.restore();

    // The glass.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(mist, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    for (const b of beads) {
      const e = b.born < 1 ? easeOutBack(b.born) : 1;
      const r = b.r * e;
      if (r < 0.5) continue;
      const stretch = b.sliding ? 1 + Math.min(0.22, b.v / 400) : 1;
      const rx = r / Math.sqrt(stretch);
      const ry = r * stretch;
      // Refraction: a bead shows the world behind it, shrunk and upside down.
      const field = r * 5;
      const sx = (b.x - field) * dpr;
      const sy = (b.y - field) * dpr;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, rx, ry, 0, 0, TAU);
      ctx.clip();
      ctx.translate(b.x, b.y);
      ctx.scale(1, -1);
      ctx.drawImage(backdrop, sx, sy, field * 2 * dpr, field * 2 * dpr, -rx, -ry, rx * 2, ry * 2);
      ctx.restore();
      ctx.drawImage(dropSprite, b.x - rx, b.y - ry, rx * 2, ry * 2);
    }
  }

  function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function frame(now) {
    if (!alive) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    update(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }

  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  };
  const onVisible = () => {
    last = 0; // don't jump after the tab was hidden
  };

  resize();
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisible);
  if (!reduced) raf = requestAnimationFrame(frame);

  return {
    setDark(next) {
      if (!!next === dark) return;
      dark = !!next;
      pal = dark ? PALETTES.dark : PALETTES.light;
      dropSprite = makeDropSprite(dark);
      backdrop = paintBackdrop(W, H, dpr, pal);
      redrawMist();
      if (reduced) draw();
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisible);
    },
  };
}
