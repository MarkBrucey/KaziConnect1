'use client';

// One followed application: its status (updating live), and, while it is waiting, changing the date or cancelling.

import { useState } from 'react';
import type { FormEvent } from 'react';
import { readable, soonest, toIso, toLocalInput } from '@/lib/format';
import type { FollowedApp } from '@/lib/followed';
import { Button, ErrorText, Field, StatusPill } from './ui';

const STATUS: Record<string, { word: string; note: string }> = {
  pending: { word: 'Waiting for a decision', note: 'The employer has not decided yet.' },
  accepted: { word: 'Accepted', note: 'Your application was accepted.' },
  filled: { word: 'Filled', note: 'This job went to someone else.' },
  cancelled: { word: 'Cancelled', note: 'This application was cancelled.' },
};

export interface ApplicationActions {
  cancel: (id: string) => Promise<string | null>;
  reschedule: (id: string, preferredDate: string, note: string) => Promise<string | null>;
  remove: (id: string) => void;
}

export function ApplicationCard({ app, glowing, actions }: { app: FollowedApp; glowing: boolean; actions: ApplicationActions }) {
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState('');
  const info = STATUS[app.status || ''] || { word: app.status || 'Checking', note: '' };
  const pending = app.status === 'pending';

  async function cancel() {
    if (!confirm(`Cancel application ${app.applicationId}? This cannot be undone.`)) return;
    setError('');
    const problem = await actions.cancel(app.applicationId);
    if (problem) setError(problem);
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setError('');
    const problem = await actions.reschedule(app.applicationId, toIso(String(data.get('preferredDate'))), String(data.get('note') || ''));
    if (problem) setError(problem);
    else setChanging(false);
  }

  return (
    <li id={`app-${app.applicationId}`} className={`rounded-xl border border-edge px-[26px] py-6 ${glowing ? 'animate-glow' : ''}`}>
      <h3 className="mb-0.5 mt-0 text-xl font-bold">{app.jobTitle || 'Tracked application'}</h3>
      <p className="mb-3.5 mt-0 text-muted">{app.applicationId}{app.county ? `, ${app.county}` : ''}</p>
      <StatusPill status={app.status || ''}>{info.word}</StatusPill>
      <p className="mb-0 mt-2.5">
        {info.note}{app.preferredDate && app.status !== 'cancelled' ? ` Start: ${readable(app.preferredDate)}.` : ''}
      </p>
      <span className="mt-3 inline-flex items-center gap-2 text-sm text-muted">
        <span className={`size-[9px] rounded-full ${app.live ? 'bg-ok' : 'bg-[#B7B2AC]'}`} />
        {app.live ? 'Updates live' : 'Not updating live'}
      </span>
      <div className="mt-[18px] flex flex-wrap gap-2.5">
        {pending ? (
          <>
            <Button look="outline" onClick={() => setChanging((c) => !c)}>Change date</Button>
            <Button look="danger" onClick={cancel}>Cancel application</Button>
          </>
        ) : null}
        {app.status === 'cancelled' ? <Button look="outline" onClick={() => actions.remove(app.applicationId)}>Remove from list</Button> : null}
      </div>
      {changing && pending ? (
        <form onSubmit={save} className="mt-[18px] grid gap-4">
          <Field label="New start date and time">
            <input name="preferredDate" type="datetime-local" required min={soonest()} defaultValue={app.preferredDate ? toLocalInput(app.preferredDate) : ''} />
          </Field>
          <Field label="Note for the employer" hint="Leaving this empty removes your note">
            <textarea name="note" maxLength={500} rows={2} defaultValue={app.note || ''} />
          </Field>
          <div><Button type="submit">Save new date</Button></div>
        </form>
      ) : null}
      {error ? <ErrorText className="mt-3">{error}</ErrorText> : null}
    </li>
  );
}
