// Username and password rules — the same ones the server enforces (netlify/lib/accounts.mjs).

const RESERVED = new Set([
  'admin', 'administrator', 'root', 'support', 'help', 'postit', 'post-it', 'post_it', 'api', 'me', 'settings',
  'account', 'login', 'signin', 'signup', 'system', 'staff', 'team', 'official', 'null', 'undefined',
]);

export function checkUsername(raw) {
  const u = String(raw ?? '').trim().replace(/^@/, '');
  if (u.length < 2) return { ok: false, error: 'Use at least 2 characters.' };
  if (u.length > 20) return { ok: false, error: 'Use 20 characters or fewer.' };
  if (!/^[A-Za-z0-9._]+$/.test(u)) return { ok: false, error: 'Use only letters, numbers, periods and underscores.' };
  if (!/[A-Za-z]/.test(u)) return { ok: false, error: 'Include at least one letter.' };
  if (/^\.|\.$|\.\./.test(u)) return { ok: false, error: 'Periods can’t be first, last or next to each other.' };
  if (RESERVED.has(u.toLowerCase())) return { ok: false, error: 'That username isn’t available.' };
  return { ok: true, username: u.toLowerCase() };
}

export function checkPassword(pw) {
  if (String(pw ?? '').length < 8) return { ok: false, error: 'Use at least 8 characters.' };
  if (String(pw).length > 200) return { ok: false, error: 'That password is too long.' };
  return { ok: true };
}
