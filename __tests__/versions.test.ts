// Week 13: version 2 of the job list beside version 1.
//
//   GET /api/jobs      version 1 (Endpoints 1 and 2), the address Ujuzi calls today: a bare list, FROZEN
//   GET /api/v1/jobs   the same version 1 under a versioned address
//   GET /api/v2/jobs   version 2: the same jobs wrapped as { data, count }
//
// The first group pins down version 1 exactly (the field names of a job, the bare list, the empty 400), so nobody can
// "tidy" it by accident. parityWithExpress.test.js also replays the 30 recorded Express requests to /api/jobs.

import { randomBytes } from 'crypto';
import request from 'supertest';
import { createServer } from '../app';
import * as db from '../db';
import * as rateLimit from '../lib/rateLimit';
import { resetStats, setLogSink, stats } from '../monitoring';

const JOB_FIELDS = ['area', 'category', 'county', 'duration', 'id', 'payRange', 'status', 'title', 'urgent'];
const SUNSET = 'Tue, 10 Nov 2026 21:00:00 GMT';
const SUCCESSOR = '</api/v2/jobs>; rel="successor-version"';

let server: ReturnType<typeof createServer>;
const before: Record<string, string | undefined> = {};
const SETTINGS = ['API_KEYS', 'REQUIRE_API_KEY'];

beforeAll(async () => {
  for (const name of SETTINGS) before[name] = process.env[name];
  server = createServer();
  await new Promise<void>((resolve) => { server.listen(0, resolve); });
});
afterAll(async () => {
  setLogSink(null);
  await new Promise((resolve) => server.close(resolve));
  if (db.close) await db.close();
});
beforeEach(async () => {
  await db.reset();
  rateLimit.reset();
  resetStats();
  setLogSink(() => undefined);
  for (const name of SETTINGS) delete process.env[name];
});
afterEach(() => {
  for (const name of SETTINGS) { if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name]; }
});

const get = (url: string, headers: Record<string, string> = {}) => request(server).get(url).set(headers);

describe('v1 is frozen', () => {
  it('GET /api/v1/jobs keeps its original shape: a bare list of jobs with exactly the fields they always had', async () => {
    const res = await get('/api/v1/jobs?status=active');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    for (const job of res.body) expect(Object.keys(job).sort()).toEqual(JOB_FIELDS);
  });

  it('the old address /api/jobs answers exactly what /api/v1/jobs answers, byte for byte', async () => {
    for (const query of ['?status=active', '?status=closed', '?status=active&county=Nairobi&category=accommodation']) {
      const old = await get(`/api/jobs${query}`);
      const v1 = await get(`/api/v1/jobs${query}`);
      expect(old.status).toBe(200);
      expect(old.text).toBe(v1.text);
    }
  });

  it('a query that is not valid is still the empty 400 it always was, on both addresses', async () => {
    for (const path of ['/api/jobs', '/api/v1/jobs', '/api/jobs?status=', '/api/v1/jobs?status=active&status=closed']) {
      const res = await get(path);
      expect(res.status).toBe(400);
      expect(res.text).toBe('');
    }
  });

  it('one job (GET /api/jobs/{jobId}) is not part of this change: no new shape, no deprecation', async () => {
    const res = await get('/api/jobs/job_12345');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(JOB_FIELDS);
    expect(res.headers.deprecation).toBeUndefined();
  });
});

describe('v2 has the new shape', () => {
  it('the list is wrapped: { data, count }, and count is the number of jobs in data', async () => {
    const res = await get('/api/v2/jobs?status=active');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['count', 'data']);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.count).toBe(res.body.data.length);
    for (const job of res.body.data) expect(Object.keys(job).sort()).toEqual(JOB_FIELDS);
  });

  it('same data as v1: the jobs in data are exactly the v1 list, in the same order', async () => {
    const v1 = await get('/api/jobs?status=active');
    const v2 = await get('/api/v2/jobs?status=active');

    expect(v2.body.data).toEqual(v1.body);
  });

  it('the filters still work: county and category narrow the list as in v1', async () => {
    const res = await get('/api/v2/jobs?status=active&county=Nairobi&category=accommodation');
    const v1 = await get('/api/jobs?status=active&county=Nairobi&category=accommodation');

    expect(res.body.data.map((j: { id: string }) => j.id)).toEqual(v1.body.map((j: { id: string }) => j.id));
    expect(res.body.data.every((j: { county: string; category: string }) => j.county === 'Nairobi' && j.category === 'accommodation')).toBe(true);
  });

  it('an empty result is { data: [], count: 0 }, not a 404', async () => {
    const res = await get('/api/v2/jobs?status=active&county=Turkana');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], count: 0 });
  });

  it('a query that is not valid gets the same empty 400 as v1', async () => {
    const res = await get('/api/v2/jobs?status=');

    expect(res.status).toBe(400);
    expect(res.text).toBe('');
  });

  it('only reads: POST, PUT, PATCH and DELETE on /api/v2/jobs are 404 with no body', async () => {
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await request(server)[method]('/api/v2/jobs');
      expect(res.status).toBe(404);
      expect(res.text).toBe('');
    }
  });
});

describe('deprecation headers', () => {
  it('v1 and the old address announce the sunset on every answer, the 400 included', async () => {
    for (const path of ['/api/jobs?status=active', '/api/v1/jobs?status=active', '/api/jobs', '/api/v1/jobs?status=']) {
      const res = await get(path);
      expect(res.headers.deprecation).toBe('true');
      expect(res.headers.sunset).toBe(SUNSET);
      expect(res.headers.link).toBe(SUCCESSOR);
    }
  });

  it('v2, creating a job, one job and unknown paths do not carry them', async () => {
    const answers = [
      await get('/api/v2/jobs?status=active'),
      await get('/api/jobs/job_12345'),
      await get('/api/v3/jobs'),
      await request(server).post('/api/jobs').send({}),
    ];
    for (const res of answers) {
      expect(res.headers.deprecation).toBeUndefined();
      expect(res.headers.sunset).toBeUndefined();
    }
  });
});

describe('v2 needs a key like everything else', () => {
  const key = randomBytes(24).toString('hex');

  it('with API keys on: no key is 401, a valid key is 200', async () => {
    process.env.API_KEYS = `ujuzi:${key}`;

    const without = await get('/api/v2/jobs?status=active');
    const withKey = await get('/api/v2/jobs?status=active', { 'X-API-Key': key });

    expect(without.status).toBe(401);
    expect(without.body).toEqual({ message: 'Missing or invalid API key' });
    expect(withKey.status).toBe(200);
  });

  it('/api/stats tells the versions apart, so we can see who still calls v1 before switching it off', async () => {
    process.env.API_KEYS = `ujuzi:${key}`;
    await get('/api/jobs?status=active', { 'X-API-Key': key });
    await get('/api/jobs?status=active', { 'X-API-Key': key });
    await get('/api/v2/jobs?status=active', { 'X-API-Key': key });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const { routes } = stats(0);
    expect(routes['GET /api/jobs'].count).toBe(2);
    expect(routes['GET /api/v2/jobs'].count).toBe(1);
  });
});
