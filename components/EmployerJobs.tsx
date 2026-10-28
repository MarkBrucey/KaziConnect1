'use client';

// The employer's own job postings: who applied, accepting one applicant, closing and reopening, posting a new job.

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, messageOf } from '@/lib/clientApi';
import { COUNTIES, KINDS, cap, kesText, readable } from '@/lib/format';
import type { Applicant, Application, EmployerJob, Job } from '@/lib/contract';
import { Dialog, DialogHead } from './Dialog';
import { Button, EmptyBox, ErrorText, Field, ListCard, StatusPill, SuccessText, Tag, TextButton, UrgentTag } from './ui';

const APPLICANT_STATUS: Record<string, string> = {
  pending: 'Waiting for a decision', accepted: 'Accepted', filled: 'Filled', cancelled: 'Cancelled',
};

function Applicants({ jobId, applicants, onAccept }: { jobId: string; applicants: Applicant[]; onAccept: (a: Applicant) => void }) {
  return (
    <ul aria-label={`Applicants for ${jobId}`} className="m-0 mt-[18px] list-none border-t border-line p-0">
      {applicants.length === 0 ? (
        <li className="py-3.5 text-[15px] text-muted">Nobody has applied yet.</li>
      ) : applicants.map((a) => (
        <li key={a.applicationId} className="grid items-center gap-x-4 gap-y-1.5 border-b border-line py-3.5 min-[761px]:grid-cols-[1fr_auto]">
          <div>
            <p className="m-0">
              <strong>{a.studentName || a.studentId}</strong>{' '}
              <span className="ml-1.5"><StatusPill status={a.status}>{APPLICANT_STATUS[a.status] || a.status}</StatusPill></span>
            </p>
            <p className="m-0 text-[15px] text-muted">
              Can start {readable(a.preferredDate)}{a.note ? `. Note: ${a.note}` : ''}. Application {a.applicationId}
            </p>
          </div>
          {a.status === 'pending' ? <Button onClick={() => onAccept(a)}>Accept</Button> : null}
        </li>
      ))}
    </ul>
  );
}

function EmployerJobCard({ job, onChanged }: { job: EmployerJob; onChanged: (message: string) => void }) {
  const [applicants, setApplicants] = useState<Applicant[] | null>(null);
  const [error, setError] = useState('');
  const open = job.status === 'active';
  // A job has one place: once someone is accepted it is filled for good, so it is not offered for reopening.
  // (Only known once the applicants are loaded; otherwise the API says so if Reopen is pressed.)
  const filled = applicants !== null && applicants.some((a) => a.status === 'accepted');

  const loadApplicants = useCallback(async () => {
    const res = await api<Applicant[]>(`/api/jobs/${encodeURIComponent(job.id)}/applications`);
    if (res.status !== 200 || !res.body) { setError(messageOf(res, 'Applicants could not be loaded.')); return false; }
    setApplicants(res.body);
    return true;
  }, [job.id]);

  async function toggleApplicants() {
    setError('');
    if (applicants) { setApplicants(null); return; }
    await loadApplicants();
  }

  async function accept(a: Applicant) {
    if (!confirm('Accept this applicant? Everyone else waiting for this job will be told it is filled, and the job will close.')) return;
    setError('');
    const res = await api<Application>(`/api/applications/${encodeURIComponent(a.applicationId)}`, { method: 'PATCH', body: { status: 'accepted' } });
    if (res.status !== 200) { setError(messageOf(res, 'That did not work. Try again.')); return; }
    onChanged(`Accepted ${a.studentName || a.studentId}. The job is now closed and the other applicants have been told.`);
    await loadApplicants();
  }

  async function setStatus(status: 'active' | 'closed') {
    if (status === 'closed' && !confirm('Close this job? Anyone still waiting will be told it is filled.')) return;
    setError('');
    const res = await api<Job>(`/api/jobs/${encodeURIComponent(job.id)}`, { method: 'PATCH', body: { status } });
    if (res.status !== 200 || !res.body) { setError(messageOf(res, 'That did not work. Try again.')); return; }
    onChanged(status === 'closed' ? `${res.body.title} is closed.` : `${res.body.title} is open again.`);
  }

  return (
    <ListCard id={`emp-${job.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5"><Tag>{cap(job.category)}</Tag>{job.urgent ? <UrgentTag /> : null}</div>
          <h4 className="mb-1 mt-2 text-xl font-bold">{job.title}</h4>
          <p className="m-0 text-muted">{job.area}, {job.county}. {job.duration}. {kesText(job.payRange)}</p>
        </div>
        <StatusPill status={open ? 'active' : 'closed'}>{open ? 'Open' : filled ? 'Filled' : 'Closed'}</StatusPill>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <span className="font-semibold">{job.pendingApplications} waiting for a decision</span>
        <Button look="outline" onClick={toggleApplicants}>View applicants</Button>
        {filled && !open ? null : <Button look={open ? 'danger' : 'outline'} onClick={() => setStatus(open ? 'closed' : 'active')}>{open ? 'Close job' : 'Reopen job'}</Button>}
      </div>
      {error ? <ErrorText className="mt-3">{error}</ErrorText> : null}
      {applicants ? <Applicants jobId={job.id} applicants={applicants} onAccept={accept} /> : null}
    </ListCard>
  );
}

function PostJobDialog({ open, onClose, onPosted }: { open: boolean; onClose: () => void; onPosted: (job: Job) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const d = new FormData(e.currentTarget);
    const text = (name: string): string => String(d.get(name) || '').trim();
    const body = {
      title: text('title'), category: text('category'), county: text('county'), area: text('area'), duration: text('duration'),
      urgent: d.get('urgent') === 'on',
      payRange: { min: Number(d.get('min')), max: Number(d.get('max')) },
    };
    setBusy(true);
    const res = await api<Job>('/api/jobs', { method: 'POST', body });
    setBusy(false);
    if (res.status !== 201 || !res.body) { setError(messageOf(res, 'The job was not posted. Try again.')); return; }
    onPosted(res.body);
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy="post-title" width={600}>
      <DialogHead id="post-title" title="Post a Job">Students nearby will see it straight away.</DialogHead>
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Job title"><input name="title" required maxLength={100} placeholder="For example, Fix leaking kitchen sink" /></Field>
        <div className="grid gap-3.5 min-[761px]:grid-cols-2">
          <Field label="Kind of work"><input name="category" required list="kinds" maxLength={40} placeholder="For example, plumbing" /></Field>
          <Field label="How long it takes"><input name="duration" required maxLength={40} placeholder="For example, about 2 hours" /></Field>
        </div>
        <div className="grid gap-3.5 min-[761px]:grid-cols-2">
          <Field label="County"><input name="county" required list="counties" maxLength={40} placeholder="For example, Nairobi" /></Field>
          <Field label="Estate or area"><input name="area" required maxLength={60} placeholder="For example, Westlands" /></Field>
        </div>
        <div className="grid gap-3.5 min-[761px]:grid-cols-2">
          <Field label="Pay from (KES)"><input name="min" type="number" required min={0} step="any" placeholder="1500" /></Field>
          <Field label="Pay up to (KES)" hint="Same as above for a fixed amount"><input name="max" type="number" required min={0} step="any" placeholder="1500" /></Field>
        </div>
        <label className="flex items-center gap-2.5 font-semibold"><input type="checkbox" name="urgent" className="!w-auto" /> Mark as urgent</label>
        <datalist id="kinds">{KINDS.map((k) => <option key={k} value={k} />)}</datalist>
        <datalist id="counties">{COUNTIES.map((c) => <option key={c} value={c} />)}</datalist>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Button type="submit" full disabled={busy}>Post job</Button>
      </form>
      <p className="mb-0 mt-1 text-center text-muted"><TextButton onClick={onClose}>Not now</TextButton></p>
    </Dialog>
  );
}

export function EmployerJobs() {
  const [jobs, setJobs] = useState<EmployerJob[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    const res = await api<EmployerJob[]>('/api/me/jobs');
    if (res.status !== 200 || !res.body) { setFailed(true); return; }
    setFailed(false);
    setJobs(res.body);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const changed = async (text: string) => { setMessage(text); await load(); };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h3 className="m-0 text-[22px] font-bold">Your job postings</h3>
        <Button onClick={() => setPosting(true)}>Post a Job</Button>
      </div>
      {message ? <SuccessText>{message}</SuccessText> : null}
      {failed ? (
        <ErrorText>Your jobs could not be loaded. Refresh the page to try again.</ErrorText>
      ) : jobs === null ? (
        <p className="text-muted">Loading your jobs.</p>
      ) : jobs.length === 0 ? (
        <EmptyBox title="No jobs posted yet" action={<Button onClick={() => setPosting(true)}>Post a Job</Button>}>
          Post your first job to start receiving applications from students nearby.
        </EmptyBox>
      ) : (
        <ul className="m-0 grid list-none gap-5 p-0">
          {jobs.map((job) => <EmployerJobCard key={job.id} job={job} onChanged={changed} />)}
        </ul>
      )}
      <PostJobDialog open={posting} onClose={() => setPosting(false)} onPosted={(job) => { setPosting(false); void changed(`${job.title} is posted and open for applications.`); }} />
    </div>
  );
}
