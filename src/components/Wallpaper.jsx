import { useEffect, useRef } from 'react';
import { createRain } from '../rainScene.js';
import { createReef } from '../reefScene.js';
import SceneWorker from '../scene.worker.js?worker&inline';

/*
 * Animated wallpapers, each drawn on a canvas (in a worker where the browser allows):
 *   rain — rain on a window: sky, falling rain, fog and drops on the glass, lightning
 *          (fires `postit:lightning` so the rain sound can roll thunder in after it)
 *   reef — a coral reef: sunbeams and rippling light, three depths of coral, fish,
 *          seaweed, bubbles, jellyfish; glowing plankton at night
 * mood follows the appearance: 'light', 'dark' or 'night' (extra dark).
 */
const SCENES = { rain: createRain, reef: createReef };

export function Wallpaper({ kind, mood = 'light', lightning = true }) {
  if (!SCENES[kind]) return null;
  return <SceneWallpaper key={kind} kind={kind} mood={mood} lightning={lightning} />;
}

function SceneWallpaper({ kind, mood, lightning }) {
  const boxRef = useRef(null);
  const sceneRef = useRef(null);
  const initial = useRef({ mood, lightning });

  useEffect(() => {
    const scene = startScene(boxRef.current, kind, initial.current);
    sceneRef.current = scene;
    if (import.meta.env.DEV) window.__rainStrike = () => scene.call('strike');
    return () => scene.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sceneRef.current?.call('setMood', mood);
  }, [mood]);

  useEffect(() => {
    sceneRef.current?.call('setLightning', lightning);
  }, [lightning]);

  return <div ref={boxRef} className={`wallpaper wp-${kind}`} aria-hidden="true" />;
}

/*
 * Run the scene in a worker when the browser can hand a canvas to one, so it
 * never competes with scrolling; otherwise run it here.
 */
function startScene(box, kind, { mood, lightning }) {
  const view = () => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 });
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const onStrike = (distance) => window.dispatchEvent(new CustomEvent('postit:lightning', { detail: { distance } }));
  const state = { mood, lightning };
  let canvas = null;
  let call = () => {};
  let stop = () => {};

  const mount = () => {
    canvas?.remove();
    canvas = document.createElement('canvas');
    box.appendChild(canvas);
    return canvas;
  };
  const opts = () => {
    const v = view();
    return { mood: state.mood, lightning: state.lightning, reduced, width: v.w, height: v.h, dpr: v.dpr };
  };
  const onMainThread = () => {
    stop();
    const engine = SCENES[kind](mount(), { ...opts(), onStrike });
    call = (type, value) => engine[type]?.(value);
    stop = () => engine.destroy();
  };

  let worker = null;
  try {
    const c = mount();
    if (!c.transferControlToOffscreen || typeof Worker === 'undefined') throw new Error('no offscreen');
    worker = new SceneWorker();
    const off = c.transferControlToOffscreen();
    worker.onmessage = (e) => e.data?.type === 'strike' && onStrike(e.data.distance);
    worker.onerror = () => {
      // The worker couldn't start (e.g. blocked): draw on the page instead.
      worker?.terminate();
      worker = null;
      onMainThread();
    };
    worker.postMessage({ type: 'init', kind, canvas: off, opts: opts() }, [off]);
    call = (type, value) => worker?.postMessage({ type, value });
    stop = () => {
      worker?.terminate();
      worker = null;
    };
  } catch {
    worker?.terminate();
    worker = null;
    onMainThread();
  }

  let timer = 0;
  const onResize = () => {
    clearTimeout(timer);
    timer = setTimeout(() => call('resize', view()), 120);
  };
  const onVisible = () => document.visibilityState === 'visible' && call('visible');
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisible);

  return {
    call(type, value) {
      if (type === 'setMood') state.mood = value;
      if (type === 'setLightning') state.lightning = value;
      call(type, value);
    },
    destroy() {
      clearTimeout(timer);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisible);
      call('destroy');
      stop();
      canvas?.remove();
      canvas = null;
    },
  };
}
