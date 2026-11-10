// Week 11, resilience, through the real server: when Sherehe cannot be asked, Endpoint 22 returns the last good
// list with an X-Data-Saved-At header (so the page can say so), and says nothing of the kind while Sherehe answers.
// Writes are never served from saved data and never retried.

const request = require('supertest');
const { createServer } = require('../app');
const db = require('../db');
const fetcher = require('../clients/fetcher');
const { PARTNER_UNAVAILABLE } = require('../clients/upstreamError');
const { createShereheStub } = require('../helpers/shereheStub');
const { DEMO_PASSWORD } = require('../seedData');

const MINUTE = 60 * 1000;
let server;
let stub;
let clock;
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
  clock = 20_000_000;
  fetcher.configure({ retryDelayMs: 5, now: () => clock });
  process.env.SHEREHE_API_URL = stub.url;
  process.env.SHEREHE_API_KEY = stub.apiKey;
});

async function employer() {
  const res = await request(server).post('/api/auth/login').send({ email: 'employer@kaziconnect.demo', password: DEMO_PASSWORD });
  return { Authorization: `Bearer ${res.body.token}` };
}
const openings = (auth) => request(server).get('/api/event-openings').set(auth);

describe('Endpoint 22 with Sherehe answering', () => {
  it('has no X-Data-Saved-At header: the data is live', async () => {
    const res = await openings(await employer());

    expect(res.status).toBe(200);
    expect(res.headers['x-data-saved-at']).toBeUndefined();
  });
});

describe('Endpoint 22 with Sherehe not answering', () => {
  it('returns the same list as before, with the time it was saved in X-Data-Saved-At', async () => {
    const auth = await employer();
    const live = await openings(auth);
    const savedAt = new Date(clock).toISOString();
    clock += 6 * MINUTE; // the 5-minute copy has run out
    stub.setMode('error');

    const saved = await openings(auth);

    expect(saved.status).toBe(200);
    expect(saved.body).toEqual(live.body);
    expect(saved.headers['x-data-saved-at']).toBe(savedAt);
  });

  it('tried Sherehe 3 times before giving up on it (the first attempt and 2 retries)', async () => {
    const auth = await employer();
    await openings(auth);
    clock += 6 * MINUTE;
    stub.reset();
    stub.setMode('error');

    await openings(auth);

    expect(stub.requests.filter((r) => r.method === 'GET')).toHaveLength(3);
    expect(fetcher.counters()).toEqual({ retries: 2, savedDataServed: 1 });
  });

  it('answers our own 502, and no header, when nothing was ever saved', async () => {
    stub.setMode('error');

    const res = await openings(await employer());

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ message: PARTNER_UNAVAILABLE });
    expect(res.headers['x-data-saved-at']).toBeUndefined();
  });

  it('comes back to live data when Sherehe returns, with no change to anything', async () => {
    const auth = await employer();
    await openings(auth);
    clock += 6 * MINUTE;
    stub.setMode('error');
    const saved = await openings(auth);
    stub.setMode('up');

    const live = await openings(auth);

    expect(saved.headers['x-data-saved-at']).toBeDefined();
    expect(live.status).toBe(200);
    expect(live.headers['x-data-saved-at']).toBeUndefined();
  });

  it('does not touch the jobs: Endpoints 1 to 21 neither fail nor carry the header', async () => {
    const auth = await employer();
    await openings(auth);
    clock += 6 * MINUTE;
    stub.setMode('error');

    const jobs = await request(server).get('/api/jobs?status=active');

    expect(jobs.status).toBe(200);
    expect(jobs.headers['x-data-saved-at']).toBeUndefined();
  });

  it('never makes an offer from saved data: the offer is refused with a 502, tried once, and nothing is kept', async () => {
    const auth = await employer();
    await openings(auth);
    clock += 6 * MINUTE;
    stub.reset();
    stub.setMode('error');

    const res = await request(server).post('/api/staffing-offers').set(auth).send({ roleId: 'rol_3001', workersOffered: 2 });

    expect(res.status).toBe(502);
    expect(stub.requests.filter((r) => r.method === 'POST')).toHaveLength(1); // the role was found in the saved list, but the offer itself is never retried
    const mine = await request(server).get('/api/me/staffing-offers').set(auth);
    expect(mine.body).toEqual([]);
  });
});
