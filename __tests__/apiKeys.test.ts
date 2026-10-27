// Week 9: API keys and rate limiting (lib/apiKeys.ts, lib/rateLimit.ts, lib/apiGate.ts, proxy.ts, realtime.ts).
// Keys are switched on by setting API_KEYS. With none set the API is open, exactly as before (the 156 original
// tests and the parity test run that way), so these tests set the variables themselves and put them back.
//
// "Every endpoint requires a key" is tested from openapi.yaml: one request per operation the contract lists, so an
// endpoint added later cannot slip past the check.

import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import type { AddressInfo } from 'net';
import request from 'supertest';
import WebSocket from 'ws';
import YAML from 'yaml';
import { createServer } from '../app';
import * as db from '../db';
import * as rateLimit from '../lib/rateLimit';
import { describeAccess, identify, keyFromSubprotocols, parseKeys, readConfig } from '../lib/apiKeys';

const key = (): string => randomBytes(24).toString('hex');
const UJUZI = key();
const WEBSITE = key();
const TEAM = key();
const KEYS = `ujuzi:${UJUZI},website:${WEBSITE},team:${TEAM}`;

const SETTINGS = ['API_KEYS', 'REQUIRE_API_KEY', 'API_RATE_LIMIT', 'API_RATE_WINDOW_MS', 'API_FAILED_KEY_LIMIT'];
const saved: Record<string, string | undefined> = {};
let server: ReturnType<typeof createServer>;
let port = 0;

beforeAll(async () => {
  for (const name of SETTINGS) saved[name] = process.env[name];
  server = createServer();
  await new Promise<void>((resolve) => { server.listen(0, resolve); });
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (db.close) await db.close();
});
beforeEach(async () => {
  await db.reset();
  rateLimit.reset();
  for (const name of SETTINGS) delete process.env[name];
});
afterEach(() => {
  for (const name of SETTINGS) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
});

const keysOn = (extra: Record<string, string> = {}): void => { process.env.API_KEYS = KEYS; Object.assign(process.env, extra); };
const get = (url: string, headers: Record<string, string> = {}) => request(server).get(url).set(headers);
const JOBS = '/api/jobs?status=active';

describe('reading the settings', () => {
  it('names each consumer, and gives a bare key a name of its own', () => {
    const { consumers, problems } = parseKeys(` ujuzi : ${UJUZI} , ${TEAM} ,, `);

    expect(consumers.map((c) => c.name)).toEqual(['ujuzi', 'key2']);
    expect(problems).toEqual([]);
  });

  it('ignores a key that is too short, a bad name, a repeated name and a repeated key, and says why', () => {
    const { consumers, problems } = parseKeys(`short:abc,bad name:${UJUZI},ok:${TEAM},ok:${key()},other:${TEAM}`);

    expect(consumers.map((c) => c.name)).toEqual(['ok']);
    expect(problems).toHaveLength(4);
  });

  it('knows each key, and nothing close to it', () => {
    const config = readConfig({ API_KEYS: KEYS });

    expect(identify(UJUZI, config)?.name).toBe('ujuzi');
    expect(identify(TEAM, config)?.name).toBe('team');
    expect(identify(UJUZI.slice(0, -1), config)).toBeNull();
    expect(identify(`${UJUZI}0`, config)).toBeNull();
    expect(identify(UJUZI.toUpperCase(), config)).toBeNull();
    expect(identify('', config)).toBeNull();
    expect(identify(undefined, config)).toBeNull();
  });

  it('is switched on by API_KEYS, or by REQUIRE_API_KEY; otherwise it is open', () => {
    expect(readConfig({}).required).toBe(false);
    expect(readConfig({ API_KEYS: KEYS }).required).toBe(true);
    expect(readConfig({ REQUIRE_API_KEY: 'true' }).required).toBe(true);
    expect(readConfig({ REQUIRE_API_KEY: 'false' }).required).toBe(false);
  });

  it('says how access is set up in one line that never contains a key', () => {
    const lines = [describeAccess(readConfig({ API_KEYS: KEYS })), describeAccess(readConfig({})), describeAccess(readConfig({ REQUIRE_API_KEY: 'true' }))];

    for (const line of lines) for (const secret of [UJUZI, WEBSITE, TEAM]) expect(line).not.toContain(secret);
    expect(lines[0]).toContain('3 loaded (ujuzi, website, team)');
    expect(lines[1]).toMatch(/open/);
    expect(lines[2]).toMatch(/every call is refused/);
  });

  it('reads a key from the WebSocket subprotocol a browser sends', () => {
    expect(keyFromSubprotocols(`kazi-key.${UJUZI}`)).toBe(UJUZI);
    expect(keyFromSubprotocols(`other, kazi-key.${UJUZI}`)).toBe(UJUZI);
    expect(keyFromSubprotocols(['x', `kazi-key.${TEAM}`])).toBe(TEAM);
    expect(keyFromSubprotocols('chat')).toBeNull();
    expect(keyFromSubprotocols(undefined)).toBeNull();
  });

  it('has defaults of 100 calls a minute, and takes its own numbers from the settings', () => {
    expect(rateLimit.readLimits({})).toEqual({ max: 100, windowMs: 60000, failedMax: 20 });
    expect(rateLimit.readLimits({ API_RATE_LIMIT: '7', API_RATE_WINDOW_MS: '500', API_FAILED_KEY_LIMIT: '2' })).toEqual({ max: 7, windowMs: 500, failedMax: 2 });
    expect(rateLimit.readLimits({ API_RATE_LIMIT: 'lots', API_RATE_WINDOW_MS: '-5' })).toMatchObject({ max: 100, windowMs: 60000 });
  });
});

describe('with no keys set, the API is open as it always was', () => {
  it('answers without a key', async () => {
    expect((await get(JOBS)).status).toBe(200);
  });

  it('adds no rate limit either', async () => {
    process.env.API_RATE_LIMIT = '2';
    for (let i = 0; i < 6; i++) expect((await get(JOBS)).status).toBe(200);
  });
});

describe('with keys set', () => {
  beforeEach(() => keysOn());

  it('refuses a request with no key: 401, a JSON message, and the handler never runs', async () => {
    const res = await get(JOBS);

    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ message: 'Missing or invalid API key' });
  });

  it('refuses a wrong key, the right key in the wrong place, and a login token on its own', async () => {
    const login = await get(JOBS, { 'X-API-Key': TEAM }).then(async () => request(server).post('/api/auth/login').set({ 'X-API-Key': TEAM }).send({ email: 'employer@kaziconnect.demo', password: 'KaziDemo2026' }));
    expect(login.status).toBe(200);

    expect((await get(JOBS, { 'X-API-Key': 'wrong' })).status).toBe(401);
    expect((await get(JOBS, { Authorization: `Bearer ${TEAM}` })).status).toBe(401);
    expect((await get('/api/me', { Authorization: `Bearer ${login.body.token}` })).status).toBe(401);
  });

  it('lets each consumer in with its own key, whatever the case of the header name', async () => {
    for (const k of [UJUZI, WEBSITE, TEAM]) expect((await get(JOBS, { 'X-API-Key': k })).status).toBe(200);
    expect((await get(JOBS, { 'x-api-key': UJUZI })).status).toBe(200);
  });

  it('then works exactly as before: a login token on top of the key still decides what a person may do', async () => {
    const withKey = { 'X-API-Key': UJUZI };
    const login = await request(server).post('/api/auth/login').set(withKey).send({ email: 'student@kaziconnect.demo', password: 'KaziDemo2026' });

    const me = await get('/api/me', { ...withKey, Authorization: `Bearer ${login.body.token}` });
    const post = await request(server).post('/api/jobs').set({ ...withKey, Authorization: `Bearer ${login.body.token}` }).send({});

    expect(me.status).toBe(200);
    expect(post.status).toBe(403); // a student may not post jobs
  });

  it('refuses a HEAD request and an unknown /api path without a key, and answers an unknown path with a key as before: 404, no body', async () => {
    expect((await request(server).head(JOBS)).status).toBe(401);
    expect((await get('/api/nothing-here')).status).toBe(401);

    const known = await get('/api/nothing-here', { 'X-API-Key': TEAM });
    expect(known.status).toBe(404);
    expect(known.text).toBe('');
  });

  it('carries the CORS headers on a refusal, so a browser app can read it', async () => {
    const res = await get(JOBS);

    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('answers the browser preflight without a key, because a preflight cannot carry one', async () => {
    const res = await request(server).options(JOBS);

    expect(res.status).toBe(204);
  });

  it('keeps the documentation public: /openapi.yaml, /docs and the home page need no key', async () => {
    expect((await get('/openapi.yaml')).status).toBe(200);
    expect((await get('/docs')).status).toBe(200);
    expect((await get('/')).status).toBe(200);
  });

  describe('every operation in openapi.yaml', () => {
    const contract = YAML.parse(fs.readFileSync(path.join(__dirname, '..', 'openapi.yaml'), 'utf8')) as { paths: Record<string, Record<string, unknown>> };
    const operations: Array<[string, string]> = [];
    for (const [route, methods] of Object.entries(contract.paths)) {
      for (const method of Object.keys(methods)) if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) operations.push([method.toUpperCase(), route]);
    }
    const fill = (route: string): string => route.replace(/\{(\w+)\}/g, (_m, name: string) => (name.toLowerCase().includes('application') ? 'app_1001' : name.toLowerCase().includes('offer') ? 'sof_1001' : 'job_12345'));

    it('is a long enough list that this test cannot pass by finding nothing', () => {
      expect(operations.length).toBeGreaterThanOrEqual(24);
    });

    it.each(operations)('%s %s refuses a request with no key (401) and lets one with a key reach its handler', async (method, route) => {
      const url = fill(route);
      const send = (headers: Record<string, string>) => request(server)[method.toLowerCase() as 'get'](url).set(headers).send(method === 'GET' || method === 'DELETE' ? undefined : {});

      const without = await send({});
      rateLimit.reset();
      const withKey = await send({ 'X-API-Key': TEAM });

      expect(without.status).toBe(401);
      expect(without.body).toEqual({ message: 'Missing or invalid API key' });
      // With a key it reaches the handler: a login-protected endpoint still answers 401 for the missing LOGIN token,
      // but with its own message, not the API-key one.
      expect(withKey.body?.message).not.toBe('Missing or invalid API key');
      expect(withKey.status).not.toBe(429);
    });
  });
});

describe('the rate limit', () => {
  beforeEach(() => keysOn({ API_RATE_LIMIT: '3' }));

  it('lets 3 calls through and refuses the next ones with 429', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await get(JOBS, { 'X-API-Key': TEAM })).status);

    expect(codes).toEqual([200, 200, 200, 429, 429]);
  });

  it('answers 429 with a Retry-After header and a JSON body that say when to try again', async () => {
    for (let i = 0; i < 3; i++) await get(JOBS, { 'X-API-Key': TEAM });

    const res = await get(JOBS, { 'X-API-Key': TEAM });

    expect(res.status).toBe(429);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    const wait = Number(res.headers['retry-after']);
    expect(Number.isInteger(wait)).toBe(true);
    expect(wait).toBeGreaterThanOrEqual(1);
    expect(wait).toBeLessThanOrEqual(60);
    expect(res.body).toEqual({ message: 'Too many requests', retryAfter: wait });
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('counts each consumer on its own: one consumer using its allowance does not stop another', async () => {
    for (let i = 0; i < 4; i++) await get(JOBS, { 'X-API-Key': TEAM });

    expect((await get(JOBS, { 'X-API-Key': TEAM })).status).toBe(429);
    expect((await get(JOBS, { 'X-API-Key': UJUZI })).status).toBe(200);
  });

  it('starts again when the window ends', async () => {
    process.env.API_RATE_WINDOW_MS = '300';
    for (let i = 0; i < 4; i++) await get(JOBS, { 'X-API-Key': TEAM });
    expect((await get(JOBS, { 'X-API-Key': TEAM })).status).toBe(429);

    await new Promise((resolve) => setTimeout(resolve, 400));

    expect((await get(JOBS, { 'X-API-Key': TEAM })).status).toBe(200);
  });

  it('can be turned off with API_RATE_LIMIT=0, while the key check stays', async () => {
    process.env.API_RATE_LIMIT = '0';

    for (let i = 0; i < 10; i++) expect((await get(JOBS, { 'X-API-Key': TEAM })).status).toBe(200);
    expect((await get(JOBS)).status).toBe(401);
  });

  it('gives each visitor of the website their own allowance, because the website key is shared by everyone', async () => {
    const visitor = (address: string) => get(JOBS, { 'X-API-Key': WEBSITE, 'X-Forwarded-For': address });
    for (let i = 0; i < 4; i++) await visitor('10.0.0.1');

    expect((await visitor('10.0.0.1')).status).toBe(429);
    expect((await visitor('10.0.0.2')).status).toBe(200);
  });

  it('slows down key guessing: after a few wrong keys from one address, even more wrong keys get 429, and a right key still works', async () => {
    process.env.API_FAILED_KEY_LIMIT = '3';
    const guess = () => get(JOBS, { 'X-API-Key': `wrong-${randomBytes(4).toString('hex')}`, 'X-Forwarded-For': '10.9.9.9' });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await guess()).status);

    expect(codes).toEqual([401, 401, 401, 429, 429]);
    expect((await get(JOBS, { 'X-API-Key': TEAM, 'X-Forwarded-For': '10.9.9.9' })).status).toBe(200);
  });
});

describe('with REQUIRE_API_KEY and no key configured, it fails closed', () => {
  it('refuses every call, even one that sends some key', async () => {
    process.env.REQUIRE_API_KEY = 'true';

    expect((await get(JOBS)).status).toBe(401);
    expect((await get(JOBS, { 'X-API-Key': TEAM })).status).toBe(401);
  });
});

describe('the website\'s own pages', () => {
  const metaOf = (html: string): string | null => /<meta name="kazi-api-key" content="([^"]+)"/.exec(html)?.[1] ?? null;

  it('carry the website key, and only the website key, for the browser to send', async () => {
    keysOn();

    const page = await get('/');

    expect(metaOf(page.text)).toBe(WEBSITE);
    expect(page.text).not.toContain(UJUZI);
    expect(page.text).not.toContain(TEAM);
  });

  it('carry no key when keys are not switched on, or when no key is named "website"', async () => {
    expect(metaOf((await get('/')).text)).toBeNull();

    process.env.API_KEYS = `ujuzi:${UJUZI}`;
    expect(metaOf((await get('/')).text)).toBeNull();
  });
});

describe('the WebSocket (Endpoint 6)', () => {
  beforeEach(() => keysOn());
  const url = (): string => `ws://localhost:${port}/api/applications/app_1001/subscribe`;

  // Resolves with how the connection attempt ended: the first message, or the status of a refusal.
  const attempt = (options: WebSocket.ClientOptions = {}, protocols?: string[]): Promise<{ opened: boolean; first?: unknown; refused?: number; protocol?: string }> =>
    new Promise((resolve) => {
      const ws = new WebSocket(url(), protocols, options);
      ws.on('message', (data) => { const protocol = ws.protocol; ws.close(); resolve({ opened: true, first: JSON.parse(data.toString()), protocol }); });
      ws.on('unexpected-response', (_req, res) => { resolve({ opened: false, refused: res.statusCode }); ws.terminate(); });
      ws.on('error', () => undefined);
    });

  it('refuses a connection with no key, or a wrong one: 401', async () => {
    expect(await attempt()).toMatchObject({ opened: false, refused: 401 });
    expect(await attempt({ headers: { 'X-API-Key': 'wrong' } })).toMatchObject({ opened: false, refused: 401 });
  });

  it('accepts a server that sends its key as a header, and sends the status at once as before', async () => {
    expect(await attempt({ headers: { 'X-API-Key': UJUZI } })).toMatchObject({ opened: true, first: { applicationId: 'app_1001', status: 'pending' } });
  });

  it('accepts a browser that sends its key as the subprotocol "kazi-key.<key>", and answers with that subprotocol', async () => {
    const result = await attempt({}, [`kazi-key.${WEBSITE}`]);

    expect(result).toMatchObject({ opened: true, first: { applicationId: 'app_1001' }, protocol: `kazi-key.${WEBSITE}` });
  });

  it('refuses a wrong key sent as a subprotocol', async () => {
    expect(await attempt({}, ['kazi-key.not-a-real-key-at-all'])).toMatchObject({ opened: false, refused: 401 });
  });

  it('counts toward the rate limit, and refuses with 429 once it is used up', async () => {
    process.env.API_RATE_LIMIT = '2';

    const results = [await attempt({ headers: { 'X-API-Key': TEAM } }), await attempt({ headers: { 'X-API-Key': TEAM } }), await attempt({ headers: { 'X-API-Key': TEAM } })];

    expect(results.map((r) => r.opened)).toEqual([true, true, false]);
    expect(results[2].refused).toBe(429);
  });

  it('tells a caller with no key nothing about which application ids exist', async () => {
    const missing = new Promise<number | undefined>((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}/api/applications/app_999999/subscribe`);
      ws.on('unexpected-response', (_req, res) => { resolve(res.statusCode); ws.terminate(); });
      ws.on('error', () => undefined);
    });

    expect(await missing).toBe(401); // the same answer as for an application that exists
  });
});
