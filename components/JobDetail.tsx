'use client';

// One job in full, with the form to apply and, once applied, the application's status updating live.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/clientApi';
import { cap } from '@/lib/format';
import { followed, useFollowedApplications } from '@/lib/followed';
import type { Job } from '@/lib/contract';
import { useAuth } from './authContext';
import { ApplicationCard } from './ApplicationCard';
import { ApplyForm } from './ApplyForm';
import { Price } from './JobsSection';
import { EmptyBox, LinkButton, StatusPill, Tag, UrgentTag, Wrap } from './ui';

export function JobDetail({ jobId }: { jobId: string }) {
  const { user } = useAuth();
  const [job, setJob] = useState<Job | null | undefined>(undefined);
  const [sent, setSent] = useState<string | null>(null);
  const follow = useFollowedApplications();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await api<Job>(`/api/jobs/${encodeURIComponent(jobId)}`);
      if (!cancelled) setJob(res.status === 200 && res.body ? res.body : null);
    })();
    return () => { cancelled = true; };
  }, [jobId]);

  const application = sent ? follow.apps.find((a) => a.applicationId === sent) : undefined;

  return (
    <Wrap className="pb-20 pt-10">
      <p className="mb-6 mt-0"><Link href="/#jobs">← All job listings</Link></p>
      {job === undefined ? (
        <p className="text-muted">Loading the job.</p>
      ) : job === null ? (
        <EmptyBox title="That job could not be found" action={<LinkButton href="/#jobs">See the job listings</LinkButton>}>
          It may have just closed or been removed.
        </EmptyBox>
      ) : (
        <div className="grid items-start gap-10 min-[900px]:grid-cols-[1fr_minmax(0,460px)]">
          <article>
            <div className="flex flex-wrap items-center gap-2.5">
              <Tag>{cap(job.category)}</Tag>
              {job.urgent ? <UrgentTag /> : null}
              <StatusPill status={job.status}>{job.status === 'active' ? 'Open' : 'Closed'}</StatusPill>
            </div>
            <h1 className="mb-2 mt-4 text-4xl font-extrabold leading-[1.15] tracking-tight">{job.title}</h1>
            <p className="m-0 text-lg text-muted">{job.area}, {job.county}</p>
            <p className="mb-0 mt-1 text-lg text-muted">{job.duration}</p>
            <p className="mb-0 mt-6 text-2xl font-extrabold tabular-nums"><Price payRange={job.payRange} /></p>
          </article>

          <aside className="rounded-2xl border border-line p-6 sm:p-8">
            {application ? (
              <>
                <h2 className="mb-3.5 mt-0 text-xl font-bold">Application sent</h2>
                <ul className="m-0 list-none p-0">
                  <ApplicationCard app={application} glowing={Boolean(follow.glowing[application.applicationId])}
                    actions={{ cancel: follow.cancel, reschedule: follow.reschedule, remove: follow.remove }} />
                </ul>
                <p className="mb-0 mt-4 text-sm text-muted">It is saved in this browser. See all of them under <Link href="/applications">your applications</Link>.</p>
              </>
            ) : user && user.role === 'employer' ? (
              <p className="m-0">You are logged in as an employer, so you cannot apply. <Link href="/dashboard">Go to your dashboard</Link>.</p>
            ) : job.status !== 'active' ? (
              <p className="m-0 text-center font-semibold text-bad">This job has closed and is no longer taking applications.</p>
            ) : (
              <>
                <h2 className="mb-4 mt-0 text-xl font-bold">Apply for this job</h2>
                <ApplyForm
                  job={job}
                  onSent={(a) => {
                    setSent(a.applicationId);
                    follow.save({ ...(followed.get(a.applicationId) || { applicationId: a.applicationId }) });
                    follow.subscribe(a.applicationId);
                  }}
                />
              </>
            )}
          </aside>
        </div>
      )}
    </Wrap>
  );
}
