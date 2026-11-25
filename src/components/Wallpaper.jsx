import { useEffect, useRef } from 'react';
import { createRain } from '../rainScene.js';
import RainSceneWorker from '../rainScene.worker.js?worker&inline';

/*
 * Animated wallpapers. Only one for now: rain on a window.
 *
 * The scene is drawn in four layers on a single canvas:
 *   1. a soft night sky (or an overcast afternoon in light mode)
 *   2. rain falling outside, in three depths
 *   3. fog on the glass, plus a mist of tiny droplets stuck to it
 *   4. bigger beads that swell, run down and merge
 * Now and then lightning flickers through the sky (and `postit:lightning`
 * is fired so the rain sound can roll thunder in after it).
 */
export function Wallpaper({ kind, dark, lightning = true }) {
  if (kind !== 'rain') return null;
  return <RainWallpaper dark={dark} lightning={lightning} />;
}

function RainWallpaper({ dark, lightning }) {
  const boxRef = useRef(null);
  const sceneRef = useRef(null);
  const initial = useRef({ dark, lightning });

  useEffect(() => {
    const scene = startRain(boxRef.current, initial.current);
    sceneRef.current = scene;
    if (import.meta.env.DEV) window.__rainStrike = () => scene.call('strike');
    return () => scene.destroy();
  }, []);

  useEffect(() => {
    sceneRef.current?.call('setDark', dark);
  }, [dark]);

  useEffect(() => {
    sceneRef.current?.call('setLightning', lightning);
  }, [lightning]);

  return <div ref={boxRef} className="wallpaper wp-rain" aria-hidden="true" />;
}

/*
 * Run the scene in a worker when the browser can hand a canvas to one, so the
 * rain never competes with scrolling; otherwise run it here.
 */
function startRain(box, { dark, lightning }) {
  const view = () => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 });
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const onStrike = (distance) => window.dispatchEvent(new CustomEvent('postit:lightning', { detail: { distance } }));
  const state = { dark, lightning };
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
    return { dark: state.dark, lightning: state.lightning, reduced, width: v.w, height: v.h, dpr: v.dpr };
  };
  const onMainThread = () => {
    stop();
    const engine = createRain(mount(), { ...opts(), onStrike });
    call = (type, value) => engine[type]?.(value);
    stop = () => engine.destroy();
  };

  let worker = null;
  try {
    const c = mount();
    if (!c.transferControlToOffscreen || typeof Worker === 'undefined') throw new Error('no offscreen');
    worker = new RainSceneWorker();
    const off = c.transferControlToOffscreen();
    worker.onmessage = (e) => e.data?.type === 'strike' && onStrike(e.data.distance);
    worker.onerror = () => {
      // The worker couldn't start (e.g. blocked): draw on the page instead.
      worker?.terminate();
      worker = null;
      onMainThread();
    };
    worker.postMessage({ type: 'init', canvas: off, opts: opts() }, [off]);
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
      if (type === 'setDark') state.dark = value;
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
