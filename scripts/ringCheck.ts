// npm run ring:check: the end-to-end check of Kazi Connect's part of the ring (requirement R9).
//
//   1. ONE LIVE READ FROM SHEREHE with the real API key (K1: upcoming events). Every event in the reply is
//      checked against Sherehe's contract and typed as types/sherehe.d.ts says (the Event schema).
//   2. KAZI CONNECT'S OWN DEPLOYMENT, Endpoints 1, 5 and 6:
//        Endpoint 1  GET /api/jobs?status=active                 the jobs, each matching the contract
//        Endpoint 5  GET /api/applications/{id}/status           the status of an application
//        Endpoint 6  WebSocket /api/applications/{id}/subscribe  the status arrives live, and a final "cancelled"
//      Endpoints 5 and 6 need an application to look at, so this makes one (student ID ringcheck_000, for the
//      first open job) and cancels it again at the end, which also exercises Endpoint 9. Add --read-only to
//      make nothing: then set RING_APPLICATION_ID to an application that already exists, and only the status
//      and the first live message are checked.
//
// It is strict: a step either passes or fails. The two halves are independent, so Kazi's own endpoints are
// still checked when Sherehe is down (and the output says which half failed). If Sherehe's address or key
// is not set, it stops with exit code 2 and says what is missing: that is a part not set up yet, not a
// failure. Use `npm run ring:status` first to see how far each system has got, and sort failures with
// evidence/ring/HELD_ISSUES.md.
//
// Settings (environment or .env): SHEREHE_API_URL (or SHEREHE_URL), SHEREHE_API_KEY, KAZI_URL (defaults to
// the live Render site).

import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';
import YAML from 'yaml';
import type { components as ShereheTypes } from '../types/sherehe';
import type { Application, ApplicationStatus, Job } from '../lib/contract';
import { createChecker } from './lib/schemaCheck';
import type { ContractDoc, Json } from './lib/schemaCheck';
import { isPlaceholder, settingsFromEnvironment } from './ringStatus';
import type { Settings } from './ringStatus';

type ShereheEvent = ShereheTypes['schemas']['Event'];

export interface Step {
  half: 'sherehe' | 'kazi';
  name: string;
  passed: boolean;
  detail: string;
}

export interface Options {
  readOnly: boolean;
  applicationId: string; // used with readOnly
}

const ROOT = path.join(__dirname, '..');
const DAY = 24 * 60 * 60 * 1000;

const readContract = (file: string): ContractDoc => YAML.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')) as ContractDoc;

// The compile-time half of "checked against types/sherehe.d.ts": once the reply has passed the contract's
// schema it is used as ShereheEvent[], so a field Sherehe renames in its contract stops `npm run typecheck`.
function asEvents(body: unknown): ShereheEvent[] {
  return body as ShereheEvent[];
}

async function getJson(url: string, headers: Record<string, string>, timeoutMs: number): Promise<{ status: number; body: Json }> {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
  const text = await res.text();
  let body: Json = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = undefined; }
  return { status: res.status, body };
}

const describe = (err: unknown): string => (err instanceof Error ? `${err.name}: ${err.message}${err.cause ? ` (${String((err.cause as { code?: string }).code || err.cause)})` : ''}` : String(err));

// ---- Half 1: Sherehe

async function checkSherehe(settings: Settings): Promise<Step[]> {
  const steps: Step[] = [];
  const name = 'one live read from Sherehe (K1: upcoming events), with the real key';
  const base = settings.shereheUrl.trim().replace(/\/+$/, '');
  try {
    const { status, body } = await getJson(`${base}/api/events?status=upcoming`, { 'X-API-Key': settings.shereheKey }, settings.timeoutMs);
    if (status !== 200) {
      steps.push({ half: 'sherehe', name, passed: false, detail: `Sherehe answered ${status}, expected 200${status === 401 || status === 403 ? ' (is the key the one Sherehe issued to Kazi Connect?)' : status === 404 ? ' (the endpoint is not built yet?)' : ''}` });
      return steps;
    }
    const contract = readContract('partner-tests/sherehe_openapi.yaml');
    const checker = createChecker(contract);
    const problems: string[] = [];
    checker.schemaCheck(body, checker.declaredResponse('/api/events', 'GET', 200)?.content?.['application/json']?.schema, 'reply', problems);
    if (problems.length) {
      steps.push({ half: 'sherehe', name, passed: false, detail: `the reply does not match Sherehe's contract: ${problems.slice(0, 4).join('; ')}${problems.length > 4 ? ` (and ${problems.length - 4} more)` : ''}` });
      return steps;
    }
    const events = asEvents(body);
    steps.push({ half: 'sherehe', name, passed: true, detail: `${events.length} upcoming event(s)${events.length ? `, for example "${events[0].name}" in ${events[0].county}` : ''}, every one matching the Event schema` });
  } catch (err) {
    steps.push({ half: 'sherehe', name, passed: false, detail: `could not read from Sherehe: ${describe(err)}` });
  }
  return steps;
}

// ---- Half 2: Kazi Connect's own deployment

// Both helpers give up after `ms`, so a server that never answers fails the step instead of hanging the check.
// A rejection that nothing is awaiting yet (because an earlier step failed) is marked handled, not left to crash.
function nextMessage(ws: WebSocket, ms: number): Promise<Json> {
  const promise = new Promise<Json>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no message within ${Math.round(ms / 1000)} seconds`)), ms);
    ws.once('message', (data) => {
      clearTimeout(timer);
      try { resolve(JSON.parse(data.toString())); } catch { reject(new Error('the message is not JSON')); }
    });
  });
  promise.catch(() => undefined);
  return promise;
}

function nextClose(ws: WebSocket, ms: number): Promise<number> {
  const promise = new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the socket was not closed within ${Math.round(ms / 1000)} seconds`)), ms);
    ws.once('close', (code) => { clearTimeout(timer); resolve(code); });
  });
  promise.catch(() => undefined);
  return promise;
}

async function checkKazi(settings: Settings, options: Options): Promise<Step[]> {
  const steps: Step[] = [];
  const base = settings.kaziUrl.trim().replace(/\/+$/, '');
  const checker = createChecker(readContract('openapi.yaml'));
  const step = (name: string, passed: boolean, detail: string): void => { steps.push({ half: 'kazi', name, passed, detail }); };
  const timeoutMs = settings.timeoutMs;
  let created: string | null = null;
  let socket: WebSocket | null = null;

  try {
    // Endpoint 1
    const jobs = await getJson(`${base}/api/jobs?status=active`, {}, timeoutMs);
    const problems: string[] = [];
    if (jobs.status !== 200) problems.push(`answered ${jobs.status}, expected 200`);
    else checker.schemaCheck(jobs.body, checker.declaredResponse('/api/jobs', 'GET', 200)?.content?.['application/json']?.schema, 'reply', problems);
    step('Endpoint 1: GET /api/jobs?status=active', problems.length === 0, problems.length ? problems.slice(0, 4).join('; ') : `${(jobs.body as Job[]).length} active job(s), every one matching the contract`);

    // An application for Endpoints 5 and 6 to look at
    let applicationId = options.readOnly ? options.applicationId : '';
    if (!options.readOnly) {
      const open = Array.isArray(jobs.body) ? (jobs.body as Job[])[0] : undefined;
      if (!open) {
        step('an application to look at (needed by Endpoints 5 and 6)', false, 'there is no open job to apply for');
        return steps;
      }
      const made = await fetch(`${base}/api/applications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ jobId: open.id, studentId: 'ringcheck_000', preferredDate: new Date(Date.now() + 30 * DAY).toISOString().replace(/\.\d{3}Z$/, 'Z'), note: 'ring:check, cancelled again straight away' }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const application = (await made.json()) as Application;
      if (made.status !== 201) {
        step('an application to look at (needed by Endpoints 5 and 6)', false, `Endpoint 7 answered ${made.status}, expected 201`);
        return steps;
      }
      applicationId = application.applicationId;
      created = applicationId;
    }
    if (!applicationId) {
      step('Endpoints 5 and 6', false, 'with --read-only, set RING_APPLICATION_ID to an application that exists');
      return steps;
    }

    // Endpoint 5
    const status = await getJson(`${base}/api/applications/${encodeURIComponent(applicationId)}/status`, {}, timeoutMs);
    const statusProblems: string[] = [];
    if (status.status !== 200) statusProblems.push(`answered ${status.status}, expected 200`);
    else checker.schemaCheck(status.body, checker.declaredResponse('/api/applications/{applicationId}/status', 'GET', 200)?.content?.['application/json']?.schema, 'reply', statusProblems);
    step(`Endpoint 5: GET /api/applications/${applicationId}/status`, statusProblems.length === 0, statusProblems.length ? statusProblems.join('; ') : `status "${(status.body as ApplicationStatus).status}"`);

    // Endpoint 6
    const wsUrl = `${base.replace(/^http/, 'ws')}/api/applications/${encodeURIComponent(applicationId)}/subscribe`;
    const ws = new WebSocket(wsUrl);
    socket = ws;
    const first = nextMessage(ws, timeoutMs);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the WebSocket did not open')), timeoutMs);
      ws.once('open', () => { clearTimeout(timer); resolve(); });
      ws.once('error', (err) => { clearTimeout(timer); reject(err); });
    });
    const onConnect = (await first) as ApplicationStatus;
    const wsProblems: string[] = [];
    checker.schemaCheck(onConnect, { $ref: '#/components/schemas/ApplicationStatus' }, 'message', wsProblems);
    if (onConnect.applicationId !== applicationId) wsProblems.push(`the message is for ${onConnect.applicationId}`);
    step('Endpoint 6: WebSocket, the status on connect', wsProblems.length === 0, wsProblems.length ? wsProblems.join('; ') : `received "${onConnect.status}" at once`);

    if (created) {
      // Cancelling it (Endpoint 9) must be announced live and close the socket, which is the rest of Endpoint 6
      const closed = nextClose(ws, timeoutMs);
      const final = nextMessage(ws, timeoutMs);
      const gone = await fetch(`${base}/api/applications/${encodeURIComponent(created)}`, { method: 'DELETE', signal: AbortSignal.timeout(timeoutMs) });
      const message = (await final) as ApplicationStatus;
      const code = await closed;
      created = null;
      const finalOk = gone.status === 204 && message.status === 'cancelled' && code === 1000;
      step('Endpoint 6: WebSocket, the final "cancelled" message (and Endpoint 9)', finalOk,
        finalOk ? 'cancelling it was announced live and the socket closed normally' : `DELETE answered ${gone.status}; final message "${message.status}"; closed with code ${code}`);
    } else {
      ws.close();
    }
  } catch (err) {
    step('Kazi Connect\'s own deployment', false, `could not complete: ${describe(err)}`);
  } finally {
    if (socket) socket.terminate();
    if (created) {
      // Something failed part way: do not leave the check's application behind on the live site.
      await fetch(`${base}/api/applications/${encodeURIComponent(created)}`, { method: 'DELETE', signal: AbortSignal.timeout(timeoutMs) }).catch(() => undefined);
    }
  }
  return steps;
}

// Returns every step, or the reason the check cannot run at all.
export async function runRingCheck(settings: Settings, options: Options): Promise<{ steps: Step[]; cannotRun: string | null }> {
  if (isPlaceholder(settings.shereheUrl.trim()) || !settings.shereheKey) {
    const missing = [isPlaceholder(settings.shereheUrl.trim()) ? 'SHEREHE_API_URL (still empty or a TODO placeholder)' : '', settings.shereheKey ? '' : 'SHEREHE_API_KEY'].filter(Boolean).join(' and ');
    return { steps: [], cannotRun: `${missing} not set. Sherehe has not been deployed or has not issued a key yet: this is a part not set up, not a failure. Run \`npm run ring:status\` to see how far each system has got.` };
  }
  const [sherehe, kazi] = await Promise.all([checkSherehe(settings), checkKazi(settings, options)]);
  return { steps: [...sherehe, ...kazi], cannotRun: null };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const settings = settingsFromEnvironment(args);
  const options: Options = { readOnly: args.includes('--read-only'), applicationId: process.env.RING_APPLICATION_ID || '' };
  const { steps, cannotRun } = await runRingCheck(settings, options);
  if (cannotRun) {
    console.log(`Cannot run the ring check: ${cannotRun}`);
    process.exit(2);
  }
  console.log(`Ring check: Sherehe at ${settings.shereheUrl}, Kazi Connect at ${settings.kaziUrl}\n`);
  for (const s of steps) console.log(`${s.passed ? 'pass' : 'FAIL'}  [${s.half}] ${s.name}\n        ${s.detail}`);
  const failed = steps.filter((s) => !s.passed);
  console.log(failed.length === 0
    ? `\nAll ${steps.length} steps passed.`
    : `\n${failed.length} of ${steps.length} steps failed (${[...new Set(failed.map((s) => s.half))].join(' and ')}). Before fixing anything, run \`npm run ring:status\`: a part that is not built yet belongs on hold (evidence/ring/HELD_ISSUES.md), not in a bug list.`);
  process.exit(failed.length === 0 ? 0 : 1);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(2);
  });
}
