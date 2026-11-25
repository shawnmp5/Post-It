import { useEffect, useRef, useState } from 'react';
import { Logo, IconEye, IconEyeOff, IconLock, IconCheck } from './Icons.jsx';
import { checkUsername, checkEmail, checkPassword } from '../account/rules.js';
import { isUsernameAvailable, signUp, signIn, unlock } from '../account/client.js';

/*
 * The first thing a new visitor sees: Create Account (or Sign In). Also the Unlock
 * screen, for a device that's still signed in but has lost the key (site data cleared).
 */
export function AuthScreen({ demo, locked, onDone, onSignOut }) {
  const [view, setView] = useState(locked ? 'unlock' : 'signup');
  return (
    <div className="auth">
      <div className="auth-backdrop" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="auth-card" key={view}>
        {view === 'signup' && <SignUp onDone={onDone} onSwitch={() => setView('signin')} />}
        {view === 'signin' && <SignIn onDone={onDone} onSwitch={() => setView('signup')} />}
        {view === 'unlock' && <Unlock locked={locked} onDone={onDone} onSignOut={onSignOut} />}
        {demo && <p className="auth-demo">Preview: accounts here are kept in this browser only.</p>}
      </div>
    </div>
  );
}

function SignUp({ onDone, onSwitch }) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [check, setCheck] = useState(null); // { state: 'checking' | 'ok' | 'bad', text }
  const [error, setError] = useState(null); // { field, text }
  const [busy, setBusy] = useState(false);
  const first = useRef(null);
  useEffect(() => first.current?.focus(), []);

  useUsernameCheck(username, setCheck);

  const submit = async (e) => {
    e.preventDefault();
    const u = checkUsername(username);
    if (!u.ok) return setError({ field: 'username', text: u.error });
    if (check?.state === 'bad') return setError({ field: 'username', text: check.text });
    const em = checkEmail(email);
    if (!em.ok) return setError({ field: 'email', text: em.error });
    const pw = checkPassword(password);
    if (!pw.ok) return setError({ field: 'password', text: pw.error });
    if (password !== confirm) return setError({ field: 'confirm', text: 'The passwords don’t match.' });
    setError(null);
    setBusy(true);
    try {
      onDone(await signUp({ username: u.username, email: em.email, password }), { isNew: true });
    } catch (err) {
      setBusy(false);
      setError({ field: err.field, text: err.message });
    }
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <div className="auth-logo">
        <Logo size={44} />
      </div>
      <h1 className="auth-title">Create Your Account</h1>
      <p className="auth-sub">One account for all your walls, on every device.</p>

      <div className={`ios-fields ${error ? 'has-error' : ''}`}>
        <label className={`ios-field ${error?.field === 'username' ? 'is-bad' : ''}`}>
          <span className="ios-field-at" aria-hidden="true">
            @
          </span>
          <input
            ref={first}
            value={username}
            onChange={(e) => setUsername(e.target.value.replace(/^@/, '').replace(/\s/g, ''))}
            placeholder="username"
            aria-label="Username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={21}
          />
        </label>
        <label className={`ios-field ${error?.field === 'email' ? 'is-bad' : ''}`}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" aria-label="Email" autoComplete="email" />
        </label>
        <PasswordField value={password} onChange={setPassword} placeholder="Password" autoComplete="new-password" bad={error?.field === 'password'} />
        <PasswordField value={confirm} onChange={setConfirm} placeholder="Confirm Password" autoComplete="new-password" bad={error?.field === 'confirm'} />
      </div>

      <Status error={error} check={username ? check : null} hint="Usernames need at least 2 characters and one letter. Passwords need 8 or more." />

      <button type="submit" className="auth-primary" disabled={busy}>
        {busy ? <Spinner label="Creating Account" /> : 'Create Account'}
      </button>

      <p className="auth-fine">
        <IconLock /> Your notes are end-to-end encrypted with your password. Nobody else can read them, so if you forget your
        password they can’t be recovered.
      </p>
      <p className="auth-switch">
        Already have an account?{' '}
        <button type="button" className="auth-link" onClick={onSwitch}>
          Sign In
        </button>
      </p>
    </form>
  );
}

function SignIn({ onDone, onSwitch }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const first = useRef(null);
  useEffect(() => first.current?.focus(), []);

  const submit = async (e) => {
    e.preventDefault();
    if (!login.trim()) return setError({ field: 'login', text: 'Enter your username or email.' });
    if (!password) return setError({ field: 'password', text: 'Enter your password.' });
    setError(null);
    setBusy(true);
    try {
      onDone(await signIn({ login: login.trim(), password }), { isNew: false });
    } catch (err) {
      setBusy(false);
      setError({ field: err.field || 'password', text: err.status === 401 || !err.status ? 'That username or password isn’t right.' : err.message });
    }
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <div className="auth-logo">
        <Logo size={44} />
      </div>
      <h1 className="auth-title">Sign In</h1>
      <p className="auth-sub">Welcome back to POST IT.</p>
      <div className={`ios-fields ${error ? 'has-error' : ''}`}>
        <label className={`ios-field ${error?.field === 'login' ? 'is-bad' : ''}`}>
          <input
            ref={first}
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder="Username or Email"
            aria-label="Username or email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        <PasswordField value={password} onChange={setPassword} placeholder="Password" autoComplete="current-password" bad={error?.field === 'password'} />
      </div>
      <Status error={error} />
      <button type="submit" className="auth-primary" disabled={busy}>
        {busy ? <Spinner label="Signing In" /> : 'Sign In'}
      </button>
      <p className="auth-switch">
        New to POST IT?{' '}
        <button type="button" className="auth-link" onClick={onSwitch}>
          Create an account
        </button>
      </p>
    </form>
  );
}

function Unlock({ locked, onDone, onSignOut }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!password) return setError({ field: 'password', text: 'Enter your password.' });
    setBusy(true);
    try {
      const key = await unlock(locked.user, locked.keyBox, password);
      onDone({ user: locked.user, keyBox: locked.keyBox, key }, { isNew: false });
    } catch (err) {
      setBusy(false);
      setError({ field: 'password', text: err.message });
    }
  };
  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <div className="auth-avatar">{locked.user.username.charAt(0).toUpperCase()}</div>
      <h1 className="auth-title">@{locked.user.username}</h1>
      <p className="auth-sub">Enter your password to unlock your notes on this device.</p>
      <div className={`ios-fields ${error ? 'has-error' : ''}`}>
        <PasswordField value={password} onChange={setPassword} placeholder="Password" autoComplete="current-password" bad={!!error} autoFocus />
      </div>
      <Status error={error} />
      <button type="submit" className="auth-primary" disabled={busy}>
        {busy ? <Spinner label="Unlocking" /> : 'Unlock'}
      </button>
      <p className="auth-switch">
        Not you?{' '}
        <button type="button" className="auth-link" onClick={onSignOut}>
          Sign Out
        </button>
      </p>
    </form>
  );
}

/* ---------------- shared bits ---------------- */

export function PasswordField({ value, onChange, placeholder, autoComplete, bad, autoFocus }) {
  const [show, setShow] = useState(false);
  return (
    <label className={`ios-field ${bad ? 'is-bad' : ''}`}>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        spellCheck={false}
      />
      <button
        type="button"
        className="ios-field-eye"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        title={show ? 'Hide password' : 'Show password'}
        tabIndex={-1}
      >
        {show ? <IconEyeOff /> : <IconEye />}
      </button>
    </label>
  );
}

// Checks a username as it's typed: rules first, then whether it's taken.
export function useUsernameCheck(username, setCheck, current) {
  useEffect(() => {
    if (!username) return setCheck(null);
    const v = checkUsername(username);
    if (!v.ok) return setCheck({ state: 'bad', text: v.error });
    if (current && v.username === current) return setCheck({ state: 'ok', text: 'This is your username.' });
    setCheck({ state: 'checking', text: 'Checking…' });
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await isUsernameAvailable(v.username);
        if (!live) return;
        if (r.error) setCheck({ state: 'bad', text: r.error });
        else setCheck(r.available ? { state: 'ok', text: `@${v.username} is available.` } : { state: 'bad', text: `@${v.username} is already taken.` });
      } catch {
        if (live) setCheck(null);
      }
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [username, setCheck, current]);
}

export function Status({ error, check, hint }) {
  if (error) return <p className="auth-status is-bad" role="alert">{error.text}</p>;
  if (check)
    return (
      <p className={`auth-status is-${check.state}`} aria-live="polite">
        {check.state === 'ok' && <IconCheck />}
        {check.text}
      </p>
    );
  return hint ? <p className="auth-status">{hint}</p> : <p className="auth-status" />;
}

export function Spinner({ label }) {
  return (
    <span className="auth-busy">
      <span className="spinner" aria-hidden="true" />
      {label}…
    </span>
  );
}
