import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Logo, IconFileText } from '../components/Icons.jsx';
import { StaticWall } from './StaticWall.jsx';
import { openShareLink } from '../account/client.js';
import { exportPDF } from './export.js';

/* What someone sees when they open a share link: the topic, read-only. No account needed. */
export function SharedView({ id, rawKey }) {
  const [state, setState] = useState({ status: 'loading' });
  const [fit, setFit] = useState(1);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);
  const wallRef = useRef(null);

  // Follow the system's light / dark.
  useEffect(() => {
    const m = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = m.matches ? 'dark' : 'light';
      document.documentElement.dataset.shade = 'none';
    };
    apply();
    m.addEventListener('change', apply);
    return () => m.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (!rawKey) return setState({ status: 'error', text: 'This link is incomplete. Ask for the full link.' });
    openShareLink(id, rawKey)
      .then((r) => {
        setState({ status: 'ready', ...r });
        document.title = `${r.data.topic.name} · POST IT`;
      })
      .catch((e) =>
        setState({ status: 'error', text: e?.status === 404 ? 'This link doesn’t work anymore. The owner may have stopped sharing it.' : 'This link is incomplete or wrong. Ask for the full link.' }),
      );
  }, [id, rawKey]);

  // Shrink a wide wall to fit small screens.
  useLayoutEffect(() => {
    if (state.status !== 'ready') return undefined;
    const measure = () => {
      const w = wallRef.current?.firstElementChild?.offsetWidth || 0;
      const avail = (scrollRef.current?.clientWidth || 0) - 32;
      setFit(w && avail ? Math.max(0.45, Math.min(1, avail / w)) : 1);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [state.status]);

  if (state.status !== 'ready')
    return (
      <div className="shared">
        <div className="shared-message">
          <Logo size={40} />
          <p>{state.status === 'loading' ? 'Opening…' : state.text}</p>
          {state.status === 'error' && (
            <a className="share-primary" href="/">
              Go to POST IT
            </a>
          )}
        </div>
      </div>
    );

  const { data, username, updatedAt } = state;
  const when = new Date(updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return (
    <div className="shared">
      <header className="shared-bar">
        <a href="/" className="shared-brand" title="POST IT">
          <Logo size={22} />
        </a>
        <div className="shared-heading">
          <h1>{data.topic.name}</h1>
          <p>
            Shared by @{username} · {when} · View only
          </p>
        </div>
        <div className="shared-actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await exportPDF(data);
              } finally {
                setBusy(false);
              }
            }}
          >
            <IconFileText /> {busy ? 'Making PDF…' : 'PDF'}
          </button>
          <a className="share-primary" href="/">
            Make your own
          </a>
        </div>
      </header>
      <main ref={scrollRef} className="shared-scroll">
        <div ref={wallRef} className="shared-canvas" style={{ zoom: fit }}>
          {data.notes.length ? (
            <StaticWall notes={data.notes} connections={data.connections} settings={data.settings} />
          ) : (
            <p className="shared-empty">This topic has no notes yet.</p>
          )}
        </div>
      </main>
    </div>
  );
}
