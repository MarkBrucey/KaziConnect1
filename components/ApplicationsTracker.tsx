'use client';

// "Your applications": follow applications live, change the date, or cancel while they wait.
// A logged in student's applications come from their account; anyone else follows them by ID.

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { api } from '@/lib/clientApi';
import { jobFor, useFollowedApplications } from '@/lib/followed';
import type { Application } from '@/lib/contract';
import { useAuth } from './authContext';
import { ApplicationCard } from './ApplicationCard';
import { FLASH_KEY } from './JobsSection';
import { Band, Button, EmptyBox, ErrorText, LinkButton, SuccessText, Wrap } from './ui';

export function ApplicationsTracker() {
  const { user, ready } = useAuth();
  const followedApps = useFollowedApplications();
  const { apps, glowing, checkAll, save, track, cancel, reschedule, remove } = followedApps;
  const [flash, setFlash] = useState('');
  const [lookupError, setLookupError] = useState('');

  // The message left by the apply form, shown once.
  useEffect(() => {
    try {
      const message = sessionStorage.getItem(FLASH_KEY);
      if (message) { setFlash(message); sessionStorage.removeItem(FLASH_KEY); }
    } catch { /* no message */ }
  }, []);

  // Once we know who is logged in: bring in a student's own applications, then check and follow them all.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      if (user && user.role === 'student') {
        const res = await api<Application[]>('/api/me/applications');
        if (res.status === 200 && res.body) {
          for (const application of res.body) {
            const job = await jobFor(application.jobId);
            if (cancelled) return;
            save({ ...application, jobTitle: job ? job.title : undefined, county: job ? job.county : undefined });
          }
        }
      }
      if (!cancelled) await checkAll();
    })();
    return () => { cancelled = true; };
    // checkAll and save are stable; this runs again only when the person logs in or out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user && user.id]);

  async function lookup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setLookupError('');
    const problem = await track(String(new FormData(form).get('applicationId') || ''));
    if (problem) setLookupError(problem);
    else form.reset();
  }

  return (
    <section>
      <Band title="Your applications">Follow your applications live, change the date, or cancel while you wait.</Band>
      <Wrap className="pb-20 pt-12">
        {user && user.role === 'employer' ? (
          <EmptyBox title="This page is for people looking for work" action={<LinkButton href="/dashboard">Go to your dashboard</LinkButton>}>
            As an employer you see who applied for each job on your dashboard.
          </EmptyBox>
        ) : (
          <>
            <form onSubmit={lookup} className="mb-[30px] flex max-w-[560px] flex-col gap-3 sm:flex-row">
              <label className="sr-only" htmlFor="lookup-id">Application ID</label>
              <input id="lookup-id" name="applicationId" placeholder="Track an application by ID, for example app_1001" autoComplete="off" />
              <Button type="submit">Track</Button>
            </form>
            {lookupError ? <ErrorText className="-mt-3.5 mb-6">{lookupError}</ErrorText> : null}
            {flash ? <SuccessText>{flash}</SuccessText> : null}
            {apps.length ? (
              <ul className="m-0 grid list-none grid-cols-1 gap-6 p-0 min-[761px]:grid-cols-2">
                {apps.map((app) => (
                  <ApplicationCard key={app.applicationId} app={app} glowing={Boolean(glowing[app.applicationId])} actions={{ cancel, reschedule, remove }} />
                ))}
              </ul>
            ) : (
              <EmptyBox title="No applications yet" action={<LinkButton href="/#jobs">Browse jobs</LinkButton>}>
                Apply for a job and it will show here, with its status updating live.
              </EmptyBox>
            )}
          </>
        )}
        <p className="mt-8 text-sm text-muted">Looking for the other side? <Link href="/#jobs">See the job listings</Link>.</p>
      </Wrap>
    </section>
  );
}
