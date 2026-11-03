'use client';

// Job listings: filter by kind of work and county, and apply.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/clientApi';
import { cap, kesText } from '@/lib/format';
import type { Job } from '@/lib/contract';
import { useAuth } from './authContext';
import { ApplyForm } from './ApplyForm';
import { Dialog, DialogHead } from './Dialog';
import { Button, EmptyBox, Tag, TextButton, UrgentTag, Wrap } from './ui';

export const FLASH_KEY = 'kazi-flash';

export function Price({ payRange }: { payRange: { min: number; max: number } }) {
  const text = kesText(payRange);
  if (payRange.min === payRange.max) return <>{text}</>;
  const [from, to] = text.split(' to ');
  return <>{from} <small className="text-sm font-normal text-muted">to</small> {to}</>;
}

function JobCard({ job, canApply, onApply }: { job: Job; canApply: boolean; onApply: (id: string) => void }) {
  return (
    <li className="flex flex-col rounded-xl border border-edge bg-white px-6 pb-[22px] pt-6 hover:border-brown hover:shadow-[0_6px_18px_rgba(85,74,64,0.12)]">
      <div className="flex items-center justify-between gap-2.5">
        <Tag>{cap(job.category)}</Tag>
        {job.urgent ? <UrgentTag /> : null}
      </div>
      <h3 className="mb-2 mt-3.5 text-[21px] font-bold leading-[1.3] tracking-[-0.01em]">
        <Link href={`/jobs/${encodeURIComponent(job.id)}`} className="no-underline hover:underline">{job.title}</Link>
      </h3>
      <p className="m-0 text-muted">{job.area}, {job.county}</p>
      <p className="mb-0 mt-0.5 text-muted">{job.duration}</p>
      <div className="h-[22px]" />
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5 border-t border-line pt-[18px]">
        <span className="whitespace-nowrap font-extrabold tabular-nums"><Price payRange={job.payRange} /></span>
        {canApply ? <Button pill small onClick={() => onApply(job.id)}>Apply Now</Button> : null}
      </div>
    </li>
  );
}

export function JobsSection() {
  const { user } = useAuth();
  const router = useRouter();
  const [category, setCategory] = useState('');
  const [county, setCounty] = useState('');
  const [kinds, setKinds] = useState<string[]>([]);
  const [counties, setCounties] = useState<string[]>([]);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [applying, setApplying] = useState<{ job: Job | null; missing: boolean } | null>(null);
  const canApply = !user || user.role === 'student';

  // The chips and the county list come from the jobs that are open right now.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await api<Job[]>('/api/jobs?status=active');
      if (cancelled || res.status !== 200 || !res.body) return;
      setKinds([...new Set(res.body.map((j) => j.category))].sort());
      setCounties([...new Set(res.body.map((j) => j.county))].sort());
    })();
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ status: 'active' });
    if (county) params.set('county', county);
    if (category) params.set('category', category);
    setFailed(false);
    setJobs(null);
    const res = await api<Job[]>(`/api/jobs?${params}`);
    if (res.status !== 200 || !res.body) { setFailed(true); return; }
    setJobs(res.body);
  }, [county, category]);
  useEffect(() => { void load(); }, [load]);

  async function openApply(jobId: string) {
    const res = await api<Job>(`/api/jobs/${encodeURIComponent(jobId)}`);
    setApplying(res.status === 200 && res.body ? { job: res.body, missing: false } : { job: null, missing: true });
  }

  const where = [category ? cap(category) : null, county || null].filter(Boolean).join(' in ');
  const summary = failed
    ? 'The jobs could not be loaded. Check your connection and refresh the page.'
    : jobs === null
      ? 'Loading jobs.'
      : `${jobs.length} open ${jobs.length === 1 ? 'job' : 'jobs'}${where ? `: ${where}` : ''}.`;

  return (
    <section id="jobs">
      <div className="border-b border-line">
        <Wrap className="flex flex-wrap items-center justify-between gap-4 py-[18px]">
          <div role="group" aria-label="Kind of work" className="flex flex-wrap gap-2.5">
            {['', ...kinds].map((kind) => (
              <button key={kind || 'all'} type="button" aria-pressed={category === kind} onClick={() => setCategory(kind)}
                className="cursor-pointer rounded-full border border-edge bg-white px-5 py-[7px] text-[17px] font-medium text-[#555] hover:border-brown hover:text-ink aria-pressed:border-brown aria-pressed:bg-brown aria-pressed:font-semibold aria-pressed:text-white">
                {kind ? cap(kind) : 'All'}
              </button>
            ))}
          </div>
          <label className="sr-only" htmlFor="county">County</label>
          <select id="county" value={county} onChange={(e) => setCounty(e.target.value)} className="!w-full min-w-[190px] !rounded-full !px-4 !py-[9px] min-[761px]:!w-auto">
            <option value="">All counties</option>
            {counties.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Wrap>
      </div>
      <Wrap className="pb-14 pt-10 min-[761px]:pt-14">
        <h2 className="mb-3 text-4xl font-extrabold leading-[1.15] tracking-tight">Job listings</h2>
        <p aria-live="polite" className="mb-7 mt-0 text-muted">{summary}</p>
        <ul className="m-0 grid list-none grid-cols-1 gap-[26px] p-0 min-[761px]:grid-cols-2 min-[1181px]:grid-cols-3">
          {jobs && jobs.length === 0 ? (
            <li className="col-span-full">
              <EmptyBox title="No open jobs here yet" action={<Button onClick={() => { setCounty(''); setCategory(''); }}>Show all jobs</Button>}>
                Try another kind of work or another county.
              </EmptyBox>
            </li>
          ) : (jobs || []).map((job) => <JobCard key={job.id} job={job} canApply={canApply} onApply={openApply} />)}
        </ul>
      </Wrap>

      <Dialog open={applying !== null} onClose={() => setApplying(null)} labelledBy="apply-title">
        {applying && applying.job ? (
          <>
            <DialogHead id="apply-title" title={`Apply for ${applying.job.title}`}>
              {applying.job.area}, {applying.job.county}. {applying.job.duration}. {kesText(applying.job.payRange)}
            </DialogHead>
            {applying.job.status === 'active' ? (
              <ApplyForm
                job={applying.job}
                onSent={(application) => {
                  try { sessionStorage.setItem(FLASH_KEY, `Application sent. Your application ID is ${application.applicationId}.`); } catch { /* the message is skipped */ }
                  setApplying(null);
                  router.push('/applications');
                }}
              />
            ) : (
              <p className="text-center font-semibold text-bad">This job has closed and is no longer taking applications.</p>
            )}
          </>
        ) : applying ? (
          <p className="text-center font-semibold text-bad" id="apply-title">That job could not be found. It may have just closed.</p>
        ) : null}
        <p className="mb-0 mt-1 text-center text-muted"><TextButton onClick={() => setApplying(null)}>Not now</TextButton></p>
      </Dialog>
    </section>
  );
}
