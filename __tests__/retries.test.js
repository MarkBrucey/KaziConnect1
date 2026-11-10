// Week 11, resilience: the fetcher's retries and saved data. It is tested against the local Sherehe stub, which
// can be told to fail some of the time (flaky), to always fail (error), to answer 429 with Retry-After, or to
// be slow. The waits are shortened here so the tests are quick; what they prove is the rules, not the numbers.

const fetcher = require('../clients/fetcher');
const client = require('../clients/shereheClient');
const { createShereheStub } = require('../helpers/shereheStub');

let stub;
beforeAll(async () => { stub = createShereheStub(); await stub.start(); });
afterAll(async () => { await stub.stop(); });

const keyed = () => ({ 'X-API-Key': stub.apiKey });
const EVENTS = () => `${stub.url}/api/events?status=upcoming`;
const MINUTE = 60 * 1000;
let clock;
beforeEach(() => {
  stub.reset();
  fetcher.reset();
  clock = 10_000_000;
  fetcher.configure({ retryDelayMs: 5, now: () => clock });
  process.env.SHEREHE_API_URL = stub.url;
  process.env.SHEREHE_API_KEY = stub.apiKey;
});
afterAll(() => { delete process.env.SHEREHE_API_URL; delete process.env.SHEREHE_API_KEY; });

async function failure(promise) {
  try { await promise; } catch (err) { return err; }
  throw new Error('expected the call to fail, but it succeeded');
}
const requestsTo = (method) => stub.requests.filter((r) => r.method === method).length;

describe('the numbers', () => {
  it('a waiting person gets 3 seconds an attempt, 2 retries and 200 ms then 400 ms: 9.6 seconds at worst', () => {
    fetcher.reset();
    expect(fetcher.worstCaseMs('user')).toBe(9600);
    const spy = jest.spyOn(AbortSignal, 'timeout');
    fetcher.deadline('user');
    expect(spy.mock.calls.map((c) => c[0])).toEqual([9600]);
    spy.mockRestore();
  });

  it('background work does not retry, so its worst case is its one 60 seconds', () => {
    fetcher.reset();
    expect(fetcher.worstCaseMs('background')).toBe(60000);
  });

  it('the worst case follows the settings: the handout\'s 1.5 s, 2 retries, 200 ms is 5.1 seconds', () => {
    fetcher.configure({ userTimeoutMs: 1500, retries: 2, retryDelayMs: 200 });
    expect(fetcher.worstCaseMs('user')).toBe(5100);
  });
});

describe('what is retried', () => {
  it('a flaky partner (fails twice, then works) gives the person the answer, after exactly 2 retries', async () => {
    stub.setMode('flaky');

    const res = await fetcher.request(EVENTS(), { headers: keyed() });

    expect(res.status).toBe(200);
    expect(requestsTo('GET')).toBe(3);
    expect(fetcher.counters().retries).toBe(2);
  });

  it('a partner that always fails is asked exactly 3 times (1 + 2 retries) and then the call fails', async () => {
    stub.setMode('error');

    const err = await failure(fetcher.request(EVENTS(), { headers: keyed() }));

    expect(err).toMatchObject({ kind: 'status', status: 503 });
    expect(requestsTo('GET')).toBe(3);
    expect(fetcher.counters().retries).toBe(2);
  });

  it('retries a timeout', async () => {
    fetcher.configure({ userTimeoutMs: 30 });
    stub.setDelay(150);

    const err = await failure(fetcher.request(EVENTS(), { headers: keyed() }));

    expect(err).toMatchObject({ kind: 'timeout' });
    expect(requestsTo('GET')).toBe(3);
  });

  it('retries a connection that is dropped', async () => {
    stub.setMode('drop');

    const err = await failure(fetcher.request(EVENTS(), { headers: keyed() }));

    expect(err).toMatchObject({ kind: 'network' });
    expect(requestsTo('GET')).toBe(3);
  });

  it('waits longer each time: 100 ms, then 200 ms (300 ms in all), not the same wait twice', async () => {
    fetcher.configure({ retryDelayMs: 100 });
    stub.setMode('error');
    const started = Date.now();

    await failure(fetcher.request(EVENTS(), { headers: keyed() }));

    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(290); // 100 + 200; the same wait twice would be about 200
    expect(elapsed).toBeLessThan(1500);
  });
});

describe('what is never retried', () => {
  it('a wrong key (401): asking again changes nothing', async () => {
    const res = await fetcher.request(EVENTS(), { headers: { 'X-API-Key': 'wrong' } });

    expect(res).toEqual({ status: 401, body: null });
    expect(requestsTo('GET')).toBe(1);
    expect(fetcher.counters().retries).toBe(0);
  });

  it('an event that does not exist (404) and a county that does not exist (400)', async () => {
    const missing = await fetcher.request(`${stub.url}/api/events/evt_nope/roles`, { headers: keyed() });
    const badCounty = await fetcher.request(`${EVENTS()}&county=Atlantis`, { headers: keyed() });

    expect([missing.status, badCounty.status]).toEqual([404, 400]);
    expect(requestsTo('GET')).toBe(2);
  });

  it('a redirect', async () => {
    stub.setMode('redirect');

    const err = await failure(fetcher.request(EVENTS(), { headers: keyed() }));

    expect(err).toMatchObject({ kind: 'status', status: 302 });
    expect(requestsTo('GET')).toBe(1);
  });

  it('an answer that is not JSON', async () => {
    stub.setMode('garbage');

    const err = await failure(fetcher.request(EVENTS(), { headers: keyed() }));

    expect(err).toMatchObject({ kind: 'shape' });
    expect(requestsTo('GET')).toBe(1);
  });

  it('a POST, which could be done twice: one attempt only', async () => {
    stub.failNext(10);

    const err = await failure(fetcher.request(`${stub.url}/api/offers`, { method: 'POST', headers: keyed(), body: { roleId: 'rol_3001', workersOffered: 1 } }));

    expect(err).toMatchObject({ kind: 'status', status: 503 });
    expect(requestsTo('POST')).toBe(1);
  });

  it('a DELETE: one attempt only', async () => {
    stub.failNext(10);

    const err = await failure(fetcher.request(`${stub.url}/api/offers/ofr_4001`, { method: 'DELETE', headers: keyed() }));

    expect(err).toMatchObject({ kind: 'status', status: 503 });
    expect(requestsTo('DELETE')).toBe(1);
  });

  it('background work (the offer poller asks again in a few minutes anyway)', async () => {
    stub.setMode('error');

    const err = await failure(fetcher.request(EVENTS(), { headers: keyed(), mode: 'background' }));

    expect(err).toMatchObject({ kind: 'status', status: 503 });
    expect(requestsTo('GET')).toBe(1);
  });

  it('anything after the person\'s shared deadline has passed', async () => {
    fetcher.configure({ userTimeoutMs: 1000 });
    stub.setDelay(300);

    const err = await failure(fetcher.request(EVENTS(), { headers: keyed(), signal: AbortSignal.timeout(40) }));

    expect(err).toMatchObject({ kind: 'timeout' });
    expect(requestsTo('GET')).toBe(1);
  });
});

describe('a 429 (too many requests)', () => {
  it('waits as long as Retry-After says, then tries again and gets the answer', async () => {
    fetcher.configure({ retryAfterCapMs: 5000 });
    stub.failNext(1, { status: 429, retryAfter: 1 });
    const started = Date.now();

    const res = await fetcher.request(EVENTS(), { headers: keyed() });

    expect(res.status).toBe(200);
    expect(requestsTo('GET')).toBe(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(950); // it did wait about a second
  });

  it('never waits longer than the cap, however long Retry-After asks', async () => {
    fetcher.configure({ retryAfterCapMs: 60 });
    stub.failNext(1, { status: 429, retryAfter: 30 });
    const started = Date.now();

    const res = await fetcher.request(EVENTS(), { headers: keyed() });

    expect(res.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('with no Retry-After it waits the normal short time', async () => {
    stub.failNext(1, { status: 429 });

    const res = await fetcher.request(EVENTS(), { headers: keyed() });

    expect(res.status).toBe(200);
    expect(requestsTo('GET')).toBe(2);
  });

  it('a 429 that never stops is tried 3 times and then returned as a 429, as before', async () => {
    stub.failNext(10, { status: 429, retryAfter: 0 });

    const res = await fetcher.request(EVENTS(), { headers: keyed() });

    expect(res).toEqual({ status: 429, body: null });
    expect(requestsTo('GET')).toBe(3);
  });
});

describe('saved data', () => {
  async function readThenLetItExpire() {
    const first = await fetcher.request(EVENTS(), { headers: keyed(), cache: true });
    clock += 6 * MINUTE; // past the 5-minute cache
    return first;
  }

  it('is not used while the partner answers', async () => {
    await readThenLetItExpire();

    const res = await fetcher.request(EVENTS(), { headers: keyed(), cache: true });

    expect(res.savedAt).toBeUndefined();
    expect(fetcher.counters().savedDataServed).toBe(0);
  });

  it('is the last good answer, flagged with when it was saved, when the partner cannot be asked', async () => {
    const savedAt = clock;
    const first = await readThenLetItExpire();
    stub.setMode('error');
    const noted = [];

    const res = await fetcher.request(EVENTS(), { headers: keyed(), cache: true, onSaved: (t) => noted.push(t) });

    expect(res.body).toEqual(first.body);
    expect(res.savedAt).toBe(savedAt);
    expect(noted).toEqual([savedAt]);
    expect(fetcher.counters().savedDataServed).toBe(1);
  });

  it('still comes back after the retries were used up (3 attempts were made first)', async () => {
    await readThenLetItExpire();
    stub.reset();
    stub.setMode('error');

    await fetcher.request(EVENTS(), { headers: keyed(), cache: true });

    expect(requestsTo('GET')).toBe(3);
  });

  it('is served when the partner keeps saying 429', async () => {
    const first = await readThenLetItExpire();
    stub.failNext(10, { status: 429, retryAfter: 0 });

    const res = await fetcher.request(EVENTS(), { headers: keyed(), cache: true });

    expect(res.body).toEqual(first.body);
    expect(res.savedAt).toBeDefined();
  });

  it('is gone after an hour: then the call fails', async () => {
    await readThenLetItExpire();
    clock += 60 * MINUTE;
    stub.setMode('error');

    const err = await failure(fetcher.request(EVENTS(), { headers: keyed(), cache: true }));

    expect(err).toMatchObject({ kind: 'status', status: 503 });
  });

  it('does not exist for something never read: the call fails and says why', async () => {
    stub.setMode('error');

    const err = await failure(fetcher.request(EVENTS(), { headers: keyed(), cache: true }));

    expect(err).toMatchObject({ kind: 'status', status: 503 });
    expect(fetcher.counters().savedDataServed).toBe(0);
  });

  it('is never given to a call that asks for the truth (refresh): it fails instead', async () => {
    await readThenLetItExpire();
    stub.setMode('error');

    const err = await failure(fetcher.request(EVENTS(), { headers: keyed(), cache: true, refresh: true }));

    expect(err).toMatchObject({ kind: 'status', status: 503 });
    expect(fetcher.counters().savedDataServed).toBe(0);
  });

  it('is never given in place of a call that is not cached', async () => {
    await readThenLetItExpire();
    stub.setMode('error');

    const err = await failure(fetcher.request(EVENTS(), { headers: keyed() }));

    expect(err).toMatchObject({ kind: 'status', status: 503 });
  });

  it('does not hide a wrong key: a 401 is returned as a 401, not replaced by old data', async () => {
    await readThenLetItExpire();

    const res = await fetcher.request(EVENTS(), { headers: { 'X-API-Key': 'wrong' }, cache: true });

    expect(res).toEqual({ status: 401, body: null });
  });

  it('is replaced by live data as soon as the partner is back, with no change to anything', async () => {
    await readThenLetItExpire();
    stub.setMode('error');
    const saved = await fetcher.request(EVENTS(), { headers: keyed(), cache: true });
    stub.setMode('up');

    const live = await fetcher.request(EVENTS(), { headers: keyed(), cache: true });

    expect(saved.savedAt).toBeDefined();
    expect(live.savedAt).toBeUndefined();
    expect(live.status).toBe(200);
  });
});

describe('the openings, with and without saved data', () => {
  it('say when the list is saved data: savedAt is null for live data', async () => {
    const live = await client.findOpeningsWithSavedAt();

    expect(live.savedAt).toBeNull();
    expect(live.openings.length).toBeGreaterThan(0);
  });

  it('give the same openings, with the time they were saved, when Sherehe is down', async () => {
    const savedAt = clock;
    const live = await client.findOpeningsWithSavedAt();
    clock += 6 * MINUTE;
    stub.setMode('drop');

    const down = await client.findOpeningsWithSavedAt();

    expect(down.openings).toEqual(live.openings);
    expect(down.savedAt).toBe(savedAt);
  });

  it('do the same on the two-call path (an older Sherehe), using the oldest saved copy', async () => {
    stub.setBulk(false);
    const savedAt = clock;
    const live = await client.findOpeningsWithSavedAt();
    clock += 6 * MINUTE;
    stub.setMode('drop');

    const down = await client.findOpeningsWithSavedAt();

    expect(down.openings).toEqual(live.openings);
    expect(down.savedAt).toBe(savedAt);
  });

  it('fail when nothing was ever saved', async () => {
    stub.setMode('drop');

    await expect(client.findOpeningsWithSavedAt()).rejects.toMatchObject({ kind: 'network' });
  });

  it('never answer "no such role" from saved data: a role that is not in the saved list fails instead (the re-read gets no saved data)', async () => {
    await client.findOpenings(); // saves the lists
    clock += 6 * MINUTE;
    stub.addRole({ id: 'rol_3999', eventId: 'evt_2001', title: 'Newer role', category: 'catering', headcount: 2, filled: 0, payPerShift: 1500, shiftStart: '2099-01-01T08:00:00Z', shiftEnd: '2099-01-01T16:00:00Z' });
    stub.setMode('drop');

    await expect(client.findOpening('rol_3999')).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('the stand-in\'s own switch (used by hand for the drills)', () => {
  let switchable;
  beforeAll(async () => { switchable = createShereheStub({ controls: true }); await switchable.start(); });
  afterAll(async () => { await switchable.stop(); });

  const mode = (name) => fetch(`${switchable.url}/__mode/${name}`, { signal: AbortSignal.timeout(2000) });
  const events = () => fetch(`${switchable.url}/api/events?status=upcoming`, { headers: { 'X-API-Key': switchable.apiKey }, signal: AbortSignal.timeout(2000) });

  it('can be switched back from every mode, including down, error and slow, and answers the switch at once', async () => {
    for (const bad of ['error', 'down', 'slow', 'flaky']) {
      await mode(bad).catch(() => undefined);
      const started = Date.now();
      const back = await mode('ok');
      expect(back.status).toBe(200);
      expect(Date.now() - started).toBeLessThan(500);
      expect((await events()).status).toBe(200);
    }
  });

  it('refuses a mode it does not know', async () => {
    expect((await mode('nonsense')).status).toBe(404);
  });
});
