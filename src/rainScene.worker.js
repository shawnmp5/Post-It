import { createRain } from './rainScene.js';

// Draws the rain wallpaper on a canvas handed over from the page.
let engine = null;
self.onmessage = ({ data }) => {
  if (data.type === 'init') {
    engine = createRain(data.canvas, {
      ...data.opts,
      onStrike: (distance) => self.postMessage({ type: 'strike', distance }),
    });
  } else if (engine) {
    engine[data.type]?.(data.value);
    if (data.type === 'destroy') engine = null;
  }
};
