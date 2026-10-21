// Event work: shereheClient (the only module that talks to Sherehe) and the mappers that turn
// Sherehe's words into Kazi's. Tested against the local Sherehe stub.

const fetcher = require('../clients/fetcher');
const client = require('../clients/shereheClient');
const { UpstreamError, PartnerRejection } = require('../clients/upstreamError');
const { createShereheStub } = require('../helpers/shereheStub');
const { CATEGORIES, COUNTIES } = require('../sharedLists');
const {
  fromShereheEvent, fromShereheRole, fromShereheOffer, toEventOpening, toStaffingOffer, toJobInput,
} = require('../mappers');

let stub;
beforeAll(async () => {
  stub = createShereheStub();
  await stub.start();
  process.env.SHEREHE_API_URL = stub.url;
  process.env.SHEREHE_API_KEY = stub.apiKey;
});
afterAll(async () => {
  delete process.env.SHEREHE_API_URL;
  delete process.env.SHEREHE_API_KEY;
  await stub.stop();
});
beforeEach(() => { stub.reset(); fetcher.reset(); });

async function failure(promise) {
  try { await promise; } catch (err) { return err; }
  throw new Error('expected the call to fail, but it succeeded');
}

describe('configuration', () => {
  const saved = {};
  beforeEach(() => { saved.url = process.env.SHEREHE_API_URL; saved.key = process.env.SHEREHE_API_KEY; });
  afterEach(() => { process.env.SHEREHE_API_URL = saved.url; process.env.SHEREHE_API_KEY = saved.key; });

  it.each([
    ['the address is not set', () => { delete process.env.SHEREHE_API_URL; }],
    ['the address is not a web address', () => { process.env.SHEREHE_API_URL = 'sherehe.example'; }],
    ['the key is not set', () => { delete process.env.SHEREHE_API_KEY; }],
  ])('refuses to call Sherehe when %s, without sending anything', async (_name, unset) => {
    unset();

    const err = await failure(client.findOpenings());

    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.kind).toBe('config');
    expect(stub.requests).toHaveLength(0);
  });

  it('sends the key as X-API-Key on every call, and never in the address', async () => {
    await client.findOpenings();

    expect(stub.requests.length).toBeGreaterThan(0);
    stub.requests.forEach((r) => {
      expect(r.key).toBe(stub.apiKey);
      expect(r.search).not.toContain(stub.apiKey);
    });
  });
});

describe('findOpenings (K1 and K2)', () => {
  it('returns each role that has a free slot on an upcoming event, soonest shift first', async () => {
    const found = await client.findOpenings();

    expect(found.map(({ role }) => role.id)).toEqual(['rol_3003', 'rol_3001', 'rol_3004']);
    expect(found[1].event.name).toBe('Wanjiku and Otieno wedding');
  });

  it('leaves out a full role, and a role on an event that is not upcoming', async () => {
    const ids = (await client.findOpenings()).map(({ role }) => role.id);

    expect(ids).not.toContain('rol_3002'); // full
    expect(ids).not.toContain('rol_3005'); // on the completed event
  });

  it('works out the free slots as headcount minus filled', async () => {
    const found = await client.findOpenings();

    expect(Object.fromEntries(found.map(({ role }) => [role.id, role.openSlots]))).toEqual({ rol_3001: 6, rol_3003: 2, rol_3004: 5 });
  });

  it('filters by county, ignoring upper and lower case, and sends the county on to Sherehe', async () => {
    const found = await client.findOpenings({ county: 'mombasa' });

    expect(found.map(({ role }) => role.id)).toEqual(['rol_3004']);
    expect(stub.requests[0].search).toContain('county=mombasa');
  });

  it('returns an empty list for a county with no events', async () => {
    expect(await client.findOpenings({ county: 'Lamu' })).toEqual([]);
  });

  it('returns an empty list when Sherehe does not know the county (it answers 400)', async () => {
    expect(await client.findOpenings({ county: 'Atlantis' })).toEqual([]);
  });

  it('reads from the cache the second time, so Sherehe is not asked again', async () => {
    await client.findOpenings();
    const asked = stub.requests.length;

    await client.findOpenings();

    expect(stub.requests).toHaveLength(asked);
  });

  it('fails as a whole when the events list works but one event\'s roles cannot be read', async () => {
    stub.failOn('/roles');

    const err = await failure(client.findOpenings());

    expect(err).toMatchObject({ kind: 'status', status: 503 });
    expect(stub.requests.some((r) => r.path === '/api/events')).toBe(true); // the first call did succeed
  });

  it('gives a person one time budget for the whole list, not one per call', async () => {
    // Two calls in a row (the events, then their roles) at 300 ms each: 600 ms in all.
    // Each call is inside the 500 ms limit on its own, but together they are not.
    fetcher.configure({ userTimeoutMs: 500 });
    stub.setDelay(300);

    const err = await failure(client.findOpenings());

    expect(err).toMatchObject({ kind: 'timeout' });
  });

  it('still answers when the same calls fit inside the budget', async () => {
    fetcher.configure({ userTimeoutMs: 2000 });
    stub.setDelay(100);

    expect(await client.findOpenings()).toHaveLength(3);
  });

  it('fails when Sherehe is down for the events list itself', async () => {
    stub.setMode('error');

    expect(await failure(client.findOpenings())).toMatchObject({ kind: 'status', status: 503 });
  });

  it('treats an event that disappeared between the two calls as having no roles', async () => {
    const roles = await client.listRoles('evt_9999');

    expect(roles).toEqual([]);
  });

  it('treats an unexpected reply as a "shape" error, not as an empty list', async () => {
    stub.setMode('wrongShape');

    expect(await failure(client.findOpenings())).toMatchObject({ kind: 'shape' });
  });

  it("turns Sherehe's refusal of our key into an UpstreamError, not into something a user sees as 401", async () => {
    process.env.SHEREHE_API_KEY = 'a-wrong-key';
    try {
      expect(await failure(client.findOpenings())).toMatchObject({ kind: 'status', status: 401 });
    } finally {
      process.env.SHEREHE_API_KEY = stub.apiKey;
    }
  });
});

describe('findOpening', () => {
  it('finds one opening by its role id', async () => {
    const found = await client.findOpening('rol_3003');

    expect(found.role.id).toBe('rol_3003');
    expect(found.event.id).toBe('evt_2001');
  });

  it('returns null for a role that does not exist, is full, or is on a finished event', async () => {
    expect(await client.findOpening('rol_9999')).toBeNull();
    expect(await client.findOpening('rol_3002')).toBeNull();
    expect(await client.findOpening('rol_3005')).toBeNull();
  });
});

describe('createOffer (K3)', () => {
  it('creates an offer and returns it in our own terms', async () => {
    const offer = await client.createOffer({ roleId: 'rol_3001', workersOffered: 6, note: 'Six trained students' });

    expect(offer).toEqual({ id: 'ofr_4001', roleId: 'rol_3001', eventId: 'evt_2001', workersOffered: 6, status: 'pending' });
    expect(stub.requests.at(-1).body).toEqual({ roleId: 'rol_3001', workersOffered: 6, note: 'Six trained students' });
  });

  it('leaves the note out of the request when there is none', async () => {
    await client.createOffer({ roleId: 'rol_3001', workersOffered: 2 });

    expect(stub.requests.at(-1).body).toEqual({ roleId: 'rol_3001', workersOffered: 2 });
  });

  it.each([
    ['more workers than free slots', { roleId: 'rol_3001', workersOffered: 7 }, 'invalid'],
    ['a role that does not exist', { roleId: 'rol_9999', workersOffered: 1 }, 'not_found'],
    ['a full role', { roleId: 'rol_3002', workersOffered: 1 }, 'conflict'],
  ])('reports %s as a rejection, not a failure', async (_name, args, kind) => {
    const err = await failure(client.createOffer(args));

    expect(err).toBeInstanceOf(PartnerRejection);
    expect(err.kind).toBe(kind);
  });

  it('treats a refused key as a failure, not a rejection', async () => {
    process.env.SHEREHE_API_KEY = 'a-wrong-key';
    try {
      expect(await failure(client.createOffer({ roleId: 'rol_3001', workersOffered: 1 }))).toBeInstanceOf(UpstreamError);
    } finally {
      process.env.SHEREHE_API_KEY = stub.apiKey;
    }
  });

  it('is not cached and is not retried', async () => {
    await client.createOffer({ roleId: 'rol_3004', workersOffered: 1 });
    await client.createOffer({ roleId: 'rol_3004', workersOffered: 1 });
    stub.setMode('drop');
    await failure(client.createOffer({ roleId: 'rol_3004', workersOffered: 1 }));

    expect(stub.requests.filter((r) => r.method === 'POST')).toHaveLength(3);
  });
});

describe('getOffer (K4)', () => {
  it('returns the offer with its current status', async () => {
    const made = await client.createOffer({ roleId: 'rol_3001', workersOffered: 2 });

    expect((await client.getOffer(made.id)).status).toBe('pending');
  });

  it('is never cached, so a decision is seen at once', async () => {
    const made = await client.createOffer({ roleId: 'rol_3001', workersOffered: 2 });
    await client.getOffer(made.id);
    stub.decide(made.id, 'accepted');

    expect((await client.getOffer(made.id)).status).toBe('accepted');
  });

  it('returns null for an offer Sherehe no longer has', async () => {
    expect(await client.getOffer('ofr_9999')).toBeNull();
  });

  it('waits up to the background timeout, not the 10 seconds a waiting person gets', async () => {
    const made = await client.createOffer({ roleId: 'rol_3001', workersOffered: 2 });
    fetcher.configure({ userTimeoutMs: 50, backgroundTimeoutMs: 2000 });
    stub.setDelay(300);

    expect((await client.getOffer(made.id)).status).toBe('pending');
  });
});

describe('withdrawOffer (K5)', () => {
  it('withdraws a pending offer', async () => {
    const made = await client.createOffer({ roleId: 'rol_3001', workersOffered: 2 });

    expect(await client.withdrawOffer(made.id)).toBe('withdrawn');
    expect(stub.offers).toEqual([]);
  });

  it("reports an offer Sherehe no longer has as 'gone'", async () => {
    expect(await client.withdrawOffer('ofr_9999')).toBe('gone');
  });

  it('reports an offer the organiser already decided as a conflict', async () => {
    const made = await client.createOffer({ roleId: 'rol_3001', workersOffered: 2 });
    stub.decide(made.id, 'declined');

    const err = await failure(client.withdrawOffer(made.id));

    expect(err).toBeInstanceOf(PartnerRejection);
    expect(err.kind).toBe('conflict');
  });
});

describe('mapping what Sherehe sends', () => {
  const event = { id: 'evt_2001', name: 'Wanjiku and Otieno wedding', type: 'wedding', county: 'nairobi', area: 'Westlands', venue: 'Sarit Expo Centre', startsAt: '2026-12-05T14:00:00Z', endsAt: '2026-12-05T22:00:00Z', expectedGuests: 300, status: 'upcoming' };
  const role = { id: 'rol_3001', eventId: 'evt_2001', title: 'Waiters', category: 'catering', headcount: 6, filled: 2, shiftStart: '2026-12-05T13:00:00Z', shiftEnd: '2026-12-05T23:00:00Z', payPerShift: 1500 };

  it('writes a county the way the shared list does', () => {
    expect(fromShereheEvent(event).county).toBe('Nairobi');
    expect(fromShereheEvent({ ...event, county: '  uasin gishu ' }).county).toBe('Uasin Gishu');
  });

  it('keeps a county that is not on the shared list as it came', () => {
    expect(fromShereheEvent({ ...event, county: 'Somewhere' }).county).toBe('Somewhere');
  });

  it('keeps every shared category, and turns any other into "events"', () => {
    CATEGORIES.forEach((c) => expect(fromShereheRole({ ...role, category: c }).category).toBe(c));
    expect(fromShereheRole({ ...role, category: 'Catering ' }).category).toBe('catering');
    expect(fromShereheRole({ ...role, category: 'bartending' }).category).toBe('events');
  });

  it.each([
    ['an event with no name', () => fromShereheEvent({ ...event, name: '' })],
    ['an event with a bad date', () => fromShereheEvent({ ...event, startsAt: 'soon' })],
    ['a role with no pay', () => fromShereheRole({ ...role, payPerShift: undefined })],
    ['a role with pay as text', () => fromShereheRole({ ...role, payPerShift: '1500' })],
    ['a role with a headcount of zero', () => fromShereheRole({ ...role, headcount: 0 })],
    ['a role with no shift times', () => fromShereheRole({ ...role, shiftStart: undefined })],
    ['an offer with an unknown status', () => fromShereheOffer({ id: 'ofr_1', roleId: 'rol_3001', workersOffered: 1, status: 'maybe' })],
    ['an offer with no workers', () => fromShereheOffer({ id: 'ofr_1', roleId: 'rol_3001', status: 'pending' })],
    ['something that is not an object', () => fromShereheRole('rol_3001')],
  ])('refuses %s with a "shape" error', (_name, build) => {
    expect(build).toThrow(UpstreamError);
    expect(build).toThrow(expect.objectContaining({ kind: 'shape' }));
  });

  it('lists the 47 shared counties, each once', () => {
    expect(COUNTIES).toHaveLength(47);
    expect(new Set(COUNTIES).size).toBe(47);
  });
});

describe('mapping what we send', () => {
  const event = fromShereheEvent({ id: 'evt_2001', name: 'Wanjiku and Otieno wedding', county: 'Nairobi', area: 'Westlands', startsAt: '2026-12-05T14:00:00Z', status: 'upcoming' });
  const role = fromShereheRole({ id: 'rol_3001', eventId: 'evt_2001', title: 'Waiters', category: 'catering', headcount: 6, filled: 0, shiftStart: '2026-12-05T13:00:00Z', shiftEnd: '2026-12-05T23:00:00Z', payPerShift: 1500 });

  it('builds an EventOpening with exactly the contract fields', () => {
    const opening = toEventOpening(event, role);

    expect(opening).toEqual({
      roleId: 'rol_3001', eventName: 'Wanjiku and Otieno wedding', county: 'Nairobi', area: 'Westlands',
      startsAt: '2026-12-05T13:00:00Z', title: 'Waiters', category: 'catering', openSlots: 6, payPerShift: 1500,
    });
  });

  it('builds a StaffingOffer from a stored row, with jobId null until accepted', () => {
    const row = { _id: 'sof_1001', employer_id: 'usr_1001', sherehe_offer_id: 'ofr_4001', role_id: 'rol_3001', event_name: 'Wanjiku and Otieno wedding', workers_offered: 6, status: 'pending', job_id: null, job_draft: {}, created_at: new Date('2026-11-20T09:15:00.000Z') };

    expect(toStaffingOffer(row)).toEqual({
      id: 'sof_1001', roleId: 'rol_3001', eventName: 'Wanjiku and Otieno wedding', workersOffered: 6,
      status: 'pending', jobId: null, createdAt: '2026-11-20T09:15:00Z',
    });
    expect(toStaffingOffer({ ...row, status: 'accepted', job_id: 'job_12353' }).jobId).toBe('job_12353');
  });

  it('builds the job to open: role title and event, shared category, one pay amount, not urgent', () => {
    expect(toJobInput(event, role)).toEqual({
      title: 'Waiters, Wanjiku and Otieno wedding', category: 'catering', county: 'Nairobi', area: 'Westlands',
      duration: 'One shift, 5 Dec 2026, about 10 hours', urgent: false, payMin: 1500, payMax: 1500,
    });
  });

  it('writes the shift date as the Kenyan date, three hours ahead of UTC', () => {
    const lateShift = fromShereheRole({ id: 'rol_1', eventId: 'evt_1', title: 'Cleaners', category: 'cleaning', headcount: 2, filled: 0, shiftStart: '2026-12-31T22:30:00Z', shiftEnd: '2027-01-01T01:30:00Z', payPerShift: 900 });

    expect(toJobInput(event, lateShift).duration).toBe('One shift, 1 Jan 2027, about 3 hours');
  });

  it('keeps the job title and duration within the limits the job form uses', () => {
    const longRole = { ...role, title: 'T'.repeat(80) };
    const longEvent = { ...event, name: 'E'.repeat(80) };
    const job = toJobInput(longEvent, longRole);

    expect(job.title.length).toBeLessThanOrEqual(100);
    expect(job.duration.length).toBeLessThanOrEqual(40);
  });
});
