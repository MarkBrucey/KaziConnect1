'use client';

// Log in, register and choose a new password as full pages (the same form the login dialog shows), so each
// has an address of its own: /login, /register and /reset.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthForm } from './AuthForm';
import type { AuthMode } from './AuthForm';
import { Wrap } from './ui';

// Moving from /reset to /login starts a new page, so the "password changed" notice travels in sessionStorage.
const NOTICE_KEY = 'kazi-auth-notice';

export function AuthPage({ initial }: { initial: AuthMode }) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>(initial);
  const [message, setMessage] = useState('');
  const [kind, setKind] = useState<'error' | 'success'>('error');

  useEffect(() => {
    try {
      const notice = sessionStorage.getItem(NOTICE_KEY);
      if (notice) { setMessage(notice); setKind('success'); sessionStorage.removeItem(NOTICE_KEY); }
    } catch { /* no notice */ }
  }, []);

  return (
    <Wrap className="py-12 sm:py-16">
      <div className="mx-auto w-full max-w-[470px] rounded-[18px] border border-line px-[22px] pb-6 pt-7 shadow-[0_30px_80px_rgba(17,17,17,0.12)] sm:px-10 sm:pb-8 sm:pt-9">
        <AuthForm
          key={mode}
          mode={mode}
          message={message}
          messageKind={kind}
          onMode={(next) => {
            setMessage('');
            setMode(next);
            if (next === 'login' || next === 'register') router.replace(`/${next}`);
          }}
          onSignedIn={(user) => router.push(user.role === 'employer' ? '/dashboard' : '/#jobs')}
          onPasswordChanged={() => {
            try { sessionStorage.setItem(NOTICE_KEY, 'Password changed. Log in with your new password.'); } catch { /* the notice is skipped */ }
            router.replace('/login');
          }}
        />
      </div>
    </Wrap>
  );
}
