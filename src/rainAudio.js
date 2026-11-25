/*
 * Rain sound, made in the browser with the Web Audio API (no audio files).
 *
 * Real rain isn't a hiss: it's thousands of separate little impacts with
 * uneven timing and loudness. So the sound is built from individual drops:
 *   - two "beds" of rendered rain (a soft, dense patter and splashes). Their
 *     lengths differ, so the mix only repeats every few minutes, and every
 *     grain wraps around, so the loops have no seam.
 *   - a few heavier drops knocking on the window, scheduled live
 *   - a low wash of heavy rain further off, swelling with gusts
 *   - a soft room reverb, so it sounds like outside rather than in your ear
 *   - thunder after each lightning flash (the wallpaper fires `postit:lightning`)
 */

import { makeRainSounds } from './rainDsp.js';
import RainSoundsWorker from './rainSounds.worker.js?worker&inline';

const rand = (a, b) => a + Math.random() * (b - a);

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

// The samples take a moment to make, so they're made in a worker; the mix is
// wired up as soon as they arrive (the volume is still fading in by then).
function loadSounds(sampleRate) {
  return new Promise((resolve) => {
    try {
      const worker = new RainSoundsWorker();
      worker.onmessage = (e) => {
        resolve(e.data);
        worker.terminate();
      };
      worker.onerror = () => {
        worker.terminate();
        resolve(makeRainSounds(sampleRate));
      };
      worker.postMessage({ sampleRate });
    } catch {
      resolve(makeRainSounds(sampleRate));
    }
  });
}

function stereo([L, R]) {
  const buf = ctx.createBuffer(2, L.length, ctx.sampleRate);
  buf.getChannelData(0).set(L);
  buf.getChannelData(1).set(R);
  return buf;
}

function build() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
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
  air.frequency.value = 8000;
  air.Q.value = 0.5;
  master.connect(air).connect(comp).connect(ctx.destination);

  const verb = ctx.createConvolver();
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

  // Heavy rain further off: a soft, low wash that swells with gusts.
  const washLp = ctx.createBiquadFilter();
  washLp.type = 'lowpass';
  washLp.frequency.value = 2200;
  washLp.Q.value = 0.5;
  const washHp = ctx.createBiquadFilter();
  washHp.type = 'highpass';
  washHp.frequency.value = 180;
  const washGain = ctx.createGain();
  washGain.gain.value = 0.4;
  washHp.connect(washLp).connect(washGain).connect(master);

  const rumbleLp = ctx.createBiquadFilter();
  rumbleLp.type = 'lowpass';
  rumbleLp.frequency.value = 320;
  const rumbleGain = ctx.createGain();
  rumbleGain.gain.value = 0.35;
  rumbleLp.connect(rumbleGain).connect(master);

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

  const tapBus = ctx.createGain();
  tapBus.gain.value = 0.3;
  tapBus.connect(master);
  send(tapBus, 0.35);

  const thunderBus = ctx.createGain();
  thunderBus.connect(master);
  send(thunderBus, 0.4);

  if (import.meta.env.DEV) window.__rainAudio = { ctx, master, out: comp };
  const bus = { tapBus, thunderBus };

  loadSounds(ctx.sampleRate).then((s) => {
    verb.buffer = stereo(s.verb);
    const loop = (data, into, offset = 0) => {
      const src = ctx.createBufferSource();
      src.buffer = stereo(data);
      src.loop = true;
      src.connect(into);
      src.start(0, offset * src.buffer.duration);
    };
    loop(s.beds[0], beds);
    loop(s.beds[1], beds, 0.4);
    loop(s.wash, washHp);
    loop(s.rumble, rumbleLp);
    parts = {
      ...bus,
      taps: s.taps.map((d) => toBuffer(ctx, d)),
      thunderNoise: stereo(s.thunder),
      crackNoise: stereo(s.crack),
    };
  });
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

// Schedule a little ahead so the taps land on time.
function schedule() {
  if (!running || !ctx || !parts) return;
  const now = ctx.currentTime;
  const ahead = now + 0.3;
  if (nextTap < now) nextTap = now;
  while (nextTap < ahead) {
    nextTap += -Math.log(1 - Math.random()) / 3; // ~3 big drops a second, randomly spaced
    const a = Math.random();
    play(parts.taps[(Math.random() * parts.taps.length) | 0], nextTap, 0.06 + a * a * 0.4, rand(-0.9, 0.9), parts.tapBus, rand(0.85, 1.15));
  }
}

/* Thunder: an optional crack for close strikes, then a long rolling rumble. */
function thunder(distance = 0.5) {
  if (!running || !ctx || !parts || ctx.state !== 'running') return;
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
