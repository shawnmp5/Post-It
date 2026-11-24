import { useEffect, useRef } from 'react';

/** Animated night sky: twinkling stars over slowly drifting nebula. */
function NightSky() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    let stars = [];
    let raf = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const seed = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round((w * h) / 5200);
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() < 0.08 ? 1.1 + Math.random() * 0.9 : 0.35 + Math.random() * 0.7,
        a: 0.25 + Math.random() * 0.65,
        tw: 0.6 + Math.random() * 1.8, // twinkle speed
        ph: Math.random() * Math.PI * 2,
        dx: (Math.random() - 0.5) * 0.012, // slow drift
      }));
    };

    let last = 0;
    const draw = (t) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 33) return; // ~30 fps is plenty for a backdrop
      last = t;
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        if (!reduce) {
          s.x += s.dx;
          if (s.x < 0) s.x += w;
          if (s.x > w) s.x -= w;
        }
        const alpha = reduce ? s.a : s.a * (0.55 + 0.45 * Math.sin(t * 0.001 * s.tw + s.ph));
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        if (s.r > 1.1) {
          // a soft glow on the brighter stars
          ctx.globalAlpha = alpha * 0.18;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };

    seed();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(seed);
    ro.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="wallpaper wp-night" aria-hidden="true">
      <div className="wp-nebula" />
      <div className="wp-nebula is-2" />
      <canvas ref={ref} className="wp-stars" />
    </div>
  );
}

function Aurora() {
  return (
    <div className="wallpaper wp-aurora" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}

export function Wallpaper({ kind }) {
  if (kind === 'night') return <NightSky />;
  if (kind === 'aurora') return <Aurora />;
  return null;
}
