'use client';

// The top bar. What it offers depends on who is logged in, as on the original page.

import Link from 'next/link';
import { firstName } from '@/lib/format';
import { useAuth } from './authContext';
import { Button, Wrap, buttonClass } from './ui';

const navLink = 'text-[#5B5B5B] font-medium no-underline whitespace-nowrap hover:text-ink max-[1000px]:hidden';

export function Header() {
  const { user, ready, openAuth, signOut } = useAuth();

  return (
    <header className="sticky top-0 z-10 border-b border-line bg-white">
      <Wrap className="flex h-[76px] items-center justify-between gap-5">
        <Link href="/" className="whitespace-nowrap text-[26px] font-extrabold tracking-[-0.02em] no-underline">Kazi Connect</Link>
        <nav aria-label="Main" className="flex items-center gap-[22px] min-[1001px]:gap-9">
          {!ready ? null : !user ? (
            <>
              <Link href="/" className={navLink}>Home</Link>
              <Link href="/#how" className={navLink}>How it works</Link>
              <Link href="/#jobs" className={navLink}>Job listings</Link>
              <Link href="/applications" className={navLink}>Your applications</Link>
              <button type="button" onClick={() => openAuth('login')} className="cursor-pointer border-0 bg-transparent p-0 font-medium text-[#5B5B5B] hover:text-ink">Log In</button>
              <Button pill onClick={() => openAuth('register')}>Register</Button>
            </>
          ) : user.role === 'employer' ? (
            <>
              <Link href="/dashboard" className={navLink}>Dashboard</Link>
              <Link href="/#jobs" className={navLink}>Browse Jobs</Link>
              <span className="whitespace-nowrap font-semibold max-[760px]:hidden">{firstName(user.name)}</span>
              <button type="button" onClick={() => void signOut()} className={buttonClass('solid', { pill: true })}>Log Out</button>
            </>
          ) : (
            <>
              <Link href="/#jobs" className={navLink}>Job listings</Link>
              <Link href="/applications" className={navLink}>Your applications</Link>
              <span className="whitespace-nowrap font-semibold max-[760px]:hidden">{firstName(user.name)}</span>
              <button type="button" onClick={() => void signOut()} className={buttonClass('solid', { pill: true })}>Log Out</button>
            </>
          )}
        </nav>
      </Wrap>
    </header>
  );
}
