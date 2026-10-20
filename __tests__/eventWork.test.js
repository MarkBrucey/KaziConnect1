// Event work, Endpoints 22 to 25 (website need W7). Every test follows arrange, act, assert and
// checks the real response against the contract: exact field names, types and values, not just
// the status code. Sherehe is the local stub in helpers/shereheStub.js, which can be told to be
// down, slow or full of surprises.

const request = require('supertest');
const { createServer } = require('../app');
const db = require('../db');
const fetcher = require('../clients/fetcher');
const { PARTNER_UNAVAILABLE } = require('../clients/upstreamError');
const { createShereheStub } = require('../helpers/shereheStub');
const { DEMO_PASSWORD } = require('../seedData');

const OPENING_FIELDS = ['area', 'category', 'county', 'eventName', 'openSlots', 'payPerShift', 'roleId', 'startsAt', 'title'];
const OFFER_FIELDS = ['createdAt', 'eventName', 'id', 'jobId', 'roleId', 'status', 'workersOffered'];
const JOB_FIELDS = ['area', 'category', 'county', 'duration', 'id', 'payRange', 'status', 'title', 'urgent'];
const DAY = 24 * 60 * 60 * 1000;
const future = (days) => new Date(Date.now() + days * DAY).toISOString().replace(/\.\d{3}Z$/, 'Z');

function expectErrorBody(res, message) {
  expect(Object.keys(res.body)).toEqual(['message']);
  expect(typeof res.body.message).toBe('string');
  if (message) expect(res.body.message).toBe(message);
}

function expectOffer(offer) {
  expect(Object.keys(offer).sort()).toEqual(OFFER_FIELDS);
  expect(typeof offer.id).toBe('string');
  expect(typeof offer.roleId).toBe('string');
  expect(typeof offer.eventName).toBe('string');
  expect(Number.isInteger(offer.workersOffered)).toBe(true);
  expect(['pending', 'accepted', 'declined']).toContain(offer.status);
  expect(offer.jobId === null || typeof offer.jobId === 'string').toBe(true);
  expect(offer.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
}

let server;
let stub;
beforeAll(async () => {
  stub = createShereheStub();
  await stub.start();
  process.env.SHEREHE_API_URL = stub.url;
  process.env.SHEREHE_API_KEY = stub.apiKey;
  server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
});
afterAll(async () => {
  delete process.env.SHEREHE_API_URL;
  delete process.env.SHEREHE_API_KEY;
  await new Promise((resolve) => server.close(resolve));
  await stub.stop();
  if (db.close) await db.close();
});
beforeEach(async () => {
  await db.reset();
  stub.reset();
  fetcher.reset();
  process.env.SHEREHE_API_URL = stub.url;
  process.env.SHEREHE_API_KEY = stub.apiKey;
});

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
async function tokenFor(email) {
  const res = await request(server).post('/api/auth/login').send({ email, password: DEMO_PASSWORD });
  return res.body.token;
}
async function newEmployerToken() {
  const res = await request(server).post('/api/auth/register')
    .send({ name: 'Other Employer', email: 'other@example.com', password: 'safe-password-1', role: 'employer' });
  return res.body.token;
}
const employer = () => tokenFor('employer@kaziconnect.demo');
const student = () => tokenFor('student@kaziconnect.demo');
const offerFor = (token, body) => request(server).post('/api/staffing-offers').set(bearer(token)).send(body);
const validOffer = (over = {}) => ({ roleId: 'rol_3001', workersOffered: 4, note: 'Four trained catering students', ...over });
const postedToSherehe = () => stub.requests.filter((r) => r.method === 'POST');

describe('Endpoint 22: GET /api/event-openings', () => {
  it('lists the open roles as EventOpenings: exact contract fields, right types, soonest shift first', async () => {
    const token = await employer();

    const res = await request(server).get('/api/event-openings').set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.map((o) => o.roleId)).toEqual(['rol_3003', 'rol_3001', 'rol_3004']);
    res.body.forEach((o) => {
      expect(Object.keys(o).sort()).toEqual(OPENING_FIELDS);
      expect(typeof o.roleId).toBe('string');
      expect(typeof o.eventName).toBe('string');
      expect(typeof o.county).toBe('string');
      expect(typeof o.area).toBe('string');
      expect(o.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(typeof o.title).toBe('string');
      expect(Number.isInteger(o.openSlots)).toBe(true);
      expect(o.openSlots).toBeGreaterThanOrEqual(1);
      expect(typeof o.payPerShift).toBe('number');
    });
  });

  it("describes a role in Kazi's words, with the values from Sherehe's role and event", async () => {
    const token = await employer();

    const res = await request(server).get('/api/event-openings?county=Nairobi').set(bearer(token));

    expect(res.body.find((o) => o.roleId === 'rol_3001')).toEqual({
      roleId: 'rol_3001', eventName: 'Wanjiku and Otieno wedding', county: 'Nairobi', area: 'Westlands',
      startsAt: '2026-12-05T13:00:00Z', title: 'Waiters', category: 'catering', openSlots: 6, payPerShift: 1500,
    });
  });

  it("uses the shared categories, and shows only free slots (a role with 3 places and 1 filled has 2 open)", async () => {
    const token = await employer();

    const res = await request(server).get('/api/event-openings').set(bearer(token));

    expect(res.body.find((o) => o.roleId === 'rol_3003')).toMatchObject({ category: 'security', openSlots: 2 });
  });

  it('leaves out full roles and roles on events that are not upcoming', async () => {
    const token = await employer();

    const res = await request(server).get('/api/event-openings').set(bearer(token));

    const ids = res.body.map((o) => o.roleId);
    expect(ids).not.toContain('rol_3002'); // full
    expect(ids).not.toContain('rol_3005'); // the event is over
  });

  it('filters by county, ignoring upper and lower case', async () => {
    const token = await employer();

    const res = await request(server).get('/api/event-openings?county=MOMBASA').set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.map((o) => o.roleId)).toEqual(['rol_3004']);
    expect(res.body[0].county).toBe('Mombasa');
  });

  it('returns an empty list, not an error, for a county with nothing on', async () => {
    const token = await employer();

    const res = await request(server).get('/api/event-openings?county=Lamu').set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns an empty list for a name that is not a county at all', async () => {
    const token = await employer();

    const res = await request(server).get('/api/event-openings?county=Atlantis').set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('treats a blank county as no filter', async () => {
    const token = await employer();

    const res = await request(server).get('/api/event-openings?county=').set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
  });

  it('asks Sherehe with our key, and a second request within 5 minutes is answered from the cache', async () => {
    const token = await employer();
    await request(server).get('/api/event-openings').set(bearer(token));
    const asked = stub.requests.length;

    const again = await request(server).get('/api/event-openings').set(bearer(token));

    expect(again.body).toHaveLength(3);
    expect(stub.requests).toHaveLength(asked);
    stub.requests.forEach((r) => expect(r.key).toBe(stub.apiKey));
  });

  it('answers 401 without a token, and does not call Sherehe', async () => {
    const res = await request(server).get('/api/event-openings');

    expect(res.status).toBe(401);
    expectErrorBody(res);
    expect(stub.requests).toHaveLength(0);
  });

  it('answers 401 for a token that is not valid', async () => {
    const res = await request(server).get('/api/event-openings').set(bearer('a'.repeat(64)));

    expect(res.status).toBe(401);
  });

  it('answers 403 for a student, and does not call Sherehe', async () => {
    const token = await student();

    const res = await request(server).get('/api/event-openings').set(bearer(token));

    expect(res.status).toBe(403);
    expectErrorBody(res, 'Only employers can do this.');
    expect(stub.requests).toHaveLength(0);
  });
});

describe('Endpoint 22: when Sherehe cannot be used', () => {
  async function expectUnavailable(setUp) {
    const token = await employer();
    setUp();
    const res = await request(server).get('/api/event-openings').set(bearer(token));
    expect(res.status).toBe(502);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expectErrorBody(res, PARTNER_UNAVAILABLE);
    return res;
  }

  it('answers 502 with our own message when Sherehe is down', async () => {
    await expectUnavailable(() => stub.setMode('drop'));
  });

  it('answers 502 when Sherehe is not there at all', async () => {
    await expectUnavailable(() => { process.env.SHEREHE_API_URL = 'http://127.0.0.1:9'; });
  });

  it("answers 502 and never passes Sherehe's error text on", async () => {
    const res = await expectUnavailable(() => stub.setMode('error'));

    expect(JSON.stringify(res.body) + JSON.stringify(res.headers)).not.toMatch(/hunter2|database|password|stub internal/);
  });

  it('answers 502, not 401, when Sherehe refuses our key (our 401 means "log in")', async () => {
    const res = await expectUnavailable(() => { process.env.SHEREHE_API_KEY = 'a-wrong-key'; });

    expect(res.body.message).not.toMatch(/partner key|X-API-Key/);
  });

  it('answers 502 when Sherehe is too slow for a person to wait', async () => {
    await expectUnavailable(() => { fetcher.configure({ userTimeoutMs: 50 }); stub.setDelay(400); });
  });

  it('answers 502 when Sherehe sends something that is not JSON', async () => {
    await expectUnavailable(() => stub.setMode('garbage'));
  });

  it('answers 502 when Sherehe sends JSON in a shape the contract does not promise', async () => {
    await expectUnavailable(() => stub.setMode('wrongShape'));
  });

  it('answers 502 when one event\'s roles cannot be read (never a half-empty list)', async () => {
    await expectUnavailable(() => stub.failOn('/roles'));
  });

  it('answers 502 when the Sherehe address and key are not set', async () => {
    await expectUnavailable(() => { delete process.env.SHEREHE_API_URL; delete process.env.SHEREHE_API_KEY; });
  });

  it('still asks for a login first: no token is 401, even with Sherehe down', async () => {
    stub.setMode('drop');

    const res = await request(server).get('/api/event-openings');

    expect(res.status).toBe(401);
  });

  it('recovers by itself once Sherehe is back', async () => {
    const token = await employer();
    stub.setMode('drop');
    await request(server).get('/api/event-openings').set(bearer(token));
    stub.setMode('up');

    const res = await request(server).get('/api/event-openings').set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
  });
});

describe('Endpoint 23: POST /api/staffing-offers', () => {
  it('makes the offer: 201 with the exact StaffingOffer shape, pending, no job yet', async () => {
    const token = await employer();

    const res = await offerFor(token, validOffer());

    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expectOffer(res.body);
    expect(res.body).toMatchObject({
      id: 'sof_1001', roleId: 'rol_3001', eventName: 'Wanjiku and Otieno wedding', workersOffered: 4, status: 'pending', jobId: null,
    });
  });

  it('really sends the offer to Sherehe, with the key and the note', async () => {
    const token = await employer();

    await offerFor(token, validOffer());

    expect(stub.offers).toHaveLength(1);
    expect(stub.offers[0]).toMatchObject({ roleId: 'rol_3001', workersOffered: 4, note: 'Four trained catering students', status: 'pending' });
    expect(postedToSherehe()).toHaveLength(1);
    expect(postedToSherehe()[0].key).toBe(stub.apiKey);
    expect(postedToSherehe()[0].body).toEqual({ roleId: 'rol_3001', workersOffered: 4, note: 'Four trained catering students' });
  });

  it('works without a note, and sends none', async () => {
    const token = await employer();

    const res = await offerFor(token, { roleId: 'rol_3001', workersOffered: 1 });

    expect(res.status).toBe(201);
    expect(postedToSherehe()[0].body).toEqual({ roleId: 'rol_3001', workersOffered: 1 });
  });

  it('really stores it: it appears in the employer\'s own list straight away', async () => {
    const token = await employer();
    const made = await offerFor(token, validOffer());

    const list = await request(server).get('/api/me/staffing-offers').set(bearer(token));

    expect(list.body).toEqual([made.body]);
  });

  it('works out the job to open now, from the role as the employer saw it', async () => {
    const token = await employer();
    await offerFor(token, validOffer());

    const row = await db.findStaffingOfferById('sof_1001');

    expect(row.job_draft).toEqual({
      title: 'Waiters, Wanjiku and Otieno wedding', category: 'catering', county: 'Nairobi', area: 'Westlands',
      duration: 'One shift, 5 Dec 2026, about 10 hours', urgent: false, payMin: 1500, payMax: 1500,
    });
    expect(row.sherehe_offer_id).toBe('ofr_4001');
  });

  it('opens no job yet: the public listings are exactly as before', async () => {
    const token = await employer();
    await offerFor(token, validOffer());

    const jobs = await request(server).get('/api/jobs?status=active');

    expect(jobs.body).toHaveLength(6);
  });

  it.each([
    ['roleId is missing', { workersOffered: 2 }],
    ['workersOffered is missing', { roleId: 'rol_3001' }],
    ['roleId is empty', { roleId: '   ', workersOffered: 2 }],
    ['roleId is a number', { roleId: 3001, workersOffered: 2 }],
    ['roleId is far too long', { roleId: 'r'.repeat(81), workersOffered: 2 }],
    ['workersOffered is 0', { roleId: 'rol_3001', workersOffered: 0 }],
    ['workersOffered is negative', { roleId: 'rol_3001', workersOffered: -3 }],
    ['workersOffered is not a whole number', { roleId: 'rol_3001', workersOffered: 1.5 }],
    ['workersOffered is text', { roleId: 'rol_3001', workersOffered: '3' }],
    ['workersOffered is a boolean', { roleId: 'rol_3001', workersOffered: true }],
    ['workersOffered is absurdly large', { roleId: 'rol_3001', workersOffered: 10001 }],
    ['note is not text', { roleId: 'rol_3001', workersOffered: 2, note: 42 }],
    ['note is over 500 characters', { roleId: 'rol_3001', workersOffered: 2, note: 'x'.repeat(501) }],
    ['a field the contract does not allow is sent', { roleId: 'rol_3001', workersOffered: 2, status: 'accepted' }],
    ['the body is an array', [{ roleId: 'rol_3001', workersOffered: 2 }]],
  ])('rejects the offer with 400 when %s, and sends and stores nothing', async (_name, body) => {
    const token = await employer();

    const res = await offerFor(token, body);

    expect(res.status).toBe(400);
    expectErrorBody(res);
    expect(stub.requests).toHaveLength(0);
    expect(await db.findStaffingOffersByEmployer('usr_1001')).toEqual([]);
  });

  it('accepts a note of exactly 500 characters', async () => {
    const token = await employer();

    const res = await offerFor(token, validOffer({ note: 'x'.repeat(500) }));

    expect(res.status).toBe(201);
  });

  it('rejects a request with no body at all with 400', async () => {
    const token = await employer();

    const res = await request(server).post('/api/staffing-offers').set(bearer(token));

    expect(res.status).toBe(400);
    expectErrorBody(res);
  });

  it('rejects a body that is not valid JSON with 400 and a message', async () => {
    const token = await employer();

    const res = await request(server).post('/api/staffing-offers').set(bearer(token))
      .set('Content-Type', 'application/json').send('{"roleId": "rol_3001",');

    expect(res.status).toBe(400);
    expectErrorBody(res, 'Request body is not valid JSON');
  });

  it('answers 401 without a token and 403 for a student, and sends nothing to Sherehe', async () => {
    const studentToken = await student();

    const anonymous = await request(server).post('/api/staffing-offers').send(validOffer());
    const forbidden = await offerFor(studentToken, validOffer());

    expect(anonymous.status).toBe(401);
    expect(forbidden.status).toBe(403);
    expectErrorBody(forbidden, 'Only employers can do this.');
    expect(stub.requests).toHaveLength(0);
  });

  it.each([
    ['does not exist', 'rol_9999'],
    ['is already full', 'rol_3002'],
    ['is on an event that is over', 'rol_3005'],
  ])('answers 404 when the role %s, without trying to make an offer', async (_name, roleId) => {
    const token = await employer();

    const res = await offerFor(token, validOffer({ roleId }));

    expect(res.status).toBe(404);
    expectErrorBody(res, `No open role with the id ${roleId}`);
    expect(postedToSherehe()).toHaveLength(0);
    expect(await db.findStaffingOffersByEmployer('usr_1001')).toEqual([]);
  });

  it('answers 400 when Sherehe says there are fewer free slots than workers offered, in our own words', async () => {
    const token = await employer();

    const res = await offerFor(token, validOffer({ workersOffered: 7 })); // rol_3001 has 6 free

    expect(res.status).toBe(400);
    expectErrorBody(res, 'workersOffered must be a whole number from 1 up to the free slots on this role');
    expect(res.body.message).not.toBe('workersOffered must be a whole number from 1 to the open slots'); // not Sherehe's text
    expect(await db.findStaffingOffersByEmployer('usr_1001')).toEqual([]);
    expect(stub.offers).toEqual([]);
  });

  it('answers 409 when the employer already has an offer waiting on the role', async () => {
    const token = await employer();
    await offerFor(token, validOffer());

    const res = await offerFor(token, validOffer({ workersOffered: 1 }));

    expect(res.status).toBe(409);
    expectErrorBody(res);
    expect(postedToSherehe()).toHaveLength(1); // the second never reached Sherehe
    expect(stub.offers).toHaveLength(1);
    expect(await db.findStaffingOffersByEmployer('usr_1001')).toHaveLength(1);
  });

  it('answers 409 when another Kazi employer already has an offer waiting on the role', async () => {
    const first = await employer();
    const second = await newEmployerToken();
    await offerFor(first, validOffer());

    const res = await offerFor(second, validOffer());

    expect(res.status).toBe(409);
    expect(stub.offers).toHaveLength(1);
  });

  it('allows a new offer on the same role once the earlier one was declined', async () => {
    const token = await employer();
    const first = await offerFor(token, validOffer());
    await db.declineStaffingOffer(first.body.id);

    const again = await offerFor(token, validOffer({ workersOffered: 2 }));

    expect(again.status).toBe(201);
  });

  it('allows offers on different roles at the same time', async () => {
    const token = await employer();

    const a = await offerFor(token, validOffer({ roleId: 'rol_3001' }));
    const b = await offerFor(token, validOffer({ roleId: 'rol_3004', workersOffered: 2 }));

    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.body.id).toBe('sof_1002');
  });

  it('answers 409 when the role filled up at Sherehe after the employer saw it, and keeps nothing', async () => {
    const token = await employer();
    await request(server).get('/api/event-openings').set(bearer(token)); // the employer's page, now cached
    stub.fillRole('rol_3001');

    const res = await offerFor(token, validOffer());

    expect(res.status).toBe(409);
    expectErrorBody(res);
    expect(await db.findStaffingOffersByEmployer('usr_1001')).toEqual([]);
    expect(stub.offers).toEqual([]);
  });

  it('when two employers offer on a role at the same moment, one wins and the other is taken back from Sherehe', async () => {
    const a = await employer();
    const b = await newEmployerToken();

    const [one, two] = await Promise.all([offerFor(a, validOffer()), offerFor(b, validOffer())]);

    expect([one.status, two.status].sort()).toEqual([201, 409]);
    expect(stub.offers).toHaveLength(1); // the loser's offer was withdrawn, so the organiser sees only one
    expect(await db.findPendingStaffingOffers()).toHaveLength(1);
  });
});

describe('Endpoint 23: when Sherehe cannot be used', () => {
  it('answers 502 and stores nothing when Sherehe goes down before the offer is made', async () => {
    const token = await employer();
    await request(server).get('/api/event-openings').set(bearer(token)); // the lists are cached, as on the employer's page
    stub.setMode('drop');

    const res = await offerFor(token, validOffer());

    expect(res.status).toBe(502);
    expectErrorBody(res, PARTNER_UNAVAILABLE);
    expect(await db.findStaffingOffersByEmployer('usr_1001')).toEqual([]);
  });

  it('answers 502 when Sherehe is down and nothing is cached', async () => {
    const token = await employer();
    stub.setMode('drop');

    const res = await offerFor(token, validOffer());

    expect(res.status).toBe(502);
    expectErrorBody(res, PARTNER_UNAVAILABLE);
  });

  it('answers 502 and stores nothing when Sherehe is too slow to answer the offer', async () => {
    const token = await employer();
    await request(server).get('/api/event-openings').set(bearer(token));
    fetcher.configure({ userTimeoutMs: 50 });
    stub.setDelay(400);

    const res = await offerFor(token, validOffer());

    expect(res.status).toBe(502);
    expect(await db.findStaffingOffersByEmployer('usr_1001')).toEqual([]);
  });

  it('does not retry the offer by itself', async () => {
    const token = await employer();
    await request(server).get('/api/event-openings').set(bearer(token));
    stub.setMode('error');

    await offerFor(token, validOffer());

    expect(postedToSherehe()).toHaveLength(1);
  });

  it('answers 502 and passes nothing of Sherehe\'s error on', async () => {
    const token = await employer();
    await request(server).get('/api/event-openings').set(bearer(token));
    stub.setMode('error');

    const res = await offerFor(token, validOffer());

    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toMatch(/hunter2|database|password/);
  });

  it('still checks the body first: a bad body is 400, not 502, with Sherehe down', async () => {
    const token = await employer();
    stub.setMode('drop');

    const res = await offerFor(token, { roleId: 'rol_3001' });

    expect(res.status).toBe(400);
  });
});

describe('Endpoint 24: GET /api/me/staffing-offers', () => {
  it('is an empty list for an employer with no offers', async () => {
    const token = await employer();

    const res = await request(server).get('/api/me/staffing-offers').set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('lists the employer\'s offers newest first, each with the exact StaffingOffer fields', async () => {
    const token = await employer();
    await offerFor(token, validOffer({ roleId: 'rol_3001' }));
    await offerFor(token, validOffer({ roleId: 'rol_3004', workersOffered: 2 }));

    const res = await request(server).get('/api/me/staffing-offers').set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.map((o) => o.id)).toEqual(['sof_1002', 'sof_1001']);
    res.body.forEach(expectOffer);
  });

  it('shows only the logged in employer\'s own offers', async () => {
    const mineToken = await employer();
    const otherToken = await newEmployerToken();
    await offerFor(mineToken, validOffer());

    const res = await request(server).get('/api/me/staffing-offers').set(bearer(otherToken));

    expect(res.body).toEqual([]);
  });

  it('shows the job once an offer is accepted, and the final status once it is declined', async () => {
    const token = await employer();
    const a = await offerFor(token, validOffer({ roleId: 'rol_3001' }));
    const b = await offerFor(token, validOffer({ roleId: 'rol_3004', workersOffered: 2 }));
    const { job } = await db.acceptStaffingOffer(a.body.id);
    await db.declineStaffingOffer(b.body.id);

    const res = await request(server).get('/api/me/staffing-offers').set(bearer(token));

    expect(res.body.find((o) => o.id === a.body.id)).toMatchObject({ status: 'accepted', jobId: job._id });
    expect(res.body.find((o) => o.id === b.body.id)).toMatchObject({ status: 'declined', jobId: null });
  });

  it('never calls Sherehe, so it works even when Sherehe is down', async () => {
    const token = await employer();
    await offerFor(token, validOffer());
    const asked = stub.requests.length;
    stub.setMode('drop');

    const res = await request(server).get('/api/me/staffing-offers').set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(stub.requests).toHaveLength(asked);
  });

  it('answers 401 without a token and 403 for a student', async () => {
    const studentToken = await student();

    expect((await request(server).get('/api/me/staffing-offers')).status).toBe(401);
    const forbidden = await request(server).get('/api/me/staffing-offers').set(bearer(studentToken));
    expect(forbidden.status).toBe(403);
    expectErrorBody(forbidden);
  });
});

describe('Endpoint 25: DELETE /api/staffing-offers/{offerId}', () => {
  it('withdraws a pending offer: 204 with no body', async () => {
    const token = await employer();
    const made = await offerFor(token, validOffer());

    const res = await request(server).delete(`/api/staffing-offers/${made.body.id}`).set(bearer(token));

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
  });

  it('withdraws it at Sherehe and deletes it here', async () => {
    const token = await employer();
    const made = await offerFor(token, validOffer());

    await request(server).delete(`/api/staffing-offers/${made.body.id}`).set(bearer(token));

    expect(stub.offers).toEqual([]);
    expect(stub.requests.filter((r) => r.method === 'DELETE')).toHaveLength(1);
    expect(await db.findStaffingOfferById(made.body.id)).toBeNull();
    const list = await request(server).get('/api/me/staffing-offers').set(bearer(token));
    expect(list.body).toEqual([]);
  });

  it('frees the role: the same employer can offer on it again straight away', async () => {
    const token = await employer();
    const made = await offerFor(token, validOffer());
    await request(server).delete(`/api/staffing-offers/${made.body.id}`).set(bearer(token));

    const again = await offerFor(token, validOffer({ workersOffered: 2 }));

    expect(again.status).toBe(201);
  });

  it('answers 404 for an id that does not exist, and 404 the second time', async () => {
    const token = await employer();
    const made = await offerFor(token, validOffer());
    await request(server).delete(`/api/staffing-offers/${made.body.id}`).set(bearer(token));

    const missing = await request(server).delete('/api/staffing-offers/sof_9999').set(bearer(token));
    const twice = await request(server).delete(`/api/staffing-offers/${made.body.id}`).set(bearer(token));

    expect(missing.status).toBe(404);
    expectErrorBody(missing);
    expect(twice.status).toBe(404);
  });

  it('answers 403 for an offer another employer made, and leaves it alone', async () => {
    const mineToken = await employer();
    const otherToken = await newEmployerToken();
    const made = await offerFor(mineToken, validOffer());

    const res = await request(server).delete(`/api/staffing-offers/${made.body.id}`).set(bearer(otherToken));

    expect(res.status).toBe(403);
    expectErrorBody(res);
    expect(stub.offers).toHaveLength(1);
    expect((await db.findStaffingOfferById(made.body.id)).status).toBe('pending');
  });

  it.each(['accepted', 'declined'])('answers 409 for an offer that is already %s, without calling Sherehe', async (final) => {
    const token = await employer();
    const made = await offerFor(token, validOffer());
    if (final === 'accepted') await db.acceptStaffingOffer(made.body.id); else await db.declineStaffingOffer(made.body.id);
    const before = stub.requests.length;

    const res = await request(server).delete(`/api/staffing-offers/${made.body.id}`).set(bearer(token));

    expect(res.status).toBe(409);
    expectErrorBody(res);
    expect(stub.requests).toHaveLength(before);
    expect((await db.findStaffingOfferById(made.body.id)).status).toBe(final);
  });

  it('answers 409 when the organiser accepted just now and we have not noticed yet, and changes nothing', async () => {
    const token = await employer();
    const made = await offerFor(token, validOffer());
    stub.decide('ofr_4001', 'accepted'); // on Sherehe's website; the poller has not run

    const res = await request(server).delete(`/api/staffing-offers/${made.body.id}`).set(bearer(token));

    expect(res.status).toBe(409);
    expectErrorBody(res);
    expect(stub.offers).toHaveLength(1);
    expect((await db.findStaffingOfferById(made.body.id)).status).toBe('pending'); // the poller will catch up
  });

  it('treats an offer Sherehe no longer has as withdrawn: 204, and ours is deleted', async () => {
    const token = await employer();
    const made = await offerFor(token, validOffer());
    stub.dropOffer('ofr_4001');

    const res = await request(server).delete(`/api/staffing-offers/${made.body.id}`).set(bearer(token));

    expect(res.status).toBe(204);
    expect(await db.findStaffingOfferById(made.body.id)).toBeNull();
  });

  it('answers 401 without a token and 403 for a student', async () => {
    const studentToken = await student();

    expect((await request(server).delete('/api/staffing-offers/sof_1001')).status).toBe(401);
    expect((await request(server).delete('/api/staffing-offers/sof_1001').set(bearer(studentToken))).status).toBe(403);
  });

  it('answers 502 and keeps the offer pending when Sherehe is down', async () => {
    const token = await employer();
    const made = await offerFor(token, validOffer());
    stub.setMode('drop');

    const res = await request(server).delete(`/api/staffing-offers/${made.body.id}`).set(bearer(token));

    expect(res.status).toBe(502);
    expectErrorBody(res, PARTNER_UNAVAILABLE);
    expect((await db.findStaffingOfferById(made.body.id)).status).toBe('pending');
    stub.setMode('up');
    expect(stub.offers).toHaveLength(1);
  });

  it('answers 502 and keeps the offer when Sherehe is too slow', async () => {
    const token = await employer();
    const made = await offerFor(token, validOffer());
    fetcher.configure({ userTimeoutMs: 50 });
    stub.setDelay(400);

    const res = await request(server).delete(`/api/staffing-offers/${made.body.id}`).set(bearer(token));

    expect(res.status).toBe(502);
    expect(await db.findStaffingOfferById(made.body.id)).not.toBeNull();
  });
});

describe('When Sherehe is down, Endpoints 1 to 21 are unaffected', () => {
  it.each([['down', () => stub.setMode('drop')], ['not configured', () => { delete process.env.SHEREHE_API_URL; delete process.env.SHEREHE_API_KEY; }]])(
    'the whole Ujuzi-facing API and the website API keep working while Sherehe is %s', async (_name, breakIt) => {
      const token = await employer();
      breakIt();

      const jobs = await request(server).get('/api/jobs?status=active');
      const filtered = await request(server).get('/api/jobs?county=Nairobi&category=accommodation&status=active');
      const job = await request(server).get('/api/jobs/job_12345');
      const jobStatus = await request(server).get('/api/jobs/job_12345/status');
      const appStatus = await request(server).get('/api/applications/app_1001/status');
      const created = await request(server).post('/api/applications')
        .send({ jobId: 'job_12345', studentId: 'grd_0101', preferredDate: future(30) });
      const me = await request(server).get('/api/me').set(bearer(token));
      const myJobs = await request(server).get('/api/me/jobs').set(bearer(token));
      const posted = await request(server).post('/api/jobs').set(bearer(token))
        .send({ title: 'Fix leaking kitchen sink', category: 'plumbing', county: 'Nairobi', area: 'Westlands', duration: 'About 2 hours', payRange: { min: 1500, max: 1500 } });

      expect(jobs.status).toBe(200);
      expect(jobs.body.length).toBeGreaterThan(0);
      jobs.body.forEach((j) => expect(Object.keys(j).sort()).toEqual(JOB_FIELDS));
      expect([filtered.status, job.status, jobStatus.status, appStatus.status]).toEqual([200, 200, 200, 200]);
      expect(created.status).toBe(201);
      expect([me.status, myJobs.status, posted.status]).toEqual([200, 200, 201]);
      // ...while the three endpoints that need Sherehe say so plainly
      expect((await request(server).get('/api/event-openings').set(bearer(token))).status).toBe(502);
      expect((await offerFor(token, validOffer())).status).toBe(502);
      expect((await request(server).get('/api/me/staffing-offers').set(bearer(token))).status).toBe(200);
    });

  it('unknown paths still answer 404 with no body', async () => {
    const res = await request(server).get('/api/staffing-offers/anything/else');

    expect(res.status).toBe(404);
    expect(res.text).toBe('');
  });

  it('answers CORS preflight for the new paths like every other path', async () => {
    const res = await request(server).options('/api/staffing-offers/sof_1001');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-methods']).toMatch(/DELETE/);
  });
});
