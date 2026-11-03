'use client';

// Applying for a job. A logged in student applies as themselves; anyone else gives a student ID.

import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, messageOf } from '@/lib/clientApi';
import { followed } from '@/lib/followed';
import { soonest, toIso } from '@/lib/format';
import type { Application, Job } from '@/lib/contract';
import { useAuth } from './authContext';
import { Button, ErrorText, Field, TextButton } from './ui';

export function ApplyForm({ job, onSent }: { job: Job; onSent: (application: Application) => void }) {
  const { user, openAuth } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const asStudent = user !== null && user.role === 'student';

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const data = new FormData(e.currentTarget);
    const body: { jobId: string; studentId: string; preferredDate: string; note?: string } = {
      jobId: job.id,
      studentId: asStudent && user ? user.id : String(data.get('studentId') || '').trim(),
      preferredDate: toIso(String(data.get('preferredDate'))),
    };
    const note = String(data.get('note') || '').trim();
    if (note) body.note = note;
    setBusy(true);
    const res = await api<Application>('/api/applications', { method: 'POST', body });
    setBusy(false);
    if (res.status !== 201 || !res.body) { setError(messageOf(res, 'The application was not sent. Try again.')); return; }
    followed.save({ ...res.body, jobTitle: job.title, county: job.county });
    onSent(res.body);
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {asStudent && user ? (
        <p className="m-0">Applying as <strong>{user.name}</strong></p>
      ) : (
        <Field
          label="Student ID"
          hint={<>or <TextButton onClick={() => openAuth('login')}>log in</TextButton> so your applications are saved to your account</>}
        >
          <input name="studentId" required autoComplete="off" placeholder="For example stu_0042" />
        </Field>
      )}
      <Field label="When can you start?">
        <input name="preferredDate" type="datetime-local" required min={soonest()} />
      </Field>
      <Field label="Note for the employer" hint="Optional, up to 500 characters">
        <textarea name="note" maxLength={500} rows={3} placeholder="For example, available after 2pm on weekdays" />
      </Field>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button type="submit" full disabled={busy}>Submit application</Button>
    </form>
  );
}
