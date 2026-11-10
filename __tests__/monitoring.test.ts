// Week 12: monitoring (monitoring.ts and Endpoint 26, GET /api/stats). One JSON line per request with exactly the
// fields we chose, never a key, a query string or a body; requests refused for a key or the rate limit are logged
// too, because monitor() runs first; /api/stats needs a key and its numbers add up.

import { createHash, randomBytes } from 'crypto';
import request from 'supertest';
import { createServer } from '../app';
import * as db from '../db';
import * as rateLimit from '../lib/rateLimit';
import * as fetcher from '../clients/fetcher';
import * as saved from '../lib/savedOpenings';
import { resetStats, routeOf, setLogSink } from '../monitoring';
import { createShereheStub } from '../helpers/shereheStub';
import type { ShereheStub } from '../helpers/shereheStub';

const key = (): string => randomBytes(24).toString('hex');
const UJUZI = key();
const TEAM = key();
const STATS = key();
const label = (k: string): string => 'key-' + createHash('sha256').update(k).digest('hex').slice(0, 6);

const SETTINGS = ['API_KEYS', 'REQUIRE_API_KEY', 'API_RATE_LIMIT', 'API_RATE_WINDOW_MS', 'API_FAILED_KEY_LIMIT', 'STATS_KEY', 'SHEREHE_API_URL', 'SHEREHE_API_KEY'];
const before: Record<string, string | undefined> = {};
let server: ReturnType<typeof createServer>;
let stub: ShereheStub;
let lines: string[] = [];

beforeAll(async () => {
  for (const name of SETTINGS) before[name] = process.env[name];
  stub = createShereheStub();
  await stub.start();
  server = createServer();
  await new Promise<void>((resolve) => { server.listen(0, resolve); });
});
afterAll(async () => {
  setLogSink(null);
  await new Promise((resolve) => server.close(resolve));
  await stub.stop();
  if (db.close) await db.close();
});
beforeEach(async () => {
  await db.reset();
  rateLimit.reset();
  fetcher.reset();
  saved.forget();
  stub.reset();
  for (const name of SETTINGS) delete process.env[name];
  resetStats();
  lines = [];
  setLogSink((line) => lines.push(line));
});
afterEach(() => {
  for (const name of SETTINGS) { if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name]; }
});

const keysOn = (): void => { process.env.API_KEYS = `ujuzi:${UJUZI},team:${TEAM}`; };
const get = (url: string, headers: Record<string, string> = {}) => request(server).get(url).set(headers);
const logged = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
const settle = () => new Promise((resolve) => setTimeout(resolve, 20)); // 'finish' fires just after the reply

describe('the request log (Part B)', () => {
  it('writes one JSON line per request, with exactly time, method, path, status, ms and caller', async () => {
    await get('/api/jobs?status=active');
    await settle();

    expect(lines).toHaveLength(1);
    const [entry] = logged();
    expect(Object.keys(entry)).toEqual(['time', 'method', 'path', 'status', 'ms', 'caller']);
    expect(entry).toMatchObject({ method: 'GET', path: '/api/jobs', status: 200, caller: 'none' });
    expect(new Date(entry.time as string).toISOString()).toBe(entry.time);
    expect(typeof entry.ms).toBe('number');
    expect(entry.ms as number).toBeGreaterThan(0); // the precise clock: never a rounded 0
  });

  it('never writes the query string, where emails, tokens and names can hide', async () => {
    await get('/api/jobs?status=active&county=Nairobi&email=wanjiru%40example.com');
    await settle();

    expect(logged()[0].path).toBe('/api/jobs');
    expect(lines.join('\n')).not.toMatch(/wanjiru|status=|county|\?/);
  });

  it('a real key is a key-xxxxxx label, a wrong key and no key are "none", and the key itself is never written', async () => {
    keysOn();

    const ok = await get('/api/jobs?status=active', { 'X-API-Key': UJUZI });
    const wrong = await get('/api/jobs?status=active', { 'X-API-Key': 'wrong-key-1234567890' });
    const missing = await get('/api/jobs?status=active');
    await settle();

    expect([ok.status, wrong.status, missing.status]).toEqual([200, 401, 401]);
    expect(logged().map((e) => [e.status, e.caller])).toEqual([[200, label(UJUZI)], [401, 'none'], [401, 'none']]);
    const all = lines.join('\n');
    expect(all.split(UJUZI)).toHaveLength(1); // grep -c "<key>" prints 0
    expect(all).not.toContain(UJUZI.slice(0, 8));
    expect(all).not.toContain('wrong-key');
  });

  it('two consumers get two different labels, the same key always the same one', async () => {
    keysOn();

    await get('/api/jobs?status=active', { 'X-API-Key': UJUZI });
    await get('/api/jobs?status=active', { 'X-API-Key': TEAM });
    await get('/api/jobs?status=active', { 'X-API-Key': UJUZI });
    await settle();

    const callers = logged().map((e) => e.caller);
    expect(callers[0]).toBe(callers[2]);
    expect(callers[0]).not.toBe(callers[1]);
  });

  it('logs requests the rate limit refuses (429), because monitor runs before it', async () => {
    keysOn();
    process.env.API_RATE_LIMIT = '2';

    for (let i = 0; i < 3; i++) await get('/api/jobs?status=active', { 'X-API-Key': UJUZI });
    await settle();

    expect(logged().map((e) => e.status)).toEqual([200, 200, 429]);
  });

  it('never writes a login token or a request body', async () => {
    const login = await request(server).post('/api/auth/login').send({ email: 'employer@kaziconnect.demo', password: 'KaziDemo2026' });
    await get('/api/me', { Authorization: `Bearer ${login.body.token}` });
    await settle();

    const all = lines.join('\n');
    expect(all).not.toContain(login.body.token);
    expect(all).not.toContain('KaziDemo2026');
    expect(all).not.toContain('employer@kaziconnect.demo');
  });

  it("leaves out Next.js's own build files, which a single page view fetches by the dozen", async () => {
    await get('/_next/static/chunks/nothing-here.js');
    await get('/favicon.ico');
    await settle();

    expect(lines).toHaveLength(0);
  });
});

describe('route patterns', () => {
  it.each([
    ['/api/jobs', '/api/jobs'],
    ['/api/jobs/job_12345', '/api/jobs/:jobId'],
    ['/api/jobs/job_12345/applications', '/api/jobs/:jobId/applications'],
    ['/api/applications/app_1/status', '/api/applications/:applicationId/status'],
    ['/api/staffing-offers/sof_1', '/api/staffing-offers/:offerId'],
    ['/api/v2/jobs', '/api/v2/jobs'],
    ['/api/stats', '/api/stats'],
    ['/jobs/job_12345', '/jobs/:jobId'],
    ['/', '/'],
    ['/api/not-a-route', '(no route)'],
  ])('%s is counted as %s', (path, pattern) => {
    expect(routeOf(path)).toBe(pattern);
  });
});

describe('/api/stats (Part C)', () => {
  it('needs a key: with keys off and no STATS_KEY it always answers 401', async () => {
    const res = await get('/api/stats', { 'X-API-Key': STATS });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Missing or invalid API key' });
  });

  it('with keys off, answers only to STATS_KEY', async () => {
    process.env.STATS_KEY = STATS;

    expect((await get('/api/stats')).status).toBe(401);
    expect((await get('/api/stats', { 'X-API-Key': 'not-the-stats-key-at-all' })).status).toBe(401);
    expect((await get('/api/stats', { 'X-API-Key': STATS })).status).toBe(200);
  });

  it('with keys on, answers to any valid key and to nobody else', async () => {
    keysOn();

    expect((await get('/api/stats', { 'X-API-Key': TEAM })).status).toBe(200);
    expect((await get('/api/stats')).status).toBe(401);
  });

  it('adds up: totals, 4xx and 5xx, the error rate from 5xx only, and one row per route pattern', async () => {
    process.env.STATS_KEY = STATS;
    await get('/api/jobs?status=active');
    await get('/api/jobs/job_12345');
    await get('/api/jobs/job_99999'); // no such job: 404
    await get('/api/not-a-route'); // 404
    const login = await request(server).post('/api/auth/login').send({ email: 'employer@kaziconnect.demo', password: 'KaziDemo2026' });
    await get('/api/event-openings', { Authorization: `Bearer ${login.body.token}` }); // Sherehe not set up: 502
    await settle();

    const res = await get('/api/stats', { 'X-API-Key': STATS });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['startedAt', 'uptimeSeconds', 'total', 'clientErrors', 'serverErrors', 'errorRatePercent', 'avgMs', 'routes', 'partner']);
    expect(res.body.total).toBe(6); // its own request is not counted in its own reply
    expect(res.body.clientErrors).toBe(2);
    expect(res.body.serverErrors).toBe(1);
    expect(res.body.errorRatePercent).toBe(16.7);
    expect(res.body.routes['GET /api/jobs/:jobId']).toMatchObject({ count: 2, clientErrors: 1, serverErrors: 0 });
    expect(res.body.routes['GET (no route)']).toMatchObject({ count: 1, clientErrors: 1 });
    expect(res.body.routes['GET /api/event-openings']).toMatchObject({ count: 1, serverErrors: 1 });
    for (const row of Object.values(res.body.routes) as Array<{ avgMs: number; maxMs: number }>) expect(row.maxMs).toBeGreaterThanOrEqual(row.avgMs);
    expect(res.body.partner).toEqual({ name: 'Sherehe', retries: 0, failures: 1, savedListServed: 0 });

    const again = await get('/api/stats', { 'X-API-Key': STATS });
    expect(again.body.total).toBe(7); // the first /api/stats shows up in the next reply
    expect(again.body.routes['GET /api/stats'].count).toBe(1);
  });

  it("counts Sherehe's retries, its failures and every time the saved list stood in (the Week 11 stretch)", async () => {
    process.env.STATS_KEY = STATS;
    process.env.SHEREHE_API_URL = stub.url;
    process.env.SHEREHE_API_KEY = stub.apiKey;
    fetcher.configure({ onRetry: () => {} });
    const login = await request(server).post('/api/auth/login').send({ email: 'employer@kaziconnect.demo', password: 'KaziDemo2026' });
    const openings = () => get('/api/event-openings', { Authorization: `Bearer ${login.body.token}` });

    stub.failNext(2, 503);
    await openings(); // two retries, then live
    fetcher.clearCache();
    stub.setMode('error');
    await openings(); // two more retries, a failure, and the saved list
    await settle();

    const res = await get('/api/stats', { 'X-API-Key': STATS });

    expect(res.body.partner).toEqual({ name: 'Sherehe', retries: 4, failures: 1, savedListServed: 1 });
    expect(res.body.serverErrors).toBe(0); // the employer never saw a 5xx
  });
});
