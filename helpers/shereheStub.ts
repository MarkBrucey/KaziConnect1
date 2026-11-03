// A local stand-in for Sherehe, built from partner-tests/sherehe_openapi.yaml: same paths,
// same fields, same status codes, and the contract's own examples as its sample data
// (evt_2001, rol_3001, ofr_4001). The automated tests, `npm run verify` and local trials of the
// Event work page all use it, so none of them needs the real Sherehe or its API key.
//
// Beyond the contract it has controls for the things a test must make happen:
//   stub.setMode('drop' | 'error' | 'garbage' | 'wrongShape' | 'redirect' | 'huge' | 'up')   misbehave
//   stub.failOn('/roles')              answer 503 only for paths containing this text
//   stub.setDelay(ms)                  answer slowly
//   stub.decide(offerId, 'accepted' | 'declined')   what the organiser would do on Sherehe's website
//   stub.fillRole(roleId)              make a role full
//   stub.dropOffer(offerId)            Sherehe loses an offer behind Kazi's back
//   stub.requests                      every request received (method, path, key, body)
//
// Run it by hand with: npx tsx helpers/shereheStub.ts   (it prints the address and the key)

import http from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import type { components } from '../types/sherehe';
import { COUNTIES } from '../sharedLists';

type Event = components['schemas']['Event'];
type Role = components['schemas']['Role'];
type Offer = components['schemas']['Offer'];

export type StubMode = 'up' | 'drop' | 'error' | 'garbage' | 'wrongShape' | 'redirect' | 'huge';

export interface StubRequest {
  method: string;
  path: string;
  search: string;
  key: string | null;
  body: unknown;
}

export const STUB_KEY = 'stub-partner-key';

const EVENTS: Event[] = [
  { id: 'evt_2001', name: 'Wanjiku and Otieno wedding', type: 'wedding', county: 'Nairobi', area: 'Westlands', venue: 'Sarit Expo Centre', startsAt: '2026-12-05T14:00:00Z', endsAt: '2026-12-05T22:00:00Z', expectedGuests: 300, status: 'upcoming' },
  { id: 'evt_2002', name: 'Coast Tech Summit', type: 'conference', county: 'Mombasa', area: 'Nyali', venue: 'Nyali Beach Hall', startsAt: '2026-12-12T07:00:00Z', endsAt: '2026-12-12T15:00:00Z', expectedGuests: 150, status: 'upcoming' },
  { id: 'evt_2003', name: 'Kasarani Charity Concert', type: 'concert', county: 'Nairobi', area: 'Kasarani', venue: 'Kasarani Grounds', startsAt: '2026-09-01T15:00:00Z', endsAt: '2026-09-01T21:00:00Z', expectedGuests: 800, status: 'completed' },
];

const ROLES: Role[] = [
  { id: 'rol_3001', eventId: 'evt_2001', title: 'Waiters', category: 'catering', headcount: 6, filled: 0, shiftStart: '2026-12-05T13:00:00Z', shiftEnd: '2026-12-05T23:00:00Z', payPerShift: 1500 },
  { id: 'rol_3002', eventId: 'evt_2001', title: 'Ushers', category: 'events', headcount: 4, filled: 4, shiftStart: '2026-12-05T13:00:00Z', shiftEnd: '2026-12-05T21:00:00Z', payPerShift: 1200 },
  { id: 'rol_3003', eventId: 'evt_2001', title: 'Security guards', category: 'security', headcount: 3, filled: 1, shiftStart: '2026-12-05T12:00:00Z', shiftEnd: '2026-12-06T00:00:00Z', payPerShift: 2000 },
  { id: 'rol_3004', eventId: 'evt_2002', title: 'Registration desk', category: 'events', headcount: 5, filled: 0, shiftStart: '2026-12-12T06:00:00Z', shiftEnd: '2026-12-12T16:00:00Z', payPerShift: 1800 },
  { id: 'rol_3005', eventId: 'evt_2003', title: 'Stage crew', category: 'events', headcount: 8, filled: 0, shiftStart: '2026-09-01T12:00:00Z', shiftEnd: '2026-09-01T22:00:00Z', payPerShift: 1600 },
];

interface StubState {
  events: Event[];
  roles: Role[];
  offers: Map<string, Offer>;
  nextOffer: number;
  bulk: boolean; // false: behaves like a Sherehe that does not know include=roles and ignores it
  mode: StubMode;
  failOn: string | null;
  delayMs: number;
  requests: StubRequest[];
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const INVALID_JSON = Symbol('invalid-json');

function freshState(): StubState {
  return { events: clone(EVENTS), roles: clone(ROLES), offers: new Map(), nextOffer: 4001, bulk: true, mode: 'up', failOn: null, delayMs: 0, requests: [] };
}

export interface ShereheStub {
  apiKey: string;
  readonly url: string;
  readonly requests: StubRequest[];
  readonly offers: Offer[];
  start(port?: number): Promise<void>;
  stop(): Promise<void>;
  reset(): void;
  setMode(mode: StubMode): void;
  failOn(text: string | null): void;
  setDelay(ms: number): void;
  decide(offerId: string, status: 'accepted' | 'declined'): void;
  dropOffer(offerId: string): void;
  fillRole(roleId: string): void;
  // What the organiser does on Sherehe's own website: add a role to an event, after Kazi may have cached the lists.
  addRole(role: components['schemas']['Role']): void;
  // false makes GET /api/events ignore include=roles, as a Sherehe from before that feature would.
  setBulk(on: boolean): void;
}

export function createShereheStub({ apiKey = STUB_KEY }: { apiKey?: string } = {}): ShereheStub {
  let server: http.Server | null = null;
  let state = freshState();

  const send = (res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void => {
    const text = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, { ...(text ? { 'Content-Type': 'application/json' } : {}), ...headers });
    res.end(text);
  };
  const message = (res: ServerResponse, status: number, text: string): void => send(res, status, { message: text });

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => { raw += chunk; });
      req.on('end', () => resolve(raw));
    });
  }

  function newOffer(st: StubState, body: { roleId: string; workersOffered: number; note?: string }): { status: 201; offer: Offer } | { status: number; text: string } {
    const role = st.roles.find((r) => r.id === body.roleId);
    const event = role && st.events.find((e) => e.id === role.eventId);
    if (!role || !event || event.status !== 'upcoming') return { status: 404, text: `Role ${body.roleId} not found` };
    const open = role.headcount - role.filled;
    if (open === 0) return { status: 409, text: `Role ${role.id} is full` };
    if (body.workersOffered > open) return { status: 400, text: 'workersOffered must be a whole number from 1 to the open slots' };
    const offer: Offer = {
      id: `ofr_${st.nextOffer++}`, roleId: role.id, eventId: role.eventId, workersOffered: body.workersOffered,
      note: body.note === undefined ? '' : body.note, status: 'pending', createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
    st.offers.set(offer.id, offer);
    return { status: 201, offer };
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // A request keeps working on the state that existed when it arrived. After stub.reset() a slow
    // request that is still waiting (a client that timed out) can then never write into the next
    // test's data. That is also how a real Sherehe behaves: the offer may exist although we gave up.
    const st = state;
    const url = new URL(req.url || '/', 'http://stub');
    const raw = await readBody(req);
    let body: unknown;
    try { body = raw ? JSON.parse(raw) : undefined; } catch { body = INVALID_JSON; }
    const method = req.method || 'GET';
    st.requests.push({ method, path: url.pathname, search: url.search, key: (req.headers['x-api-key'] as string | undefined) || null, body: body === INVALID_JSON ? raw : body });
    if (st.delayMs) await sleep(st.delayMs);

    // Misbehaviour comes first, so it applies whatever was asked.
    if (st.mode === 'drop') { req.socket.destroy(); return; }
    if (st.mode === 'error') return message(res, 503, 'stub internal failure: database password is hunter2');
    if (st.mode === 'garbage') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>maintenance page</html>'); return; }
    if (st.mode === 'wrongShape') return send(res, 200, { unexpected: true });
    if (st.mode === 'redirect') { res.writeHead(302, { Location: 'http://127.0.0.1:9/elsewhere' }); res.end(); return; }
    if (st.mode === 'huge') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify([{ filler: 'x'.repeat(2 * 1024 * 1024) }])); return; }

    if (st.failOn && url.pathname.includes(st.failOn)) return message(res, 503, 'stub internal failure');
    if (req.headers['x-api-key'] !== apiKey) return message(res, 401, 'Send your partner key as X-API-Key');

    const path = url.pathname;
    let m: RegExpExecArray | null;

    if (method === 'GET' && path === '/api/events') {
      if (url.searchParams.get('status') !== 'upcoming') return message(res, 400, 'status must be upcoming');
      const county = url.searchParams.get('county');
      if (county !== null && !COUNTIES.some((c) => c.toLowerCase() === county.trim().toLowerCase())) return message(res, 400, "county must be one of Kenya's 47 counties");
      const matching = st.events.filter((e) => e.status === 'upcoming' && (county === null || e.county.toLowerCase() === county.trim().toLowerCase()));
      const include = url.searchParams.getAll('include');
      if (st.bulk && include.length > 0 && !(include.length === 1 && include[0].trim() === '')) {
        if (include.length > 1 || include[0].trim() !== 'roles') return message(res, 400, 'include must be roles');
        return send(res, 200, matching.map((e) => ({ ...e, roles: st.roles.filter((r) => r.eventId === e.id) })));
      }
      return send(res, 200, matching);
    }
    if (method === 'GET' && (m = /^\/api\/events\/([^/]+)$/.exec(path))) {
      const event = st.events.find((e) => e.id === m![1]);
      return event ? send(res, 200, event) : message(res, 404, `Event ${m[1]} not found`);
    }
    if (method === 'GET' && (m = /^\/api\/events\/([^/]+)\/roles$/.exec(path))) {
      const eventId = m[1];
      if (!st.events.some((e) => e.id === eventId)) return message(res, 404, `Event ${eventId} not found`);
      return send(res, 200, st.roles.filter((r) => r.eventId === eventId));
    }

    if (method === 'POST' && path === '/api/offers') {
      if (body === null || typeof body !== 'object' || Array.isArray(body)) return message(res, 400, 'Request body must be a JSON object');
      const b = body as Record<string, unknown>;
      const unknown = Object.keys(b).filter((k) => !['roleId', 'workersOffered', 'note'].includes(k));
      if (unknown.length) return message(res, 400, `Unknown field(s): ${unknown.join(', ')}`);
      if (typeof b.roleId !== 'string' || b.roleId.trim() === '') return message(res, 400, 'roleId is required');
      if (typeof b.workersOffered !== 'number' || !Number.isInteger(b.workersOffered) || b.workersOffered < 1) return message(res, 400, 'workersOffered must be a whole number from 1 to the open slots');
      if (b.note !== undefined && (typeof b.note !== 'string' || b.note.length > 500)) return message(res, 400, 'note must be a string of 500 characters or fewer');
      const made = newOffer(st, { roleId: b.roleId, workersOffered: b.workersOffered, note: b.note as string | undefined });
      if ('offer' in made) return send(res, 201, made.offer, { Location: `/api/offers/${made.offer.id}` });
      return message(res, made.status, made.text);
    }
    if ((m = /^\/api\/offers\/([^/]+)$/.exec(path))) {
      const offer = st.offers.get(m[1]);
      if (method === 'GET') return offer ? send(res, 200, offer) : message(res, 404, `Offer ${m[1]} not found`);
      if (method === 'DELETE') {
        if (!offer) return message(res, 404, `Offer ${m[1]} not found`);
        if (offer.status !== 'pending') return message(res, 409, `Offer ${offer.id} is ${offer.status}`);
        st.offers.delete(offer.id);
        return send(res, 204);
      }
    }
    return message(res, 404, 'Not found');
  }

  return {
    apiKey,
    get url(): string { return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`; },
    get requests(): StubRequest[] { return state.requests; },
    get offers(): Offer[] { return [...state.offers.values()].map(clone); },
    start(port = 0): Promise<void> {
      server = http.createServer((req, res) => { handle(req, res).catch(() => req.socket.destroy()); });
      return new Promise((resolve) => { server!.listen(port, '127.0.0.1', resolve); });
    },
    stop(): Promise<void> {
      return new Promise((resolve) => { server!.closeAllConnections(); server!.close(() => resolve()); });
    },
    reset(): void { state = freshState(); },
    setMode(mode: StubMode): void { state.mode = mode; },
    failOn(text: string | null): void { state.failOn = text; },
    setDelay(ms: number): void { state.delayMs = ms; },
    // What the organiser does on Sherehe's own website: decide a pending offer.
    decide(offerId: string, status: 'accepted' | 'declined'): void {
      const offer = state.offers.get(offerId);
      if (!offer) throw new Error(`stub has no offer ${offerId}`);
      offer.status = status;
      if (status === 'accepted') {
        const role = state.roles.find((r) => r.id === offer.roleId)!;
        role.filled = Math.min(role.headcount, role.filled + offer.workersOffered);
      }
    },
    dropOffer(offerId: string): void { state.offers.delete(offerId); },
    setBulk(on: boolean): void { state.bulk = on; },
    addRole(role: components['schemas']['Role']): void { state.roles.push(clone(role)); },
    fillRole(roleId: string): void {
      const role = state.roles.find((r) => r.id === roleId)!;
      role.filled = role.headcount;
    },
  };
}

// Run by hand: npx tsx helpers/shereheStub.ts
if (require.main === module) {
  const stub = createShereheStub();
  stub.start(Number(process.env.STUB_PORT) || 4000).then(() => {
    console.log(`Sherehe stub running on ${stub.url}`);
    console.log(`Use it with:  SHEREHE_API_URL=${stub.url} SHEREHE_API_KEY=${stub.apiKey} npm start`);
  });
}
