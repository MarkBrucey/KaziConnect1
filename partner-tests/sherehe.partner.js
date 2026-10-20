// Week 7, Part C: our tests against our upstream ring partner, Sherehe.
//
// Written from Sherehe's openapi.yaml ONLY (partner-tests/sherehe_openapi.yaml, a frozen copy),
// the way a real consumer would, with no knowledge of how their code works. It uses none of
// Kazi Connect's own modules. Every test runs against their real, running API.
//
// How to run (in this project folder):
//   SHEREHE_URL=https://their-api-address SHEREHE_API_KEY=your-key npm run test:partner
//   (on Windows Command Prompt: set SHEREHE_URL=... and set SHEREHE_API_KEY=... on separate lines first)
//
// Every offer a test creates is withdrawn again before the test ends, even when the test fails.
//
// Optional, if their data differs from what these tests find for themselves:
//   ROLE_ID        a role with at least one free slot, to make test offers on
//   FULL_ROLE_ID   a role with no free slot (without it, the "role is full" test is skipped)
//
// Not tested, because the contract only lets the organiser's website do it (a login token, not
// our key): accepting or declining an offer, and so deleting an offer that was already decided.

const request = require('supertest');

const BASE = (process.env.SHEREHE_URL || process.env.SHEREHE_API_URL || '').replace(/\/+$/, '');
const KEY = process.env.SHEREHE_API_KEY || '';
const MISSING = { event: 'evt_999999', role: 'rol_999999', offer: 'ofr_999999' };

jest.setTimeout(90000); // free hosts can take up to a minute to wake up

const EVENT_TYPES = ['wedding', 'conference', 'concert', 'corporate', 'other'];
const CATEGORIES = ['accommodation', 'campus', 'catering', 'cleaning', 'electrical', 'events', 'plumbing', 'security', 'tutoring'];
const COUNTIES_TO_TRY_FOR_NONE = ['Lamu', 'Mandera', 'Wajir', 'Marsabit', 'Tana River', 'Isiolo', 'Samburu', 'West Pokot'];

const api = () => request(BASE);
const keyed = (req) => req.set('X-API-Key', KEY);
const get = (path) => keyed(api().get(path));
const post = (path, body) => keyed(api().post(path)).send(body);
const del = (path) => keyed(api().delete(path));

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isInt = (v) => Number.isInteger(v);
const isDateTime = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(v) && !Number.isNaN(Date.parse(v));
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// Shapes, taken field by field from Sherehe's contract
function expectEvent(x) {
  expect(isStr(x.id)).toBe(true);
  expect(isStr(x.name)).toBe(true);
  expect(EVENT_TYPES).toContain(x.type);
  expect(isStr(x.county)).toBe(true);
  expect(isStr(x.area)).toBe(true);
  expect(isStr(x.venue)).toBe(true);
  expect(isDateTime(x.startsAt)).toBe(true);
  expect(isDateTime(x.endsAt)).toBe(true);
  expect(isInt(x.expectedGuests) && x.expectedGuests >= 1).toBe(true);
  expect(['upcoming', 'completed', 'cancelled']).toContain(x.status);
}

function expectRole(x) {
  expect(isStr(x.id)).toBe(true);
  expect(isStr(x.eventId)).toBe(true);
  expect(isStr(x.title)).toBe(true);
  expect(CATEGORIES).toContain(x.category);
  expect(isInt(x.headcount) && x.headcount >= 1).toBe(true);
  expect(isInt(x.filled) && x.filled >= 0).toBe(true);
  expect(isDateTime(x.shiftStart)).toBe(true);
  expect(isDateTime(x.shiftEnd)).toBe(true);
  expect(isInt(x.payPerShift) && x.payPerShift >= 0).toBe(true);
}

function expectOffer(x) {
  expect(isStr(x.id)).toBe(true);
  expect(isStr(x.roleId)).toBe(true);
  expect(isStr(x.eventId)).toBe(true);
  expect(isInt(x.workersOffered)).toBe(true);
  expect(typeof x.note).toBe('string');
  expect(['pending', 'accepted', 'declined']).toContain(x.status);
  expect(isDateTime(x.createdAt)).toBe(true);
}

function expectError(res) {
  expect(res.headers['content-type']).toMatch(/application\/json/);
  expect(typeof res.body.message).toBe('string');
}

// Offers made by the tests, withdrawn again afterwards whatever happened
const madeOffers = [];
async function makeOffer(roleId, workersOffered = 1, note) {
  const res = await post('/api/offers', note === undefined ? { roleId, workersOffered } : { roleId, workersOffered, note });
  if (res.status === 201 && res.body && res.body.id) madeOffers.push(res.body.id);
  return res;
}
async function withdrawMade() {
  while (madeOffers.length) await del(`/api/offers/${madeOffers.pop()}`).catch(() => {});
}

// A role with a free slot, found from their own listings
let openRole = null; // { id, free }
async function findOpenRole() {
  if (openRole) return openRole;
  const events = (await get('/api/events?status=upcoming')).body;
  for (const event of events) {
    const roles = (await get(`/api/events/${encodeURIComponent(event.id)}/roles`)).body;
    const role = process.env.ROLE_ID ? roles.find((r) => r.id === process.env.ROLE_ID) : roles.find((r) => r.headcount - r.filled >= 1);
    if (role) { openRole = { id: role.id, free: role.headcount - role.filled }; return openRole; }
  }
  throw new Error('No role with a free slot was found on Sherehe to make test offers on. Ask Sherehe for one, then set ROLE_ID.');
}

beforeAll(() => {
  if (!BASE) throw new Error("Set SHEREHE_URL to Sherehe's API address first, for example: SHEREHE_URL=https://their-api.onrender.com");
  if (!KEY) throw new Error("Set SHEREHE_API_KEY to the partner key Sherehe issued to Kazi Connect.");
});
afterEach(withdrawMade);
afterAll(withdrawMade);

describe('every call needs the partner key (401)', () => {
  it.each([
    ['GET', '/api/events?status=upcoming'],
    ['GET', '/api/events/evt_2001'],
    ['GET', '/api/events/evt_2001/roles'],
    ['GET', `/api/offers/${MISSING.offer}`],
    ['DELETE', `/api/offers/${MISSING.offer}`],
  ])('%s %s without a key is refused with 401 and a message', async (method, path) => {
    const res = await api()[method.toLowerCase()](path);

    expect(res.status).toBe(401);
    expectError(res);
  });

  it('POST /api/offers without a key is refused with 401, and no offer is made', async () => {
    const roleId = (await findOpenRole()).id;

    const res = await api().post('/api/offers').send({ roleId, workersOffered: 1 });

    expect(res.status).toBe(401);
    expectError(res);
  });

  it('a wrong key is refused with 401 too', async () => {
    const res = await api().get('/api/events?status=upcoming').set('X-API-Key', `${KEY}-not-the-key`);

    expect(res.status).toBe(401);
  });
});

describe('GET /api/events?status=upcoming (K1)', () => {
  it('returns upcoming events with the contract fields and types', async () => {
    const res = await get('/api/events?status=upcoming');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(Array.isArray(res.body)).toBe(true);
    res.body.forEach(expectEvent);
    res.body.forEach((x) => expect(x.status).toBe('upcoming'));
  });

  it('filters by county, ignoring upper and lower case: every event returned is in that county', async () => {
    const all = (await get('/api/events?status=upcoming')).body;
    expect(all.length).toBeGreaterThan(0); // there must be something to filter
    const county = all[0].county;

    const res = await get(`/api/events?status=upcoming&county=${encodeURIComponent(county.toUpperCase())}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    res.body.forEach((x) => expect(same(x.county, county)).toBe(true));
  });

  it('edge case: a county with no events returns an empty list, not an error', async () => {
    const all = (await get('/api/events?status=upcoming')).body;
    const busy = new Set(all.map((x) => x.county.toLowerCase()));
    const quiet = COUNTIES_TO_TRY_FOR_NONE.find((c) => !busy.has(c.toLowerCase()));
    expect(quiet).toBeDefined(); // every county we try has events: add one to the list above

    const res = await get(`/api/events?status=upcoming&county=${encodeURIComponent(quiet)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('rejects a request without status with 400 and a message', async () => {
    const res = await get('/api/events');

    expect(res.status).toBe(400);
    expectError(res);
  });

  it('rejects a status other than upcoming with 400', async () => {
    const res = await get('/api/events?status=completed');

    expect(res.status).toBe(400);
    expectError(res);
  });
});

describe('GET /api/events/{eventId} (K1)', () => {
  it('returns one event with every contract field', async () => {
    const first = (await get('/api/events?status=upcoming')).body[0];

    const res = await get(`/api/events/${encodeURIComponent(first.id)}`);

    expect(res.status).toBe(200);
    expectEvent(res.body);
    expect(res.body.id).toBe(first.id);
  });

  it('returns 404 and a message for an event that does not exist', async () => {
    const res = await get(`/api/events/${MISSING.event}`);

    expect(res.status).toBe(404);
    expectError(res);
  });
});

describe('GET /api/events/{eventId}/roles (K2)', () => {
  it("returns the event's roles with the contract fields and types", async () => {
    const events = (await get('/api/events?status=upcoming')).body;
    let seen = 0;
    for (const event of events) {
      const res = await get(`/api/events/${encodeURIComponent(event.id)}/roles`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      res.body.forEach((role) => { expectRole(role); expect(role.eventId).toBe(event.id); seen++; });
    }
    expect(seen).toBeGreaterThan(0); // at least one role to look at
  });

  it('returns 404 and a message for an event that does not exist', async () => {
    const res = await get(`/api/events/${MISSING.event}/roles`);

    expect(res.status).toBe(404);
    expectError(res);
  });
});

describe('POST /api/offers (K3)', () => {
  it('creates an offer: 201, a pending Offer with a new id, the note kept, and a Location header', async () => {
    const role = await findOpenRole();

    const res = await makeOffer(role.id, 1, 'Kazi Connect partner test: please ignore');

    expect(res.status).toBe(201);
    expectOffer(res.body);
    expect(res.body).toMatchObject({ roleId: role.id, workersOffered: 1, note: 'Kazi Connect partner test: please ignore', status: 'pending' });
    expect(res.headers.location).toBe(`/api/offers/${res.body.id}`);
  });

  it('the note is optional: it comes back as an empty string when none was sent', async () => {
    const role = await findOpenRole();

    const res = await makeOffer(role.id, 1);

    expect(res.status).toBe(201);
    expect(res.body.note).toBe('');
  });

  it('the offer exists afterwards: reading it by id returns the same Offer', async () => {
    const role = await findOpenRole();
    const made = await makeOffer(role.id, 1, 'read-back check');

    const res = await get(`/api/offers/${made.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(made.body);
  });

  it.each([
    ['roleId is missing', () => ({ workersOffered: 1 })],
    ['workersOffered is missing', (roleId) => ({ roleId })],
    ['workersOffered is 0', (roleId) => ({ roleId, workersOffered: 0 })],
    ['workersOffered is negative', (roleId) => ({ roleId, workersOffered: -1 })],
    ['workersOffered is not a whole number', (roleId) => ({ roleId, workersOffered: 1.5 })],
    ['workersOffered is text', (roleId) => ({ roleId, workersOffered: '1' })],
    ['roleId is not text', () => ({ roleId: 3001, workersOffered: 1 })],
    ['note is over 500 characters', (roleId) => ({ roleId, workersOffered: 1, note: 'x'.repeat(501) })],
    ['a field the contract does not allow is sent', (roleId) => ({ roleId, workersOffered: 1, status: 'accepted' })],
  ])('rejects the offer with 400 and a message when %s, and makes no offer', async (_name, build) => {
    const role = await findOpenRole();

    const res = await post('/api/offers', build(role.id));

    expect(res.status).toBe(400);
    expectError(res);
  });

  it('rejects an offer of more workers than the role has free slots, with 400', async () => {
    const role = await findOpenRole();

    const res = await makeOffer(role.id, role.free + 1);

    expect(res.status).toBe(400);
    expectError(res);
  });

  it('returns 404 and a message for a role that does not exist', async () => {
    const res = await makeOffer(MISSING.role, 1);

    expect(res.status).toBe(404);
    expectError(res);
  });

  const withFullRole = process.env.FULL_ROLE_ID ? it : it.skip; // needs a role with no free slot; set FULL_ROLE_ID to run it
  withFullRole('returns 409 and a message for a role that is already full', async () => {
    const res = await makeOffer(process.env.FULL_ROLE_ID, 1);

    expect(res.status).toBe(409);
    expectError(res);
  });
});

describe('GET /api/offers/{offerId} (K4)', () => {
  it('returns 404 and a message for an offer that does not exist', async () => {
    const res = await get(`/api/offers/${MISSING.offer}`);

    expect(res.status).toBe(404);
    expectError(res);
  });
});

describe('DELETE /api/offers/{offerId} (K5)', () => {
  it('withdraws a pending offer: 204 with no body, and the offer no longer exists', async () => {
    const role = await findOpenRole();
    const made = await makeOffer(role.id, 1, 'withdraw check');

    const res = await del(`/api/offers/${made.body.id}`);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect((await get(`/api/offers/${made.body.id}`)).status).toBe(404);
  });

  it('frees the role: the same offer can be made again afterwards', async () => {
    const role = await findOpenRole();
    const first = await makeOffer(role.id, 1);
    await del(`/api/offers/${first.body.id}`);

    const again = await makeOffer(role.id, 1);

    expect(again.status).toBe(201);
  });

  it('withdrawing the same offer a second time returns 404', async () => {
    const role = await findOpenRole();
    const made = await makeOffer(role.id, 1);
    await del(`/api/offers/${made.body.id}`);

    const res = await del(`/api/offers/${made.body.id}`);

    expect(res.status).toBe(404);
    expectError(res);
  });

  it('returns 404 and a message for an offer that never existed', async () => {
    const res = await del(`/api/offers/${MISSING.offer}`);

    expect(res.status).toBe(404);
    expectError(res);
  });
});
