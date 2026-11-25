/*
 * The account client. Talks to /api/* (Netlify Function, or the dev server's stand-in).
 * Where there's no server — the Claude preview, a plain static host — it falls back to a
 * demo mode that keeps accounts in this browser only, with the same encryption.
 *
 * Every function that takes a password does the key work here, in the browser:
 * only derived keys and ciphertext are ever sent.
 */
import { checkUsername } from './rules.js';
import {
  KDF_ITERATIONS,
  deriveKeys,
  newSalt,
  newDataKey,
  wrapDataKey,
  unwrapDataKey,
  saveKey,
  forgetKey,
  b64,
} from './crypto.js';

export class AccountError extends Error {
  constructor(message, { field, status } = {}) {
    super(message);
    this.field = field;
    this.status = status;
  }
}

/* ---------------- server ---------------- */

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new AccountError('Can’t reach POST IT. Check your connection and try again.', { status: 0 });
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) throw Object.assign(new AccountError(data.error || 'Something went wrong. Try again.', { field: data.field, status: res.status }), { data });
  return data;
}

const server = {
  me: () => call('GET', '/api/me'),
  username: (u) => call('GET', `/api/username?u=${encodeURIComponent(u)}`),
  signup: (b) => call('POST', '/api/signup', b),
  prelogin: (b) => call('POST', '/api/prelogin', b),
  login: (b) => call('POST', '/api/login', b),
  logout: () => call('POST', '/api/logout'),
  account: (b) => call('PATCH', '/api/account', b),
  password: (b) => call('POST', '/api/password', b),
  remove: (b) => call('POST', '/api/delete', b),
  getWall: () => call('GET', '/api/data'),
  putWall: (b) => call('PUT', '/api/data', b),
};

/* ---------------- demo (this browser only) ---------------- */

const DEMO_KEY = 'postit:demo-accounts';
const sha = async (s) => b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
function demoDb() {
  try {
    return JSON.parse(localStorage.getItem(DEMO_KEY)) || { users: {}, names: {}, emails: {}, walls: {}, session: null };
  } catch {
    return { users: {}, names: {}, emails: {}, walls: {}, session: null };
  }
}
const demoSave = (d) => localStorage.setItem(DEMO_KEY, JSON.stringify(d));
const pub = (u) => ({ id: u.id, username: u.username, email: u.email, createdAt: u.createdAt });
const box = (u) => ({ salt: u.kdfSalt, iterations: u.kdfIterations, wrappedKey: u.wrappedKey });
const err = (m, field, status = 400) => {
  throw new AccountError(m, { field, status });
};
function demoFind(d, login) {
  const l = String(login ?? '').trim().toLowerCase();
  if (l.includes('@') && !l.startsWith('@')) return d.users[d.emails[l]] || null;
  return d.users[d.names[l.replace(/^@/, '')]] || null;
}
async function demoVerify(u, authKey) {
  return u.authHash === (await sha(`${u.authSalt}:${authKey}`));
}
const demo = {
  async me() {
    const d = demoDb();
    const u = d.users[d.session];
    if (!u) err('Not signed in.', null, 401);
    return { user: pub(u), keyBox: box(u) };
  },
  async username(raw) {
    const v = checkUsername(raw);
    if (!v.ok) return { available: false, error: v.error };
    const d = demoDb();
    const owner = d.names[v.username];
    return { available: !owner || owner === d.session, username: v.username };
  },
  async signup(b) {
    const d = demoDb();
    const un = checkUsername(b.username).username;
    const em = String(b.email).trim().toLowerCase();
    if (d.names[un]) err(`@${un} is already taken.`, 'username', 409);
    if (d.emails[em]) err('An account already uses this email.', 'email', 409);
    const id = crypto.randomUUID();
    const authSalt = newSalt();
    const u = { id, username: un, email: em, authSalt, authHash: await sha(`${authSalt}:${b.authKey}`), kdfSalt: b.salt, kdfIterations: b.iterations, wrappedKey: b.wrappedKey, createdAt: Date.now() };
    d.users[id] = u;
    d.names[un] = id;
    d.emails[em] = id;
    d.session = id;
    demoSave(d);
    return { user: pub(u), keyBox: box(u) };
  },
  async prelogin(b) {
    const u = demoFind(demoDb(), b.login);
    return u ? { salt: u.kdfSalt, iterations: u.kdfIterations } : { salt: (await sha(`fake:${b.login}`)).slice(0, 22), iterations: KDF_ITERATIONS };
  },
  async login(b) {
    const d = demoDb();
    const u = demoFind(d, b.login);
    if (!u || !(await demoVerify(u, b.authKey))) err('That username or password isn’t right.', null, 401);
    d.session = u.id;
    demoSave(d);
    return { user: pub(u), keyBox: box(u) };
  },
  async logout() {
    const d = demoDb();
    d.session = null;
    demoSave(d);
    return { ok: true };
  },
  async account(b) {
    const d = demoDb();
    const u = d.users[d.session];
    if (!u) err('Not signed in.', null, 401);
    if (b.username != null) {
      const un = checkUsername(b.username).username;
      if (un !== u.username) {
        if (d.names[un]) err(`@${un} is already taken.`, 'username', 409);
        delete d.names[u.username];
        d.names[un] = u.id;
        u.username = un;
      }
    }
    if (b.email != null) {
      if (!(await demoVerify(u, b.authKey || ''))) err('Your password isn’t right.', 'password', 401);
      const em = String(b.email).trim().toLowerCase();
      if (em !== u.email) {
        if (d.emails[em]) err('An account already uses this email.', 'email', 409);
        delete d.emails[u.email];
        d.emails[em] = u.id;
        u.email = em;
      }
    }
    demoSave(d);
    return { user: pub(u) };
  },
  async password(b) {
    const d = demoDb();
    const u = d.users[d.session];
    if (!u) err('Not signed in.', null, 401);
    if (!(await demoVerify(u, b.authKey || ''))) err('Your current password isn’t right.', 'current', 401);
    u.authSalt = newSalt();
    u.authHash = await sha(`${u.authSalt}:${b.newAuthKey}`);
    u.kdfSalt = b.newSalt;
    u.kdfIterations = b.iterations;
    u.wrappedKey = b.newWrappedKey;
    demoSave(d);
    return { user: pub(u), keyBox: box(u) };
  },
  async remove(b) {
    const d = demoDb();
    const u = d.users[d.session];
    if (!u) err('Not signed in.', null, 401);
    if (!(await demoVerify(u, b.authKey || ''))) err('Your password isn’t right.', 'password', 401);
    delete d.names[u.username];
    delete d.emails[u.email];
    delete d.walls[u.id];
    delete d.users[u.id];
    d.session = null;
    demoSave(d);
    return { ok: true };
  },
  async getWall() {
    const d = demoDb();
    return d.walls[d.session] || { blob: null, rev: 0, updatedAt: 0 };
  },
  async putWall(b) {
    const d = demoDb();
    const cur = d.walls[d.session];
    const rev = cur?.rev || 0;
    if (!b.force && rev !== (b.baseRev || 0)) err('Changed elsewhere.', null, 409);
    d.walls[d.session] = { blob: b.blob, rev: rev + 1, updatedAt: b.updatedAt };
    try {
      demoSave(d);
    } catch {
      err('This browser’s storage is full.', null, 413);
    }
    return { rev: rev + 1, updatedAt: b.updatedAt };
  },
};

/* ---------------- the client ---------------- */

let api = null;
export let mode = null; // 'server' | 'demo'

// Finds out whether there's a server and whether someone is signed in.
export async function start() {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (res.headers.get('x-postit-api')) {
      api = server;
      mode = 'server';
      const data = res.ok ? await res.json() : null;
      return { mode, user: data?.user || null, keyBox: data?.keyBox || null };
    }
  } catch {
    /* no server */
  }
  api = demo;
  mode = 'demo';
  try {
    const data = await demo.me();
    return { mode, user: data.user, keyBox: data.keyBox };
  } catch {
    return { mode, user: null, keyBox: null };
  }
}

export const isUsernameAvailable = (u) => api.username(u);

export async function signUp({ username, email, password }) {
  const salt = newSalt();
  const { authKey, wrapKey } = await deriveKeys(password, salt);
  const dataKey = await newDataKey();
  const wrappedKey = await wrapDataKey(dataKey, wrapKey);
  const res = await api.signup({ username, email, authKey, salt, iterations: KDF_ITERATIONS, wrappedKey });
  const key = await unwrapDataKey(wrappedKey, wrapKey); // keep a non-extractable copy
  await saveKey(res.user.id, key);
  return { user: res.user, keyBox: res.keyBox, key };
}

export async function signIn({ login, password }) {
  const pre = await api.prelogin({ login });
  const { authKey, wrapKey } = await deriveKeys(password, pre.salt, pre.iterations);
  const res = await api.login({ login, authKey });
  const key = await unwrapDataKey(res.keyBox.wrappedKey, wrapKey);
  await saveKey(res.user.id, key);
  return { user: res.user, keyBox: res.keyBox, key };
}

// Signed in on this device but the key isn't here (e.g. site data was cleared): ask for the password.
export async function unlock(user, keyBox, password) {
  const { wrapKey } = await deriveKeys(password, keyBox.salt, keyBox.iterations);
  let key;
  try {
    key = await unwrapDataKey(keyBox.wrappedKey, wrapKey);
  } catch {
    throw new AccountError('That password isn’t right.', { field: 'password', status: 401 });
  }
  await saveKey(user.id, key);
  return key;
}

export async function signOut(uid) {
  await forgetKey(uid);
  try {
    await api.logout();
  } catch {
    /* already signed out */
  }
}

export const changeUsername = (username) => api.account({ username });

export async function changeEmail(email, password, keyBox) {
  const { authKey } = await deriveKeys(password, keyBox.salt, keyBox.iterations);
  return api.account({ email, authKey });
}

export async function changePassword(user, keyBox, current, next) {
  const old = await deriveKeys(current, keyBox.salt, keyBox.iterations);
  let dataKey;
  try {
    dataKey = await unwrapDataKey(keyBox.wrappedKey, old.wrapKey, true);
  } catch {
    throw new AccountError('Your current password isn’t right.', { field: 'current', status: 401 });
  }
  const newSaltValue = newSalt();
  const fresh = await deriveKeys(next, newSaltValue);
  const newWrappedKey = await wrapDataKey(dataKey, fresh.wrapKey);
  const res = await api.password({ authKey: old.authKey, newAuthKey: fresh.authKey, newSalt: newSaltValue, iterations: KDF_ITERATIONS, newWrappedKey });
  await saveKey(user.id, await unwrapDataKey(newWrappedKey, fresh.wrapKey));
  return res;
}

export async function deleteAccount(user, keyBox, password) {
  const { authKey } = await deriveKeys(password, keyBox.salt, keyBox.iterations);
  await api.remove({ authKey });
  await forgetKey(user.id);
}

export const getWall = () => api.getWall();
export const putWall = (b) => api.putWall(b);
