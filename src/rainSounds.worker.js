import { makeRainSounds, transferables } from './rainDsp.js';

// Make the rain sound off the main thread and hand the samples back.
self.onmessage = (e) => {
  const sounds = makeRainSounds(e.data.sampleRate, e.data.verbRate);
  self.postMessage(sounds, transferables(sounds));
};
