// npm run ring:status: where does each system in the ring stand, and is an error a genuine fault or just
// a part that has not been built yet?
//
// The ring is Sherehe (events) -> Kazi Connect (casual jobs) -> Ujuzi (skills) -> Sherehe. While the three
// teams are still building, calls between the systems fail for two very different reasons: a part is
// not there yet, or a part is there and wrong. This tool probes all three over HTTP and gives each check
// a verdict that says which:
//
//   ok             the reply is what the contract promises
//   not-built      the contract names this path but the system answers 404, 405 or 501: not built yet. HOLD it.
//   key-problem    the system refuses our API key (401 or 403 with a key sent): not issued or not accepted yet
//   genuine-error  the system answered 5xx: it is there and it fell over. Worth fixing.
//   drift          it answered, but not as its contract says (wrong status, wrong shape, or the contract changed)
//   pending-deploy Kazi Connect's live site is on an older contract than this checkout: merge uat to main
//   unreachable    no answer: no such address, refused, timed out, or Render says there is no such service
//   not-configured no address given yet (or still a TODO placeholder)
//   manual         cannot be seen from outside; a person has to confirm it
//   skipped        not run
//
// It only reads, unless --write is given (then it also makes one Sherehe offer and withdraws it again).
//
//   npm run ring:status                       one report
//   npm run ring:status -- --json             the same as JSON
//   npm run ring:status -- --watch            repeat every 10 minutes, print only when something changes
//   npm run ring:status -- --watch --until-ready   ...and stop (exit 0) when all three are ready
//
// Settings come from the environment or .env: KAZI_URL (defaults to the live Render site), SHEREHE_URL
// (or SHEREHE_API_URL), SHEREHE_API_KEY, UJUZI_URL.

import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { readDotEnv } from './lib/dotenv';
import { createChecker } from './lib/schemaCheck';
import type { ContractDoc, Json } from './lib/schemaCheck';

export type Verdict =
  | 'ok' | 'not-built' | 'key-problem' | 'genuine-error' | 'drift' | 'pending-deploy'
  | 'unreachable' | 'not-configured' | 'manual' | 'skipped';

export type SystemState =
  | 'not-configured' | 'unreachable' | 'no-service-deployed' | 'waking'
  | 'partial' | 'broken' | 'conforming' | 'up' | 'older-contract' | 'current';

export interface Check {
  system: 'kazi' | 'sherehe' | 'ujuzi';
  name: string;
  request: string;
  verdict: Verdict;
  status: number | null;
  note: string;
}

export interface SystemReport {
  system: 'kazi' | 'sherehe' | 'ujuzi';
  url: string;
  state: SystemState;
  summary: string;
  checks: Check[];
}

export interface Report {
  at: string;
  ready: boolean;
  systems: SystemReport[];
}

export interface Settings {
  kaziUrl: string;
  shereheUrl: string;
  shereheKey: string;
  ujuziUrl: string;
  write: boolean;
  timeoutMs: number;
}

const ROOT = path.join(__dirname, '..');
const KAZI_LIVE = 'https://kaziconnect1-1xmu.onrender.com';
const PLACEHOLDER = /todo|<[^>]*>|example\.(com|org|net)|your-|changeme/i;

// What one HTTP probe found.
type Probe =
  | { kind: 'response'; status: number; headers: Headers; text: string; ms: number }
  | { kind: 'no-answer'; why: 'dns' | 'refused' | 'timeout' | 'network'; detail: string };

async function probe(url: string, { headers = {}, method = 'GET', body, timeoutMs }: { headers?: Record<string, string>; method?: string; body?: unknown; timeoutMs: number }): Promise<Probe> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { kind: 'response', status: res.status, headers: res.headers, text: await res.text(), ms: Date.now() - started };
  } catch (err) {
    const name = typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : '';
    if (name === 'TimeoutError' || name === 'AbortError') return { kind: 'no-answer', why: 'timeout', detail: `no answer within ${Math.round(timeoutMs / 1000)} seconds` };
    const cause = typeof err === 'object' && err !== null && 'cause' in err ? (err as { cause: unknown }).cause : undefined;
    const code = typeof cause === 'object' && cause !== null && 'code' in cause ? String((cause as { code: unknown }).code) : '';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { kind: 'no-answer', why: 'dns', detail: 'no such address (the name does not exist yet)' };
    if (code === 'ECONNREFUSED') return { kind: 'no-answer', why: 'refused', detail: 'connection refused (nothing is listening)' };
    return { kind: 'no-answer', why: 'network', detail: code || 'network error' };
  }
}

// Render answers 404 with this header when no service lives at the address at all.
const renderHasNoService = (headers: Headers): boolean => (headers.get('x-render-routing') || '').toLowerCase() === 'no-server';

function parseJson(text: string): Json {
  try { return JSON.parse(text); } catch { return undefined; }
}

function contractSummary(text: string): { version: string; title: string; operations: Set<string> } | null {
  try {
    const doc = YAML.parse(text) as ContractDoc | null;
    if (!doc || typeof doc !== 'object' || !doc.paths) return null;
    const operations = new Set<string>();
    for (const [route, item] of Object.entries(doc.paths)) {
      for (const method of Object.keys(item)) {
        if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) operations.add(`${method.toUpperCase()} ${route}`);
      }
    }
    return { version: String(doc.info?.version ?? '?'), title: String(doc.info?.title ?? '?'), operations };
  } catch {
    return null;
  }
}

export const isPlaceholder = (url: string): boolean => url === '' || PLACEHOLDER.test(url);
const trimUrl = (url: string): string => url.trim().replace(/\/+$/, '');

// Turns "the system answered with this status" into a verdict, for a path its contract declares.
function statusVerdict(status: number, expected: number[], keyWasSent: boolean): { verdict: Verdict; note: string } | null {
  if (expected.includes(status)) return null;
  if (status === 404 || status === 405 || status === 501) return { verdict: 'not-built', note: `answered ${status}: the contract names this path, but it is not built yet` };
  if ((status === 401 || status === 403) && keyWasSent) return { verdict: 'key-problem', note: `answered ${status} although a key was sent: the key is not issued or not accepted yet` };
  if (status >= 500) return { verdict: 'genuine-error', note: `answered ${status}: the system is there and it failed` };
  return { verdict: 'drift', note: `answered ${status}, but the contract expects ${expected.join(' or ')}` };
}

function unreachableCheck(system: Check['system'], name: string, request: string, p: Extract<Probe, { kind: 'no-answer' }>): Check {
  return { system, name, request, verdict: 'unreachable', status: null, note: p.detail };
}

// ---- Sherehe

async function checkSherehe(settings: Settings): Promise<SystemReport> {
  const url = trimUrl(settings.shereheUrl);
  const base: SystemReport = { system: 'sherehe', url, state: 'not-configured', summary: '', checks: [] };
  if (isPlaceholder(url)) {
    return { ...base, summary: url ? 'the address is still a placeholder (TODO): Sherehe has not been deployed or has not shared its address' : 'no address given (set SHEREHE_URL)', checks: [{ system: 'sherehe', name: 'address', request: '-', verdict: 'not-configured', status: null, note: url || 'SHEREHE_URL is not set' }] };
  }

  const frozen = YAML.parse(fs.readFileSync(path.join(ROOT, 'partner-tests', 'sherehe_openapi.yaml'), 'utf8')) as ContractDoc;
  const checker = createChecker(frozen);
  const keyed = settings.shereheKey ? { 'X-API-Key': settings.shereheKey } : undefined;
  const checks: Check[] = [];
  const add = (c: Omit<Check, 'system'>): Check => { const full = { system: 'sherehe' as const, ...c }; checks.push(full); return full; };
  const timeoutMs = settings.timeoutMs;

  // Is anything there at all?
  const contractProbe = await probe(`${url}/openapi.yaml`, { timeoutMs });
  if (contractProbe.kind === 'no-answer') {
    add(unreachableCheck('sherehe', 'reachable', `GET ${url}/openapi.yaml`, contractProbe));
    return { ...base, state: 'unreachable', summary: contractProbe.detail, checks };
  }
  if (contractProbe.status === 404 && renderHasNoService(contractProbe.headers)) {
    add({ name: 'reachable', request: `GET ${url}/openapi.yaml`, verdict: 'unreachable', status: 404, note: 'Render says there is no service at this address' });
    return { ...base, state: 'no-service-deployed', summary: 'Render answers that no service lives at this address: Sherehe is not deployed there (yet)', checks };
  }
  if ([502, 503, 504].includes(contractProbe.status) && contractProbe.headers.has('x-render-routing')) {
    add({ name: 'reachable', request: `GET ${url}/openapi.yaml`, verdict: 'unreachable', status: contractProbe.status, note: 'the Render service is starting or down (a free service can take about a minute to wake)' });
    return { ...base, state: 'waking', summary: 'the service exists but is not answering yet; try again in a minute', checks };
  }

  // Its published contract against the copy we built from.
  if (contractProbe.status === 200) {
    const theirs = contractSummary(contractProbe.text);
    const ours = contractSummary(fs.readFileSync(path.join(ROOT, 'partner-tests', 'sherehe_openapi.yaml'), 'utf8'));
    if (!theirs || !ours) {
      add({ name: 'contract', request: 'GET /openapi.yaml', verdict: 'drift', status: 200, note: 'it answered, but not with an OpenAPI file' });
    } else {
      const consumed = ['GET /api/events', 'GET /api/events/{eventId}', 'GET /api/events/{eventId}/roles', 'POST /api/offers', 'GET /api/offers/{offerId}', 'DELETE /api/offers/{offerId}'];
      const missing = consumed.filter((op) => !theirs.operations.has(op));
      const added = [...theirs.operations].filter((op) => !ours.operations.has(op));
      if (missing.length) add({ name: 'contract', request: 'GET /openapi.yaml', verdict: 'drift', status: 200, note: `their published contract (version ${theirs.version}) no longer has: ${missing.join(', ')}` });
      else if (theirs.version !== ours.version) add({ name: 'contract', request: 'GET /openapi.yaml', verdict: 'drift', status: 200, note: `their contract is version ${theirs.version}; ours was built from ${ours.version}. Compare them, refresh partner-tests/sherehe_openapi.yaml and run npm run types${added.length ? ` (new: ${added.join(', ')})` : ''}` });
      else add({ name: 'contract', request: 'GET /openapi.yaml', verdict: 'ok', status: 200, note: `version ${theirs.version}, same as the copy we built from` });
    }
  } else {
    add({ name: 'contract', request: 'GET /openapi.yaml', verdict: 'skipped', status: contractProbe.status, note: 'their contract is not published at /openapi.yaml (not required)' });
  }

  // Does it ask for a key?
  const noKey = await probe(`${url}/api/events?status=upcoming`, { timeoutMs });
  if (noKey.kind === 'no-answer') {
    add(unreachableCheck('sherehe', 'asks for a key', 'GET /api/events?status=upcoming (no key)', noKey));
  } else if (noKey.status === 401) {
    add({ name: 'asks for a key', request: 'GET /api/events?status=upcoming (no key)', verdict: 'ok', status: 401, note: 'refuses a request without a key, as its contract says' });
  } else {
    const v = statusVerdict(noKey.status, [401], false);
    add({ name: 'asks for a key', request: 'GET /api/events?status=upcoming (no key)', verdict: v ? v.verdict : 'ok', status: noKey.status, note: v ? v.note : 'ok' });
  }

  if (!keyed) {
    add({ name: 'reads (K1, K2, K4)', request: '-', verdict: 'not-configured', status: null, note: 'SHEREHE_API_KEY is not set, so the endpoints that need the key cannot be checked' });
    return finishSherehe(base, url, checks);
  }

  // A read with the key, checked field by field against the contract.
  const readChecked = async (name: string, request: string, urlPath: string, expectStatus: number, schemaPath: string, after?: (body: Json) => string | null): Promise<Json> => {
    const p = await probe(`${url}${urlPath}`, { headers: keyed, timeoutMs });
    if (p.kind === 'no-answer') { add(unreachableCheck('sherehe', name, request, p)); return undefined; }
    const bad = statusVerdict(p.status, [expectStatus], true);
    if (bad) { add({ name, request, verdict: bad.verdict, status: p.status, note: bad.note }); return undefined; }
    const body = parseJson(p.text);
    const problems: string[] = [];
    if (body === undefined) problems.push('the reply is not JSON');
    else checker.schemaCheck(body, checker.declaredResponse(schemaPath, 'GET', expectStatus)?.content?.['application/json']?.schema, 'reply', problems);
    const extra = problems.length ? null : after && after(body);
    if (problems.length || extra) add({ name, request, verdict: 'drift', status: p.status, note: (problems.slice(0, 3).join('; ') + (problems.length > 3 ? ` (and ${problems.length - 3} more)` : '')) || String(extra) });
    else add({ name, request, verdict: 'ok', status: p.status, note: Array.isArray(body) ? `${body.length} item(s), all matching the contract` : 'matches the contract' });
    return body;
  };

  const events = await readChecked('K1 upcoming events', 'GET /api/events?status=upcoming', '/api/events?status=upcoming', 200, '/api/events');
  if (Array.isArray(events) && events.length > 0) {
    const county = String(events[0].county);
    await readChecked('K1 county filter', `GET /api/events?status=upcoming&county=${county}`, `/api/events?status=upcoming&county=${encodeURIComponent(county)}`, 200, '/api/events',
      (list) => (Array.isArray(list) && list.length > 0 && list.every((e: Json) => String(e.county).toLowerCase() === county.toLowerCase()) ? null : `the county filter returned events outside ${county}`));
    await readChecked('K2 roles of an event', `GET /api/events/${events[0].id}/roles`, `/api/events/${encodeURIComponent(events[0].id)}/roles`, 200, '/api/events/{eventId}/roles');
  } else if (Array.isArray(events)) {
    add({ name: 'K2 roles of an event', request: '-', verdict: 'skipped', status: null, note: 'there are no upcoming events to look up roles for (ask Sherehe for sample data)' });
  }

  // K4 for an offer that cannot exist: a built service says 404 with an Error body.
  const missingOffer = await probe(`${url}/api/offers/ofr_999999`, { headers: keyed, timeoutMs });
  if (missingOffer.kind === 'no-answer') add(unreachableCheck('sherehe', 'K4 unknown offer', 'GET /api/offers/ofr_999999', missingOffer));
  else if (missingOffer.status === 404) {
    const body = parseJson(missingOffer.text);
    const hasMessage = body !== undefined && typeof body === 'object' && body !== null && typeof body.message === 'string';
    // A plain 404 with no { "message" } cannot be told from a route that does not exist, so it counts as not built.
    add({ name: 'K4 unknown offer', request: 'GET /api/offers/ofr_999999', verdict: hasMessage ? 'ok' : 'not-built', status: 404, note: hasMessage ? 'a missing offer is a 404 with a message' : 'a plain 404 with no { "message" }: most likely the route is not built yet' });
  } else {
    const v = statusVerdict(missingOffer.status, [404], true);
    add({ name: 'K4 unknown offer', request: 'GET /api/offers/ofr_999999', verdict: v ? v.verdict : 'ok', status: missingOffer.status, note: v ? v.note.replace('is not built yet', 'may not be built yet') : 'ok' });
  }

  if (settings.write) await writeCheck();
  else add({ name: 'K3 and K5 (make and withdraw an offer)', request: '-', verdict: 'skipped', status: null, note: 'only run with --write, because it makes one offer at Sherehe (and withdraws it again)' });
  return finishSherehe(base, url, checks);

  async function writeCheck(): Promise<void> {
    const events2 = Array.isArray(events) ? events : [];
    let roleId = '';
    for (const event of events2) {
      const p = await probe(`${url}/api/events/${encodeURIComponent(event.id)}/roles`, { headers: keyed, timeoutMs });
      if (p.kind !== 'response' || p.status !== 200) continue;
      const roles = parseJson(p.text);
      const open = Array.isArray(roles) ? roles.find((r: Json) => r.headcount - r.filled >= 1) : undefined;
      if (open) { roleId = open.id; break; }
    }
    if (!roleId) { add({ name: 'K3 and K5', request: '-', verdict: 'skipped', status: null, note: 'no role with a free slot was found to make a test offer on' }); return; }
    const made = await probe(`${url}/api/offers`, { method: 'POST', headers: keyed, body: { roleId, workersOffered: 1, note: 'Kazi Connect ring status check: please ignore' }, timeoutMs });
    if (made.kind === 'no-answer') { add(unreachableCheck('sherehe', 'K3 make an offer', 'POST /api/offers', made)); return; }
    const bad = statusVerdict(made.status, [201], true);
    if (bad) { add({ name: 'K3 make an offer', request: 'POST /api/offers', verdict: bad.verdict, status: made.status, note: bad.note }); return; }
    const offer = parseJson(made.text);
    const problems: string[] = [];
    checker.schemaCheck(offer, checker.declaredResponse('/api/offers', 'POST', 201)?.content?.['application/json']?.schema, 'reply', problems);
    add({ name: 'K3 make an offer', request: 'POST /api/offers', verdict: problems.length ? 'drift' : 'ok', status: 201, note: problems.length ? problems.slice(0, 3).join('; ') : 'an offer was made and matches the contract' });
    const id = offer && typeof offer.id === 'string' ? offer.id : '';
    if (!id) return;
    const gone = await probe(`${url}/api/offers/${encodeURIComponent(id)}`, { method: 'DELETE', headers: keyed, timeoutMs });
    if (gone.kind === 'no-answer') { add(unreachableCheck('sherehe', 'K5 withdraw it', `DELETE /api/offers/${id}`, gone)); return; }
    const badDelete = statusVerdict(gone.status, [204], true);
    add({ name: 'K5 withdraw it', request: `DELETE /api/offers/${id}`, verdict: badDelete ? badDelete.verdict : 'ok', status: gone.status, note: badDelete ? `${badDelete.note}. The test offer ${id} may still be at Sherehe: withdraw it by hand` : 'withdrawn' });
  }
}

function finishSherehe(base: SystemReport, url: string, checks: Check[]): SystemReport {
  const real = checks.filter((c) => !['skipped', 'manual', 'not-configured'].includes(c.verdict));
  const count = (v: Verdict): number => checks.filter((c) => c.verdict === v).length;
  let state: SystemState;
  let summary: string;
  if (real.length > 0 && real.every((c) => c.verdict === 'unreachable')) { state = 'unreachable'; summary = checks[0].note; }
  else if (count('genuine-error') > 0 || count('drift') > 0) { state = 'broken'; summary = `${count('genuine-error')} genuine error(s), ${count('drift')} that differ from the contract: worth fixing`; }
  else if (count('key-problem') > 0) { state = 'partial'; summary = 'it is up, but our API key is not accepted yet'; }
  else if (count('not-built') > 0) { state = 'partial'; summary = `${count('ok')} check(s) fine, ${count('not-built')} endpoint(s) not built yet: HOLD those`; }
  else if (checks.some((c) => c.verdict === 'not-configured')) { state = 'partial'; summary = 'reachable, but the API key is not set so the endpoints cannot be checked'; }
  else { state = 'conforming'; summary = `${count('ok')} check(s) fine`; }
  return { ...base, url, state, summary, checks };
}

// ---- Kazi Connect itself (its live site on Render)

async function checkKazi(settings: Settings): Promise<SystemReport> {
  const url = trimUrl(settings.kaziUrl);
  const base: SystemReport = { system: 'kazi', url, state: 'unreachable', summary: '', checks: [] };
  const checks: Check[] = [];
  const add = (c: Omit<Check, 'system'>): void => { checks.push({ system: 'kazi', ...c }); };
  const local = YAML.parse(fs.readFileSync(path.join(ROOT, 'openapi.yaml'), 'utf8')) as ContractDoc;
  const checker = createChecker(local);
  const timeoutMs = settings.timeoutMs;

  const contract = await probe(`${url}/openapi.yaml`, { timeoutMs });
  if (contract.kind === 'no-answer') {
    add(unreachableCheck('kazi', 'reachable', `GET ${url}/openapi.yaml`, contract));
    return { ...base, state: 'unreachable', summary: contract.detail, checks };
  }
  if ([502, 503, 504].includes(contract.status)) {
    add({ name: 'reachable', request: 'GET /openapi.yaml', verdict: 'unreachable', status: contract.status, note: 'starting or down (a free Render service can take about a minute to wake)' });
    return { ...base, state: 'waking', summary: 'the service is not answering yet; try again in a minute', checks };
  }
  const theirs = contract.status === 200 ? contractSummary(contract.text) : null;
  const here = String(local.info?.version);
  let current = false;
  if (!theirs) {
    add({ name: 'live contract', request: 'GET /openapi.yaml', verdict: 'drift', status: contract.status, note: 'the live site does not serve its contract' });
  } else if (theirs.version === here) {
    current = true;
    add({ name: 'live contract', request: 'GET /openapi.yaml', verdict: 'ok', status: 200, note: `live is on ${theirs.version}, the same as this checkout` });
  } else {
    add({ name: 'live contract', request: 'GET /openapi.yaml', verdict: 'pending-deploy', status: 200, note: `live is on ${theirs.version} but this checkout is ${here}: Ujuzi and Sherehe cannot see the new endpoints until uat is merged into main and deployed` });
  }

  const jobs = await probe(`${url}/api/jobs?status=active`, { timeoutMs });
  if (jobs.kind === 'no-answer') add(unreachableCheck('kazi', 'Endpoint 1', 'GET /api/jobs?status=active', jobs));
  else {
    const problems: string[] = [];
    const body = parseJson(jobs.text);
    if (jobs.status !== 200) problems.push(`answered ${jobs.status}`);
    else checker.schemaCheck(body, checker.declaredResponse('/api/jobs', 'GET', 200)?.content?.['application/json']?.schema, 'reply', problems);
    add({ name: 'Endpoint 1', request: 'GET /api/jobs?status=active', verdict: problems.length ? (jobs.status >= 500 ? 'genuine-error' : 'drift') : 'ok', status: jobs.status, note: problems.length ? problems.slice(0, 3).join('; ') : `${Array.isArray(body) ? body.length : 0} active job(s), all matching the contract` });
  }

  const openings = await probe(`${url}/api/event-openings`, { timeoutMs });
  if (openings.kind === 'response') {
    add({ name: 'Endpoint 22 exists', request: 'GET /api/event-openings (no login)', verdict: openings.status === 401 ? 'ok' : openings.status === 404 ? 'pending-deploy' : 'drift', status: openings.status, note: openings.status === 401 ? 'asks for a login, so Event work is deployed' : openings.status === 404 ? 'not deployed yet' : `answered ${openings.status}` });
  }
  const failing = checks.filter((c) => ['genuine-error', 'drift'].includes(c.verdict)).length;
  const pending = checks.filter((c) => c.verdict === 'pending-deploy').length;
  const state: SystemState = failing ? 'broken' : pending ? 'older-contract' : current ? 'current' : 'up';
  return { ...base, state, summary: failing ? `${failing} check(s) failed on the live site` : pending ? 'the live site is on an older version of the contract: merge uat into main to deploy' : 'the live site is up and on the current contract', checks };
}

// ---- Ujuzi

async function checkUjuzi(settings: Settings): Promise<SystemReport> {
  const url = trimUrl(settings.ujuziUrl);
  const base: SystemReport = { system: 'ujuzi', url, state: 'not-configured', summary: '', checks: [] };
  const checks: Check[] = [];
  const add = (c: Omit<Check, 'system'>): void => { checks.push({ system: 'ujuzi', ...c }); };
  if (isPlaceholder(url)) {
    return { ...base, summary: url ? 'the address is still a placeholder (TODO): Ujuzi has not been deployed or has not shared its address' : 'no address given (set UJUZI_URL)', checks: [{ system: 'ujuzi', name: 'address', request: '-', verdict: 'not-configured', status: null, note: url || 'UJUZI_URL is not set' }] };
  }
  const p = await probe(`${url}/openapi.yaml`, { timeoutMs: settings.timeoutMs });
  if (p.kind === 'no-answer') {
    add(unreachableCheck('ujuzi', 'reachable', `GET ${url}/openapi.yaml`, p));
    return { ...base, state: 'unreachable', summary: p.detail, checks };
  }
  if (p.status === 404 && renderHasNoService(p.headers)) {
    add({ name: 'reachable', request: 'GET /openapi.yaml', verdict: 'unreachable', status: 404, note: 'Render says there is no service at this address' });
    return { ...base, state: 'no-service-deployed', summary: 'Render answers that no service lives at this address: Ujuzi is not deployed there (yet)', checks };
  }
  if ([502, 503, 504].includes(p.status)) {
    add({ name: 'reachable', request: 'GET /openapi.yaml', verdict: 'unreachable', status: p.status, note: 'starting or down' });
    return { ...base, state: 'waking', summary: 'the service is not answering yet; try again in a minute', checks };
  }
  const theirs = p.status === 200 ? contractSummary(p.text) : null;
  add({ name: 'reachable and publishing its contract', request: 'GET /openapi.yaml', verdict: theirs ? 'ok' : 'not-built', status: p.status, note: theirs ? `${theirs.title}, version ${theirs.version}` : 'it answers, but does not publish an OpenAPI file at /openapi.yaml yet' });
  add({ name: 'Ujuzi has re-run its tests against Kazi 1.3.0', request: '-', verdict: 'manual', status: null, note: 'cannot be seen from outside: ask the Ujuzi sub-team and record the answer in PARTNER_TEST_RESULTS.md' });
  return { ...base, state: theirs ? 'up' : 'partial', summary: theirs ? 'reachable and publishing its contract' : 'reachable, but its contract is not published yet', checks };
}

// ---- Putting it together

export async function runStatus(settings: Settings): Promise<Report> {
  const [sherehe, kazi, ujuzi] = await Promise.all([checkSherehe(settings), checkKazi(settings), checkUjuzi(settings)]);
  const ready = sherehe.state === 'conforming' && kazi.state === 'current' && ujuzi.state === 'up';
  return { at: new Date().toISOString(), ready, systems: [kazi, sherehe, ujuzi] };
}

const NAMES = { kazi: 'Kazi Connect (live)', sherehe: 'Sherehe (upstream)', ujuzi: 'Ujuzi (downstream)' };

export function formatReport(report: Report): string {
  const lines: string[] = [`Ring status at ${report.at}`, ''];
  for (const system of report.systems) {
    lines.push(`${NAMES[system.system]}: ${system.state.toUpperCase()}${system.url ? `   ${system.url}` : ''}`);
    lines.push(`  ${system.summary}`);
    for (const c of system.checks) lines.push(`  - ${c.verdict.padEnd(14)} ${c.name}${c.status ? ` [${c.status}]` : ''}: ${c.note}`);
    lines.push('');
  }
  lines.push(report.ready ? 'READY: all three systems are up and the ring can be checked end to end.' : 'NOT READY: see the verdicts above. "not-built" and "not-configured" are parts still to be finished; "genuine-error" and "drift" are faults to fix.');
  return lines.join('\n');
}

// Only what decides whether anything has changed, so a watcher can tell.
export function fingerprint(report: Report): string {
  return JSON.stringify(report.systems.map((s) => [s.system, s.state, s.checks.map((c) => [c.name, c.verdict, c.status])]));
}

// A real environment variable beats .env. The file is read every time this is called, so a watcher that
// has been running for hours picks up an address someone has just pasted into .env.
export function settingsFromEnvironment(args: string[] = []): Settings {
  const env = { ...readDotEnv(path.join(ROOT, '.env')), ...process.env };
  return {
    kaziUrl: env.KAZI_URL || KAZI_LIVE,
    shereheUrl: env.SHEREHE_URL || env.SHEREHE_API_URL || '',
    shereheKey: env.SHEREHE_API_KEY || '',
    ujuziUrl: env.UJUZI_URL || env.UJUZI_API_URL || '',
    write: args.includes('--write'),
    timeoutMs: Number(env.RING_TIMEOUT_MS) || 60000,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const intervalSeconds = Number(args[args.indexOf('--interval') + 1]) || 600;
  const log = args.includes('--log') ? args[args.indexOf('--log') + 1] : '';

  if (!args.includes('--watch')) {
    const report = await runStatus(settingsFromEnvironment(args));
    console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report));
    process.exit(report.ready ? 0 : 1);
  }

  let last = '';
  let quiet = 0;
  for (;;) {
    const report = await runStatus(settingsFromEnvironment(args));
    const now = fingerprint(report);
    if (log) fs.appendFileSync(log, JSON.stringify({ at: report.at, ready: report.ready, systems: report.systems.map((s) => ({ system: s.system, state: s.state })) }) + '\n');
    if (now !== last) {
      console.log(last === '' ? formatReport(report) : `CHANGE\n${formatReport(report)}`);
      last = now;
      quiet = 0;
    } else if (++quiet % 6 === 0) {
      console.log(`${report.at}: no change (${report.systems.map((s) => `${s.system}=${s.state}`).join(', ')})`);
    }
    if (report.ready && args.includes('--until-ready')) {
      console.log('ALL THREE SYSTEMS ARE READY. Time to run the held checks (npm run ring:check, npm run test:partner) and sort genuine errors from missing parts.');
      process.exit(0);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(2);
  });
}
