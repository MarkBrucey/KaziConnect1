// The only module that knows Sherehe: its address, its key, its paths and its field names.
// Everything else in Kazi Connect asks this module for openings and offers in Kazi's own
// terms. Built from partner-tests/sherehe_openapi.yaml.
//
// Needs SHEREHE_API_URL and SHEREHE_API_KEY. The key is read from the environment on each
// call and goes only into the X-API-Key header. It is never logged and never stored.
//
// A call that fails in a way a person can act on throws PartnerRejection (invalid,
// not_found, conflict). Every other failure throws UpstreamError. See upstreamError.ts.

import * as fetcher from './fetcher';
import type { FetchResult, Mode } from './fetcher';
import { PartnerRejection, UpstreamError } from './upstreamError';
import { fromShereheEvent, fromShereheOffer, fromShereheRole } from '../mappers';
import type { PartnerEvent, PartnerOffer, PartnerRole } from '../mappers';

const ROLE_LOOKUPS_AT_ONCE = 5;

export interface Opening {
  event: PartnerEvent;
  role: PartnerRole;
}

interface CallOptions {
  method?: string;
  body?: unknown;
  mode?: Mode;
  cache?: boolean;
  signal?: AbortSignal;
}

function config(): { base: string; headers: Record<string, string> } {
  const base = (process.env.SHEREHE_API_URL || '').trim().replace(/\/+$/, '');
  const key = process.env.SHEREHE_API_KEY || '';
  if (!/^https?:\/\/\S+$/.test(base) || !key) throw new UpstreamError('config', { detail: 'SHEREHE_API_URL or SHEREHE_API_KEY is not set' });
  return { base, headers: { 'X-API-Key': key, Accept: 'application/json' } };
}

function call(path: string, options: CallOptions = {}): Promise<FetchResult> {
  const { base, headers } = config();
  return fetcher.request(base + path, { ...options, headers });
}

// A status Sherehe's contract does not give us a use for (a 401 means our key is wrong, for example).
function unexpected(res: FetchResult): UpstreamError {
  return new UpstreamError('status', { status: res.status });
}

function asList(body: unknown, what: string): unknown[] {
  if (!Array.isArray(body)) throw new UpstreamError('shape', { detail: `${what} is not a list` });
  return body;
}

// Runs fn over items, a few at a time, and stops starting new work after the first failure.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index]);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// K1: upcoming events, optionally in one county. Cached for 5 minutes.
export async function listUpcomingEvents({ county, mode = 'user', signal }: { county?: string; mode?: Mode; signal?: AbortSignal } = {}): Promise<PartnerEvent[]> {
  const filter = county ? `&county=${encodeURIComponent(county)}` : '';
  const res = await call(`/api/events?status=upcoming${filter}`, { cache: true, mode, signal });
  if (res.status === 400) return []; // the only thing we vary is the county, so Sherehe does not know that county
  if (res.status !== 200) throw unexpected(res);
  return asList(res.body, 'events').map(fromShereheEvent);
}

// K2: the roles of one event. Cached for 5 minutes. An event that has gone has no roles.
export async function listRoles(eventId: string, { mode = 'user', signal }: { mode?: Mode; signal?: AbortSignal } = {}): Promise<PartnerRole[]> {
  const res = await call(`/api/events/${encodeURIComponent(eventId)}/roles`, { cache: true, mode, signal });
  if (res.status === 404) return [];
  if (res.status !== 200) throw unexpected(res);
  return asList(res.body, 'roles').map(fromShereheRole);
}

// K1 + K2: every role with a free slot on an upcoming event, as { event, role } pairs,
// soonest shift first. One failed call fails the whole list. All the calls share one deadline,
// so a person waits no longer than the user timeout in total, however many calls it takes.
export async function findOpenings({ county, mode = 'user' }: { county?: string; mode?: Mode } = {}): Promise<Opening[]> {
  const signal = fetcher.deadline(mode);
  const events = (await listUpcomingEvents({ county, mode, signal })).filter((event) => event.status === 'upcoming');
  const perEvent = await mapLimit(events, ROLE_LOOKUPS_AT_ONCE, async (event): Promise<Opening[]> =>
    (await listRoles(event.id, { mode, signal })).filter((role) => role.openSlots >= 1).map((role) => ({ event, role })));
  return perEvent.flat().sort((a, b) => a.role.shiftStart.localeCompare(b.role.shiftStart) || a.role.id.localeCompare(b.role.id));
}

// One opening by its role id, or null. Sherehe has no "get one role" call, so this reads the
// same cached lists as findOpenings.
export async function findOpening(roleId: string, { mode = 'user' }: { mode?: Mode } = {}): Promise<Opening | null> {
  return (await findOpenings({ mode })).find(({ role }) => role.id === roleId) || null;
}

// K3: offer workers for a role. Never cached, never retried.
export async function createOffer({ roleId, workersOffered, note, mode = 'user' }: { roleId: string; workersOffered: number; note?: string; mode?: Mode }): Promise<PartnerOffer> {
  const body: { roleId: string; workersOffered: number; note?: string } = { roleId, workersOffered };
  if (note !== undefined) body.note = note;
  const res = await call('/api/offers', { method: 'POST', body, mode });
  if (res.status === 201) {
    const offer = fromShereheOffer(res.body);
    if (offer.roleId !== roleId) throw new UpstreamError('shape', { detail: 'the offer is for a different role' });
    return offer;
  }
  if (res.status === 400) throw new PartnerRejection('invalid');
  if (res.status === 404) throw new PartnerRejection('not_found');
  if (res.status === 409) throw new PartnerRejection('conflict');
  throw unexpected(res);
}

// K4: one offer and its status, or null if Sherehe no longer has it. Never cached: the point
// is to see a decision as soon as the organiser makes it. Meant for background use.
export async function getOffer(offerId: string, { mode = 'background' }: { mode?: Mode } = {}): Promise<PartnerOffer | null> {
  const res = await call(`/api/offers/${encodeURIComponent(offerId)}`, { mode });
  if (res.status === 404) return null;
  if (res.status !== 200) throw unexpected(res);
  return fromShereheOffer(res.body);
}

// K5: withdraw a pending offer. Returns 'withdrawn', or 'gone' if Sherehe no longer has it.
// Throws PartnerRejection('conflict') if the organiser already decided.
export async function withdrawOffer(offerId: string, { mode = 'user' }: { mode?: Mode } = {}): Promise<'withdrawn' | 'gone'> {
  const res = await call(`/api/offers/${encodeURIComponent(offerId)}`, { method: 'DELETE', mode });
  if (res.status === 204) return 'withdrawn';
  if (res.status === 404) return 'gone';
  if (res.status === 409) throw new PartnerRejection('conflict');
  throw unexpected(res);
}
