import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconChevronRight, IconArrowLeft, IconClose, IconLock } from './Icons.jsx';
import { Avatar } from '../account/avatar.jsx';
import { PasswordField, Status, Spinner, useUsernameCheck } from './AuthScreen.jsx';
import { checkUsername, checkPassword } from '../account/rules.js';
import { changeUsername, changePassword, deleteAccount } from '../account/client.js';

const TITLES = { main: 'Account', username: 'Username', password: 'Change password', delete: 'Delete account' };

function syncText({ status, lastSynced }, mode) {
  if (mode !== 'server') return 'Saved, encrypted, in this browser';
  if (status === 'saving') return 'Syncing…';
  if (status === 'offline') return 'Offline: saved on this device for now';
  if (status === 'too-big') return 'Too big to save to your account';
  if (status === 'full') return 'This browser’s storage is full';
  if (status === 'signed-out') return 'Signed out: sign in again to save';
  if (!lastSynced) return 'Synced';
  const s = Math.round((Date.now() - lastSynced) / 1000);
  return s < 60 ? 'Synced just now' : s < 3600 ? `Synced ${Math.round(s / 60)} min ago` : s < 86400 ? `Synced ${Math.round(s / 3600)} h ago` : 'Synced';
}

export function AccountSheet({ user, keyBox, mode, sync, onSyncNow, onClose, onUser, onSignOut, onDeleted }) {
  const [page, setPage] = useState('main');
  const [dir, setDir] = useState('in');
  const [, tick] = useState(0);
  const sheet = useRef(null);
  const go = (p) => {
    setDir(p === 'main' ? 'back' : 'in');
    setPage(p);
  };

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15000); // keep "Saved n min ago" fresh
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (page === 'main') onClose();
      else go('main');
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      clearInterval(t);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [page, onClose]);

  return createPortal(
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={sheet} className="sheet" role="dialog" aria-modal="true" aria-label={TITLES[page]}>
        <header className="sheet-nav">
          {page !== 'main' && (
            <button type="button" className="icon-btn sheet-back" onClick={() => go('main')} title="Back" aria-label="Back">
              <IconArrowLeft />
            </button>
          )}
          <h2 className="sheet-title">{TITLES[page]}</h2>
          <button type="button" className="icon-btn sheet-close" onClick={onClose} title="Close" aria-label="Close">
            <IconClose />
          </button>
        </header>
        <div className={`sheet-page is-${dir}`} key={page}>
          {page === 'main' && <Main user={user} mode={mode} sync={sync} onSyncNow={onSyncNow} go={go} onSignOut={onSignOut} />}
          {page === 'username' && <EditUsername user={user} onSaved={(u) => (onUser(u), go('main'))} />}
          {page === 'password' && <EditPassword user={user} keyBox={keyBox} onSaved={(u, kb) => (onUser(u, kb), go('main'))} />}
          {page === 'delete' && <DeleteAccount user={user} keyBox={keyBox} onDeleted={onDeleted} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Main({ user, mode, sync, onSyncNow, go, onSignOut }) {
  const since = new Date(user.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return (
    <>
      <div className="acct-hero">
        <Avatar username={user.username} size="lg" />
        <div>
          <div className="acct-handle">@{user.username}</div>
          <div className="acct-email">Member since {since}</div>
        </div>
      </div>

      <div className="ios-group">
        <button type="button" className="ios-row" onClick={() => go('username')}>
          <span className="ios-label">Username</span>
          <span className="ios-value">@{user.username}</span>
          <IconChevronRight className="ios-chevron" />
        </button>
      </div>

      <h3 className="ios-group-title">Security</h3>
      <div className="ios-group">
        <button type="button" className="ios-row" onClick={() => go('password')}>
          <span className="ios-label">Change password</span>
          <IconChevronRight className="ios-chevron" />
        </button>
        <div className="ios-row is-static">
          <span className="ios-label">
            <IconLock className="ios-label-icon" /> End-to-end encryption
          </span>
          <span className="ios-value">On</span>
        </div>
      </div>
      <p className="ios-footnote">
        Your notes are encrypted on your device with a key only your password can unlock. Nobody else, including POST IT, can
        read them.
      </p>

      <h3 className="ios-group-title">Sync</h3>
      <div className="ios-group">
        <div className="ios-row is-static">
          <span className="ios-label">Notes</span>
          <span className={`ios-value ${/^Synced/.test(syncText(sync, mode)) ? 'is-synced' : ''}`}>{syncText(sync, mode)}</span>
          {mode === 'server' && (
            <button type="button" className="sync-now" onClick={onSyncNow} disabled={sync.status === 'saving'}>
              Sync now
            </button>
          )}
        </div>
      </div>
      <p className="ios-footnote">
        {mode !== 'server'
          ? 'Syncing works on the live site.'
          : `Your topics and notes are saved to your account and show up on any computer or phone where you sign in as @${user.username}.`}
      </p>

      <div className="acct-actions">
        <button type="button" className="btn" onClick={onSignOut}>
          Sign out
        </button>
        <button type="button" className="acct-delete" onClick={() => go('delete')}>
          Delete account…
        </button>
      </div>
    </>
  );
}

function EditUsername({ user, onSaved }) {
  const [value, setValue] = useState(user.username);
  const [check, setCheck] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useUsernameCheck(value, setCheck, user.username);
  const save = async (e) => {
    e.preventDefault();
    const v = checkUsername(value);
    if (!v.ok) return setError({ text: v.error });
    if (v.username === user.username) return onSaved(user);
    if (check?.state === 'bad') return setError({ text: check.text });
    setBusy(true);
    try {
      onSaved((await changeUsername(v.username)).user);
    } catch (err) {
      setBusy(false);
      setError({ text: err.message });
    }
  };
  return (
    <form onSubmit={save}>
      <div className="ios-fields">
        <label className={`ios-field ${error ? 'is-bad' : ''}`}>
          <span className="ios-field-at">@</span>
          <input
            value={value}
            onChange={(e) => {
              setError(null);
              setValue(e.target.value.replace(/^@/, '').replace(/\s/g, ''));
            }}
            aria-label="Username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={21}
            autoFocus
          />
        </label>
      </div>
      <Status error={error} check={check} />
      <p className="ios-footnote">At least 2 characters with one letter. Letters, numbers, periods and underscores. Usernames are first come, first served: your old one becomes free for others.</p>
      <button type="submit" className="auth-primary" disabled={busy}>
        {busy ? <Spinner label="Saving" /> : 'Save'}
      </button>
    </form>
  );
}

function EditPassword({ user, keyBox, onSaved }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [verify, setVerify] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    if (!current) return setError({ field: 'current', text: 'Enter your current password.' });
    const pw = checkPassword(next);
    if (!pw.ok) return setError({ field: 'next', text: pw.error });
    if (next !== verify) return setError({ field: 'verify', text: 'The new passwords don’t match.' });
    if (next === current) return setError({ field: 'next', text: 'Choose a password different from your current one.' });
    setBusy(true);
    try {
      const res = await changePassword(user, keyBox, current, next);
      onSaved(res.user, res.keyBox);
    } catch (err) {
      setBusy(false);
      setError({ field: err.field, text: err.message });
    }
  };
  return (
    <form onSubmit={save}>
      <div className="ios-fields">
        <PasswordField value={current} onChange={setCurrent} placeholder="Current password" autoComplete="current-password" bad={error?.field === 'current'} autoFocus />
      </div>
      <div className="ios-fields">
        <PasswordField value={next} onChange={setNext} placeholder="New password" autoComplete="new-password" bad={error?.field === 'next'} />
        <PasswordField value={verify} onChange={setVerify} placeholder="Type it again" autoComplete="new-password" bad={error?.field === 'verify'} />
      </div>
      <Status error={error} hint="At least 8 characters. Your other devices will be signed out and need the new password." />
      <button type="submit" className="auth-primary" disabled={busy}>
        {busy ? <Spinner label="Changing password" /> : 'Change password'}
      </button>
    </form>
  );
}

function DeleteAccount({ user, keyBox, onDeleted }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const remove = async (e) => {
    e.preventDefault();
    if (!password) return setError({ text: 'Enter your password to delete your account.' });
    setBusy(true);
    try {
      await deleteAccount(user, keyBox, password);
      onDeleted();
    } catch (err) {
      setBusy(false);
      setError({ text: err.message });
    }
  };
  return (
    <form onSubmit={remove}>
      <p className="ios-footnote is-lead">
        This permanently deletes <strong>@{user.username}</strong> and every topic and note in it, on all your devices. It can’t
        be undone. Your username becomes free for someone else.
      </p>
      <div className="ios-fields">
        <PasswordField value={password} onChange={setPassword} placeholder="Password" autoComplete="current-password" bad={!!error} autoFocus />
      </div>
      <Status error={error} />
      <button type="submit" className="auth-primary is-danger" disabled={busy}>
        {busy ? <Spinner label="Deleting" /> : 'Delete account'}
      </button>
    </form>
  );
}
