import { COLORS } from '../store.js';

// A tiny sticky note with your initial, in a colour picked from your username.
export function Avatar({ username, size = 'md' }) {
  const name = username || 'you';
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const c = COLORS.filter((x) => x.id !== 'white' && x.id !== 'gray')[h % 6];
  const tilt = ((h >> 4) % 7) - 3;
  return (
    <span className={`note-avatar is-${size}`} style={{ '--av-bg': c.bg, '--av-edge': c.edge, '--av-tilt': `${tilt}deg` }} aria-hidden="true">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
