// The one place Kazi Connect makes an HTTP call to a partner API.
//
//   * A timeout on every attempt: USER_TIMEOUT_MS when a person is waiting for the answer
//     (mode 'user'), 60 seconds for background work such as the offer poller.
//   * Week 11: a read (GET) that fails in a way that may pass is tried again, at most twice, after
//     200 ms and then 400 ms: a timeout, a dropped or refused connection, or a 5xx. A 429 is tried
//     again after the partner's Retry-After (at most 5 seconds). A 4xx other than 429 is never tried
//     again (our request is wrong and asking again changes nothing), and a write (POST, PUT, PATCH,
//     DELETE) is never tried again, because a second attempt could do it twice.
//   * A deadline() a caller can share between several calls, so a person waits at most that long
//     in total, however many calls and attempts the answer needs.
//   * A 5-minute cache for reads. Only a call that asks for it (cache: true) is cached,
//     and only a 200 answer to a GET, so errors are never remembered. PARTNER_CACHE_SECONDS changes the 5 minutes
//     (0 turns the cache off, so every read goes to the partner: used for the Week 11 failure drills).
//   * A cap on how big an answer may be, so a misbehaving partner cannot fill our memory.
//   * Anything that stops us using the answer becomes an UpstreamError, which the API
//     turns into our own 502. A partner's reply body is never passed on.
//
// request() returns { status, body } for 2xx and 4xx answers. body is the parsed JSON of a
// 2xx answer (null when it had none); 4xx bodies are not read, so there is nothing to leak.
// It throws UpstreamError for a timeout, a network failure, a 5xx, a redirect, an answer that
// is too big, or a 2xx answer that is not JSON.

import { singleton } from '../lib/singleton';
import { countPartner } from '../monitoring';
import { UpstreamError } from './upstreamError';

export type Mode = 'user' | 'background';

export interface FetchResult {
  status: number;
  body: unknown;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  mode?: Mode;
  cache?: boolean;
  // With cache: true, skip the cached answer and ask again, but still store the new answer for the next call.
  refresh?: boolean;
  signal?: AbortSignal; // for example a deadline() shared with other calls
}

interface Settings {
  userTimeoutMs: number; // one attempt, while a person waits
  backgroundTimeoutMs: number; // one attempt, in the background
  userDeadlineMs: number; // everything one answer needs (every call and every attempt), while a person waits
  retries: number; // how many more attempts a read may have after the first
  retryDelayMs: number; // the wait before the first retry; it doubles each time
  retryAfterCapMs: number; // the longest we wait when a partner's 429 asks us to
  now: () => number;
  onRetry: (note: string) => void;
}

// Week 11 numbers, and why (RESILIENCE_NOTES.md has the measurements):
//   USER_TIMEOUT_MS  one attempt. Measured on 10 November 2026 through the live Endpoint 22: once awake, Sherehe added
//                    22 to 282 ms and the whole call took 178 to 438 ms. 2 seconds is more than four times the slowest
//                    of those. Anything slower was Sherehe waking up on Render's free plan, which took about 40 seconds,
//                    longer than any person should wait, so no timeout a person could bear gets through that anyway.
//   RETRIES          2, so at most 3 attempts. Worst case for a person: 3 x 2000 + 200 + 400 = 6600 ms, inside the
//                    10-second USER_DEADLINE_MS that was already the most anyone waited before Week 11.
export const USER_TIMEOUT_MS = 2 * 1000;
export const BACKGROUND_TIMEOUT_MS = 60 * 1000;
export const USER_DEADLINE_MS = 10 * 1000;
export const RETRIES = 2;
export const RETRY_DELAY_MS = 200;
export const RETRY_AFTER_CAP_MS = 5 * 1000;
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

// Retry lines go to the server log (never in Jest, where they would only be noise). They hold the method, the path
// with no query string, and why the attempt failed: never the key, never the partner's reply.
const logRetry = (note: string): void => { if (!process.env.JEST_WORKER_ID) console.warn(`[partner] ${note}`); };

const DEFAULTS = {
  userTimeoutMs: USER_TIMEOUT_MS, backgroundTimeoutMs: BACKGROUND_TIMEOUT_MS, userDeadlineMs: USER_DEADLINE_MS,
  retries: RETRIES, retryDelayMs: RETRY_DELAY_MS, retryAfterCapMs: RETRY_AFTER_CAP_MS, onRetry: logRetry,
};
export const CACHE_TTL_MS = 5 * 60 * 1000;
export const CACHE_MAX_ENTRIES = 200;
// Re-reading the partner because something is missing (a role the cached lists do not have yet) is allowed twice in a
// row, then one more every REFRESH_MIN_GAP_MS. Sized by what a re-read costs: one call for the events and one more for
// each upcoming event (about 40 today), against a partner that allows 100 calls a minute per key. Two in a row covers a
// person adding a couple of roles; one a minute sustained is about 40 calls, so a stream of requests for ids that do
// not exist cannot use up the partner's allowance and starve everyone's lists.
export const REFRESH_MIN_GAP_MS = 60 * 1000;
export const REFRESH_BURST = 2;
export const MAX_ANSWER_BYTES = 1024 * 1024;

// One cache and one set of settings per process, however many copies of this module Next makes:
// the tests reset them from the test file and expect the route handlers to obey.
const state = singleton('fetcher', () => ({
  settings: { ...DEFAULTS, now: () => Date.now() } as Settings,
  cache: new Map<string, { result: FetchResult; expires: number }>(),
  refreshTokens: REFRESH_BURST,
  refreshedAt: null as number | null, // null: nothing has been used yet, so the burst is full
}));

// For tests: a fake clock and short timeouts.
export function configure(changes: Partial<Settings>): void { state.settings = { ...state.settings, ...changes }; }
export function clearCache(): void { state.cache.clear(); }
export function reset(): void { state.settings = { ...DEFAULTS, now: () => Date.now() }; state.cache.clear(); state.refreshTokens = REFRESH_BURST; state.refreshedAt = null; }

// True if a refresh is allowed now (and counts it): a bucket of REFRESH_BURST that fills by one every REFRESH_MIN_GAP_MS.
export function mayRefresh(): boolean {
  const now = state.settings.now();
  const earned = state.refreshedAt === null ? 0 : Math.max(0, now - state.refreshedAt) / REFRESH_MIN_GAP_MS;
  state.refreshTokens = Math.min(REFRESH_BURST, state.refreshTokens + earned);
  state.refreshedAt = now;
  if (state.refreshTokens < 1) return false;
  state.refreshTokens -= 1;
  return true;
}
export const cacheSize = (): number => state.cache.size;

const timeoutFor = (mode: Mode): number => (mode === 'background' ? state.settings.backgroundTimeoutMs : state.settings.userTimeoutMs);

// A signal that fires when a person has waited long enough (or the background limit is up), to
// be passed to several calls that together make one answer, however many attempts each one takes.
export const deadline = (mode: Mode = 'user'): AbortSignal => AbortSignal.timeout(mode === 'background' ? state.settings.backgroundTimeoutMs : state.settings.userDeadlineMs);

// CACHE_TTL_MS unless PARTNER_CACHE_SECONDS is set to a whole number of seconds (0 = no cache).
export function cacheTtlMs(env: Record<string, string | undefined> = process.env): number {
  const raw = (env.PARTNER_CACHE_SECONDS || '').trim();
  return /^\d{1,6}$/.test(raw) ? Number(raw) * 1000 : CACHE_TTL_MS;
}

function remember(key: string, result: FetchResult): void {
  const now = state.settings.now();
  for (const [k, entry] of state.cache) if (entry.expires <= now) state.cache.delete(k);
  while (state.cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = state.cache.keys().next();
    if (oldest.done) break;
    state.cache.delete(oldest.value);
  }
  const ttl = cacheTtlMs();
  if (ttl <= 0) return;
  state.cache.set(key, { result, expires: now + ttl });
}

// Errors are recognised by their name, not with instanceof: the DOMException a timeout produces comes
// from outside the realm this file may be running in (for example Jest's sandbox), so instanceof Error fails.
function field(err: unknown, name: string): unknown {
  return typeof err === 'object' && err !== null && name in err ? (err as Record<string, unknown>)[name] : undefined;
}

function isAbort(err: unknown): boolean {
  const name = field(err, 'name');
  return name === 'TimeoutError' || name === 'AbortError';
}

function asUpstreamError(err: unknown): UpstreamError {
  if (err instanceof UpstreamError) return err;
  if (isAbort(err)) return new UpstreamError('timeout');
  const code = field(field(err, 'cause'), 'code');
  return new UpstreamError('network', { detail: typeof code === 'string' ? code : '' });
}

// Reads an answer up to MAX_ANSWER_BYTES. Anything bigger is refused, not stored.
async function readAnswer(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_ANSWER_BYTES) throw new UpstreamError('shape', { detail: 'the answer is too large' });
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_ANSWER_BYTES) {
      await reader.cancel();
      throw new UpstreamError('shape', { detail: 'the answer is too large' });
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

// One attempt: { status, body, retryAfter } for a 2xx or 4xx answer, or an UpstreamError.
async function attemptOnce(url: string, { method, headers, body, mode, signal }: { method: string; headers: Record<string, string>; body: unknown; mode: Mode; signal?: AbortSignal }): Promise<FetchResult & { retryAfter: string | null }> {
  const limits = [AbortSignal.timeout(timeoutFor(mode))];
  if (signal) limits.push(signal);
  let res: Response;
  let text = '';
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual', // never follow a redirect: the API key would travel with it
      signal: AbortSignal.any(limits),
    });
    if (res.status < 300) text = await readAnswer(res);
  } catch (err) {
    throw asUpstreamError(err);
  }

  if (res.status >= 500 || (res.status >= 300 && res.status < 400)) throw new UpstreamError('status', { status: res.status });
  if (res.status >= 400) return { status: res.status, body: null, retryAfter: res.headers.get('retry-after') };

  let parsed: unknown = null;
  if (text.trim() !== '') {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new UpstreamError('shape', { status: res.status, detail: 'the answer is not JSON' });
    }
  }
  return { status: res.status, body: parsed, retryAfter: null };
}

// Worth asking again: the partner was slow, unreachable or broken for a moment. A redirect, an answer we cannot
// read and a missing setting fail the same way every time, so they are not.
const retryable = (err: UpstreamError): boolean =>
  err.kind === 'timeout' || err.kind === 'network' || (err.kind === 'status' && err.status !== null && RETRY_STATUSES.has(err.status));

// Waits ms, or less if the shared deadline fires first.
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    const done = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

const pathOf = (url: string): string => { try { return new URL(url).pathname; } catch { return '(unreadable address)'; } };

export async function request(url: string, { method = 'GET', headers = {}, body, mode = 'user', cache: useCache = false, refresh = false, signal }: RequestOptions = {}): Promise<FetchResult> {
  const key = `${method} ${url}`;
  if (useCache && !refresh) {
    const hit = state.cache.get(key);
    if (hit && hit.expires > state.settings.now()) return hit.result;
    state.cache.delete(key);
  }

  const read = method.toUpperCase() === 'GET';
  const maxRetries = read ? Math.max(0, state.settings.retries) : 0; // a write is never tried twice
  for (let attempt = 0; ; attempt++) {
    let wait = state.settings.retryDelayMs * 2 ** attempt; // 200 ms, then 400 ms
    let why: string;
    let answer: (FetchResult & { retryAfter: string | null }) | null = null;
    try {
      answer = await attemptOnce(url, { method, headers, body, mode, signal });
    } catch (err) {
      const failure = asUpstreamError(err);
      if (attempt >= maxRetries || !retryable(failure) || signal?.aborted) throw failure;
      why = failure.status ? `HTTP ${failure.status}` : failure.kind === 'network' && failure.detail ? `network: ${failure.detail}` : failure.kind;
    }
    if (answer) {
      const result: FetchResult = { status: answer.status, body: answer.body };
      if (answer.status !== 429 || attempt >= maxRetries || signal?.aborted) {
        if (useCache && read && result.status === 200) remember(key, result);
        return result;
      }
      const asked = Number(answer.retryAfter);
      if (Number.isFinite(asked) && asked > 0) wait = Math.min(asked * 1000, state.settings.retryAfterCapMs); // as asked, up to 5 s
      why = 'HTTP 429';
    }
    countPartner('retry'); // Week 12: /api/stats shows how often the partner needed a second try
    state.settings.onRetry(`${method} ${pathOf(url)} attempt ${attempt + 1} of ${maxRetries + 1} failed (${why!}), retrying in ${wait} ms`);
    await pause(wait, signal);
  }
}
