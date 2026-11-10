// Week 11: resilience. When Sherehe is slow, flaky or gone, a read is tried again a capped number of times (never a
// write, never a 4xx), and the Event work list falls back to the last list we had, clearly marked as saved.
// Sherehe is the local stub, which can be told to fail for a moment, to fail for good, or to be slow.

const request = require('supertest');
const { createServer } = require('../app');
const db = require('../db');
const fetcher = require('../clients/fetcher');
const saved = require('../lib/savedOpenings');
const { PARTNER_UNAVAILABLE, UpstreamError } = require('../clients/upstreamError');
const { createShereheStub } = require('../helpers/shereheStub');
const { DEMO_PASSWORD } = require('../seedData');

let server;
let stub;
let retries; // the "retrying" lines the fetcher would have written to the log
beforeAll(async () => {
  stub = createShereheStub();
  await stub.start();
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
  saved.forget();
  retries = [];
  fetcher.configure({ onRetry: (note) => retries.push(note) });
  process.env.SHEREHE_API_URL = stub.url;
  process.env.SHEREHE_API_KEY = stub.apiKey;
});

const keyed = () => ({ 'X-API-Key': stub.apiKey });
const EVENTS = () => `${stub.url}/api/events?status=upcoming`;
const gets = () => stub.requests.filter((r) => r.method === 'GET').length;
async function failure(promise) {
  try { await promise; } catch (err) { return err; }
  throw new Error('expected the call to fail, but it succeeded');
}

describe('the Week 11 numbers', () => {
  it('2 seconds an attempt, at most 2 retries after 200 ms and 400 ms, 10 seconds in all for a waiting person', () => {
    expect(fetcher.USER_TIMEOUT_MS).toBe(2000);
    expect(fetcher.RETRIES).toBe(2);
    expect(fetcher.RETRY_DELAY_MS).toBe(200);
    expect(fetcher.RETRY_AFTER_CAP_MS).toBe(5000);
    expect(fetcher.USER_DEADLINE_MS).toBe(10000);
    // The worst case, every attempt timing out, still fits inside the deadline.
    const worst = (fetcher.RETRIES + 1) * fetcher.USER_TIMEOUT_MS + 200 + 400;
    expect(worst).toBe(6600);
    expect(worst).toBeLessThan(fetcher.USER_DEADLINE_MS);
  });
});

describe('a read that fails for a moment is tried again', () => {
  it('flaky: fails twice, then works, so the caller never sees a failure', async () => {
    stub.failNext(2, 503);

    const res = await fetcher.request(EVENTS(), { headers: keyed() });

    expect(res.status).toBe(200);
    expect(res.body.map((e) => e.id)).toEqual(['evt_2001', 'evt_2002']);
    expect(gets()).toBe(3);
    expect(retries).toEqual([
      'GET /api/events attempt 1 of 3 failed (HTTP 503), retrying in 200 ms',
      'GET /api/events attempt 2 of 3 failed (HTTP 503), retrying in 400 ms',
    ]);
  });

  it('always failing: exactly two retries, then it gives up (no endless loop)', async () => {
    stub.setMode('error');

    const err = await failure(fetcher.request(EVENTS(), { headers: keyed() }));

    expect(err).toBeInstanceOf(UpstreamError);
    expect(err).toMatchObject({ kind: 'status', status: 503 });
    expect(gets()).toBe(3);
    expect(retries).toHaveLength(2);
  });

  it.each([500, 502, 504])('a %i is tried again', async (status) => {
    stub.failNext(1, status);

    const res = await fetcher.request(EVENTS(), { headers: keyed() });

    expect(res.status).toBe(200);
    expect(gets()).toBe(2);
  });

  it('a slow answer that times out is tried again', async () => {
    fetcher.configure({ userTimeoutMs: 100 });
    stub.setDelay(400);
    const slow = fetcher.request(EVENTS(), { headers: keyed() });
    setTimeout(() => stub.setDelay(0), 150); // Sherehe recovers during the first wait

    const res = await slow;

    expect(res.status).toBe(200);
    expect(retries[0]).toBe('GET /api/events attempt 1 of 3 failed (timeout), retrying in 200 ms');
  });

  it('a dropped connection is tried again, and gives up after three attempts', async () => {
    stub.setMode('drop');

    const err = await failure(fetcher.request(EVENTS(), { headers: keyed() }));

    expect(err).toMatchObject({ kind: 'network' });
    expect(gets()).toBe(3);
  });

  it("a 429 waits for the partner's Retry-After, capped at 5 seconds", async () => {
    fetcher.configure({ retryAfterCapMs: 50 }); // the real cap is 5000 ms; 50 keeps the test quick
    stub.failNext(1, 429, 30);

    const res = await fetcher.request(EVENTS(), { headers: keyed() });

    expect(res.status).toBe(200);
    expect(retries).toEqual(['GET /api/events attempt 1 of 3 failed (HTTP 429), retrying in 50 ms']);
  });

  it('a 429 that never ends comes back as a 429 after the retries, not as a crash', async () => {
    fetcher.configure({ retryAfterCapMs: 10 });
    stub.failNext(5, 429, 1);

    const res = await fetcher.request(EVENTS(), { headers: keyed() });

    expect(res).toEqual({ status: 429, body: null });
    expect(gets()).toBe(3);
  });
});

describe('what is never tried again', () => {
  it.each([400, 401, 403, 404])('a %i comes straight back: our request is wrong, and asking again changes nothing', async (status) => {
    stub.failNext(1, status);

    const res = await fetcher.request(EVENTS(), { headers: keyed() });

    expect(res).toEqual({ status, body: null });
    expect(gets()).toBe(1);
    expect(retries).toHaveLength(0);
  });

  it('a POST is never tried again, even after a 503: a second attempt could make a second offer', async () => {
    stub.failNext(1, 503);

    const err = await failure(fetcher.request(`${stub.url}/api/offers`, { method: 'POST', headers: keyed(), body: { roleId: 'rol_3001', workersOffered: 1 } }));

    expect(err).toMatchObject({ kind: 'status', status: 503 });
    expect(stub.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
    expect(retries).toHaveLength(0);
  });

  it('a DELETE is never tried again either', async () => {
    stub.setMode('drop');

    await failure(fetcher.request(`${stub.url}/api/offers/ofr_4001`, { method: 'DELETE', headers: keyed() }));

    expect(stub.requests.filter((r) => r.method === 'DELETE')).toHaveLength(1);
  });

  it('an answer that is not JSON is not tried again: it would be the same next time', async () => {
    stub.setMode('garbage');

    await failure(fetcher.request(EVENTS(), { headers: keyed() }));

    expect(gets()).toBe(1);
  });

  it('stops when the shared deadline is up, however many retries are left', async () => {
    stub.setMode('error');
    fetcher.configure({ retryDelayMs: 1000 });

    const started = Date.now();
    await failure(fetcher.request(EVENTS(), { headers: keyed(), signal: AbortSignal.timeout(300) }));

    expect(Date.now() - started).toBeLessThan(900);
    expect(gets()).toBe(1);
  });
});

describe('Endpoint 22 falls back to the saved list, clearly marked', () => {
  let token;
  beforeEach(async () => {
    const res = await request(server).post('/api/auth/login').send({ email: 'employer@kaziconnect.demo', password: DEMO_PASSWORD });
    token = res.body.token;
  });
  const openings = (county) => request(server).get(`/api/event-openings${county ? `?county=${county}` : ''}`).set({ Authorization: `Bearer ${token}` });

  it('live: the list as always, marked Kazi-Stale: false with the time it was built', async () => {
    const res = await openings();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.headers['kazi-stale']).toBe('false');
    expect(new Date(res.headers['kazi-as-of']).toISOString()).toBe(res.headers['kazi-as-of']);
  });

  it('flaky: Sherehe fails twice and the employer still gets the live list', async () => {
    stub.failNext(2, 503);

    const res = await openings();

    expect(res.status).toBe(200);
    expect(res.headers['kazi-stale']).toBe('false');
    expect(retries).toHaveLength(2);
  });

  it('Sherehe down after a good read: the same list, marked saved, with the time it was saved', async () => {
    const live = await openings();
    fetcher.clearCache(); // as if the 5 minutes had passed
    stub.setMode('error');

    const res = await openings();

    expect(res.status).toBe(200);
    expect(res.body).toEqual(live.body);
    expect(res.headers['kazi-stale']).toBe('true');
    expect(res.headers['kazi-as-of']).toBe(live.headers['kazi-as-of']);
    expect(saved.servedCount()).toBe(1);
  });

  it('Sherehe slow after a good read: the saved list comes back after the timeouts, not after Sherehe', async () => {
    fetcher.configure({ userTimeoutMs: 100, userDeadlineMs: 1000 });
    await openings();
    fetcher.clearCache();
    stub.setDelay(3000);

    const started = Date.now();
    const res = await openings();

    expect(res.status).toBe(200);
    expect(res.headers['kazi-stale']).toBe('true');
    expect(Date.now() - started).toBeLessThan(1500);
    stub.setDelay(0);
  });

  it('after a restart (nothing saved), Sherehe down is the friendly 502, never a crash', async () => {
    stub.setMode('error');

    const res = await openings();

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ message: PARTNER_UNAVAILABLE });
  });

  it('each county keeps its own saved list', async () => {
    await openings('Nairobi');
    fetcher.clearCache();
    stub.setMode('error');

    expect((await openings('Nairobi')).headers['kazi-stale']).toBe('true');
    expect((await openings('Mombasa')).status).toBe(502); // never read, so nothing saved for it
  });

  it('back to live as soon as Sherehe answers again, with no change of code', async () => {
    await openings();
    fetcher.clearCache();
    stub.setMode('error');
    expect((await openings()).headers['kazi-stale']).toBe('true');
    stub.setMode('up');

    const res = await openings();

    expect(res.headers['kazi-stale']).toBe('false');
  });

  it('a made-up county name is never saved, so it cannot fill memory', () => {
    saved.remember('Atlantis', []);
    expect(saved.recall('Atlantis')).toBeNull();
    saved.remember('nairobi', []);
    expect(saved.recall('Nairobi')).not.toBeNull();
  });

  it('an offer is never made from a saved list: Endpoint 23 still needs Sherehe', async () => {
    await openings();
    stub.setMode('error');

    const res = await request(server).post('/api/staffing-offers').set({ Authorization: `Bearer ${token}` }).send({ roleId: 'rol_3001', workersOffered: 1 });

    expect(res.status).toBe(502);
    expect(stub.offers).toHaveLength(0);
  });
});
