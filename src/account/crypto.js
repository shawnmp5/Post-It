/*
 * End-to-end encryption for the wall, all in the browser (Web Crypto).
 *
 *   password ──PBKDF2-SHA256, 600k rounds, per-account salt──▶ master secret (never leaves the browser)
 *   master ──HKDF "auth"──▶ auth key   → sent to the server to sign in (it stores only a scrypt hash of it)
 *   master ──HKDF "wrap"──▶ wrap key   → encrypts the account's data key
 *   data key (random AES-256-GCM)       → encrypts the wall; stored on the server only in wrapped form
 *
 * The server never sees the password, the master secret, the wrap key or the data key,
 * so it can't read anyone's notes. Changing the password re-wraps the same data key.
 */

const te = new TextEncoder();
const td = new TextDecoder();
export const KDF_ITERATIONS = 600000;

export function b64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const newSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));

export async function deriveKeys(password, salt, iterations = KDF_ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', te.encode(String(password).normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const master = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations }, base, 256);
  const hk = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const zero = new Uint8Array(32);
  const auth = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: zero, info: te.encode('postit auth v1') }, hk, 256);
  const wrapKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: zero, info: te.encode('postit wrap v1') },
    hk,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
  return { authKey: b64(auth), wrapKey };
}

export const newDataKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);

export async function wrapDataKey(dataKey, wrapKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.wrapKey('raw', dataKey, wrapKey, { name: 'AES-GCM', iv });
  return { iv: b64(iv), ct: b64(ct) };
}

// Throws if the password (and so the wrap key) is wrong.
export function unwrapDataKey(box, wrapKey, extractable = false) {
  return crypto.subtle.unwrapKey('raw', unb64(box.ct), wrapKey, { name: 'AES-GCM', iv: unb64(box.iv) }, { name: 'AES-GCM' }, extractable, ['encrypt', 'decrypt']);
}

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
const canZip = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

export async function encryptJSON(dataKey, value) {
  let bytes = te.encode(JSON.stringify(value));
  const z = canZip ? 1 : 0;
  if (z) bytes = await pipe(bytes, new CompressionStream('gzip'));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dataKey, bytes);
  return { v: 1, z, iv: b64(iv), ct: b64(ct) };
}

export async function decryptJSON(dataKey, box) {
  let bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, dataKey, unb64(box.ct)));
  if (box.z) bytes = await pipe(bytes, new DecompressionStream('gzip'));
  return JSON.parse(td.decode(bytes));
}

/* The unlocked data key is kept in IndexedDB as a non-extractable key, so a reload doesn't
   ask for the password again — and the raw key can't be read out even by the page itself. */
const DB = 'postit-keys';
function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('keys');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('keys', mode);
    const r = fn(t.objectStore('keys'));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}
export async function saveKey(uid, key) {
  try {
    await tx('readwrite', (s) => s.put(key, uid));
  } catch {
    /* private mode: the key lives only in memory; a reload will ask for the password */
  }
}
export async function loadKey(uid) {
  try {
    return (await tx('readonly', (s) => s.get(uid))) || null;
  } catch {
    return null;
  }
}
export async function forgetKey(uid) {
  try {
    await tx('readwrite', (s) => s.delete(uid));
  } catch {
    /* ignore */
  }
}
