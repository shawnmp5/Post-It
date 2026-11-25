import { createRain } from './rainScene.js';
import { createReef } from './reefScene.js';

// Draws an animated wallpaper (rain or coral reef) on a canvas handed over from the page.
const SCENES = { rain: createRain, reef: createReef };
let engine = null;
self.onmessage = ({ data }) => {
  if (data.type === 'init') {
    const create = SCENES[data.kind] || createRain;
    engine = create(data.canvas, {
      ...data.opts,
      onStrike: (distance) => self.postMessage({ type: 'strike', distance }),
    });
  } else if (engine) {
    engine[data.type]?.(data.value);
    if (data.type === 'destroy') engine = null;
  }
};
