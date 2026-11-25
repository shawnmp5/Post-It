/*
 * Rain sound, made in the browser with the Web Audio API (no audio files).
 *
 * Real rain isn't a hiss: it's thousands of separate little impacts with
 * uneven timing and loudness. So the sound is built from individual drops:
 *   - two "beds" of rendered rain (fine crackle, splashes and the odd bubble
 *     in a puddle). Their lengths differ, so the mix only repeats every few
 *     minutes, and every grain wraps around, so the loops have no seam.
 *   - heavier drops tapping on the window, scheduled live
 *   - a slow drip or two off a ledge, scheduled live
 *   - a low wash of heavy rain further off, swelling with gusts
 *   - a soft room reverb, so it sounds like outside rather than in your ear
 *   - thunder after each lightning flash (the wallpaper fires `postit:lightning`)
 */

const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

let ctx = null;
let master = null;
let parts = null;
let volume = 0.6;
let running = false;
let timer = 0;
let nextTap = 0;
let unlockArmed = false;
let stopTimer = 0;

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

// The tiniest drops: a sub-millisecond crackle, mostly high frequencies.
function sizzleGrain(sr) {
  const n = Math.max(8, Math.floor(sr * rand(0.0006, 0.0025)));
  const d = new Float32Array(n);
  const tau = rand(0.00025, 0.0009);
  let p1 = 0, p2 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    const hp = w - 2 * p1 + p2; // second difference: tilts toward the highs
    p2 = p1;
    p1 = w;
    const t = i / sr;
    d[i] = hp * Math.exp(-t / tau) * Math.min(1, t / 0.00008);
  }
  biquad(d, 'lowpass', rand(7000, 11000), 0.7, sr);
  return normalize(d);
}

// A drop hitting something hard (leaves, pavement, the sill): a short, pitched tick
// with a little low thud under it.
function tickGrain(sr) {
  const n = Math.floor(sr * 0.022);
  const d = new Float32Array(n);
  const body = new Float32Array(n);
  const tau = rand(0.0012, 0.0045);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.exp(-t / tau) * Math.min(1, t / 0.0002);
    d[i] = (Math.random() * 2 - 1) * env;
    body[i] = (Math.random() * 2 - 1) * Math.exp(-t / (tau * 2.2));
  }
  biquad(d, 'bandpass', rand(1400, 5200), rand(1.2, 3.5), sr);
  normalize(d);
  biquad(body, 'lowpass', rand(250, 700), 1.2, sr);
  normalize(body);
  const thud = rand(0.1, 0.45);
  for (let i = 0; i < n; i++) d[i] = d[i] + body[i] * thud;
  return normalize(d);
}

// A drop into a puddle: the tiny air bubble rings with a pitch that rises.
function bubbleGrain(sr) {
  const n = Math.floor(sr * 0.06);
  const d = new Float32Array(n);
  const f0 = rand(1100, 3000);
  const rise = rand(6, 16);
  const tau = rand(0.005, 0.016);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    phase += (TAU * f0 * (1 + rise * t)) / sr;
    d[i] = Math.sin(phase) * Math.exp(-t / tau) * Math.min(1, t / 0.0015);
  }
  // the splash before the bubble
  for (let i = 0; i < Math.min(n, sr * 0.004); i++) d[i] += (Math.random() * 2 - 1) * 0.35 * Math.exp(-i / sr / 0.001);
  return normalize(d);
}

// A big drop tapping the window glass: a crisp knock with a glassy ring.
function tapGrain(sr) {
  const n = Math.floor(sr * 0.06);
  const d = new Float32Array(n);
  const ring = new Float32Array(n);
  const f = rand(1800, 3600);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    d[i] = (Math.random() * 2 - 1) * Math.exp(-t / 0.0016) * Math.min(1, t / 0.0001);
    phase += (TAU * f) / sr;
    ring[i] = Math.sin(phase) * Math.exp(-t / rand(0.004, 0.009));
  }
  biquad(d, 'bandpass', rand(2200, 4200), 0.9, sr);
  normalize(d);
  const knock = new Float32Array(n);
  for (let i = 0; i < n; i++) knock[i] = (Math.random() * 2 - 1) * Math.exp(-i / sr / 0.004);
  biquad(knock, 'lowpass', rand(500, 900), 1, sr);
  normalize(knock);
  const r = rand(0.08, 0.22);
  for (let i = 0; i < n; i++) d[i] = d[i] + knock[i] * 0.55 + ring[i] * r;
  return normalize(d);
}

// A drip off a ledge into water: a rounder, lower "plop".
function dripGrain(sr, f0) {
  const n = Math.floor(sr * 0.12);
  const d = new Float32Array(n);
  const rise = rand(9, 14);
  const tau = rand(0.018, 0.03);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    phase += (TAU * f0 * (1 + rise * Math.min(t, 0.05))) / sr;
    d[i] = Math.sin(phase) * Math.exp(-t / tau) * Math.min(1, t / 0.002);
  }
  for (let i = 0; i < Math.min(n, sr * 0.003); i++) d[i] += (Math.random() * 2 - 1) * 0.25 * Math.exp(-i / sr / 0.0008);
  return normalize(d);
}

/* ------------------------------------------------------------------ */
/* Beds                                                                */

function renderBed(ctx, seconds, density) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  const bank = (make, count) => Array.from({ length: count }, () => make(sr));
  const sizzles = bank(sizzleGrain, 48);
  const ticks = bank(tickGrain, 40);
  const bubbles = bank(bubbleGrain, 24);

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
  scatter(sizzles, 1400 * density, 0.22, 2.2);
  scatter(ticks, 150 * density, 0.42, 2.8);
  scatter(bubbles, 7 * density, 0.2, 1.6);

  // Even out the level.
  let sum = 0;
  for (let i = 0; i < len; i++) sum += L[i] * L[i] + R[i] * R[i];
  const rms = Math.sqrt(sum / (2 * len)) || 1;
  const k = 0.11 / rms;
  const buf = ctx.createBuffer(2, len, sr);
  const outL = buf.getChannelData(0);
  const outR = buf.getChannelData(1);
  for (let i = 0; i < len; i++) {
    outL[i] = L[i] * k;
    outR[i] = R[i] * k;
  }
  return buf;
}

function noiseBuffer(ctx, seconds, color) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const extra = Math.floor(sr * 0.3);
  const buf = ctx.createBuffer(2, len, sr);
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
    const out = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) out[i] = d[i];
    for (let i = 0; i < extra; i++) {
      const t = i / extra;
      out[i] = d[i] * t + d[len + i] * (1 - t);
    }
  }
  return buf;
}

// A soft outdoor space: decaying noise that loses its highs as it fades.
function impulse(ctx, seconds) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const a = 0.5 - 0.46 * t; // darker as it decays
      lp += ((Math.random() * 2 - 1) - lp) * a;
      d[i] = lp * Math.pow(1 - t, 3.2) * (i < sr * 0.008 ? i / (sr * 0.008) : 1);
    }
  }
  return buf;
}

/* ------------------------------------------------------------------ */

function build() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const sr = ctx.sampleRate;
  master = ctx.createGain();
  master.gain.value = 0;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.ratio.value = 3;
  comp.attack.value = 0.008;
  comp.release.value = 0.35;
  // Rain on a window is soft up top: roll off the very highs.
  const air = ctx.createBiquadFilter();
  air.type = 'lowpass';
  air.frequency.value = 10500;
  air.Q.value = 0.5;
  master.connect(air).connect(comp).connect(ctx.destination);

  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx, 2.4);
  const verbGain = ctx.createGain();
  verbGain.gain.value = 0.55;
  verb.connect(verbGain).connect(master);
  const send = (node, amount) => {
    const g = ctx.createGain();
    g.gain.value = amount;
    node.connect(g).connect(verb);
  };

  // Overall tone: no rumble from the beds, no harsh top.
  const tone = ctx.createBiquadFilter();
  tone.type = 'highshelf';
  tone.frequency.value = 6000;
  tone.gain.value = -8;
  const beds = ctx.createGain();
  beds.gain.value = 1;
  beds.connect(tone).connect(master);
  send(tone, 0.18);

  for (const [secs, offset] of [
    [17, 0],
    [23, 0.4],
  ]) {
    const src = ctx.createBufferSource();
    src.buffer = renderBed(ctx, secs, 0.5);
    src.loop = true;
    src.connect(beds);
    src.start(0, offset * secs);
  }

  // Heavy rain further off: a soft, low wash that swells with gusts.
  const wash = ctx.createBufferSource();
  wash.buffer = noiseBuffer(ctx, 13, 'pink');
  wash.loop = true;
  const washLp = ctx.createBiquadFilter();
  washLp.type = 'lowpass';
  washLp.frequency.value = 1400;
  washLp.Q.value = 0.5;
  const washHp = ctx.createBiquadFilter();
  washHp.type = 'highpass';
  washHp.frequency.value = 180;
  const washGain = ctx.createGain();
  washGain.gain.value = 0.32;
  wash.connect(washHp).connect(washLp).connect(washGain).connect(master);

  const rumble = ctx.createBufferSource();
  rumble.buffer = noiseBuffer(ctx, 11, 'brown');
  rumble.loop = true;
  const rumbleLp = ctx.createBiquadFilter();
  rumbleLp.type = 'lowpass';
  rumbleLp.frequency.value = 320;
  const rumbleGain = ctx.createGain();
  rumbleGain.gain.value = 0.35;
  rumble.connect(rumbleLp).connect(rumbleGain).connect(master);

  // Gusts: slow, uneven swells (two LFOs that drift in and out of step).
  const gust = ctx.createGain();
  gust.gain.value = 1;
  for (const [hz, depth] of [
    [0.043, 0.16],
    [0.0171, 0.12],
  ]) {
    const osc = ctx.createOscillator();
    osc.frequency.value = hz;
    const g = ctx.createGain();
    g.gain.value = depth;
    osc.connect(g);
    g.connect(washGain.gain);
    g.connect(beds.gain);
    osc.start();
  }

  wash.start();
  rumble.start();

  const taps = Array.from({ length: 24 }, () => tapGrain(sr)).map((d) => toBuffer(ctx, d));
  const tapBus = ctx.createGain();
  tapBus.gain.value = 0.38;
  tapBus.connect(master);
  send(tapBus, 0.35);

  // One or two drips at fixed spots, each with its own pitch and pace.
  const drips = [
    { pan: rand(-0.75, -0.35), f: rand(750, 1050), every: rand(0.9, 1.4) },
    { pan: rand(0.4, 0.8), f: rand(1050, 1400), every: rand(1.5, 2.6) },
  ].map((d) => ({ ...d, bufs: Array.from({ length: 6 }, () => toBuffer(ctx, dripGrain(sr, d.f * rand(0.97, 1.03)))), next: 0 }));
  const dripBus = ctx.createGain();
  dripBus.gain.value = 0.22;
  dripBus.connect(master);
  send(dripBus, 0.7);

  const thunderBus = ctx.createGain();
  thunderBus.connect(master);
  send(thunderBus, 0.4);

  if (import.meta.env.DEV) window.__rainAudio = { ctx, master, out: comp };
  parts = { taps, tapBus, drips, dripBus, thunderBus, thunderNoise: noiseBuffer(ctx, 10, 'brown'), crackNoise: noiseBuffer(ctx, 1.5, 'pink') };
}

function toBuffer(ctx, d) {
  const buf = ctx.createBuffer(1, d.length, ctx.sampleRate);
  buf.getChannelData(0).set(d);
  return buf;
}

function play(buf, when, gain, pan, bus, rate = 1) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = gain;
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(g).connect(p).connect(bus);
  } else {
    src.connect(g).connect(bus);
  }
  src.start(when);
}

// Schedule a little ahead so taps and drips land on time.
function schedule() {
  if (!running || !ctx) return;
  const now = ctx.currentTime;
  const ahead = now + 0.3;
  if (nextTap < now) nextTap = now;
  while (nextTap < ahead) {
    nextTap += -Math.log(1 - Math.random()) / 5; // ~5 big drops a second, randomly spaced
    const a = Math.random();
    play(parts.taps[(Math.random() * parts.taps.length) | 0], nextTap, 0.08 + a * a * 0.6, rand(-0.9, 0.9), parts.tapBus, rand(0.85, 1.15));
  }
  for (const d of parts.drips) {
    if (d.next < now) d.next = now + rand(0, d.every);
    while (d.next < ahead) {
      play(d.bufs[(Math.random() * d.bufs.length) | 0], d.next, rand(0.6, 1), d.pan, parts.dripBus, rand(0.98, 1.02));
      d.next += d.every * rand(0.85, 1.2);
    }
  }
}

/* Thunder: an optional crack for close strikes, then a long rolling rumble. */
function thunder(distance = 0.5) {
  if (!running || !ctx || ctx.state !== 'running') return;
  const near = 1 - distance; // 1 = overhead
  const delay = 0.25 + distance * 2.6;
  const t0 = ctx.currentTime + delay;
  const dur = rand(5, 8.5);

  const src = ctx.createBufferSource();
  src.buffer = parts.thunderNoise;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.6;
  lp.frequency.setValueAtTime(320 + near * 900, t0);
  lp.frequency.exponentialRampToValueAtTime(90 + near * 60, t0 + dur);
  const g = ctx.createGain();
  g.gain.value = 0;
  // A rolling envelope: rises, then several swells as it dies away.
  const N = 240;
  const curve = new Float32Array(N);
  const attack = 0.03 + distance * 0.18;
  let wobble = 0.7;
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * dur;
    wobble += (rand(0.35, 1.15) - wobble) * 0.18;
    const rise = Math.min(1, t / (attack * dur));
    curve[i] = rise * Math.exp(-t / (dur * 0.32)) * wobble * (1.6 + near * 2.6);
  }
  curve[N - 1] = 0;
  g.gain.setValueCurveAtTime(curve, t0, dur);
  src.connect(lp).connect(g).connect(parts.thunderBus);
  src.start(t0, rand(0, 1.5), dur + 0.1);

  if (near > 0.55) {
    const crack = ctx.createBufferSource();
    crack.buffer = parts.crackNoise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = rand(900, 1800);
    bp.Q.value = 0.5;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0, t0);
    cg.gain.linearRampToValueAtTime(1.2 * near, t0 + 0.01);
    cg.gain.exponentialRampToValueAtTime(0.001, t0 + rand(0.35, 0.7));
    crack.connect(bp).connect(cg).connect(parts.thunderBus);
    crack.start(t0);
  }
}

function onLightning(e) {
  thunder(e.detail?.distance ?? 0.5);
}

// Browsers only let audio start after a click or key press.
function armUnlock() {
  if (unlockArmed) return;
  unlockArmed = true;
  const unlock = () => {
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
    unlockArmed = false;
    if (running && ctx) ctx.resume();
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

const level = () => Math.pow(volume, 1.6);

export function startRainSound() {
  clearTimeout(stopTimer);
  if (!window.AudioContext && !window.webkitAudioContext) return;
  if (!ctx) build();
  if (!running) {
    running = true;
    window.addEventListener('postit:lightning', onLightning);
    timer = setInterval(schedule, 100);
  }
  ctx.resume().catch(() => {});
  if (ctx.state !== 'running') armUnlock();
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(level(), now + 2);
}

export function stopRainSound() {
  if (!ctx || !running) return;
  running = false;
  clearInterval(timer);
  window.removeEventListener('postit:lightning', onLightning);
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(0, now + 0.6);
  stopTimer = setTimeout(() => ctx && !running && ctx.suspend(), 700);
}

export function setRainVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  if (!ctx || !running) return;
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(level(), now + 0.15);
}
