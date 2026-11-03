'use client';

// Log in, register, forgot password and choose a new password: one form with four modes, used both by the
// login dialog and by the /login, /register and /reset pages.

import { useState } from 'react';
import type { FormEvent } from 'react';
import { RESET_TOKEN_KEY, api, messageOf, session } from '@/lib/clientApi';
import type { AuthResponse, Message, User } from '@/lib/contract';
import { useAuth } from './authContext';
import { DialogHead } from './Dialog';
import { Button, ErrorText, Field, SuccessText, TextButton } from './ui';

export type AuthMode = 'login' | 'register' | 'forgot' | 'reset';

export function AuthForm({ mode, message = '', messageKind = 'error', onMode, onSignedIn, onPasswordChanged, withHeading = true }: {
  mode: AuthMode;
  message?: string;
  messageKind?: 'error' | 'success';
  onMode: (mode: AuthMode) => void;
  onSignedIn: (user: User) => void;
  onPasswordChanged: () => void;
  withHeading?: boolean;
}) {
  const { signedIn } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState('');
  const login = mode === 'login';
  const register = mode === 'register';

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const data = new FormData(e.currentTarget);
    const text = (name: string): string => String(data.get(name) || '');

    if (mode === 'forgot') {
      setBusy(true);
      const res = await api<Message>('/api/auth/password-resets', { method: 'POST', body: { email: text('email').trim() } });
      setBusy(false);
      if (res.status !== 202) { setError(messageOf(res, 'That did not work. Try again.')); return; }
      setSent(res.body ? res.body.message : '');
      return;
    }

    if (mode === 'reset') {
      const password = text('password');
      if (password !== text('confirm')) { setError('The two passwords are not the same.'); return; }
      let token = '';
      try { token = sessionStorage.getItem(RESET_TOKEN_KEY) || ''; } catch { /* no token */ }
      setBusy(true);
      const res = await api('/api/auth/password', { method: 'PUT', body: { token, password } });
      setBusy(false);
      if (res.status !== 204) { setError(messageOf(res, 'That did not work. Try again.')); return; }
      try { sessionStorage.removeItem(RESET_TOKEN_KEY); } catch { /* nothing to remove */ }
      session.clear();
      onPasswordChanged();
      return;
    }

    const body: Record<string, unknown> = { email: text('email').trim(), password: text('password') };
    if (register) { body.name = text('name').trim(); body.role = text('role') || 'student'; }
    setBusy(true);
    const res = await api<AuthResponse>(login ? '/api/auth/login' : '/api/auth/register', { method: 'POST', body });
    setBusy(false);
    if ((res.status !== 200 && res.status !== 201) || !res.body) { setError(messageOf(res, 'That did not work. Try again.')); return; }
    signedIn(res.body);
    onSignedIn(res.body.user);
  }

  const heading = mode === 'forgot' ? 'Reset your password' : mode === 'reset' ? 'Choose a new password' : 'Kazi Connect';
  const sub = mode === 'forgot' || mode === 'reset' ? 'Kazi Connect' : "Kenya's fastest way to find work nearby";

  return (
    <div>
      {withHeading ? <DialogHead id="auth-title" title={heading}>{sub}</DialogHead> : null}

      {login || register ? (
        <div role="tablist" className="mb-[22px] grid grid-cols-2 rounded-[10px] bg-cream p-1">
          {(['login', 'register'] as const).map((tab) => (
            <button key={tab} type="button" role="tab" aria-selected={mode === tab} onClick={() => onMode(tab)}
              className={`cursor-pointer rounded-lg border-0 p-2.5 font-semibold ${mode === tab ? 'bg-white text-ink shadow-[0_1px_3px_rgba(17,17,17,0.12)]' : 'bg-transparent text-[#8A847E]'}`}>
              {tab === 'login' ? 'Log In' : 'Register'}
            </button>
          ))}
        </div>
      ) : null}

      {message ? <p className={`mb-3.5 font-semibold ${messageKind === 'success' ? 'text-ok' : 'text-bad'}`}>{message}</p> : null}

      {sent ? (
        <div>
          <SuccessText className="!mb-1.5">{sent}</SuccessText>
          <p className="m-0 text-muted">Check your spam folder too. You can close this window.</p>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="grid gap-4">
          {mode === 'forgot' ? (
            <p className="m-0">Enter the email you registered with. If it has an account, we will email you a link to choose a new password.</p>
          ) : null}
          {register ? (
            <Field label="Full name"><input name="name" required autoComplete="name" placeholder="Your name" /></Field>
          ) : null}
          {mode !== 'reset' ? (
            <Field label="Email"><input name="email" type="email" required autoComplete="email" placeholder="you@example.com" /></Field>
          ) : null}
          {login || register ? (
            <Field label="Password" hint={register ? 'At least 8 characters' : undefined}>
              <input name="password" type="password" required autoComplete={login ? 'current-password' : 'new-password'} placeholder={login ? 'Your password' : 'Choose a password'} />
            </Field>
          ) : null}
          {login ? (
            <p className="-mt-2 mb-0 text-right">
              <TextButton onClick={() => onMode('forgot')} className="!font-medium no-underline">Forgot password?</TextButton>
            </p>
          ) : null}
          {mode === 'reset' ? (
            <>
              <Field label="New password" hint="At least 8 characters">
                <input name="password" type="password" required autoComplete="new-password" placeholder="Choose a new password" />
              </Field>
              <Field label="Type it again"><input name="confirm" type="password" required autoComplete="new-password" placeholder="The same password" /></Field>
            </>
          ) : null}
          {register ? (
            <div>
              <p className="mb-[7px] mt-0 font-semibold">I want to</p>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <label className="flex cursor-pointer items-center gap-2.5 rounded-[10px] border border-field px-3.5 py-3 font-semibold has-[:checked]:border-brown has-[:checked]:bg-cream">
                  <input type="radio" name="role" value="student" defaultChecked /> Find work
                </label>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-[10px] border border-field px-3.5 py-3 font-semibold has-[:checked]:border-brown has-[:checked]:bg-cream">
                  <input type="radio" name="role" value="employer" /> Hire
                </label>
              </div>
            </div>
          ) : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button type="submit" full disabled={busy}>
            {mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Save new password' : login ? 'Log In' : 'Create account'}
          </Button>
        </form>
      )}

      {mode === 'forgot' ? (
        <p className="mb-0 mt-1 text-center text-muted"><TextButton onClick={() => onMode('login')}>Back to log in</TextButton></p>
      ) : null}
      {mode === 'reset' ? (
        <p className="mb-0 mt-1 text-center text-muted"><TextButton onClick={() => onMode('forgot')}>Ask for a new link</TextButton></p>
      ) : null}
      {login || register ? (
        <>
          <p className="mb-0 mt-1 text-center text-muted">
            {login
              ? <>No account? <TextButton onClick={() => onMode('register')}>Register here</TextButton></>
              : <>Already have an account? <TextButton onClick={() => onMode('login')}>Log in</TextButton></>}
          </p>
          <p className="mb-0 mt-[18px] rounded-[10px] bg-cream px-3.5 py-3 text-sm text-muted">
            To try it: log in as <strong className="text-ink">employer@kaziconnect.demo</strong> or <strong className="text-ink">student@kaziconnect.demo</strong> with the password <strong className="text-ink">KaziDemo2026</strong>.
          </p>
        </>
      ) : null}
    </div>
  );
}
