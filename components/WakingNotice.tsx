'use client';

// Shown while a request has been waiting more than 4 seconds, since the free host sleeps when quiet.

import { useEffect, useState } from 'react';
import { WAKING_EVENT } from '@/lib/clientApi';
import { Wrap } from './ui';

export function WakingNotice() {
  const [waking, setWaking] = useState(false);

  useEffect(() => {
    const listener = (e: Event): void => setWaking(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener(WAKING_EVENT, listener);
    return () => window.removeEventListener(WAKING_EVENT, listener);
  }, []);

  if (!waking) return null;
  return (
    <Wrap className="pt-4">
      <p role="status" className="m-0 rounded-xl border border-dashed border-line bg-cream px-[18px] py-3.5">
        Starting up the server. The first visit after a quiet spell can take up to a minute.
      </p>
    </Wrap>
  );
}
