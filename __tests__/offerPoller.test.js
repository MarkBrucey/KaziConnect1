// Event work: the poller that follows staffing offers until the organiser decides, and opens a
// job when one is accepted. Sherehe is the local stub, and `stub.decide` plays the organiser.

const request = require('supertest');
const { createServer } = require('../app');
const db = require('../db');
const fetcher = require('../clients/fetcher');
const { runOnce, startOfferPoller } = require('../jobs/offerPoller');
const { createShereheStub } = require('../helpers/shereheStub');
const { DEMO_PASSWORD } = require('../seedData');

const JOB_FIELDS = ['area', 'category', 'county', 'duration', 'id', 'payRange', 'status', 'title', 'urgent'];

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
async function tokenFor(email, password = DEMO_PASSWORD) {
  const res = await request(server).post('/api/auth/login').send({ email, password });
  return res.body.token;
}
const employer = () => tokenFor('employer@kaziconnect.demo');
async function newEmployerToken() {
  const res = await request(server).post('/api/auth/register')
    .send({ name: 'Other Employer', email: 'other@example.com', password: 'safe-password-1', role: 'employer' });
  return res.body.token;
}
const offerFor = (token, roleId = 'rol_3001', workersOffered = 4) =>
  request(server).post('/api/staffing-offers').set(bearer(token)).send({ roleId, workersOffered });
const listOffers = (token) => request(server).get('/api/me/staffing-offers').set(bearer(token));
const reads = () => stub.requests.filter((r) => r.method === 'GET' && r.path.startsWith('/api/offers/'));

describe('an offer the organiser accepts', () => {
  it('opens a job for the employer, with the role\'s category and one pay amount, and records its id on the offer', async () => {
    const token = await employer();
    const made = await offerFor(token);
    stub.decide('ofr_4001', 'accepted');

    const result = await runOnce();

    expect(result).toMatchObject({ checked: 1, accepted: 1, declined: 0, failed: 0 });
    const offers = await listOffers(token);
    expect(offers.body).toEqual([{ ...made.body, status: 'accepted', jobId: 'job_12353' }]);
  });

  it('makes a job exactly like any other: the exact Job fields, active, with the role\'s details', async () => {
    const token = await employer();
    await offerFor(token);
    stub.decide('ofr_4001', 'accepted');
    await runOnce();

    const res = await request(server).get('/api/jobs/job_12353');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(JOB_FIELDS);
    expect(res.body).toEqual({
      id: 'job_12353', title: 'Waiters, Wanjiku and Otieno wedding', category: 'catering', county: 'Nairobi',
      area: 'Westlands', duration: 'One shift, 5 Dec 2026, about 10 hours', urgent: false, status: 'active',
      payRange: { min: 1500, max: 1500 },
    });
  });

  it('never shows where the job came from in any response', async () => {
    const token = await employer();
    await offerFor(token);
    stub.decide('ofr_4001', 'accepted');
    await runOnce();

    const responses = [
      await request(server).get('/api/jobs?status=active'),
      await request(server).get('/api/jobs/job_12353'),
      await request(server).get('/api/jobs/job_12353/status'),
      await request(server).get('/api/me/jobs').set(bearer(token)),
    ];

    responses.forEach((res) => expect(JSON.stringify(res.body)).not.toMatch(/rol_3001|source_role|sourceRole|ofr_4001/));
  });

  it('puts the job in the public listings that Ujuzi reads: Endpoint 1, and Endpoint 2 by county and category', async () => {
    const token = await employer();
    await offerFor(token);
    stub.decide('ofr_4001', 'accepted');
    await runOnce();

    const all = await request(server).get('/api/jobs?status=active');
    const filtered = await request(server).get('/api/jobs?county=Nairobi&category=catering&status=active');

    expect(all.body.map((j) => j.id)).toContain('job_12353');
    expect(filtered.body.map((j) => j.id)).toEqual(['job_12348', 'job_12353']);
  });

  it('gives the job to the employer who made the offer, and to nobody else', async () => {
    const token = await employer();
    const other = await newEmployerToken();
    await offerFor(token);
    stub.decide('ofr_4001', 'accepted');
    await runOnce();

    const mine = await request(server).get('/api/me/jobs').set(bearer(token));
    const theirs = await request(server).get('/api/me/jobs').set(bearer(other));

    expect(mine.body.map((j) => j.id)).toContain('job_12353');
    expect(theirs.body).toEqual([]);
  });

  it('lets the employer manage it like any job: close it, and a student can apply', async () => {
    const token = await employer();
    await offerFor(token);
    stub.decide('ofr_4001', 'accepted');
    await runOnce();

    const apply = await request(server).post('/api/applications')
      .send({ jobId: 'job_12353', studentId: 'grd_0101', preferredDate: '2099-01-01T09:00:00Z' });
    const close = await request(server).patch('/api/jobs/job_12353').set(bearer(token)).send({ status: 'closed' });

    expect(apply.status).toBe(201);
    expect(close.status).toBe(200);
    expect(close.body.status).toBe('closed');
  });

  it('needs nothing from Sherehe but the offer\'s status', async () => {
    const token = await employer();
    await offerFor(token);
    stub.decide('ofr_4001', 'accepted');
    stub.requests.length = 0;

    await runOnce();

    expect(stub.requests.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /api/offers/ofr_4001']);
  });

  it('makes only one job however many times it runs', async () => {
    const token = await employer();
    await offerFor(token);
    stub.decide('ofr_4001', 'accepted');

    await runOnce();
    const second = await runOnce();
    await runOnce();

    expect(second).toMatchObject({ checked: 0, accepted: 0 });
    const jobs = await request(server).get('/api/me/jobs').set(bearer(token));
    expect(jobs.body.filter((j) => j.title.startsWith('Waiters'))).toHaveLength(1);
  });

  it('makes only one job when two passes run at the same moment', async () => {
    const token = await employer();
    await offerFor(token);
    stub.decide('ofr_4001', 'accepted');
    stub.setDelay(150);

    const [first, second] = await Promise.all([runOnce(), runOnce()]);

    expect([first.skipped, second.skipped].sort()).toEqual([false, true]);
    expect((await request(server).get('/api/jobs?status=active')).body.filter((j) => j.title.startsWith('Waiters'))).toHaveLength(1);
  });

  it('frees the role for a new offer only after the first is decided, and the old offer stays accepted', async () => {
    const token = await employer();
    await offerFor(token);
    expect((await offerFor(token)).status).toBe(409);
    stub.decide('ofr_4001', 'accepted');
    await runOnce();

    const again = await offerFor(token, 'rol_3001', 2);

    expect(again.status).toBe(201);
    expect((await listOffers(token)).body.map((o) => o.status)).toEqual(['pending', 'accepted']);
  });
});

describe('an offer the organiser declines', () => {
  it('is marked declined, and no job is opened', async () => {
    const token = await employer();
    await offerFor(token);
    stub.decide('ofr_4001', 'declined');
    const before = (await request(server).get('/api/jobs?status=active')).body.length;

    const result = await runOnce();

    expect(result).toMatchObject({ checked: 1, accepted: 0, declined: 1, failed: 0 });
    expect((await listOffers(token)).body[0]).toMatchObject({ status: 'declined', jobId: null });
    expect((await request(server).get('/api/jobs?status=active')).body).toHaveLength(before);
  });

  it('lets the employer offer on the role again', async () => {
    const token = await employer();
    await offerFor(token);
    stub.decide('ofr_4001', 'declined');
    await runOnce();

    expect((await offerFor(token, 'rol_3001', 1)).status).toBe(201);
  });
});

describe('an offer still waiting', () => {
  it('is left exactly as it is, and asked about again next time', async () => {
    const token = await employer();
    await offerFor(token);

    const first = await runOnce();
    const second = await runOnce();

    expect(first).toMatchObject({ checked: 1, accepted: 0, declined: 0, failed: 0 });
    expect(second.checked).toBe(1);
    expect((await listOffers(token)).body[0]).toMatchObject({ status: 'pending', jobId: null });
    expect(reads()).toHaveLength(2); // never cached, so a decision is seen at once
  });

  it('is noticed on the very next pass after the organiser decides', async () => {
    const token = await employer();
    await offerFor(token);
    await runOnce();
    stub.decide('ofr_4001', 'accepted');

    await runOnce();

    expect((await listOffers(token)).body[0].status).toBe('accepted');
  });
});

describe('which offers are asked about', () => {
  it('asks about nothing, and calls Sherehe not at all, when there are no pending offers', async () => {
    const result = await runOnce();

    expect(result).toMatchObject({ skipped: false, checked: 0, failed: 0 });
    expect(stub.requests).toHaveLength(0);
  });

  it('never asks again about an offer that is accepted or declined', async () => {
    const token = await employer();
    await offerFor(token, 'rol_3001');
    await offerFor(token, 'rol_3004', 2);
    stub.decide('ofr_4001', 'accepted');
    stub.decide('ofr_4002', 'declined');
    await runOnce();
    stub.requests.length = 0;

    const again = await runOnce();

    expect(again.checked).toBe(0);
    expect(stub.requests).toHaveLength(0);
  });

  it('handles every offer in one pass: one accepted, one declined, one still waiting', async () => {
    const token = await employer();
    await offerFor(token, 'rol_3001');
    await offerFor(token, 'rol_3004', 2);
    await offerFor(token, 'rol_3003', 1);
    stub.decide('ofr_4001', 'accepted');
    stub.decide('ofr_4002', 'declined');

    const result = await runOnce();

    expect(result).toMatchObject({ checked: 3, accepted: 1, declined: 1, failed: 0 });
    expect((await listOffers(token)).body.map((o) => o.status)).toEqual(['pending', 'declined', 'accepted']);
  });

  it('asks about the oldest offer first', async () => {
    const token = await employer();
    await offerFor(token, 'rol_3001');
    await offerFor(token, 'rol_3004', 2);
    stub.requests.length = 0;

    await runOnce();

    expect(reads().map((r) => r.path)).toEqual(['/api/offers/ofr_4001', '/api/offers/ofr_4002']);
  });

  it('uses the long background timeout, since nobody is waiting', async () => {
    const token = await employer();
    await offerFor(token);
    stub.decide('ofr_4001', 'accepted');
    fetcher.configure({ userTimeoutMs: 50, backgroundTimeoutMs: 2000 });
    stub.setDelay(300);

    const result = await runOnce();

    expect(result.accepted).toBe(1);
  });
});

describe('when Sherehe cannot be used', () => {
  it.each([
    ['is down', () => stub.setMode('drop')],
    ['answers with an error', () => stub.setMode('error')],
    ['refuses our key', () => { process.env.SHEREHE_API_KEY = 'a-wrong-key'; }],
    ['sends something that is not JSON', () => stub.setMode('garbage')],
    ['sends an unexpected shape', () => stub.setMode('wrongShape')],
    ['is too slow', () => { fetcher.configure({ backgroundTimeoutMs: 50 }); stub.setDelay(300); }],
    ['is not set up', () => { delete process.env.SHEREHE_API_URL; delete process.env.SHEREHE_API_KEY; }],
  ])('keeps the offer pending, does not throw, and counts a failure, when Sherehe %s', async (_name, breakIt) => {
    const token = await employer();
    await offerFor(token);
    stub.decide('ofr_4001', 'accepted');
    breakIt();

    const result = await runOnce();

    expect(result).toMatchObject({ checked: 1, accepted: 0, declined: 0, failed: 1 });
    expect((await listOffers(token)).body[0]).toMatchObject({ status: 'pending', jobId: null });
    expect((await request(server).get('/api/jobs?status=active')).body).toHaveLength(6); // no job opened
  });

  it('tries again later and then does the work: nothing is lost by the outage', async () => {
    const token = await employer();
    await offerFor(token);
    stub.decide('ofr_4001', 'accepted');
    stub.setMode('drop');
    await runOnce();
    await runOnce();
    stub.setMode('up');

    const result = await runOnce();

    expect(result).toMatchObject({ accepted: 1, failed: 0 });
    expect((await listOffers(token)).body[0]).toMatchObject({ status: 'accepted', jobId: 'job_12353' });
  });

  it('does not let one offer that fails hold up the others', async () => {
    const token = await employer();
    await offerFor(token, 'rol_3001');
    await offerFor(token, 'rol_3004', 2);
    stub.decide('ofr_4001', 'accepted');
    stub.decide('ofr_4002', 'accepted');
    stub.failOn('/ofr_4001'); // only the first offer's check fails

    const result = await runOnce();

    expect(result).toMatchObject({ checked: 2, accepted: 1, failed: 1 });
    expect((await listOffers(token)).body.map((o) => o.status)).toEqual(['accepted', 'pending']);
  });

  it('gives up on the whole pass at once when Sherehe is not set up, instead of failing every offer', async () => {
    const token = await employer();
    await offerFor(token, 'rol_3001');
    await offerFor(token, 'rol_3004', 2);
    delete process.env.SHEREHE_API_URL;
    stub.requests.length = 0;

    const result = await runOnce();

    expect(result.failed).toBe(1);
    expect(stub.requests).toHaveLength(0);
  });

  it('leaves an offer pending if Sherehe has lost track of it, so the employer can still withdraw it', async () => {
    const token = await employer();
    const made = await offerFor(token);
    stub.dropOffer('ofr_4001');

    const result = await runOnce();

    expect(result).toMatchObject({ checked: 1, accepted: 0, declined: 0, failed: 0 });
    expect((await listOffers(token)).body[0].status).toBe('pending');
    const withdrawn = await request(server).delete(`/api/staffing-offers/${made.body.id}`).set(bearer(token));
    expect(withdrawn.status).toBe(204);
  });

  it('does not touch Endpoints 1 to 21 while Sherehe is down', async () => {
    const token = await employer();
    await offerFor(token);
    stub.setMode('drop');
    await runOnce();

    const res = await request(server).get('/api/jobs?status=active');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(6);
  });
});

describe('startOfferPoller', () => {
  const waitUntil = async (check) => {
    for (let i = 0; i < 100; i++) { if (await check()) return true; await new Promise((r) => setTimeout(r, 20)); }
    return false;
  };

  it('does a pass soon after it starts, with no one calling runOnce, and stops when told to', async () => {
    const token = await employer();
    await offerFor(token);
    stub.decide('ofr_4001', 'accepted');

    const poller = startOfferPoller({ firstRunMs: 10 });
    const done = await waitUntil(async () => (await listOffers(token)).body[0].status === 'accepted');
    poller.stop();

    expect(done).toBe(true);
  });

  it('does nothing at all if it is stopped before its first pass', async () => {
    const token = await employer();
    await offerFor(token);

    const poller = startOfferPoller({ firstRunMs: 40 });
    poller.stop();
    await new Promise((r) => setTimeout(r, 200));

    expect(reads()).toHaveLength(0);
  });

  it('waits 3 minutes between passes by default, never less than 5 seconds, and reads OFFER_POLL_MS', () => {
    const saved = process.env.OFFER_POLL_MS;
    try {
      delete process.env.OFFER_POLL_MS;
      const byDefault = startOfferPoller({ firstRunMs: 60000 });
      const tooShort = startOfferPoller({ intervalMs: 1, firstRunMs: 60000 });
      process.env.OFFER_POLL_MS = '90000';
      const fromEnv = startOfferPoller({ firstRunMs: 60000 });
      process.env.OFFER_POLL_MS = 'soon';
      const notANumber = startOfferPoller({ firstRunMs: 60000 });

      expect([byDefault.every, tooShort.every, fromEnv.every, notANumber.every]).toEqual([180000, 5000, 90000, 180000]);
      [byDefault, tooShort, fromEnv, notANumber].forEach((p) => p.stop());
    } finally {
      if (saved === undefined) delete process.env.OFFER_POLL_MS; else process.env.OFFER_POLL_MS = saved;
    }
  });
});
