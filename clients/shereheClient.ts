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
  refresh?: boolean;
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
export async function listUpcomingEvents({ county, mode = 'user', refresh = false, signal }: { county?: string; mode?: Mode; refresh?: boolean; signal?: AbortSignal } = {}): Promise<PartnerEvent[]> {
  const filter = county ? `&county=${encodeURIComponent(county)}` : '';
  const res = await call(`/api/events?status=upcoming${filter}`, { cache: true, refresh, mode, signal });
  if (res.status === 400) return []; // the only thing we vary is the county, so Sherehe does not know that county
  if (res.status !== 200) throw unexpected(res);
  return asList(res.body, 'events').map(fromShereheEvent);
}

// K2: the roles of one event. Cached for 5 minutes. An event that has gone has no roles.
export async function listRoles(eventId: string, { mode = 'user', refresh = false, signal }: { mode?: Mode; refresh?: boolean; signal?: AbortSignal } = {}): Promise<PartnerRole[]> {
  const res = await call(`/api/events/${encodeURIComponent(eventId)}/roles`, { cache: true, refresh, mode, signal });
  if (res.status === 404) return [];
  if (res.status !== 200) throw unexpected(res);
  return asList(res.body, 'roles').map(fromShereheRole);
}

// K1 + K2 in ONE call: the upcoming events with their roles (GET /api/events?include=roles). Cached for 5 minutes.
// Returns null when this Sherehe does not have that feature (it answers 400, or ignores include and sends events
// with no roles), so the caller uses the two calls above instead.
async function listUpcomingWithRoles({ county, mode = 'user', refresh = false, signal }: { county?: string; mode?: Mode; refresh?: boolean; signal?: AbortSignal }): Promise<Array<{ event: PartnerEvent; roles: PartnerRole[] }> | null> {
  const filter = county ? `&county=${encodeURIComponent(county)}` : '';
  const res = await call(`/api/events?status=upcoming${filter}&include=roles`, { cache: true, refresh, mode, signal });
  if (res.status === 400) return null;
  if (res.status !== 200) throw unexpected(res);
  const list = asList(res.body, 'events');
  const withRoles = list.every((raw) => typeof raw === 'object' && raw !== null && Array.isArray((raw as { roles?: unknown }).roles));
  if (!withRoles) return null; // an older Sherehe ignores include and sends plain events
  return list.map((raw) => ({ event: fromShereheEvent(raw), roles: asList((raw as { roles: unknown }).roles, 'roles').map(fromShereheRole) }));
}

// K1 + K2: every role with a free slot on an upcoming event, as { event, role } pairs,
// soonest shift first. One call when Sherehe can send events with their roles; otherwise one call for the events and one
// more for each event. One failed call fails the whole list. All the calls share one deadline,
// so a person waits no longer than the user timeout in total, however many calls it takes.
export async function findOpenings({ county, mode = 'user', refresh = false }: { county?: string; mode?: Mode; refresh?: boolean } = {}): Promise<Opening[]> {
  const signal = fetcher.deadline(mode);
  const bulk = await listUpcomingWithRoles({ county, mode, refresh, signal });
  if (bulk) {
    return bulk
      .filter(({ event }) => event.status === 'upcoming')
      .flatMap(({ event, roles }) => roles.filter((role) => role.openSlots >= 1).map((role) => ({ event, role })))
      .sort((a, b) => a.role.shiftStart.localeCompare(b.role.shiftStart) || a.role.id.localeCompare(b.role.id));
  }
  const events = (await listUpcomingEvents({ county, mode, refresh, signal })).filter((event) => event.status === 'upcoming');
  const perEvent = await mapLimit(events, ROLE_LOOKUPS_AT_ONCE, async (event): Promise<Opening[]> =>
    (await listRoles(event.id, { mode, refresh, signal })).filter((role) => role.openSlots >= 1).map((role) => ({ event, role })));
  return perEvent.flat().sort((a, b) => a.role.shiftStart.localeCompare(b.role.shiftStart) || a.role.id.localeCompare(b.role.id));
}

// One opening by its role id, or null. Sherehe has no "get one role" call, so this reads the
// same cached lists as findOpenings. A role the cached lists do not have may simply be newer than the
// cache (up to 5 minutes), and an employer who has just been told about it must be able to offer for
// it, so on a miss the lists are read again from Sherehe (a short burst, then one every REFRESH_MIN_GAP_MS).
// When that allowance is used up the role cannot be told apart from one that does not exist, so this does NOT
// answer "no such role": it fails like any other moment Sherehe cannot be asked, and the employer tries again.
export async function findOpening(roleId: string, { mode = 'user' }: { mode?: Mode } = {}): Promise<Opening | null> {
  const find = (openings: Opening[]): Opening | null => openings.find(({ role }) => role.id === roleId) || null;
  const cached = find(await findOpenings({ mode }));
  if (cached) return cached;
  if (!fetcher.mayRefresh()) throw new UpstreamError('status', { status: 429, detail: 'too many re-reads of Sherehe for roles that are not in the cached lists; try again shortly' });
  return find(await findOpenings({ mode, refresh: true }));
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
