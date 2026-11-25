/*
 * POST IT accounts: the server half.
 *
 * What the server stores, per account:
 *   - username (unique, case-insensitive, first come first served) and email (unique)
 *   - a scrypt hash of the client's *auth key*. The password itself never reaches the
 *     server: the browser stretches it (PBKDF2, 600k rounds) and sends only a derived
 *     auth key, which can't be turned back into the password or the encryption key.
 *   - the user's note-encryption key, itself encrypted ("wrapped") with a key only the
 *     password can make — so the server holds it but can't open it.
 *   - the wall (topics, notes, settings) as AES-GCM ciphertext made in the browser.
 *
 * So the notes are end-to-end encrypted: nobody with access to the storage can read them.
 * The flip side: a forgotten password can't be reset into the notes.
 *
 * Storage goes through `getStore(name)` (Netlify Blobs in production, an in-memory map
 * for local development), so this file runs anywhere.
 */

import { createHmac, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

const SESSION_COOKIE = 'postit_session';
const SESSION_DAYS = 30;
const MAX_WALL_BYTES = 5_500_000;
const LOCK_AFTER = 8; // failed sign-ins before a short lockout
const LOCK_MINUTES = 10;

const RESERVED = new Set([
  'admin', 'administrator', 'root', 'support', 'help', 'postit', 'post-it', 'post_it', 'api', 'me', 'settings',
  'account', 'login', 'signin', 'signup', 'system', 'staff', 'team', 'official', 'null', 'undefined',
]);

/* ---------------- rules (mirrored in src/account/rules.js) ---------------- */

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

export function checkEmail(raw) {
  const e = String(raw ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) || e.length > 254) return { ok: false, error: 'Enter a valid email address.' };
  return { ok: true, email: e.toLowerCase() };
}

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const isB64 = (s, min, max) => typeof s === 'string' && s.length >= min && s.length <= max && /^[A-Za-z0-9_-]+$/.test(s);
const sha = (s) => createHash('sha256').update(s).digest('hex');

/* ---------------- handler ---------------- */

export function createAccounts(getStore) {
  const users = () => getStore('users'); // uid -> user record
  const names = () => getStore('usernames'); // username -> { uid }
  const mails = () => getStore('emails'); // sha256(email) -> { uid }
  const walls = () => getStore('walls'); // uid -> { blob, rev, updatedAt }
  const secrets = () => getStore('secrets');

  let secretCache = null;
  async function secret() {
    if (secretCache) return secretCache;
    const s = secrets();
    let v = await s.get('session', { type: 'json' });
    if (!v) {
      await s.setJSON('session', { key: b64(randomBytes(32)) }, { onlyIfNew: true });
      v = await s.get('session', { type: 'json' });
    }
    secretCache = Buffer.from(v.key, 'base64url');
    return secretCache;
  }

  async function hashAuth(authKey, salt) {
    return b64(await scrypt(authKey, salt, 32, { N: 16384, r: 8, p: 1 }));
  }
  async function verifyAuth(user, authKey) {
    const h = Buffer.from(await hashAuth(authKey, Buffer.from(user.authSalt, 'base64url')), 'base64url');
    const want = Buffer.from(user.authHash, 'base64url');
    return h.length === want.length && timingSafeEqual(h, want);
  }

  async function sign(user) {
    const body = b64(JSON.stringify({ uid: user.id, pv: user.pv, exp: Date.now() + SESSION_DAYS * 864e5 }));
    const mac = b64(createHmac('sha256', await secret()).update(body).digest());
    return `${body}.${mac}`;
  }
  async function readSession(req) {
    const m = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
    if (!m) return null;
    const [body, mac] = m[1].split('.');
    if (!body || !mac) return null;
    const want = createHmac('sha256', await secret()).update(body).digest();
    const got = Buffer.from(mac, 'base64url');
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    let p;
    try {
      p = JSON.parse(Buffer.from(body, 'base64url').toString());
    } catch {
      return null;
    }
    if (!p?.uid || p.exp < Date.now()) return null;
    const user = await users().get(p.uid, { type: 'json' });
    if (!user || user.pv !== p.pv) return null; // signed out everywhere after a password change
    return user;
  }

  const secure = (req) => new URL(req.url).protocol === 'https:';
  const cookie = (req, value, maxAge) =>
    `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`;

  const json = (status, body, extra = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-postit-api': '1', ...extra },
    });
  const fail = (status, error, field) => json(status, field ? { error, field } : { error });

  const publicUser = (u) => ({ id: u.id, username: u.username, email: u.email, createdAt: u.createdAt });
  const keyBox = (u) => ({ salt: u.kdfSalt, iterations: u.kdfIterations, wrappedKey: u.wrappedKey });

  async function findUid(login) {
    const l = String(login ?? '').trim();
    if (l.includes('@') && !l.startsWith('@')) return (await mails().get(sha(l.toLowerCase()), { type: 'json' }))?.uid ?? null;
    const u = checkUsername(l);
    if (!u.ok) return null;
    return (await names().get(u.username, { type: 'json' }))?.uid ?? null;
  }

  // Sign-in needs the account's salt before it can stretch the password. Unknown
  // logins get a stable fake salt, so this can't be used to probe who has an account.
  async function fakeSalt(login) {
    return b64(createHmac('sha256', await secret()).update(`salt:${String(login).trim().toLowerCase()}`).digest().subarray(0, 16));
  }

  function validKeyMaterial(b) {
    return isB64(b.authKey, 40, 64) && isB64(b.salt, 20, 32) && b.wrappedKey && isB64(b.wrappedKey.iv, 14, 20) && isB64(b.wrappedKey.ct, 40, 80);
  }

  const routes = {
    // Signed out is a normal answer here, not an error.
    'GET /api/me': async (req, user) => json(200, user ? { user: publicUser(user), keyBox: keyBox(user) } : { user: null }),

    'GET /api/username': async (req, user) => {
      const q = new URL(req.url).searchParams.get('u');
      const v = checkUsername(q);
      if (!v.ok) return json(200, { available: false, error: v.error });
      const owner = (await names().get(v.username, { type: 'json' }))?.uid;
      return json(200, { available: !owner || owner === user?.id, username: v.username });
    },

    'POST /api/signup': async (req, user, b) => {
      const un = checkUsername(b.username);
      if (!un.ok) return fail(400, un.error, 'username');
      const em = checkEmail(b.email);
      if (!em.ok) return fail(400, em.error, 'email');
      if (!validKeyMaterial(b)) return fail(400, 'Something went wrong preparing your account.');
      const id = randomUUID();
      const claimed = await names().setJSON(un.username, { uid: id }, { onlyIfNew: true });
      if (!claimed.modified) return fail(409, `@${un.username} is already taken.`, 'username');
      const mail = await mails().setJSON(sha(em.email), { uid: id }, { onlyIfNew: true });
      if (!mail.modified) {
        await names().delete(un.username);
        return fail(409, 'An account already uses this email.', 'email');
      }
      const authSalt = randomBytes(16);
      const rec = {
        id,
        username: un.username,
        email: em.email,
        authSalt: b64(authSalt),
        authHash: await hashAuth(b.authKey, authSalt),
        kdfSalt: b.salt,
        kdfIterations: b.iterations || 600000,
        wrappedKey: b.wrappedKey,
        pv: 1,
        failed: 0,
        lockedUntil: 0,
        createdAt: Date.now(),
      };
      await users().setJSON(id, rec);
      return json(201, { user: publicUser(rec), keyBox: keyBox(rec) }, { 'set-cookie': cookie(req, await sign(rec), SESSION_DAYS * 86400) });
    },

    'POST /api/prelogin': async (req, user, b) => {
      const uid = await findUid(b.login);
      const rec = uid && (await users().get(uid, { type: 'json' }));
      return json(200, rec ? { salt: rec.kdfSalt, iterations: rec.kdfIterations } : { salt: await fakeSalt(b.login), iterations: 600000 });
    },

    'POST /api/login': async (req, user, b) => {
      const uid = await findUid(b.login);
      const rec = uid && (await users().get(uid, { type: 'json' }));
      if (!rec || !isB64(b.authKey, 40, 64)) return fail(401, 'That username or password isn’t right.');
      if (rec.lockedUntil > Date.now()) return fail(429, 'Too many tries. Wait a few minutes and try again.');
      if (!(await verifyAuth(rec, b.authKey))) {
        rec.failed = (rec.failed || 0) + 1;
        if (rec.failed >= LOCK_AFTER) {
          rec.failed = 0;
          rec.lockedUntil = Date.now() + LOCK_MINUTES * 60e3;
        }
        await users().setJSON(rec.id, rec);
        return fail(401, 'That username or password isn’t right.');
      }
      if (rec.failed) {
        rec.failed = 0;
        await users().setJSON(rec.id, rec);
      }
      return json(200, { user: publicUser(rec), keyBox: keyBox(rec) }, { 'set-cookie': cookie(req, await sign(rec), SESSION_DAYS * 86400) });
    },

    'POST /api/logout': async (req) => json(200, { ok: true }, { 'set-cookie': cookie(req, '', 0) }),

    'PATCH /api/account': async (req, user, b) => {
      if (!user) return fail(401, 'Not signed in.');
      if (b.username != null) {
        const un = checkUsername(b.username);
        if (!un.ok) return fail(400, un.error, 'username');
        if (un.username !== user.username) {
          const claimed = await names().setJSON(un.username, { uid: user.id }, { onlyIfNew: true });
          if (!claimed.modified) return fail(409, `@${un.username} is already taken.`, 'username');
          const old = user.username;
          user.username = un.username;
          await users().setJSON(user.id, user);
          if ((await names().get(old, { type: 'json' }))?.uid === user.id) await names().delete(old); // free the old name
        }
      }
      if (b.email != null) {
        if (!(await verifyAuth(user, b.authKey || ''))) return fail(401, 'Your password isn’t right.', 'password');
        const em = checkEmail(b.email);
        if (!em.ok) return fail(400, em.error, 'email');
        if (em.email !== user.email) {
          const claimed = await mails().setJSON(sha(em.email), { uid: user.id }, { onlyIfNew: true });
          if (!claimed.modified) return fail(409, 'An account already uses this email.', 'email');
          const old = sha(user.email);
          user.email = em.email;
          await users().setJSON(user.id, user);
          if ((await mails().get(old, { type: 'json' }))?.uid === user.id) await mails().delete(old);
        }
      }
      return json(200, { user: publicUser(user) });
    },

    'POST /api/password': async (req, user, b) => {
      if (!user) return fail(401, 'Not signed in.');
      if (!(await verifyAuth(user, b.authKey || ''))) return fail(401, 'Your current password isn’t right.', 'current');
      const next = { authKey: b.newAuthKey, salt: b.newSalt, wrappedKey: b.newWrappedKey };
      if (!validKeyMaterial(next)) return fail(400, 'Something went wrong changing your password.');
      const authSalt = randomBytes(16);
      user.authSalt = b64(authSalt);
      user.authHash = await hashAuth(next.authKey, authSalt);
      user.kdfSalt = next.salt;
      user.kdfIterations = b.iterations || 600000;
      user.wrappedKey = next.wrappedKey;
      user.pv += 1; // every other session is signed out
      await users().setJSON(user.id, user);
      return json(200, { user: publicUser(user), keyBox: keyBox(user) }, { 'set-cookie': cookie(req, await sign(user), SESSION_DAYS * 86400) });
    },

    'POST /api/delete': async (req, user, b) => {
      if (!user) return fail(401, 'Not signed in.');
      if (!(await verifyAuth(user, b.authKey || ''))) return fail(401, 'Your password isn’t right.', 'password');
      await walls().delete(user.id);
      if ((await names().get(user.username, { type: 'json' }))?.uid === user.id) await names().delete(user.username);
      if ((await mails().get(sha(user.email), { type: 'json' }))?.uid === user.id) await mails().delete(sha(user.email));
      await users().delete(user.id);
      return json(200, { ok: true }, { 'set-cookie': cookie(req, '', 0) });
    },

    // The wall: only ever ciphertext. `rev` lets two devices notice each other's changes.
    'GET /api/data': async (req, user) => {
      if (!user) return fail(401, 'Not signed in.');
      const w = await walls().get(user.id, { type: 'json' });
      return json(200, w ? { blob: w.blob, rev: w.rev, updatedAt: w.updatedAt } : { blob: null, rev: 0, updatedAt: 0 });
    },

    'PUT /api/data': async (req, user, b, raw) => {
      if (!user) return fail(401, 'Not signed in.');
      if (raw.length > MAX_WALL_BYTES) return fail(413, 'Your wall is too big to save to your account (large images?).');
      if (!b.blob || !isB64(b.blob.iv, 14, 20) || typeof b.blob.ct !== 'string') return fail(400, 'Bad data.');
      const store = walls();
      const cur = await store.getWithMetadata(user.id, { type: 'json' });
      const rev = cur?.data?.rev || 0;
      if (!b.force && rev !== (b.baseRev || 0)) return json(409, { error: 'Changed elsewhere.', rev, updatedAt: cur?.data?.updatedAt || 0 });
      const next = { blob: b.blob, rev: rev + 1, updatedAt: Number(b.updatedAt) || Date.now() };
      const res = await store.setJSON(user.id, next, cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
      if (!res.modified) return json(409, { error: 'Changed elsewhere.', rev: rev + 1, updatedAt: 0 });
      return json(200, { rev: next.rev, updatedAt: next.updatedAt });
    },
  };

  return async function handle(req) {
    const url = new URL(req.url);
    const route = routes[`${req.method} ${url.pathname.replace(/\/+$/, '')}`];
    if (!route) return fail(404, 'Not found.');
    // Only accept requests from this site's own pages.
    const origin = req.headers.get('origin');
    if (req.method !== 'GET' && origin && origin !== url.origin) return fail(403, 'Forbidden.');
    let raw = '';
    let body = {};
    if (req.method !== 'GET') {
      raw = await req.text();
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          return fail(400, 'Bad request.');
        }
      }
    }
    try {
      const user = await readSession(req);
      return await route(req, user, body, raw);
    } catch (err) {
      console.error(err);
      return fail(500, 'Something went wrong. Try again.');
    }
  };
}
