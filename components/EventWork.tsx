'use client';

// Event work: open roles on upcoming events (Endpoint 22, read from Sherehe) and the employer's own offers
// (Endpoints 23 to 25). Everything that came from Sherehe is shown as text by React, never as markup.

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, messageOf } from '@/lib/clientApi';
import { cap, num, readable } from '@/lib/format';
import { COUNTIES } from '@/sharedLists';
import type { EventOpening, StaffingOffer } from '@/lib/contract';
import { Dialog, DialogHead } from './Dialog';
import { Button, EmptyBox, ErrorText, Field, ListCard, StatusPill, SuccessText, Tag, TextButton } from './ui';

const UNAVAILABLE = 'Event work is unavailable right now. Your jobs are not affected. Try again in a minute.';

const OFFER_STATUS: Record<string, { word: string; note: string }> = {
  pending: { word: 'Waiting for the organiser', note: 'The organiser has not decided yet.' },
  accepted: { word: 'Accepted', note: 'The organiser accepted, and a job was opened in your postings.' },
  declined: { word: 'Declined', note: 'The organiser declined this offer.' },
};

const places = (n: number): string => `${n} ${n === 1 ? 'place' : 'places'}`;

function OfferDialog({ opening, onClose, onSent }: { opening: EventOpening | null; onClose: () => void; onSent: (offer: StaffingOffer) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!opening) return;
    setError('');
    const d = new FormData(e.currentTarget);
    const body: { roleId: string; workersOffered: number; note?: string } = { roleId: opening.roleId, workersOffered: Number(d.get('workersOffered')) };
    const note = String(d.get('note') || '').trim();
    if (note) body.note = note;
    setBusy(true);
    const res = await api<StaffingOffer>('/api/staffing-offers', { method: 'POST', body });
    setBusy(false);
    if (res.status !== 201 || !res.body) { setError(messageOf(res, 'The offer was not sent. Try again.')); return; }
    onSent(res.body);
  }

  return (
    <Dialog open={opening !== null} onClose={onClose} labelledBy="offer-title">
      {opening ? (
        <>
          <DialogHead id="offer-title" title="Offer workers">{opening.title} at {opening.eventName}. {places(opening.openSlots)} open.</DialogHead>
          <form onSubmit={submit} noValidate className="grid gap-4">
            <Field label="How many workers?" hint={`1 to ${opening.openSlots}`}>
              <input name="workersOffered" type="number" required min={1} max={opening.openSlots} step={1} defaultValue={1} />
            </Field>
            <Field label="Note for the organiser" hint="Optional, up to 500 characters">
              <textarea name="note" maxLength={500} rows={3} placeholder="For example, Six catering students with food-hygiene certificates" />
            </Field>
            {error ? <ErrorText>{error}</ErrorText> : null}
            <Button type="submit" full disabled={busy}>Send offer</Button>
          </form>
          <p className="mb-0 mt-1 text-center text-muted"><TextButton onClick={onClose}>Not now</TextButton></p>
        </>
      ) : null}
    </Dialog>
  );
}

export function EventWork({ onSeeJobs }: { onSeeJobs: () => void }) {
  const [county, setCounty] = useState('');
  const [openings, setOpenings] = useState<EventOpening[] | null>(null);
  const [openingsProblem, setOpeningsProblem] = useState('');
  const [offers, setOffers] = useState<StaffingOffer[] | null>(null);
  const [offersFailed, setOffersFailed] = useState(false);
  const [offerErrors, setOfferErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [offering, setOffering] = useState<EventOpening | null>(null);

  const loadOpenings = useCallback(async () => {
    setOpenings(null);
    setOpeningsProblem('');
    const res = await api<EventOpening[]>(`/api/event-openings${county ? `?county=${encodeURIComponent(county)}` : ''}`);
    if (res.status !== 200 || !res.body) {
      setOpenings([]);
      setOpeningsProblem(res.status === 502 ? UNAVAILABLE : 'The open roles could not be loaded. Try again.');
      return;
    }
    setOpenings(res.body);
  }, [county]);

  const loadOffers = useCallback(async () => {
    const res = await api<StaffingOffer[]>('/api/me/staffing-offers');
    if (res.status !== 200 || !res.body) { setOffersFailed(true); return; }
    setOffersFailed(false);
    setOffers(res.body);
  }, []);

  useEffect(() => { void loadOpenings(); }, [loadOpenings]);
  useEffect(() => { void loadOffers(); }, [loadOffers]);

  async function withdraw(offer: StaffingOffer) {
    if (!confirm('Withdraw this offer? The organiser will no longer see it.')) return;
    setOfferErrors((e) => ({ ...e, [offer.id]: '' }));
    const res = await api(`/api/staffing-offers/${encodeURIComponent(offer.id)}`, { method: 'DELETE' });
    if (res.status !== 204) { setOfferErrors((e) => ({ ...e, [offer.id]: messageOf(res, 'That did not work. Try again.') })); return; }
    setMessage('Offer withdrawn.');
    await Promise.all([loadOpenings(), loadOffers()]);
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="m-0 text-[22px] font-bold">Event work</h3>
          <p className="mb-0 mt-1.5 max-w-[640px] text-muted">
            Staffing roles on upcoming events, from Sherehe. Offer your workers for a role. If the organiser accepts, a job opens in your postings with the role&apos;s pay.
          </p>
        </div>
        <label className="grid min-w-[240px] gap-1.5 font-semibold">
          County
          <select id="ev-county" value={county} onChange={(e) => setCounty(e.target.value)}>
            <option value="">All counties</option>
            {COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>

      {message ? <SuccessText>{message}</SuccessText> : null}

      <h4 className="mb-3.5 mt-0 text-xl font-bold">Open roles</h4>
      <div id="ev-openings">
        {openings === null ? (
          <p className="m-0 text-muted">Looking for open roles...</p>
        ) : openingsProblem ? (
          <EmptyBox title="Open roles are not available" action={<Button onClick={() => { setMessage(''); void loadOpenings(); void loadOffers(); }}>Try again</Button>}>
            {openingsProblem}
          </EmptyBox>
        ) : openings.length === 0 ? (
          <EmptyBox title={`No open roles${county ? ` in ${county}` : ''}`}>{county ? 'Try another county, or all counties.' : 'Check again later.'}</EmptyBox>
        ) : (
          <ul className="m-0 grid list-none gap-5 p-0">
            {openings.map((o) => (
              <ListCard key={o.roleId} id={`op-${o.roleId}`}>
                <Tag>{cap(o.category)}</Tag>
                <h4 className="mb-1 mt-2 text-xl font-bold">{o.title}</h4>
                <p className="m-0 text-muted">{o.eventName}. {o.area}, {o.county}. {readable(o.startsAt)}</p>
                <p className="m-0 text-muted">{places(o.openSlots)} open. KES {num(o.payPerShift)} per worker per shift</p>
                <div className="mt-4"><Button onClick={() => setOffering(o)}>Offer workers</Button></div>
              </ListCard>
            ))}
          </ul>
        )}
      </div>

      <h4 className="mb-3.5 mt-[34px] text-xl font-bold">Your offers</h4>
      <div id="ev-offers">
        {offersFailed ? (
          <ErrorText>Your offers could not be loaded. Try again.</ErrorText>
        ) : offers === null ? (
          <p className="m-0 text-muted">Loading your offers.</p>
        ) : offers.length === 0 ? (
          <EmptyBox title="No offers yet">Pick a role above and offer your workers for it.</EmptyBox>
        ) : (
          <ul className="m-0 grid list-none gap-5 p-0">
            {offers.map((o) => {
              const s = OFFER_STATUS[o.status] || { word: o.status, note: '' };
              return (
                <ListCard key={o.id} id={`of-${o.id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h4 className="mb-1 mt-2 text-xl font-bold">{o.eventName}</h4>
                      <p className="m-0 text-muted">{o.workersOffered} {o.workersOffered === 1 ? 'worker' : 'workers'} offered on {readable(o.createdAt)}</p>
                      <p className="m-0 text-muted">{s.note}{o.jobId ? ` Job ${o.jobId}.` : ''}</p>
                    </div>
                    <StatusPill status={o.status}>{s.word}</StatusPill>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2.5">
                    {o.status === 'pending' ? <Button look="danger" onClick={() => withdraw(o)}>Withdraw offer</Button> : null}
                    {o.status === 'accepted' ? <Button look="outline" onClick={onSeeJobs}>See it in your job postings</Button> : null}
                  </div>
                  {offerErrors[o.id] ? <ErrorText className="mt-3">{offerErrors[o.id]}</ErrorText> : null}
                </ListCard>
              );
            })}
          </ul>
        )}
      </div>

      <OfferDialog
        opening={offering}
        onClose={() => setOffering(null)}
        onSent={(offer) => {
          setOffering(null);
          setMessage(`Offer sent to the organiser of ${offer.eventName}. If they accept, a job opens in your postings.`);
          void loadOpenings();
          void loadOffers();
        }}
      />
    </div>
  );
}
