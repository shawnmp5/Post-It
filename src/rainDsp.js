/*
 * The number-crunching half of the rain sound: every drop, the rain beds, the
 * noise loops and the reverb's space, as plain sample arrays. It runs in a
 * worker (rainSounds.worker.js) so making the sound never stalls the page.
 */

const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ */
/* Small DSP helpers                                                   */

function normalize(d) {
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) for (let i = 0; i < d.length; i++) d[i] /= peak;
  return d;
}

// RBJ biquad, run in place.
function biquad(d, type, f, Q, sr) {
  const w0 = (TAU * f) / sr;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q);
  let b0, b1, b2;
  if (type === 'bandpass') {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
  } else if (type === 'lowpass') {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = (1 - cos) / 2;
  } else {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
  }
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < d.length; i++) {
    const x = d[i];
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    d[i] = y;
  }
  return d;
}

/* ------------------------------------------------------------------ */
/* Grains: one drop each                                               */

// The small drops: a soft little "tss", dense enough to blend into a patter.
function patterGrain(sr) {
  const n = Math.max(16, Math.floor(sr * rand(0.003, 0.008)));
  const d = new Float32Array(n);
  const tau = rand(0.0006, 0.0018);
  let p1 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    const hp = w - p1; // gentle tilt toward the highs
    p1 = w;
    const t = i / sr;
    d[i] = hp * Math.exp(-t / tau) * Math.min(1, t / 0.0004);
  }
  biquad(d, 'lowpass', rand(3200, 6000), 0.6, sr);
  biquad(d, 'highpass', 400, 0.6, sr);
  return normalize(d);
}

// A drop hitting something hard (leaves, pavement, the sill): a short, pitched tick
// with a little low thud under it.
function tickGrain(sr) {
  const n = Math.floor(sr * 0.022);
  const d = new Float32Array(n);
  const body = new Float32Array(n);
  const tau = rand(0.0016, 0.005);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.exp(-t / tau) * Math.min(1, t / 0.0005);
    d[i] = (Math.random() * 2 - 1) * env;
    body[i] = (Math.random() * 2 - 1) * Math.exp(-t / (tau * 2.2));
  }
  biquad(d, 'bandpass', rand(900, 3400), rand(0.7, 1.6), sr);
  normalize(d);
  biquad(body, 'lowpass', rand(250, 700), 1.2, sr);
  normalize(body);
  const thud = rand(0.1, 0.45);
  for (let i = 0; i < n; i++) d[i] = d[i] + body[i] * thud;
  return normalize(d);
}

// A big drop landing on the window: a soft, dull knock.
function tapGrain(sr) {
  const n = Math.floor(sr * 0.04);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    d[i] = (Math.random() * 2 - 1) * Math.exp(-t / 0.002) * Math.min(1, t / 0.0004);
  }
  biquad(d, 'bandpass', rand(1200, 2600), 0.8, sr);
  normalize(d);
  const knock = new Float32Array(n);
  for (let i = 0; i < n; i++) knock[i] = (Math.random() * 2 - 1) * Math.exp(-i / sr / 0.004);
  biquad(knock, 'lowpass', rand(500, 900), 1, sr);
  normalize(knock);
  for (let i = 0; i < n; i++) d[i] = d[i] + knock[i] * 0.6;
  return normalize(d);
}

/* ------------------------------------------------------------------ */
/* Beds                                                                */

function renderBed(sr, seconds, density) {
  const len = Math.floor(sr * seconds);
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  const bank = (make, count) => Array.from({ length: count }, () => make(sr));
  const patter = bank(patterGrain, 48);
  const ticks = bank(tickGrain, 40);

  const scatter = (grains, perSecond, loud, curve) => {
    const total = Math.round(perSecond * seconds);
    for (let k = 0; k < total; k++) {
      const g = grains[(Math.random() * grains.length) | 0];
      const start = (Math.random() * len) | 0;
      const amp = loud * Math.pow(Math.random(), curve); // many soft, a few loud
      const pan = rand(-1, 1);
      const gl = amp * Math.cos(((pan + 1) * Math.PI) / 4);
      const gr = amp * Math.sin(((pan + 1) * Math.PI) / 4);
      for (let i = 0; i < g.length; i++) {
        const idx = (start + i) % len; // wrap: a seamless loop
        L[idx] += g[i] * gl;
        R[idx] += g[i] * gr;
      }
    }
  };
  scatter(patter, 1900 * density, 0.22, 1.8);
  scatter(ticks, 170 * density, 0.32, 2.4);

  // Even out the level.
  let sum = 0;
  for (let i = 0; i < len; i++) sum += L[i] * L[i] + R[i] * R[i];
  const rms = Math.sqrt(sum / (2 * len)) || 1;
  const k = 0.11 / rms;
  for (let i = 0; i < len; i++) {
    L[i] *= k;
    R[i] *= k;
  }
  return [L, R];
}

function noise(sr, seconds, color) {
  const len = Math.floor(sr * seconds);
  const extra = Math.floor(sr * 0.3);
  const chans = [];
  for (let ch = 0; ch < 2; ch++) {
    const d = new Float32Array(len + extra);
    let last = 0;
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (color === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else {
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.05;
      }
    }
    // Seamless loop: the extra tail fades into the head.
    const out = new Float32Array(len);
    chans.push(out);
    for (let i = 0; i < len; i++) out[i] = d[i];
    for (let i = 0; i < extra; i++) {
      const t = i / extra;
      out[i] = d[i] * t + d[len + i] * (1 - t);
    }
  }
  return chans;
}

// A soft outdoor space: decaying noise that loses its highs as it fades.
function impulse(sr, seconds) {
  const len = Math.floor(sr * seconds);
  const chans = [];
  for (let ch = 0; ch < 2; ch++) {
    const d = new Float32Array(len);
    chans.push(d);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const a = 0.5 - 0.46 * t; // darker as it decays
      lp += ((Math.random() * 2 - 1) - lp) * a;
      d[i] = lp * Math.pow(1 - t, 3.2) * (i < sr * 0.008 ? i / (sr * 0.008) : 1);
    }
  }
  return chans;
}

/* Everything the rain sound needs, as plain arrays (all transferable). */
export function makeRainSounds(sr) {
  return {
    beds: [renderBed(sr, 17, 0.5), renderBed(sr, 23, 0.5)],
    wash: noise(sr, 13, 'pink'),
    rumble: noise(sr, 11, 'brown'),
    thunder: noise(sr, 10, 'brown'),
    crack: noise(sr, 1.5, 'pink'),
    verb: impulse(sr, 2.4),
    taps: Array.from({ length: 24 }, () => tapGrain(sr)),
  };
}

export function transferables(sounds) {
  const out = [];
  const walk = (v) => {
    if (v instanceof Float32Array) out.push(v.buffer);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(sounds);
  return out;
}
