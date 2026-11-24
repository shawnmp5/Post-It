/*
 * Rain sound, made live with the Web Audio API (no audio files, never loops):
 *   - a soft, wide hiss of rain
 *   - a low body of heavy rain further away, swelling with gusts
 *   - drops tapping on the window, placed left to right
 *   - thunder after each lightning flash (the wallpaper fires `postit:lightning`)
 */

const rand = (a, b) => a + Math.random() * (b - a);

let ctx = null;
let master = null;
let parts = null;
let volume = 0.6;
let running = false;
let dropTimer = 0;
let nextDrop = 0;
let unlockArmed = false;
let stopTimer = 0;

function pinkNoise(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const extra = Math.floor(ctx.sampleRate * 0.25);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = new Float32Array(len + extra);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    loopInto(d, len, buf.getChannelData(ch));
  }
  return buf;
}

function brownNoise(ctx, seconds, channels = 2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const extra = Math.floor(ctx.sampleRate * 0.25);
  const buf = ctx.createBuffer(channels, len, ctx.sampleRate);
  for (let ch = 0; ch < channels; ch++) {
    const d = new Float32Array(len + extra);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    loopInto(d, len, buf.getChannelData(ch));
  }
  return buf;
}

// Make a seamless loop: the extra samples past `len` fade into the start.
function loopInto(d, len, out) {
  const n = d.length - len;
  for (let i = 0; i < len; i++) out[i] = d[i];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out[i] = d[i] * t + d[len + i] * (1 - t);
  }
}

/* One raindrop on glass: a tiny click of noise and a short, falling "plip". */
function makeDrop(ctx) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 0.07);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const f = rand(1100, 3400);
  const clickDecay = rand(0.002, 0.006);
  const toneDecay = rand(0.006, 0.022);
  const tone = rand(0.1, 0.45);
  let lp = 0;
  let phase = 0;
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const n = Math.random() * 2 - 1;
    lp += (n - lp) * 0.35;
    const click = (n - lp) * Math.exp(-t / clickDecay);
    phase += (2 * Math.PI * f * (1 - t * 3)) / sr;
    const plip = Math.sin(phase) * Math.exp(-t / toneDecay) * tone;
    const attack = Math.min(1, t / 0.0006);
    d[i] = (click + plip) * attack;
    peak = Math.max(peak, Math.abs(d[i]));
  }
  for (let i = 0; i < len; i++) d[i] /= peak || 1;
  return buf;
}

function build() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0;
  // Gentle glue so thunder and drops never clip.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 3;
  comp.attack.value = 0.01;
  comp.release.value = 0.3;
  master.connect(comp).connect(ctx.destination);

  // Hiss.
  const hiss = ctx.createBufferSource();
  hiss.buffer = pinkNoise(ctx, 9);
  hiss.loop = true;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 350;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 7500;
  const hissGain = ctx.createGain();
  hissGain.gain.value = 0.75;
  hiss.connect(hp).connect(lp).connect(hissGain).connect(master);

  // Body: heavy rain further off.
  const body = ctx.createBufferSource();
  body.buffer = brownNoise(ctx, 11);
  body.loop = true;
  const bodyLp = ctx.createBiquadFilter();
  bodyLp.type = 'lowpass';
  bodyLp.frequency.value = 650;
  const bodyGain = ctx.createGain();
  bodyGain.gain.value = 1.0;
  body.connect(bodyLp).connect(bodyGain).connect(master);

  // Gusts: very slow swells on both layers.
  const gust = ctx.createOscillator();
  gust.frequency.value = 0.045;
  const gustDepth = ctx.createGain();
  gustDepth.gain.value = 0.2;
  gust.connect(gustDepth);
  gustDepth.connect(hissGain.gain);
  gustDepth.connect(bodyGain.gain);
  const gust2 = ctx.createOscillator();
  gust2.frequency.value = 0.017;
  const gust2Depth = ctx.createGain();
  gust2Depth.gain.value = 0.14;
  gust2.connect(gust2Depth).connect(hissGain.gain);

  hiss.start();
  body.start();
  gust.start();
  gust2.start();

  const drops = Array.from({ length: 28 }, () => makeDrop(ctx));
  const dropBus = ctx.createGain();
  dropBus.gain.value = 0.8;
  dropBus.connect(master);

  if (import.meta.env.DEV) window.__rainAudio = { ctx, master };
  parts = { drops, dropBus, thunderNoise: brownNoise(ctx, 10, 2), crackNoise: pinkNoise(ctx, 1.5) };
}

// Schedule drops a little ahead of time so they land evenly.
function scheduleDrops() {
  if (!running || !ctx) return;
  const ahead = ctx.currentTime + 0.25;
  if (nextDrop < ctx.currentTime) nextDrop = ctx.currentTime;
  while (nextDrop < ahead) {
    nextDrop += -Math.log(1 - Math.random()) / 26; // ~26 drops a second, randomly spaced
    playDrop(nextDrop);
  }
}

function playDrop(when) {
  const src = ctx.createBufferSource();
  src.buffer = parts.drops[(Math.random() * parts.drops.length) | 0];
  src.playbackRate.value = rand(0.75, 1.3);
  const g = ctx.createGain();
  const a = Math.random();
  g.gain.value = 0.04 + a * a * a * 0.55; // mostly soft, a few close and crisp
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (pan) {
    pan.pan.value = rand(-0.85, 0.85);
    src.connect(g).connect(pan).connect(parts.dropBus);
  } else {
    src.connect(g).connect(parts.dropBus);
  }
  src.start(when);
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
  src.connect(lp).connect(g).connect(master);
  src.start(t0, rand(0, 1.5), dur + 0.1);

  if (near > 0.55) {
    const crack = ctx.createBufferSource();
    crack.buffer = parts.crackNoise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = rand(900, 1800);
    hp.Q.value = 0.5;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0, t0);
    cg.gain.linearRampToValueAtTime(1.2 * near, t0 + 0.01);
    cg.gain.exponentialRampToValueAtTime(0.001, t0 + rand(0.35, 0.7));
    crack.connect(hp).connect(cg).connect(master);
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
    dropTimer = setInterval(scheduleDrops, 100);
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
  clearInterval(dropTimer);
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
