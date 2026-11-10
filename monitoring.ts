// Week 12: monitoring. Logs say what happened (one JSON line per request); /api/stats says how much (running
// totals since the server started).
//
// monitor(req, res) is called FIRST for every request in app.ts, before the API key check and the rate limit in
// proxy.ts, so the requests we most want to see (401 and 429) are logged too. When the response has been sent it
// writes one line:
//   {"time":"...","method":"GET","path":"/api/jobs","status":200,"ms":4.2,"caller":"key-3f9c1a"}
//   path    the path only: never the query string, which can carry emails, tokens or names
//   caller  "key-" + the first 6 hex characters of the SHA-256 of the X-API-Key sent, or "none". With API keys
//           switched on, a key that is not valid is "none" too. The key itself is never written anywhere.
// No header, no body and no login token is ever read here.
//
// Not logged: Next.js's own build files (/_next/...) and the browser's favicon request, which a single page view
// fetches by the dozen and would bury the requests that matter. The Endpoint 6 WebSocket is an upgrade, not a
// request with a response, so it is not in these numbers either.
//
// Honest limits: the totals live in this server's memory, so they reset on every restart (and a Render deploy is a
// restart), and they would be wrong across several copies of the server. Production would send them to a shared tool.

import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { identify, readConfig } from './lib/apiKeys';
import { singleton } from './lib/singleton';

const round = (n: number): number => Math.round(n * 10) / 10;

interface RouteTotals { count: number; clientErrors: number; serverErrors: number; totalMs: number; maxMs: number }
const newRoute = (): RouteTotals => ({ count: 0, clientErrors: 0, serverErrors: 0, totalMs: 0, maxMs: 0 });

const state = singleton('monitoring', () => ({
  startedAt: new Date().toISOString(),
  total: 0,
  clientErrors: 0, // 4xx: usually the caller's mistake
  serverErrors: 0, // 5xx: ours
  totalMs: 0,
  routes: {} as Record<string, RouteTotals>,
  partner: { retries: 0, failures: 0 }, // Sherehe: attempts tried again, and calls that failed in the end
  sink: null as ((line: string) => void) | null, // tests read the lines here instead of the console
}));

// Each path pattern is one row, so /api/jobs/job_1 and /api/jobs/job_2 are both GET /api/jobs/:jobId and the
// list cannot grow with every id anyone types. Anything else is "(no route)".
const ROUTES: Array<[RegExp, string]> = [
  [/^\/api\/(v1\/|v2\/)?jobs$/, ''],
  [/^\/api\/jobs\/[^/]+$/, '/api/jobs/:jobId'],
  [/^\/api\/jobs\/[^/]+\/status$/, '/api/jobs/:jobId/status'],
  [/^\/api\/jobs\/[^/]+\/applications$/, '/api/jobs/:jobId/applications'],
  [/^\/api\/applications$/, ''],
  [/^\/api\/applications\/[^/]+$/, '/api/applications/:applicationId'],
  [/^\/api\/applications\/[^/]+\/status$/, '/api/applications/:applicationId/status'],
  [/^\/api\/applications\/[^/]+\/subscribe$/, '/api/applications/:applicationId/subscribe'],
  [/^\/api\/auth\/(register|login|logout|password-resets|password)$/, ''],
  [/^\/api\/me(\/(jobs|applications|staffing-offers))?$/, ''],
  [/^\/api\/(event-openings|staffing-offers|stats)$/, ''],
  [/^\/api\/staffing-offers\/[^/]+$/, '/api/staffing-offers/:offerId'],
  [/^\/(|dashboard|applications|login|register|reset|docs|openapi\.yaml)$/, ''],
  [/^\/jobs\/[^/]+$/, '/jobs/:jobId'],
];

export function routeOf(path: string): string {
  for (const [pattern, label] of ROUTES) {
    if (!pattern.test(path)) continue;
    if (label === '') return path; // the path is already the pattern
    return label;
  }
  return '(no route)';
}

// The path with no query string and no fragment.
export const pathOnly = (url: string | undefined): string => (url || '/').split(/[?#]/)[0] || '/';

export function who(req: IncomingMessage): string {
  const sent = req.headers['x-api-key'];
  const key = Array.isArray(sent) ? sent[0] : sent;
  if (!key) return 'none';
  const config = readConfig();
  if (config.consumers.length > 0 && !identify(key, config)) return 'none'; // keys are on and this one is not valid
  return 'key-' + createHash('sha256').update(key).digest('hex').slice(0, 6);
}

const skipped = (path: string): boolean => path.startsWith('/_next/') || path === '/favicon.ico';

function write(line: string): void {
  if (state.sink) { state.sink(line); return; }
  if (!process.env.JEST_WORKER_ID) console.log(line);
}

export function monitor(req: IncomingMessage, res: ServerResponse): void {
  const start = process.hrtime.bigint();
  const caller = who(req);
  res.on('finish', () => { // after the response has gone out, so the status and the time are final
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const path = pathOnly(req.url); // read now: app.ts may have tidied the path's letter case
    if (skipped(path)) return;
    const method = req.method || 'GET';
    write(JSON.stringify({ time: new Date().toISOString(), method, path, status: res.statusCode, ms: round(ms), caller }));

    const label = `${method} ${routeOf(path)}`;
    const r = state.routes[label] || newRoute();
    state.routes[label] = r;
    state.total += 1;
    state.totalMs += ms;
    r.count += 1;
    r.totalMs += ms;
    r.maxMs = Math.max(r.maxMs, ms);
    if (res.statusCode >= 500) { state.serverErrors += 1; r.serverErrors += 1; }
    else if (res.statusCode >= 400) { state.clientErrors += 1; r.clientErrors += 1; }
  });
}

// Called by the partner code: a retry (Week 11), or a Sherehe call that failed after every attempt.
export function countPartner(what: 'retry' | 'failure'): void {
  if (what === 'retry') state.partner.retries += 1;
  else state.partner.failures += 1;
}

export interface StatsReport {
  startedAt: string;
  uptimeSeconds: number;
  total: number;
  clientErrors: number;
  serverErrors: number;
  errorRatePercent: number;
  avgMs: number;
  routes: Record<string, { count: number; clientErrors: number; serverErrors: number; avgMs: number; maxMs: number }>;
  partner: { name: string; retries: number; failures: number; savedListServed: number };
}

// What /api/stats answers. savedListServed comes from lib/savedOpenings (passed in, to keep this file free of it).
export function stats(savedListServed = 0): StatsReport {
  const routes: StatsReport['routes'] = {};
  for (const label of Object.keys(state.routes).sort()) {
    const r = state.routes[label];
    routes[label] = { count: r.count, clientErrors: r.clientErrors, serverErrors: r.serverErrors, avgMs: round(r.totalMs / r.count), maxMs: round(r.maxMs) };
  }
  return {
    startedAt: state.startedAt,
    uptimeSeconds: Math.round(process.uptime()),
    total: state.total,
    clientErrors: state.clientErrors,
    serverErrors: state.serverErrors,
    errorRatePercent: round(state.total ? (state.serverErrors / state.total) * 100 : 0), // 5xx only: our own failures
    avgMs: round(state.total ? state.totalMs / state.total : 0),
    routes,
    partner: { name: 'Sherehe', retries: state.partner.retries, failures: state.partner.failures, savedListServed },
  };
}

// For tests: start counting again, and send the log lines somewhere a test can read them (null: the console).
export function resetStats(): void {
  Object.assign(state, { startedAt: new Date().toISOString(), total: 0, clientErrors: 0, serverErrors: 0, totalMs: 0, routes: {}, partner: { retries: 0, failures: 0 } });
}
export function setLogSink(sink: ((line: string) => void) | null): void { state.sink = sink; }
