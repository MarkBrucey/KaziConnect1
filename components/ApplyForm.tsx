'use client';

// Applying for a job. Students apply from their own account, so every applicant is one known person: the account's
// ID is made by the server, while a student ID typed into a box could belong to anyone (lib/identity.ts).

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
    if (!asStudent || !user) { openAuth('login'); return; }
    const body: { jobId: string; studentId: string; preferredDate: string; note?: string } = {
      jobId: job.id,
      studentId: user.id,
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

  if (!asStudent || !user) {
    return (
      <div className="grid gap-4">
        <p className="m-0">
          {user ? 'Only student accounts can apply. Log out, then log in with a student account.' : 'Log in to your student account to apply. Your applications are then saved to your account, and nobody else can apply, change or cancel in your name.'}
        </p>
        {user ? null : (
          <>
            <Button type="button" full onClick={() => openAuth('login')}>Log in to apply</Button>
            <p className="m-0 text-center">New here? <TextButton onClick={() => openAuth('register')}>Create a free account</TextButton></p>
          </>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <p className="m-0">Applying as <strong>{user.name}</strong></p>
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
