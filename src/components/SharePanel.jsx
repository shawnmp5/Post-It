import { useState } from 'react';
import { IconLink, IconCopy, IconImage, IconFileText } from './Icons.jsx';
import { canShareLinks, createShareLink, updateShareLink, removeShareLink, shareUrl } from '../account/client.js';
import { topicPayload, exportPDF, exportPNG, topicText } from '../share/export.js';

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  }
}

function ago(at) {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* Share a topic: a view-only link, a PDF, a picture, or its text. */
export function SharePanel({ data, topicId, dispatch, toast, onDone }) {
  const topic = data.topics.find((t) => t.id === topicId);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  if (!topic) return null;
  const share = topic.share;
  const links = canShareLinks();

  const run = (name, fn) => async () => {
    if (busy) return;
    setBusy(name);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e?.message || 'Something went wrong. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const copyLink = run('link', async () => {
    const payload = topicPayload(data, topicId);
    const next = share ? await updateShareLink(share, payload) : await createShareLink(payload);
    dispatch({ type: 'topic/share', id: topicId, share: next });
    await copy(shareUrl(next));
    toast(share ? 'Link updated and copied' : 'Link copied. Anyone with it can view this topic');
  });
  const stop = run('stop', async () => {
    await removeShareLink(share.id);
    dispatch({ type: 'topic/share', id: topicId, share: null });
    toast('Sharing turned off. The old link no longer works');
  });
  const pdf = run('pdf', async () => {
    await exportPDF(topicPayload(data, topicId));
    onDone?.();
  });
  const png = run('png', async () => {
    await exportPNG(topicPayload(data, topicId));
    onDone?.();
  });
  const text = run('text', async () => {
    await copy(topicText(topicPayload(data, topicId)));
    toast('Text copied');
    onDone?.();
  });

  return (
    <div className="share-panel">
      <h2 className="share-title">Share “{topic.name}”</h2>

      <div className="share-link">
        {share ? (
          <>
            <div className="share-url" title={shareUrl(share)}>
              <IconLink />
              <span>{shareUrl(share).replace(/^https?:\/\//, '').replace(/#.*/, '')}</span>
            </div>
            <button type="button" className="share-primary" onClick={copyLink} disabled={!!busy}>
              {busy === 'link' ? 'Copying…' : 'Copy link'}
            </button>
            <p className="share-note">
              Anyone with the link can view this topic. Copying it again updates what they see (last updated {ago(share.at)}).{' '}
              <button type="button" className="share-stop" onClick={stop} disabled={!!busy}>
                Stop sharing
              </button>
            </p>
          </>
        ) : (
          <>
            <button type="button" className="share-primary" onClick={copyLink} disabled={!!busy || !links}>
              <IconLink /> {busy === 'link' ? 'Creating link…' : 'Copy link'}
            </button>
            <p className="share-note">
              {links
                ? 'Creates a view-only link. It’s encrypted, so only people with the link can open it.'
                : 'Share links work on the live site, not in this preview.'}
            </p>
          </>
        )}
      </div>

      <div className="share-actions">
        <button type="button" className="share-row" onClick={pdf} disabled={!!busy}>
          <IconFileText /> {busy === 'pdf' ? 'Making PDF…' : 'Download PDF'}
        </button>
        <button type="button" className="share-row" onClick={png} disabled={!!busy}>
          <IconImage /> {busy === 'png' ? 'Making image…' : 'Download image'}
        </button>
        <button type="button" className="share-row" onClick={text} disabled={!!busy}>
          <IconCopy /> Copy as text
        </button>
      </div>
      {error && (
        <p className="share-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
