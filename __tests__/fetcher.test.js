// Event work: the fetcher that every call to Sherehe goes through. It is tested against the
// local Sherehe stub, which can be told to be slow, to drop the connection, to fail and so on.

const fetcher = require('../clients/fetcher');
const { UpstreamError } = require('../clients/upstreamError');
const { createShereheStub } = require('../helpers/shereheStub');

let stub;
beforeAll(async () => { stub = createShereheStub(); await stub.start(); });
afterAll(async () => { await stub.stop(); });
beforeEach(() => { stub.reset(); fetcher.reset(); });

const keyed = () => ({ 'X-API-Key': stub.apiKey });
const EVENTS = () => `${stub.url}/api/events?status=upcoming`;

// The error a call throws, so a test can look at it.
async function failure(promise) {
  try { await promise; } catch (err) { return err; }
  throw new Error('expected the call to fail, but it succeeded');
}

describe('what a call returns', () => {
  it('returns the status and the parsed JSON for a 200', async () => {
    const res = await fetcher.request(EVENTS(), { headers: keyed() });

    expect(res.status).toBe(200);
    expect(res.body.map((e) => e.id)).toEqual(['evt_2001', 'evt_2002']);
  });

  it('returns a 4xx as a result instead of throwing, with no body to leak', async () => {
    const res = await fetcher.request(EVENTS(), { headers: {} });

    expect(res).toEqual({ status: 401, body: null });
  });

  it('returns no body for a 204', async () => {
    const made = await fetcher.request(`${stub.url}/api/offers`, { method: 'POST', headers: keyed(), body: { roleId: 'rol_3001', workersOffered: 2 } });
    const id = made.body.id;

    const res = await fetcher.request(`${stub.url}/api/offers/${id}`, { method: 'DELETE', headers: keyed() });

    expect(res).toEqual({ status: 204, body: null });
  });

  it('sends a JSON body with a JSON content type, and the headers it was given', async () => {
    await fetcher.request(`${stub.url}/api/offers`, { method: 'POST', headers: keyed(), body: { roleId: 'rol_3001', workersOffered: 2, note: 'hello' } });

    const sent = stub.requests[0];
    expect(sent.key).toBe(stub.apiKey);
    expect(sent.body).toEqual({ roleId: 'rol_3001', workersOffered: 2, note: 'hello' });
  });
});

describe('failures become an UpstreamError', () => {
  it('a 5xx is a "status" error, and nothing the partner said is in the error', async () => {
    stub.setMode('error');

    const err = await failure(fetcher.request(EVENTS(), { headers: keyed() }));

    expect(err).toBeInstanceOf(UpstreamError);
    expect(err).toMatchObject({ kind: 'status', status: 503 });
    expect(JSON.stringify([err.message, err.detail, err.kind])).not.toMatch(/hunter2|database|password/);
  });

  it('a dropped connection is a "network" error', async () => {
    stub.setMode('drop');

    expect(await failure(fetcher.request(EVENTS(), { headers: keyed() }))).toMatchObject({ kind: 'network' });
  });

  it('a server that is not there is a "network" error', async () => {
    const err = await failure(fetcher.request('http://127.0.0.1:9/api/events', { headers: keyed() }));

    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.kind).toBe('network');
  });

  it('a 200 that is not JSON is a "shape" error', async () => {
    stub.setMode('garbage');

    expect(await failure(fetcher.request(EVENTS(), { headers: keyed() }))).toMatchObject({ kind: 'shape' });
  });

  it('a redirect is never followed: it is a "status" error', async () => {
    stub.setMode('redirect');

    expect(await failure(fetcher.request(EVENTS(), { headers: keyed() }))).toMatchObject({ kind: 'status', status: 302 });
  });
});

describe('timeouts', () => {
  it('gives up on a slow answer when a person is waiting', async () => {
    fetcher.configure({ userTimeoutMs: 50, backgroundTimeoutMs: 2000 });
    stub.setDelay(400);

    expect(await failure(fetcher.request(EVENTS(), { headers: keyed() }))).toMatchObject({ kind: 'timeout' });
  });

  it('waits longer in the background, where nobody is waiting', async () => {
    fetcher.configure({ userTimeoutMs: 50, backgroundTimeoutMs: 2000 });
    stub.setDelay(400);

    const res = await fetcher.request(EVENTS(), { headers: keyed(), mode: 'background' });

    expect(res.status).toBe(200);
  });

  it('uses 10 seconds for a waiting person and 60 seconds in the background by default', () => {
    // Not waited for, so only the settings are checked: a slow call is tested above with shorter ones.
    const spy = jest.spyOn(AbortSignal, 'timeout');
    stub.setMode('up');

    return Promise.all([
      fetcher.request(EVENTS(), { headers: keyed() }),
      fetcher.request(EVENTS(), { headers: keyed(), mode: 'background' }),
    ]).then(() => {
      expect(spy.mock.calls.map((c) => c[0])).toEqual([10000, 60000]);
      spy.mockRestore();
    });
  });
});

describe('the 5-minute read cache', () => {
  const MINUTE = 60 * 1000;
  let clock;
  beforeEach(() => { clock = 1_000_000; fetcher.configure({ now: () => clock }); });

  it('answers a repeated cached read from memory, without calling the partner again', async () => {
    await fetcher.request(EVENTS(), { headers: keyed(), cache: true });
    clock += 4 * MINUTE;

    const again = await fetcher.request(EVENTS(), { headers: keyed(), cache: true });

    expect(stub.requests).toHaveLength(1);
    expect(again.body).toHaveLength(2);
  });

  it('asks the partner again once 5 minutes have passed', async () => {
    await fetcher.request(EVENTS(), { headers: keyed(), cache: true });
    clock += 5 * MINUTE + 1;

    await fetcher.request(EVENTS(), { headers: keyed(), cache: true });

    expect(stub.requests).toHaveLength(2);
  });

  it('caches nothing unless the call asks for it', async () => {
    await fetcher.request(EVENTS(), { headers: keyed() });
    await fetcher.request(EVENTS(), { headers: keyed() });

    expect(stub.requests).toHaveLength(2);
  });

  it('never remembers a failure: the next call tries again', async () => {
    stub.setMode('error');
    await failure(fetcher.request(EVENTS(), { headers: keyed(), cache: true }));
    stub.setMode('up');

    const res = await fetcher.request(EVENTS(), { headers: keyed(), cache: true });

    expect(res.status).toBe(200);
    expect(fetcher.cacheSize()).toBe(1);
  });

  it('never caches a 4xx answer', async () => {
    await fetcher.request(EVENTS(), { headers: {}, cache: true });
    await fetcher.request(EVENTS(), { headers: {}, cache: true });

    expect(stub.requests).toHaveLength(2);
    expect(fetcher.cacheSize()).toBe(0);
  });

  it('never caches a write', async () => {
    const send = () => fetcher.request(`${stub.url}/api/offers`, { method: 'POST', headers: keyed(), body: { roleId: 'rol_3004', workersOffered: 1 }, cache: true });
    await send();
    await send();

    expect(stub.requests.filter((r) => r.method === 'POST')).toHaveLength(2);
  });

  it('keeps each URL separate', async () => {
    await fetcher.request(`${EVENTS()}&county=Nairobi`, { headers: keyed(), cache: true });
    const mombasa = await fetcher.request(`${EVENTS()}&county=Mombasa`, { headers: keyed(), cache: true });

    expect(stub.requests).toHaveLength(2);
    expect(mombasa.body.map((e) => e.county)).toEqual(['Mombasa']);
  });

  it('holds at most 200 entries', async () => {
    for (let i = 0; i < fetcher.CACHE_MAX_ENTRIES + 25; i++) {
      await fetcher.request(`${stub.url}/api/events/evt_2001/roles?n=${i}`, { headers: keyed(), cache: true });
    }

    expect(fetcher.cacheSize()).toBeLessThanOrEqual(fetcher.CACHE_MAX_ENTRIES);
  });
});
