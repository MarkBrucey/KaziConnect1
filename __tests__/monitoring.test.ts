// Week 12, monitoring (monitoring.ts, app/api/stats/route.ts): one log line for every /api request, running totals,
// and GET /api/stats. The lines are captured from console.log, so what the log says is what is checked: no key, no
// query string, no body, and the refused calls (401, 429) are there too.

import fs from 'fs';
import path from 'path';
import { createHash, randomBytes } from 'crypto';
import request from 'supertest';
import YAML from 'yaml';
import { createServer } from '../app';
import * as db from '../db';
import * as fetcher from '../clients/fetcher';
import * as rateLimit from '../lib/rateLimit';
import { API_PATHS, callerLabel, resetStats, routeLabel } from '../monitoring';

const key = (): string => randomBytes(24).toString('hex');
const UJUZI = key();
const TEAM = key();
const WEBSITE = key();
const KEYS = `ujuzi:${UJUZI},team:${TEAM},website:${WEBSITE}`;
const label = (k: string): string => `key-${createHash('sha256').update(k).digest('hex').slice(0, 6)}`;

const SETTINGS = ['API_KEYS', 'REQUIRE_API_KEY', 'REQUEST_LOG', 'API_RATE_LIMIT', 'API_RATE_WINDOW_MS', 'API_FAILED_KEY_LIMIT'];
const saved: Record<string, string | undefined> = {};
let server: ReturnType<typeof createServer>;
let lines: string[] = [];
let logSpy: jest.SpyInstance;

beforeAll(async () => {
  for (const name of SETTINGS) saved[name] = process.env[name];
  server = createServer();
  await new Promise<void>((resolve) => { server.listen(0, resolve); });
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (db.close) await db.close();
});
beforeEach(async () => {
  await db.reset();
  rateLimit.reset();
  resetStats();
  fetcher.reset();
  for (const name of SETTINGS) delete process.env[name];
  process.env.API_KEYS = KEYS;
  process.env.REQUEST_LOG = 'on';
  lines = [];
  logSpy = jest.spyOn(console, 'log').mockImplementation((text: unknown) => { lines.push(String(text)); });
});
afterEach(() => {
  logSpy.mockRestore();
  for (const name of SETTINGS) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
});

const JOBS = '/api/jobs?status=active';
const as = (k: string) => ({ 'X-API-Key': k });
const get = (url: string, headers: Record<string, string> = {}) => request(server).get(url).set(headers);
const logged = (): Array<Record<string, unknown>> => lines.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as Record<string, unknown>);
// The log line is written when the response has finished, which can be a moment after the client has the answer.
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));
const stats = async () => (await get('/api/stats', as(TEAM))).body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- the test reads whatever fields the answer has

describe('what an API path is counted under', () => {
  it('puts every id into one row, so the list cannot grow with the ids callers invent', () => {
    expect(routeLabel('GET', '/api/jobs/job_12345')).toBe('GET /api/jobs/:jobId');
    expect(routeLabel('GET', '/api/jobs/job_99999')).toBe('GET /api/jobs/:jobId');
    expect(routeLabel('get', '/api/applications/app_1/status')).toBe('GET /api/applications/:applicationId/status');
    expect(routeLabel('DELETE', '/api/staffing-offers/sof_1')).toBe('DELETE /api/staffing-offers/:offerId');
  });

  it('is not put off by letter case or a trailing slash, as the API itself is not', () => {
    expect(routeLabel('GET', '/API/Jobs/job_1/')).toBe('GET /api/jobs/:jobId');
  });

  it('counts a path that is not one of ours as (no route)', () => {
    expect(routeLabel('GET', '/api/nothing-here')).toBe('GET (no route)');
    expect(routeLabel('GET', '/api/jobs/job_1/extra/words')).toBe('GET (no route)');
  });

  it('lists exactly the paths of openapi.yaml, so an endpoint added later cannot be missed', () => {
    const spec = YAML.parse(fs.readFileSync(path.join(__dirname, '..', 'openapi.yaml'), 'utf8')) as { paths: Record<string, unknown> };
    const inSpec = Object.keys(spec.paths).map((p) => p.replace(/\{(\w+)\}/g, ':$1')).sort();

    expect([...API_PATHS].sort()).toEqual(inSpec);
  });

  it('knows every route folder under app/api (the catch-all [...path] is the (no route) answer)', () => {
    const found: string[] = [];
    const walk = (dir: string, prefix: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(path.join(dir, entry.name), `${prefix}/${entry.name.replace(/^\[(\w+)\]$/, ':$1')}`);
        else if (entry.name === 'route.ts') found.push(prefix);
      }
    };
    walk(path.join(__dirname, '..', 'app', 'api'), '/api');

    expect(found.filter((p) => !p.includes('...')).sort()).toEqual([...API_PATHS].sort());
  });
});

describe('who called', () => {
  it('is "none" for no key and for a wrong key: a wrong key is never written, not even in part', () => {
    expect(callerLabel(undefined)).toBe('none');
    expect(callerLabel('not-a-real-key-at-all-1234')).toBe('none');
  });

  it('is key- and six characters of a hash for a valid key, the same every time and different for another consumer', () => {
    expect(callerLabel(UJUZI)).toBe(label(UJUZI));
    expect(callerLabel(UJUZI)).toMatch(/^key-[0-9a-f]{6}$/);
    expect(callerLabel(UJUZI)).toBe(callerLabel(UJUZI));
    expect(callerLabel(TEAM)).not.toBe(callerLabel(UJUZI));
    expect(callerLabel(UJUZI)).not.toContain(UJUZI.slice(0, 6));
  });
});

describe('the request log', () => {
  it('writes one JSON line per request with time, method, path, status, ms and caller, and nothing else', async () => {
    await get('/api/jobs?status=active', as(UJUZI));
    await settle();

    const [line] = logged();
    expect(Object.keys(line)).toEqual(['time', 'method', 'path', 'status', 'ms', 'caller']);
    expect(line).toMatchObject({ method: 'GET', path: '/api/jobs', status: 200, caller: label(UJUZI) });
    expect(new Date(line.time as string).toISOString()).toBe(line.time);
    expect(typeof line.ms).toBe('number');
    expect(line.ms as number).toBeGreaterThan(0);
  });

  it('logs the refused calls too, because it runs first: a wrong key and no key are both 401 from "none"', async () => {
    await get('/api/jobs', as('wrong-key-wrong-key-wrong-key'));
    await get('/api/jobs');
    await settle();

    expect(logged().map((l) => [l.status, l.caller])).toEqual([[401, 'none'], [401, 'none']]);
  });

  it('logs a 429 from the rate limit', async () => {
    process.env.API_RATE_LIMIT = '1';
    await get(JOBS, as(UJUZI));
    const refused = await get(JOBS, as(UJUZI));
    await settle();

    expect(refused.status).toBe(429);
    expect(logged().map((l) => l.status)).toEqual([200, 429]);
  });

  it('logs a 404 for a path that does not exist, and a 500 from the malformed id', async () => {
    await get('/api/not-a-route', as(UJUZI));
    await get('/api/jobs/%zz', as(UJUZI));
    await settle();

    expect(logged().map((l) => l.status)).toEqual([404, 500]);
  });

  it('never writes the key, a token, a password, a body or a query string', async () => {
    const secretQuery = 'SECRETQUERYVALUE';
    await get(`/api/jobs?status=active&token=${secretQuery}&email=someone@example.com`, as(UJUZI));
    await request(server).post('/api/auth/login').set(as(UJUZI)).send({ email: 'employer@kaziconnect.demo', password: 'SECRETPASSWORD1' });
    await settle();

    const everything = lines.join('\n');
    for (const secret of [UJUZI, TEAM, WEBSITE, secretQuery, 'SECRETPASSWORD1', 'someone@example.com', 'employer@kaziconnect.demo', 'status=active']) {
      expect(everything).not.toContain(secret);
    }
    expect(logged().map((l) => l.path)).toEqual(['/api/jobs', '/api/auth/login']);
  });

  it('does not log the website or its files: only /api is monitored', async () => {
    await get('/', as(WEBSITE));
    await get('/openapi.yaml');
    await settle();

    expect(logged()).toEqual([]);
  });

  it('writes no lines when REQUEST_LOG=off, and still counts', async () => {
    process.env.REQUEST_LOG = 'off';
    await get('/api/jobs', as(UJUZI));
    await settle();

    expect(logged()).toEqual([]);
    expect((await stats()).total).toBe(1);
  });

  it('cuts a very long path short, so a caller cannot fill the log with one line', async () => {
    await get(`/api/jobs/${'x'.repeat(5000)}`, as(UJUZI));
    await settle();

    expect((logged()[0].path as string).length).toBeLessThanOrEqual(200);
  });
});

describe('GET /api/stats', () => {
  it('answers the totals, the 4xx and 5xx counts, the error rate, the average time and a row per route', async () => {
    await get('/api/jobs?status=active', as(UJUZI)); // 200
    await get('/api/jobs/job_12345', as(UJUZI)); // 200
    await get('/api/jobs/job_99999', as(UJUZI)); // 404, the same row as the line above
    await get('/api/jobs', as('wrong-key-wrong-key-wrong-key')); // 401
    await get('/api/jobs/%zz', as(UJUZI)); // 500
    await settle();

    const body = await stats();

    expect(Object.keys(body).sort()).toEqual(['avgMs', 'clientErrors', 'errorRatePercent', 'routes', 'serverErrors', 'sherehe', 'startedAt', 'total', 'uptimeSeconds']);
    expect(body).toMatchObject({ total: 5, clientErrors: 2, serverErrors: 1, errorRatePercent: 20 });
    expect(typeof body.avgMs).toBe('number');
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(body.routes['GET /api/jobs']).toMatchObject({ count: 2, clientErrors: 1, serverErrors: 0 }); // the 200 and the 401: a refused call is counted under the path it asked for
    expect(body.routes['GET /api/jobs/:jobId']).toMatchObject({ count: 3, clientErrors: 1, serverErrors: 1 }); // two ids, and the broken one
    expect(Object.keys(body.routes[Object.keys(body.routes)[0]]).sort()).toEqual(['avgMs', 'clientErrors', 'count', 'maxMs', 'serverErrors']);
  });

  it('builds the error rate from 5xx only: callers\' mistakes (4xx) do not count against it', async () => {
    await get('/api/jobs/job_nope', as(UJUZI));
    await get('/api/jobs/job_nope', as(UJUZI));
    await settle();

    expect(await stats()).toMatchObject({ clientErrors: 2, serverErrors: 0, errorRatePercent: 0 });
  });

  it('does not count itself in its own answer, but the next answer has it', async () => {
    const first = await stats();
    const second = await stats();

    expect(first.total).toBe(0);
    expect(second.total).toBe(1);
    expect(second.routes['GET /api/stats']).toMatchObject({ count: 1 });
  });

  it('shows paths that are not one of ours as (no route), and counts a refused call under the path it asked for', async () => {
    await get('/api/not-a-route', as(UJUZI));
    await get('/api/also-not-a-route', as(UJUZI));
    await get('/api/jobs'); // 401 from the key check
    await settle();

    const body = await stats();
    expect(body.routes['GET (no route)']).toMatchObject({ count: 2, clientErrors: 2 });
    expect(body.routes['GET /api/jobs']).toMatchObject({ count: 1, clientErrors: 1 });
  });

  it('counts Sherehe retries and saved data shown, which is how often the partner is really failing', async () => {
    const { retries, savedDataServed } = (await stats()).sherehe;

    expect({ retries, savedDataServed }).toEqual({ retries: 0, savedDataServed: 0 });
  });

  it('needs a key like everything else: 401 without one', async () => {
    const res = await get('/api/stats');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Missing or invalid API key' });
  });

  it('is for the team key only: another consumer\'s valid key gets 403, and the website\'s too', async () => {
    const ujuzi = await get('/api/stats', as(UJUZI));
    const website = await get('/api/stats', as(WEBSITE));

    expect([ujuzi.status, website.status]).toEqual([403, 403]);
    expect(ujuzi.body).toEqual({ message: 'Statistics are for the team key only.' });
  });

  it('is not available at all when API keys are not switched on, rather than open to everyone', async () => {
    delete process.env.API_KEYS;

    const res = await get('/api/stats');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: 'Statistics are only available when API keys are switched on (set API_KEYS).' });
  });

  it('is read-only: a POST is the same empty 404 as any other route that does not take one', async () => {
    const res = await request(server).post('/api/stats').set(as(TEAM));

    expect(res.status).toBe(404);
    expect(res.text).toBe('');
  });

  it('counts each consumer\'s calls in the same rows (callers are told apart in the log, not in the totals)', async () => {
    await get('/api/jobs', as(UJUZI));
    await get('/api/jobs', as(TEAM));
    await settle();

    expect((await stats()).routes['GET /api/jobs'].count).toBe(2);
  });
});
