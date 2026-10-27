// npm run ring:status tells a part that is not built yet from a part that is built wrong. These tests
// stand up systems in each condition (the Sherehe stand-in behaving, misbehaving or missing, small
// servers that 404 everything or claim no Render service, the real Kazi Connect app) and check the
// verdict given for each.

import http from 'http';
import type { AddressInfo } from 'net';
import { createServer } from '../app';
import * as db from '../db';
import { createShereheStub } from '../helpers/shereheStub';
import type { ShereheStub } from '../helpers/shereheStub';
import { fingerprint, formatReport, runStatus } from '../scripts/ringStatus';
import type { Report, Settings, SystemReport, Verdict } from '../scripts/ringStatus';

let stub: ShereheStub;
let kazi: http.Server;
let kaziUrl = '';
const small: http.Server[] = [];

// A tiny server that answers every request with one canned reply.
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
beforeEach(() => { stub.reset(); });

const settings = (over: Partial<Settings> = {}): Settings => ({
  kaziUrl, kaziKey: '', shereheUrl: stub.url, shereheKey: stub.apiKey, ujuziUrl: '', write: false, timeoutMs: 3000, ...over,
});
const sherehe = async (over: Partial<Settings> = {}): Promise<SystemReport> => (await runStatus(settings(over))).systems.find((s) => s.system === 'sherehe')!;
const verdicts = (r: SystemReport): Verdict[] => r.checks.map((c) => c.verdict);
const verdictOf = (r: SystemReport, name: RegExp): Verdict => r.checks.find((c) => name.test(c.name))!.verdict;

describe('Sherehe', () => {
  it('is conforming when it answers as its contract says', async () => {
    const r = await sherehe();

    expect(r.state).toBe('conforming');
    expect(verdictOf(r, /asks for a key/)).toBe('ok');
    expect(verdictOf(r, /K1 upcoming/)).toBe('ok');
    expect(verdictOf(r, /K1 county/)).toBe('ok');
    expect(verdictOf(r, /K2/)).toBe('ok');
    expect(verdictOf(r, /K4/)).toBe('ok');
  });

  it('only makes and withdraws an offer when asked to (--write), and leaves nothing behind', async () => {
    const reads = await sherehe();
    expect(verdictOf(reads, /K3 and K5/)).toBe('skipped');
    expect(stub.requests.some((q) => q.method === 'POST')).toBe(false);

    const writes = await sherehe({ write: true });

    expect(verdictOf(writes, /K3 make/)).toBe('ok');
    expect(verdictOf(writes, /K5 withdraw/)).toBe('ok');
    expect(writes.state).toBe('conforming');
    expect(stub.offers).toEqual([]);
  });

  it('is "not-configured" while its address is still a TODO placeholder, and calls nothing', async () => {
    const r = await sherehe({ shereheUrl: 'https://sherehe-TODO.onrender.com' });

    expect(r.state).toBe('not-configured');
    expect(verdicts(r)).toEqual(['not-configured']);
    expect(stub.requests).toHaveLength(0);
  });

  it('is "not-configured" when no address is given at all', async () => {
    expect((await sherehe({ shereheUrl: '' })).state).toBe('not-configured');
  });

  it('is "unreachable" when nothing is there', async () => {
    const r = await sherehe({ shereheUrl: 'http://127.0.0.1:9' });

    expect(r.state).toBe('unreachable');
    expect(verdicts(r)).toEqual(['unreachable']);
  });

  it('is "unreachable" when the connection is dropped', async () => {
    stub.setMode('drop');

    expect((await sherehe()).state).toBe('unreachable');
  });

  it('is "no-service-deployed" when Render says no service lives at the address', async () => {
    const url = await serve((_req, res) => { res.writeHead(404, { 'x-render-routing': 'no-server' }); res.end('Not Found'); });

    const r = await sherehe({ shereheUrl: url });

    expect(r.state).toBe('no-service-deployed');
    expect(r.summary).toMatch(/not deployed/);
  });

  it('is "waking" while a Render service is still starting', async () => {
    const url = await serve((_req, res) => { res.writeHead(503, { 'x-render-routing': 'hibernate-wake-error' }); res.end(); });

    expect((await sherehe({ shereheUrl: url })).state).toBe('waking');
  });

  it('calls a half-built Sherehe "partial": every endpoint its contract names answers 404, so HOLD them', async () => {
    const url = await serve((_req, res) => { res.writeHead(404); res.end(); });

    const r = await sherehe({ shereheUrl: url });

    expect(r.state).toBe('partial');
    expect(verdictOf(r, /asks for a key/)).toBe('not-built');
    expect(verdictOf(r, /K1 upcoming/)).toBe('not-built');
    expect(verdictOf(r, /K4/)).toBe('not-built');
    expect(verdicts(r)).not.toContain('genuine-error');
    expect(verdicts(r)).not.toContain('drift');
    expect(r.summary).toMatch(/not built yet/);
  });

  it('calls a Sherehe that has some endpoints "partial" too, and says which are missing', async () => {
    const url = await serve((req, res) => {
      // only the events list is built; everything else is a plain 404
      if (req.url && req.url.startsWith('/api/events?') && req.headers['x-api-key'] === stub.apiKey) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      } else if (req.url && req.url.startsWith('/api/events?')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end('{"message":"Send your partner key as X-API-Key"}');
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    const r = await sherehe({ shereheUrl: url });

    expect(r.state).toBe('partial');
    expect(verdictOf(r, /K1 upcoming/)).toBe('ok');
    expect(verdictOf(r, /K4/)).toBe('not-built');
    expect(verdictOf(r, /K2/)).toBe('skipped'); // no events to look up roles for
  });

  it('says "key-problem" when it refuses our key', async () => {
    const r = await sherehe({ shereheKey: 'a-key-sherehe-never-issued' });

    expect(r.state).toBe('partial');
    expect(verdictOf(r, /K1 upcoming/)).toBe('key-problem');
  });

  it('says "genuine-error" when it falls over with a 5xx, and calls the system broken', async () => {
    stub.setMode('error');

    const r = await sherehe();

    expect(verdicts(r)).toContain('genuine-error');
    expect(r.state).toBe('broken');
  });

  it('says "drift" when it answers 200 but not in the shape its contract gives', async () => {
    stub.setMode('wrongShape');

    const r = await sherehe();

    expect(verdictOf(r, /K1 upcoming/)).toBe('drift');
    expect(r.state).toBe('broken');
  });

  it('says "drift" for a reply that is missing a field the contract requires', async () => {
    const url = await serve((req, res) => {
      if (req.headers['x-api-key'] !== stub.apiKey) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"message":"no key"}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([{ id: 'evt_1', name: 'No county or dates' }]));
    });

    const r = await sherehe({ shereheUrl: url });

    const k1 = r.checks.find((c) => /K1 upcoming/.test(c.name))!;
    expect(k1.verdict).toBe('drift');
    expect(k1.note).toMatch(/is missing/);
  });

  it('notices when the contract they publish is a different version from the copy we built from', async () => {
    const url = await serve((req, res) => {
      if (req.url === '/openapi.yaml') { res.writeHead(200, { 'Content-Type': 'application/yaml' }); res.end('openapi: 3.0.3\ninfo: { title: Sherehe API, version: 1.0.0 }\npaths:\n  /api/events: { get: { responses: { "200": { description: ok } } } }\n  /api/events/{eventId}/roles: { get: { responses: { "200": { description: ok } } } }\n  /api/offers: { post: { responses: { "201": { description: ok } } } }\n  /api/offers/{offerId}: { get: { responses: { "200": { description: ok } } }, delete: { responses: { "204": { description: ok } } } }\n  /api/events/{eventId}: { get: { responses: { "200": { description: ok } } } }\n'); return; }
      res.writeHead(404); res.end();
    });

    const r = await sherehe({ shereheUrl: url });

    const contract = r.checks.find((c) => c.name === 'contract')!;
    expect(contract.verdict).toBe('drift');
    expect(contract.note).toMatch(/version 1\.0\.0.*0\.1\.0/);
  });

  it('notices when the contract they publish no longer has an endpoint we call', async () => {
    const url = await serve((req, res) => {
      if (req.url === '/openapi.yaml') { res.writeHead(200); res.end('openapi: 3.0.3\ninfo: { title: Sherehe API, version: 0.1.0 }\npaths:\n  /api/events: { get: { responses: { "200": { description: ok } } } }\n'); return; }
      res.writeHead(404); res.end();
    });

    const contract = (await sherehe({ shereheUrl: url })).checks.find((c) => c.name === 'contract')!;

    expect(contract.verdict).toBe('drift');
    expect(contract.note).toMatch(/no longer has/);
  });

  it('never asks for more than reads unless --write is given', async () => {
    await sherehe();

    expect(stub.requests.every((q) => q.method === 'GET')).toBe(true);
  });
});

describe('Kazi Connect (live)', () => {
  const kaziReport = async (over: Partial<Settings> = {}): Promise<SystemReport> => (await runStatus(settings(over))).systems.find((s) => s.system === 'kazi')!;

  describe('once Kazi Connect asks for an API key', () => {
    const KEY = 'ring-status-test-key-0123456789abcdef';
    beforeEach(() => { process.env.API_KEYS = `team:${KEY}`; });
    afterEach(() => { delete process.env.API_KEYS; });

    it('is a key problem (a hold, not a fault) when no key is given, and says which setting to use', async () => {
      const r = await kaziReport();
      const endpoint1 = r.checks.find((c) => /Endpoint 1$/.test(c.name))!;

      expect(endpoint1.verdict).toBe('key-problem');
      expect(endpoint1.note).toMatch(/KAZI_API_KEY/);
      expect(r.checks.some((c) => /Endpoint 22/.test(c.name))).toBe(false); // a 401 there would only be the key check again
    });

    it('is a key problem too when the key it sends is not accepted', async () => {
      const r = await kaziReport({ kaziKey: 'a-key-that-is-not-in-api-keys' });

      expect(verdictOf(r, /Endpoint 1$/)).toBe('key-problem');
      expect(r.checks.find((c) => /Endpoint 1$/.test(c.name))!.note).toMatch(/not one of/);
    });

    it('is current and fine when the right key is sent', async () => {
      const r = await kaziReport({ kaziKey: KEY });

      expect(r.state).toBe('current');
      expect(verdictOf(r, /Endpoint 1$/)).toBe('ok');
      expect(verdictOf(r, /Endpoint 22/)).toBe('ok');
    });
  });

  it('is "current" when the live site is on the same contract version as this checkout', async () => {
    const r = await kaziReport();

    expect(r.state).toBe('current');
    expect(verdictOf(r, /live contract/)).toBe('ok');
    expect(verdictOf(r, /Endpoint 1$/)).toBe('ok');
    expect(verdictOf(r, /Endpoint 22/)).toBe('ok');
  });

  it('is "older-contract" and says "pending-deploy" when the live site is still on 1.2.1 (uat not merged yet)', async () => {
    const url = await serve((req, res) => {
      if (req.url === '/openapi.yaml') { res.writeHead(200); res.end('openapi: 3.0.0\ninfo: { title: Kazi Connect API, version: 1.2.1 }\npaths: {}\n'); return; }
      if (req.url && req.url.startsWith('/api/jobs')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('[]'); return; }
      res.writeHead(404); res.end();
    });

    const r = await kaziReport({ kaziUrl: url });

    expect(r.state).toBe('older-contract');
    expect(verdictOf(r, /live contract/)).toBe('pending-deploy');
    expect(verdictOf(r, /Endpoint 22/)).toBe('pending-deploy');
    expect(r.summary).toMatch(/merge uat into main/);
  });

  it('is "unreachable" when the live site does not answer', async () => {
    expect((await kaziReport({ kaziUrl: 'http://127.0.0.1:9' })).state).toBe('unreachable');
  });

  it('is "broken" when the live site answers Endpoint 1 with a 500', async () => {
    const url = await serve((req, res) => {
      if (req.url === '/openapi.yaml') { res.writeHead(200); res.end('openapi: 3.0.0\ninfo: { title: Kazi Connect API, version: 1.3.0 }\npaths: {}\n'); return; }
      res.writeHead(500); res.end();
    });

    const r = await kaziReport({ kaziUrl: url });

    expect(verdictOf(r, /Endpoint 1$/)).toBe('genuine-error');
    expect(r.state).toBe('broken');
  });
});

describe('Ujuzi', () => {
  const ujuzi = async (over: Partial<Settings> = {}): Promise<SystemReport> => (await runStatus(settings(over))).systems.find((s) => s.system === 'ujuzi')!;

  it('is "not-configured" while its address is a placeholder', async () => {
    expect((await ujuzi({ ujuziUrl: 'https://ujuzi-TODO.onrender.com' })).state).toBe('not-configured');
  });

  it('is "up" once it is reachable and publishes its contract, and flags what only a person can confirm', async () => {
    const url = await serve((req, res) => {
      if (req.url === '/openapi.yaml') { res.writeHead(200); res.end('openapi: 3.0.0\ninfo: { title: Ujuzi API, version: 1.0.0 }\npaths: {}\n'); return; }
      res.writeHead(404); res.end();
    });

    const r = await ujuzi({ ujuziUrl: url });

    expect(r.state).toBe('up');
    expect(verdictOf(r, /reachable/)).toBe('ok');
    expect(verdictOf(r, /re-run its tests/)).toBe('manual');
  });

  it('is "partial" when it answers but does not publish a contract yet', async () => {
    const url = await serve((_req, res) => { res.writeHead(404); res.end(); });

    const r = await ujuzi({ ujuziUrl: url });

    expect(r.state).toBe('partial');
    expect(verdictOf(r, /reachable/)).toBe('not-built');
  });

  it('is "no-service-deployed" when Render has no service at the address', async () => {
    const url = await serve((_req, res) => { res.writeHead(404, { 'x-render-routing': 'no-server' }); res.end(); });

    expect((await ujuzi({ ujuziUrl: url })).state).toBe('no-service-deployed');
  });
});

describe('the whole ring', () => {
  it('is not ready while any part is missing, and says so', async () => {
    const report = await runStatus(settings({ ujuziUrl: '' }));

    expect(report.ready).toBe(false);
    expect(formatReport(report)).toMatch(/NOT READY/);
  });

  it('is ready only when Kazi is current, Sherehe conforms and Ujuzi is up', async () => {
    const ujuziUrl = await serve((req, res) => {
      if (req.url === '/openapi.yaml') { res.writeHead(200); res.end('openapi: 3.0.0\ninfo: { title: Ujuzi API, version: 1.0.0 }\npaths: {}\n'); return; }
      res.writeHead(404); res.end();
    });

    const report = await runStatus(settings({ ujuziUrl }));

    expect(report.systems.map((s) => `${s.system}=${s.state}`)).toEqual(['kazi=current', 'sherehe=conforming', 'ujuzi=up']);
    expect(report.ready).toBe(true);
    expect(formatReport(report)).toMatch(/^READY|\nREADY/);
  });

  it('is not ready if any one of the three is wrong', async () => {
    const ujuziUrl = await serve((req, res) => {
      if (req.url === '/openapi.yaml') { res.writeHead(200); res.end('openapi: 3.0.0\ninfo: { title: Ujuzi API, version: 1.0.0 }\npaths: {}\n'); return; }
      res.writeHead(404); res.end();
    });
    stub.setMode('error');

    expect((await runStatus(settings({ ujuziUrl }))).ready).toBe(false);
  });

  it('gives the same fingerprint twice while nothing changes, and a different one when a system changes state', async () => {
    const first: Report = await runStatus(settings());
    const second: Report = await runStatus(settings());
    stub.setMode('drop');
    const third: Report = await runStatus(settings());

    expect(fingerprint(second)).toBe(fingerprint(first));
    expect(fingerprint(third)).not.toBe(fingerprint(first));
  });

  it('prints every verdict with its note', async () => {
    const text = formatReport(await runStatus(settings({ shereheUrl: 'https://sherehe-TODO.onrender.com' })));

    expect(text).toMatch(/Sherehe \(upstream\): NOT-CONFIGURED/);
    expect(text).toMatch(/placeholder/);
    expect(text).toMatch(/Kazi Connect \(live\): CURRENT/);
  });
});
