/*
 * Keeps a signed-in wall saved: encrypted in this browser (so it opens instantly and
 * works offline) and, when there's a server, synced to the account as ciphertext.
 *
 * Every save bumps a revision on the server. A device only overwrites the server copy
 * if it was editing the latest revision; otherwise the newer edit wins and the other
 * device picks it up (on focus, when coming back online, and every 45 seconds).
 */
import { encryptJSON, decryptJSON } from './crypto.js';
import { getWall, putWall, mode } from './client.js';

const cacheKey = (uid) => `postit:wall:${uid}`;
const LEGACY_KEY = 'postit:v1'; // the old, unencrypted single-user wall
const ADOPTED_KEY = 'postit:v1:adopted';

function readCache(uid) {
  try {
    return JSON.parse(localStorage.getItem(cacheKey(uid)));
  } catch {
    return null;
  }
}
function writeCache(uid, entry) {
  try {
    localStorage.setItem(cacheKey(uid), JSON.stringify(entry));
    return true;
  } catch {
    return false;
  }
}

// Notes made before accounts existed move into the first account made on this device.
function takeLegacyWall() {
  try {
    if (localStorage.getItem(ADOPTED_KEY)) return null;
    const raw = localStorage.getItem(LEGACY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function dropLegacyWall() {
  try {
    localStorage.setItem(ADOPTED_KEY, '1');
    localStorage.removeItem(LEGACY_KEY); // no unencrypted copy left behind
  } catch {
    /* ignore */
  }
}

/* Load the wall for a signed-in user: the newest of this device's copy and the account's. */
export async function openWall(user, key, makeStarter) {
  const cache = readCache(user.id);
  let local = null;
  if (cache?.box) {
    try {
      local = await decryptJSON(key, cache.box);
    } catch {
      local = null;
    }
  }
  let remote = null;
  if (mode === 'server') {
    try {
      remote = await getWall();
    } catch {
      remote = null; // offline: use this device's copy
    }
  }
  const remoteNewer =
    remote?.blob &&
    (!local || (cache.rev !== remote.rev && (!cache.dirty || remote.updatedAt > cache.updatedAt)));
  if (remoteNewer) {
    const data = await decryptJSON(key, remote.blob);
    writeCache(user.id, { box: remote.blob, rev: remote.rev, dirty: false, updatedAt: remote.updatedAt });
    return { data, meta: { rev: remote.rev, dirty: false, updatedAt: remote.updatedAt } };
  }
  if (local) return { data: local, meta: { rev: cache.rev || 0, dirty: !!cache.dirty, updatedAt: cache.updatedAt || 0 } };
  const legacy = takeLegacyWall();
  return { data: legacy || makeStarter(), meta: { rev: remote?.rev || 0, dirty: true, updatedAt: Date.now() }, adoptedLegacy: !!legacy };
}

export function createSync(user, key, initialMeta, { onRemote, adoptedLegacy }) {
  const meta = { ...initialMeta };
  let box = null;
  let seq = 0;
  let pushTimer = 0;
  let inflight = false;
  let again = false;
  let status = mode === 'server' ? 'saved' : 'local';
  let lastSynced = meta.dirty ? 0 : Date.now();
  const listeners = new Set();
  const setStatus = (s) => {
    status = s;
    if (s === 'saved') lastSynced = Date.now();
    listeners.forEach((fn) => fn({ status, lastSynced }));
  };

  async function persist(data) {
    const mine = ++seq;
    const next = await encryptJSON(key, data);
    if (mine !== seq) return; // a newer save is on its way
    box = next;
    meta.dirty = true;
    meta.updatedAt = Date.now();
    if (!writeCache(user.id, { box, rev: meta.rev, dirty: true, updatedAt: meta.updatedAt })) setStatus('full');
    if (adoptedLegacy) {
      dropLegacyWall();
      adoptedLegacy = false;
    }
    schedulePush(1200);
  }

  function schedulePush(ms) {
    if (mode !== 'server') return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, ms);
  }

  async function push() {
    if (mode !== 'server' || !meta.dirty || !box) return;
    if (inflight) {
      again = true;
      return;
    }
    inflight = true;
    setStatus('saving');
    const sentSeq = seq;
    try {
      const res = await putWall({ blob: box, baseRev: meta.rev, updatedAt: meta.updatedAt });
      meta.rev = res.rev;
      if (sentSeq === seq) meta.dirty = false;
      writeCache(user.id, { box, rev: meta.rev, dirty: meta.dirty, updatedAt: meta.updatedAt });
      setStatus(meta.dirty ? 'saving' : 'saved');
    } catch (e) {
      if (e.status === 409) await resolveConflict();
      else if (e.status === 413) setStatus('too-big');
      else if (e.status === 401) setStatus('signed-out');
      else {
        setStatus('offline');
        schedulePush(30000);
      }
    } finally {
      inflight = false;
      if (again || (meta.dirty && status === 'saving')) {
        again = false;
        schedulePush(300);
      }
    }
  }

  // Someone else saved first: the newer edit wins.
  async function resolveConflict() {
    const remote = await getWall();
    if (remote.blob && remote.updatedAt > meta.updatedAt) {
      await adopt(remote);
    } else {
      meta.rev = remote.rev;
      again = true;
    }
  }

  async function adopt(remote) {
    const data = await decryptJSON(key, remote.blob);
    box = remote.blob;
    seq++;
    meta.rev = remote.rev;
    meta.dirty = false;
    meta.updatedAt = remote.updatedAt;
    writeCache(user.id, { box, rev: meta.rev, dirty: false, updatedAt: meta.updatedAt });
    onRemote(data);
    setStatus('saved');
  }

  async function pull() {
    if (mode !== 'server' || meta.dirty || inflight) return;
    try {
      const remote = await getWall();
      if (remote.blob && remote.rev !== meta.rev) await adopt(remote);
      else if (status === 'offline') setStatus('saved');
    } catch (e) {
      if (e.status === 401) setStatus('signed-out');
      else if (e.status === 0) setStatus('offline');
    }
  }

  // Another tab of the same account saved: show its version here too.
  const onStorage = async (e) => {
    if (e.key !== cacheKey(user.id) || !e.newValue) return;
    try {
      const entry = JSON.parse(e.newValue);
      if (entry.updatedAt <= meta.updatedAt) return;
      const data = await decryptJSON(key, entry.box);
      box = entry.box;
      seq++;
      Object.assign(meta, { rev: entry.rev, dirty: entry.dirty, updatedAt: entry.updatedAt });
      onRemote(data);
    } catch {
      /* ignore */
    }
  };
  const onVisible = () => document.visibilityState === 'visible' && pull();
  const onOnline = () => (meta.dirty ? push() : pull());
  window.addEventListener('storage', onStorage);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
  const poll = setInterval(pull, 45000);
  if (meta.dirty) schedulePush(500);

  return {
    persist,
    onStatus(fn) {
      listeners.add(fn);
      fn({ status, lastSynced });
      return () => listeners.delete(fn);
    },
    flush: push,
    destroy() {
      clearTimeout(pushTimer);
      clearInterval(poll);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    },
  };
}
