import { useState } from 'react';
import { IconLink, IconCopy, IconImage, IconFileText } from './Icons.jsx';
import { canShareLinks, createShareLink, updateShareLink, removeShareLink, shareUrl } from '../account/client.js';
import { topicPayload, folderPayload, exportPDF, exportPNG, topicText } from '../share/export.js';

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

/*
 * Share a topic, or the whole folder it's in: a view-only link, a PDF, a picture, or the text.
 * `folderId` opens it on the folder; a topic in a folder can switch between the two.
 */
export function SharePanel({ data, topicId, folderId, dispatch, toast, onDone }) {
  const topic = data.topics.find((t) => t.id === topicId);
  const groupId = folderId || topic?.groupId || null;
  const group = groupId ? (data.groups || []).find((g) => g.id === groupId) : null;
  const [scope, setScope] = useState(folderId ? 'folder' : 'topic');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const isFolder = scope === 'folder' && !!group;
  if (!isFolder && !topic) return null;
  const share = isFolder ? group.share : topic.share;
  const name = isFolder ? group.name : topic.name;
  const count = isFolder ? data.topics.filter((t) => t.groupId === group.id).length : 0;
  const links = canShareLinks();
  const payload = () => (isFolder ? folderPayload(data, group.id) : topicPayload(data, topic.id));
  const save = (next) => dispatch(isFolder ? { type: 'group/share', id: group.id, share: next } : { type: 'topic/share', id: topic.id, share: next });
  const what = isFolder ? 'folder' : 'topic';

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
    const p = payload();
    const next = share ? await updateShareLink(share, p) : await createShareLink(p);
    save(next);
    await copy(shareUrl(next));
    toast(share ? 'Link updated and copied' : `Link copied. Anyone with it can view this ${what}`);
  });
  const stop = run('stop', async () => {
    await removeShareLink(share.id);
    save(null);
    toast('Sharing turned off. The old link no longer works');
  });
  const pdf = run('pdf', async () => {
    await exportPDF(payload());
    onDone?.();
  });
  const png = run('png', async () => {
    await exportPNG(payload());
    onDone?.();
  });
  const text = run('text', async () => {
    await copy(topicText(payload()));
    toast('Text copied');
    onDone?.();
  });

  return (
    <div className="share-panel">
      <h2 className="share-title">Share “{name}”</h2>
      {group && topic && (
        <div className="seg wide share-scope" role="radiogroup" aria-label="What to share">
          {[
            ['topic', 'This topic'],
            ['folder', 'Whole folder'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={scope === id}
              className={scope === id ? 'seg-value' : ''}
              onClick={() => {
                setScope(id);
                setError(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {isFolder && <p className="share-sub">{count} topic{count === 1 ? '' : 's'}, shared together. People can flip between them.</p>}

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
              Anyone with the link can view this {what}. Copying it again updates what they see (last updated {ago(share.at)}).{' '}
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
