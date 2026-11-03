// npm run ring:check, the end-to-end check of Kazi Connect's part of the ring (requirement R9). Here "Sherehe"
// is the local stand-in and "the live site" is the real app running in this process.

import http from 'http';
import type { AddressInfo } from 'net';
import { createServer } from '../app';
import * as db from '../db';
import { createShereheStub } from '../helpers/shereheStub';
import type { ShereheStub } from '../helpers/shereheStub';
import { runRingCheck } from '../scripts/ringCheck';
import type { Options, Step } from '../scripts/ringCheck';
import type { Settings } from '../scripts/ringStatus';

let stub: ShereheStub;
let kazi: http.Server;
let kaziUrl = '';
const small: http.Server[] = [];

async function serve(reply: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<string> {
  const server = http.createServer(reply);
  small.push(server);
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  stub = createShereheStub();
  await stub.start();
  kazi = createServer();
  await new Promise<void>((resolve) => { kazi.listen(0, resolve); });
  kaziUrl = `http://localhost:${(kazi.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await stub.stop();
  await new Promise((resolve) => kazi.close(resolve));
  await Promise.all(small.map((s) => new Promise((resolve) => { s.closeAllConnections(); s.close(resolve); })));
  if (db.close) await db.close();
});
beforeEach(async () => { stub.reset(); await db.reset(); });

const settings = (over: Partial<Settings> = {}): Settings => ({
  kaziUrl, kaziKey: '', shereheUrl: stub.url, shereheKey: stub.apiKey, ujuziUrl: '', write: false, timeoutMs: 5000, ...over,
});
const live: Options = { readOnly: false, applicationId: '' };
const failed = (steps: Step[]): string[] => steps.filter((s) => !s.passed).map((s) => `[${s.half}] ${s.name}`);

describe('once Kazi Connect asks for an API key', () => {
  const KEY = 'ring-check-test-key-0123456789abcdef';
  beforeEach(() => { process.env.API_KEYS = `team:${KEY}`; });
  afterEach(() => { delete process.env.API_KEYS; });

  it('passes every step when the key is given, including the WebSocket, and still leaves nothing behind', async () => {
    const before = await db.countApplications();

    const { steps } = await runRingCheck(settings({ kaziKey: KEY }), live);

    expect(failed(steps)).toEqual([]);
    expect(await db.countApplications()).toBe(before);
  });

  it('fails the Kazi half, and only that, when no key is given', async () => {
    const { steps } = await runRingCheck(settings(), live);

    expect(failed(steps).every((f) => f.startsWith('[kazi]'))).toBe(true);
    expect(failed(steps).length).toBeGreaterThan(0);
    expect(steps.find((s) => s.half === 'sherehe')!.passed).toBe(true);
  });
});

describe('when everything is up', () => {
  it('passes every step: one live read from Sherehe, then Endpoints 1, 5 and 6 on Kazi Connect', async () => {
    const { steps, cannotRun } = await runRingCheck(settings(), live);

    expect(cannotRun).toBeNull();
    expect(failed(steps)).toEqual([]);
    expect(steps.map((s) => s.name)).toEqual(expect.arrayContaining([
      expect.stringMatching(/Sherehe \(K1/),
      expect.stringMatching(/Endpoint 1/),
      expect.stringMatching(/Endpoint 5/),
      expect.stringMatching(/WebSocket, the status on connect/),
      expect.stringMatching(/final "cancelled" message/),
    ]));
  });

  it('reads from Sherehe once, with the key, and changes nothing there', async () => {
    await runRingCheck(settings(), live);

    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]).toMatchObject({ method: 'GET', path: '/api/events', key: stub.apiKey });
    expect(stub.offers).toEqual([]);
  });

  it('leaves no application behind on the live site: the one it makes is cancelled again', async () => {
    const before = await db.countApplications();

    await runRingCheck(settings(), live);

    expect(await db.countApplications()).toBe(before);
  });

  it('with --read-only makes nothing, and checks an application that already exists', async () => {
    const before = await db.countApplications();

    const { steps } = await runRingCheck(settings(), { readOnly: true, applicationId: 'app_1001' });

    expect(failed(steps)).toEqual([]);
    expect(steps.some((s) => /final "cancelled"/.test(s.name))).toBe(false);
    expect(await db.countApplications()).toBe(before);
    expect((await db.findApplicationById('app_1001'))!.application_status).toBe('pending');
  });

  it('with --read-only and no application given, says what is missing', async () => {
    const { steps } = await runRingCheck(settings(), { readOnly: true, applicationId: '' });

    expect(failed(steps)).toContain('[kazi] Endpoints 5 and 6');
  });
});

describe('when something is wrong', () => {
  it('fails only the Sherehe half when Sherehe is down; Kazi Connect is still checked', async () => {
    stub.setMode('drop');

    const { steps } = await runRingCheck(settings(), live);

    expect(failed(steps)).toEqual([expect.stringMatching(/^\[sherehe\]/)]);
    expect(steps.filter((s) => s.half === 'kazi').every((s) => s.passed)).toBe(true);
  });

  it('fails the Sherehe half with a hint when Sherehe refuses the key', async () => {
    const { steps } = await runRingCheck(settings({ shereheKey: 'a-key-sherehe-never-issued' }), live);

    const sherehe = steps.find((s) => s.half === 'sherehe')!;
    expect(sherehe.passed).toBe(false);
    expect(sherehe.detail).toMatch(/answered 401.*key/);
  });

  it('fails the Sherehe half when the endpoint is not built yet (404)', async () => {
    const url = await serve((_req, res) => { res.writeHead(404); res.end(); });

    const sherehe = (await runRingCheck(settings({ shereheUrl: url }), live)).steps.find((s) => s.half === 'sherehe')!;

    expect(sherehe.passed).toBe(false);
    expect(sherehe.detail).toMatch(/answered 404.*not built/);
  });

  it('fails the Sherehe half when the reply does not match Sherehe\'s contract', async () => {
    stub.setMode('wrongShape');

    const sherehe = (await runRingCheck(settings(), live)).steps.find((s) => s.half === 'sherehe')!;

    expect(sherehe.passed).toBe(false);
    expect(sherehe.detail).toMatch(/does not match Sherehe's contract/);
  });

  it('fails the Sherehe half for one event missing a field the contract requires', async () => {
    const url = await serve((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify([{ id: 'evt_1', name: 'Gala' }])); });

    const sherehe = (await runRingCheck(settings({ shereheUrl: url }), live)).steps.find((s) => s.half === 'sherehe')!;

    expect(sherehe.passed).toBe(false);
    expect(sherehe.detail).toMatch(/is missing/);
  });

  it('fails the Kazi half, and leaves Sherehe\'s step passing, when the live site is broken', async () => {
    const broken = await serve((_req, res) => { res.writeHead(500); res.end(); });

    const { steps } = await runRingCheck(settings({ kaziUrl: broken }), live);

    expect(steps.find((s) => s.half === 'sherehe')!.passed).toBe(true);
    expect(failed(steps).some((f) => /^\[kazi\]/.test(f))).toBe(true);
  });

  it('fails the Kazi half when the live site cannot be reached', async () => {
    const { steps } = await runRingCheck(settings({ kaziUrl: 'http://127.0.0.1:9' }), live);

    expect(steps.find((s) => s.half === 'kazi')!.passed).toBe(false);
  });
});

describe('when a part is not set up yet', () => {
  it.each([
    ['Sherehe\'s address is a TODO placeholder', { shereheUrl: 'https://sherehe-TODO.onrender.com' }, /SHEREHE_API_URL/],
    ['Sherehe\'s address is empty', { shereheUrl: '' }, /SHEREHE_API_URL/],
    ['there is no key', { shereheKey: '' }, /SHEREHE_API_KEY/],
  ])('cannot run, and says so without calling anything, when %s', async (_name, over, expected) => {
    const { steps, cannotRun } = await runRingCheck(settings(over), live);

    expect(steps).toEqual([]);
    expect(cannotRun).toMatch(expected);
    expect(cannotRun).toMatch(/not a failure/);
    expect(stub.requests).toHaveLength(0);
  });
});
