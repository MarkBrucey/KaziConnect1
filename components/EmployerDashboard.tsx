'use client';

// The employer's dashboard: their job postings, and Event work.

import { useState } from 'react';
import { firstName } from '@/lib/format';
import { useAuth } from './authContext';
import { EmployerJobs } from './EmployerJobs';
import { EventWork } from './EventWork';
import { Band, Button, EmptyBox, LinkButton, Wrap } from './ui';

type Tab = 'jobs' | 'events';

export function EmployerDashboard() {
  const { user, ready, openAuth } = useAuth();
  const [tab, setTab] = useState<Tab>('jobs');

  if (!ready) return <Wrap className="py-16"><p className="text-muted">Loading.</p></Wrap>;

  if (!user) {
    return (
      <Wrap className="py-16">
        <EmptyBox title="Log in to see your dashboard" action={<Button onClick={() => openAuth('login')}>Log In</Button>}>
          The dashboard is where employers post jobs, see who applied and accept someone.
        </EmptyBox>
      </Wrap>
    );
  }
  if (user.role !== 'employer') {
    return (
      <Wrap className="py-16">
        <EmptyBox title="The dashboard is for employers" action={<LinkButton href="/applications">Your applications</LinkButton>}>
          You are logged in as someone looking for work.
        </EmptyBox>
      </Wrap>
    );
  }

  return (
    <section>
      <Band title={`Welcome back, ${firstName(user.name)}`}>Manage your job postings and view applicants.</Band>
      <Wrap className="pb-20 pt-10">
        <div role="group" aria-label="Dashboard sections" className="mb-7 flex flex-wrap gap-2.5">
          {([['jobs', 'Your job postings'], ['events', 'Event work']] as const).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}
              className="cursor-pointer rounded-full border border-edge bg-white px-5 py-[7px] text-[17px] font-medium text-[#555] hover:border-brown hover:text-ink aria-pressed:border-brown aria-pressed:bg-brown aria-pressed:font-semibold aria-pressed:text-white">
              {label}
            </button>
          ))}
        </div>
        {tab === 'jobs' ? <EmployerJobs /> : <EventWork onSeeJobs={() => setTab('jobs')} />}
      </Wrap>
    </section>
  );
}
