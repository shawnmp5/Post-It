import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import App from './App.jsx';
import { AuthScreen } from './components/AuthScreen.jsx';
import { AccountSheet } from './components/AccountSheet.jsx';
import { start, signOut } from './account/client.js';
import { loadKey } from './account/crypto.js';
import { openWall, createSync } from './account/sync.js';
import { createStarterData } from './store.js';

/*
 * Who's here? Signed out → Create Account / Sign In. Signed in but the key isn't on this
 * device → Unlock. Otherwise decrypt the wall and hand it to the app, with a sync that
 * encrypts every change and saves it to the account.
 */
export default function Root() {
  const [phase, setPhase] = useState({ name: 'loading' });
  const [accountOpen, setAccountOpen] = useState(false);
  const [syncState, setSyncState] = useState({ status: 'saved', lastSynced: 0 });
  const [, setSyncTick] = useState(0); // re-render when sync is switched on/off
  const syncRef = useRef(null);
  const remote = useRef(new Set());

  const enter = useCallback(async ({ user, keyBox, key }, mode) => {
    setPhase({ name: 'loading' });
    const { data, meta, adoptedLegacy } = await openWall(user, key, createStarterData);
    syncRef.current?.destroy();
    const sync = createSync(user, key, meta, { adoptedLegacy, onRemote: (d) => remote.current.forEach((fn) => fn(d)) });
    syncRef.current = sync;
    sync.onStatus(setSyncState);
    setPhase({ name: 'ready', mode, user, keyBox, data, dirty: meta.dirty, sync });
  }, []);

  useEffect(() => {
    (async () => {
      const s = await start();
      if (!s.user) return setPhase({ name: 'auth', mode: s.mode });
      const key = await loadKey(s.user.id);
      if (!key) return setPhase({ name: 'auth', mode: s.mode, locked: { user: s.user, keyBox: s.keyBox } });
      try {
        await enter({ user: s.user, keyBox: s.keyBox, key }, s.mode);
      } catch {
        setPhase({ name: 'auth', mode: s.mode, locked: { user: s.user, keyBox: s.keyBox } });
      }
    })();
    return () => syncRef.current?.destroy();
  }, [enter]);

  // Signed out on the server (e.g. the password was changed on another device).
  useEffect(() => {
    if (syncState.status === 'signed-out' && phase.name === 'ready') {
      syncRef.current?.destroy();
      setAccountOpen(false);
      setPhase({ name: 'auth', mode: phase.mode });
    }
  }, [syncState.status, phase]);

  // Before the wall loads, follow the system's light/dark.
  useEffect(() => {
    if (phase.name === 'ready') return undefined;
    const root = document.documentElement;
    const m = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      root.dataset.theme = m.matches ? 'dark' : 'light';
      root.dataset.shade = 'none';
      root.dataset.wallpaper = 'none';
      root.dataset.clear = 'false';
    };
    apply();
    m.addEventListener('change', apply);
    return () => m.removeEventListener('change', apply);
  }, [phase.name]);

  const wall = useMemo(() => {
    if (phase.name !== 'ready') return null;
    return {
      initialData: phase.data,
      dirty: phase.dirty,
      persist: (d) => phase.sync.persist(d),
      subscribe: (fn) => {
        remote.current.add(fn);
        return () => remote.current.delete(fn);
      },
    };
    // The wall object must stay the same for a session (the store reads it once).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.name === 'ready' ? phase.sync : null]);

  const doSignOut = useCallback(async () => {
    const uid = phase.user?.id;
    setAccountOpen(false);
    try {
      await syncRef.current?.flush();
    } catch {
      /* offline: this device keeps the encrypted copy */
    }
    syncRef.current?.destroy();
    syncRef.current = null;
    if (uid) await signOut(uid);
    setPhase({ name: 'auth', mode: phase.mode });
  }, [phase]);

  if (phase.name === 'loading') return <div className="splash" aria-busy="true" />;

  if (phase.name === 'auth')
    return (
      <AuthScreen
        demo={phase.mode === 'demo'}
        locked={phase.locked}
        onDone={(session) => enter(session, phase.mode).catch(() => setPhase({ name: 'auth', mode: phase.mode }))}
        onSignOut={async () => {
          await signOut(phase.locked.user.id);
          setPhase({ name: 'auth', mode: phase.mode });
        }}
      />
    );

  return (
    <>
      <App
        key={phase.user.id}
        wall={wall}
        account={{ username: phase.user.username, mode: phase.mode, sync: syncState.status }}
        onOpenAccount={() => setAccountOpen(true)}
      />
      {accountOpen && (
        <AccountSheet
          user={phase.user}
          keyBox={phase.keyBox}
          mode={phase.mode}
          sync={syncState}
          syncOn={phase.sync.enabled}
          onSyncChange={async (on) => {
            await phase.sync.setEnabled(on);
            setSyncTick((n) => n + 1);
          }}
          onSyncNow={() => phase.sync.syncNow()}
          onClose={() => setAccountOpen(false)}
          onUser={(user, keyBox) => setPhase((p) => ({ ...p, user, keyBox: keyBox || p.keyBox }))}
          onSignOut={doSignOut}
          onDeleted={() => {
            const uid = phase.user.id;
            syncRef.current?.destroy();
            syncRef.current = null;
            try {
              localStorage.removeItem(`postit:wall:${uid}`);
            } catch {
              /* ignore */
            }
            setAccountOpen(false);
            setPhase({ name: 'auth', mode: phase.mode });
          }}
        />
      )}
    </>
  );
}
