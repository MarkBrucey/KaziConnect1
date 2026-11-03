'use client';

// Who is logged in, for every page. It also owns the login dialog (so any page can open it), notices
// when a login has expired, and catches the link in a password-reset email.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { RESET_TOKEN_KEY, api, session, setSessionExpiredHandler } from '@/lib/clientApi';
import type { AuthResponse, User } from '@/lib/contract';
import { AuthContext } from './authContext';
import type { AuthValue } from './authContext';
import { Dialog } from './Dialog';
import { AuthForm } from './AuthForm';
import type { AuthMode } from './AuthForm';

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; mode: AuthMode; message: string; kind: 'error' | 'success' }>({ open: false, mode: 'login', message: '', kind: 'error' });

  const openAuth = useCallback((mode: AuthMode = 'login', message = '', kind: 'error' | 'success' = 'error') => {
    setDialog({ open: true, mode, message, kind });
  }, []);

  const signedIn = useCallback((auth: AuthResponse) => {
    try { localStorage.removeItem('kazi-applications'); } catch { /* storage is off */ }
    session.set(auth.token);
    setUser(auth.user);
  }, []);

  const signOut = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' });
    session.clear();
    setUser(null);
    router.push('/');
  }, [router]);

  // Is the saved token still good?
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!session.token) { setReady(true); return; }
      const res = await api<User>('/api/me');
      if (cancelled) return;
      if (res.status === 200 && res.body) setUser(res.body);
      else session.clear();
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // A 401 anywhere means the login has run out.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      session.clear();
      setUser(null);
      openAuth('login', 'Your session has expired. Log in again.');
    });
    return () => setSessionExpiredHandler(null);
  }, [openAuth]);

  // The email link looks like https://site/#reset=<token>. Take the token out of the address bar at once,
  // keep it for this tab only, and show the new-password page.
  useEffect(() => {
    if (!window.location.hash.startsWith('#reset=')) return;
    try { sessionStorage.setItem(RESET_TOKEN_KEY, window.location.hash.slice('#reset='.length)); } catch { /* the token is lost; the page asks for a new link */ }
    history.replaceState(null, '', window.location.pathname + window.location.search);
    router.replace('/reset');
  }, [router]);

  const value = useMemo<AuthValue>(() => ({ user, ready, openAuth, signedIn, signOut }), [user, ready, openAuth, signedIn, signOut]);

  return (
    <AuthContext.Provider value={value}>
      {children}
      <Dialog open={dialog.open} onClose={() => setDialog((d) => ({ ...d, open: false }))} labelledBy="auth-title" width={470}>
        <AuthForm
          key={dialog.mode}
          mode={dialog.mode}
          message={dialog.message}
          messageKind={dialog.kind}
          onMode={(mode) => setDialog({ open: true, mode, message: '', kind: 'error' })}
          onSignedIn={(signed) => {
            setDialog((d) => ({ ...d, open: false }));
            if (signed.role === 'employer') router.push('/dashboard');
          }}
          onPasswordChanged={() => openAuth('login', 'Password changed. Log in with your new password.', 'success')}
        />
      </Dialog>
    </AuthContext.Provider>
  );
}
