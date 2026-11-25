import { COLORS } from '../store.js';

// A fresh random tilt each time the page loads (3–7°, either way), the same everywhere on
// screen until the next load.
const tilts = new Map();
function tiltFor(name) {
  if (!tilts.has(name)) tilts.set(name, (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 4));
  return Math.round(tilts.get(name) * 10) / 10;
}

// A tiny sticky note with your initial, in a colour picked from your username.
export function Avatar({ username, size = 'md' }) {
  const name = username || 'you';
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const c = COLORS.filter((x) => x.id !== 'white' && x.id !== 'gray')[h % 6];
  const tilt = tiltFor(name);
  return (
    <span className={`note-avatar is-${size}`} style={{ '--av-bg': c.bg, '--av-edge': c.edge, '--av-tilt': `${tilt}deg` }} aria-hidden="true">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
