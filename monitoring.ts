// Monitoring: one line of JSON for every /api request, and running totals that GET /api/stats reports.
//
// monitor() is called by createServer() before anything else happens to a request, so a call that is
// refused (401, 429) or answered 404 or 500 by something earlier than the handlers is logged and counted too.
// It writes when the response has been sent, so the status and the time are final.
//
// What a line holds: time, method, path, status, ms, caller. The path has no query string. The caller is
// "key-" and six characters of a hash of the API key when the key is valid, and "none" otherwise (a wrong
// or missing key is never written, not even in part). Never logged: keys, tokens, passwords, bodies, queries.
//
// The totals live in memory, so they start again from zero whenever the server restarts, and they describe this one server.
// The pages and files of the website are not API traffic and are neither logged nor counted.

import { createHash } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import * as fetcher from './clients/fetcher';
import { identify, readConfig } from './lib/apiKeys';
import { singleton } from './lib/singleton';

// Every path of the API, as a pattern. A request is counted under its pattern, so /api/jobs/job_1 and
// /api/jobs/job_2 are one row, GET /api/jobs/:jobId, and the list cannot grow with every id a caller invents.
// __tests__/monitoring.test.ts checks this list against openapi.yaml and the app/api folders.
export const API_PATHS = [
  '/api/jobs', '/api/jobs/:jobId', '/api/jobs/:jobId/status', '/api/jobs/:jobId/applications',
  '/api/applications', '/api/applications/:applicationId', '/api/applications/:applicationId/status', '/api/applications/:applicationId/subscribe',
  '/api/auth/register', '/api/auth/login', '/api/auth/logout', '/api/auth/password-resets', '/api/auth/password',
  '/api/me', '/api/me/jobs', '/api/me/applications', '/api/me/staffing-offers',
  '/api/event-openings', '/api/staffing-offers', '/api/staffing-offers/:offerId',
  '/api/stats',
];
export const NO_ROUTE = '(no route)';

const PATTERNS = API_PATHS.map((path) => ({ path, regex: new RegExp(`^${path.replace(/:[A-Za-z]+/g, '[^/]+')}/?$`, 'i') }));

// "GET /api/jobs/:jobId" for a request that reached a route of ours, or "GET (no route)" for one that did not.
export function routeLabel(method: string, path: string): string {
  const found = PATTERNS.find((pattern) => pattern.regex.test(path));
  return `${method.toUpperCase()} ${found ? found.path : NO_ROUTE}`;
}

interface RouteTotals { count: number; clientErrors: number; serverErrors: number; totalMs: number; maxMs: number }

const fresh = () => ({
  startedAt: new Date().toISOString(),
  total: 0,
  clientErrors: 0, // 4xx: usually the caller's mistake
  serverErrors: 0, // 5xx: ours
  totalMs: 0,
  routes: {} as Record<string, RouteTotals>,
});
const totals = singleton('monitoring', () => ({ current: fresh() }));

// For tests: start the totals again from zero.
export function resetStats(): void { totals.current = fresh(); }

const round = (n: number): number => Math.round(n * 10) / 10;

// A label for who called, without ever writing the key itself.
export function callerLabel(presented: string | string[] | undefined): string {
  const key = Array.isArray(presented) ? presented[0] : presented;
  if (!key) return 'none';
  if (!identify(key, readConfig())) return 'none'; // a wrong key is not written, not even in part
  return `key-${createHash('sha256').update(key).digest('hex').slice(0, 6)}`;
}

function record(label: string, status: number, ms: number): void {
  const t = totals.current;
  const route = t.routes[label] || { count: 0, clientErrors: 0, serverErrors: 0, totalMs: 0, maxMs: 0 };
  t.routes[label] = route;
  t.total += 1;
  t.totalMs += ms;
  route.count += 1;
  route.totalMs += ms;
  route.maxMs = Math.max(route.maxMs, ms);
  if (status >= 500) { t.serverErrors += 1; route.serverErrors += 1; }
  else if (status >= 400) { t.clientErrors += 1; route.clientErrors += 1; }
}

// Lines are written unless REQUEST_LOG=off. The automated tests stay quiet unless they ask (REQUEST_LOG=on).
function lineWanted(): boolean {
  const setting = (process.env.REQUEST_LOG || '').trim().toLowerCase();
  return setting ? setting !== 'off' : !process.env.JEST_WORKER_ID;
}

export function monitor(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url || '';
  const path = url.split(/[?#]/)[0];
  if (!/^\/api(\/|$)/i.test(path)) return;
  const start = process.hrtime.bigint();
  const method = (req.method || 'GET').toUpperCase();
  const caller = req.headers['x-api-key'];
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (lineWanted()) {
      console.log(JSON.stringify({ time: new Date().toISOString(), method, path: path.slice(0, 200), status: res.statusCode, ms: round(ms), caller: callerLabel(caller) }));
    }
    record(routeLabel(method, path), res.statusCode, ms);
  });
}

export interface Stats {
  startedAt: string;
  uptimeSeconds: number;
  total: number;
  clientErrors: number;
  serverErrors: number;
  errorRatePercent: number;
  avgMs: number;
  routes: Record<string, { count: number; clientErrors: number; serverErrors: number; avgMs: number; maxMs: number }>;
  sherehe: { retries: number; savedDataServed: number };
}

export function snapshot(): Stats {
  const t = totals.current;
  const routes: Stats['routes'] = {};
  for (const [label, r] of Object.entries(t.routes)) {
    routes[label] = { count: r.count, clientErrors: r.clientErrors, serverErrors: r.serverErrors, avgMs: round(r.totalMs / r.count), maxMs: round(r.maxMs) };
  }
  return {
    startedAt: t.startedAt,
    uptimeSeconds: Math.round(process.uptime()),
    total: t.total,
    clientErrors: t.clientErrors,
    serverErrors: t.serverErrors,
    errorRatePercent: round(t.total ? (t.serverErrors / t.total) * 100 : 0),
    avgMs: round(t.total ? t.totalMs / t.total : 0),
    routes,
    sherehe: fetcher.counters(),
  };
}
