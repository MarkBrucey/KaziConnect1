// The one place Kazi Connect makes an HTTP call to a partner API.
//
//   * A timeout on every attempt: 3 seconds when a person is waiting for the answer
//     (mode 'user'), 60 seconds for background work such as the offer poller.
//   * Retries, for a GET when a person is waiting: at most 2, after 200 ms and then 400 ms. It retries a timeout,
//     a failed connection, a 5xx and a 429 (which waits as long as the partner's Retry-After says, up to 5 seconds).
//     It never retries a 4xx other than 429 (asking again changes nothing), a redirect, or anything that
//     changes data (POST, DELETE). Background work does not retry: the poller asks again in a few minutes anyway.
//   * A deadline() a caller can share between several calls, so a person waits at most the worst case of one
//     call ((retries + 1) x timeout + the waits: 9.6 seconds) in total, however many calls the answer needs.
//   * A 5-minute cache for reads. Only a call that asks for it (cache: true) is cached,
//     and only a 200 answer to a GET, so errors are never remembered.
//   * Saved data: when a cached read fails even after its retries, the last good answer (up to an hour old) is
//     returned with savedAt set, so the page can say so. A call that asks for the truth (refresh: true) never
//     gets saved data: it fails instead.
//   * A cap on how big an answer may be, so a misbehaving partner cannot fill our memory.
//   * Anything that stops us using the answer becomes an UpstreamError, which the API
//     turns into our own 502. A partner's reply body is never passed on.
//
// request() returns { status, body } for 2xx and 4xx answers. body is the parsed JSON of a
// 2xx answer (null when it had none); 4xx bodies are not read, so there is nothing to leak.
// It throws UpstreamError for a timeout, a network failure, a 5xx, a redirect, an answer that
// is too big, or a 2xx answer that is not JSON.

import { singleton } from '../lib/singleton';
import { UpstreamError, logRetry } from './upstreamError';

export type Mode = 'user' | 'background';

export interface FetchResult {
  status: number;
  body: unknown;
  // Set only when the partner could not be asked and this is the last good answer: when it was saved (epoch ms).
  savedAt?: number;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  mode?: Mode;
  cache?: boolean;
  // With cache: true, skip the cached answer and ask again, but still store the new answer for the next call.
  // The caller then gets the truth or a failure, never saved data.
  refresh?: boolean;
  signal?: AbortSignal; // for example a deadline() shared with other calls
  // Called with the time the answer was saved, when saved data is returned in place of a live answer.
  onSaved?: (savedAt: number) => void;
}

interface Settings {
  userTimeoutMs: number; // per attempt
  backgroundTimeoutMs: number;
  retries: number; // for a GET when a person is waiting
  retryDelayMs: number; // before the first retry; doubles each time (200 ms, then 400 ms)
  retryAfterCapMs: number; // the longest we wait because a partner's Retry-After asked for it
  now: () => number;
}

const DEFAULTS = { userTimeoutMs: 3 * 1000, backgroundTimeoutMs: 60 * 1000, retries: 2, retryDelayMs: 200, retryAfterCapMs: 5 * 1000 };
export const STALE_MAX_AGE_MS = 60 * 60 * 1000;
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
  // An entry stays after it expires (a re-read replaces it) so it can still be served as saved data, up to STALE_MAX_AGE_MS.
  cache: new Map<string, { result: FetchResult; expires: number; savedAt: number }>(),
  refreshTokens: REFRESH_BURST,
  refreshedAt: null as number | null, // null: nothing has been used yet, so the burst is full
  retries: 0, // retries made since the server started (shown by GET /api/stats)
  savedDataServed: 0, // times saved data was returned because the partner could not be asked
}));

// For tests: a fake clock and short timeouts.
export function configure(changes: Partial<Settings>): void { state.settings = { ...state.settings, ...changes }; }
export function clearCache(): void { state.cache.clear(); }
export function reset(): void {
  state.settings = { ...DEFAULTS, now: () => Date.now() };
  state.cache.clear();
  state.refreshTokens = REFRESH_BURST;
  state.refreshedAt = null;
  state.retries = 0;
  state.savedDataServed = 0;
}
export const counters = (): { retries: number; savedDataServed: number } => ({ retries: state.retries, savedDataServed: state.savedDataServed });

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

// The longest one call can take: every attempt timing out, plus the waits between them
// ((2 + 1) x 3000 + 200 + 400 = 9600 ms with the defaults). Background work does not retry.
export function worstCaseMs(mode: Mode = 'user'): number {
  if (mode === 'background') return state.settings.backgroundTimeoutMs;
  const { userTimeoutMs, retries, retryDelayMs } = state.settings;
  let waits = 0;
  for (let n = 0; n < retries; n++) waits += retryDelayMs * 2 ** n;
  return (retries + 1) * userTimeoutMs + waits;
}

// A signal that fires when a person has waited long enough (or the background limit is up), to
// be passed to several calls that together make one answer.
export const deadline = (mode: Mode = 'user'): AbortSignal => AbortSignal.timeout(worstCaseMs(mode));

function remember(key: string, result: FetchResult): void {
  const now = state.settings.now();
  for (const [k, entry] of state.cache) if (entry.savedAt + STALE_MAX_AGE_MS <= now) state.cache.delete(k);
  state.cache.delete(key); // a re-read goes to the end of the line, so the oldest entry is the first one
  while (state.cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = state.cache.keys().next();
    if (oldest.done) break;
    state.cache.delete(oldest.value);
  }
  state.cache.set(key, { result, expires: now + CACHE_TTL_MS, savedAt: now });
}

// The last good answer for a read, if it is not too old to show.
function savedCopy(key: string): { result: FetchResult; savedAt: number } | null {
  const entry = state.cache.get(key);
  return entry && state.settings.now() - entry.savedAt < STALE_MAX_AGE_MS ? entry : null;
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Frees the connection of an answer whose body we are not going to read.
function discard(res: Response): void {
  res.body?.cancel().catch(() => undefined);
}

// Retry-After in seconds, as Sherehe sends it. A missing, zero or unreadable value means "no instruction".
function retryAfterMs(res: Response): number | null {
  const seconds = Number(res.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

// Worth asking again: it did not answer in time, the connection failed, or it had a problem of its own (5xx).
// Not worth it: a redirect, an answer we could not read, or our own settings being wrong.
function retryable(err: UpstreamError): boolean {
  return err.kind === 'timeout' || err.kind === 'network' || (err.kind === 'status' && err.status !== null && err.status >= 500);
}

interface Attempt extends FetchResult {
  waitMs?: number | null; // only on a 429: how long its Retry-After asks us to wait
}

// One try. Returns { status, body } for a 2xx or 4xx answer, throws UpstreamError for anything else.
async function attempt(url: string, init: { method: string; headers: Record<string, string>; body?: unknown }, mode: Mode, signal?: AbortSignal): Promise<Attempt> {
  const limits = [AbortSignal.timeout(timeoutFor(mode))];
  if (signal) limits.push(signal);
  let res: Response;
  let text = '';
  try {
    res = await fetch(url, {
      method: init.method,
      headers: init.body === undefined ? init.headers : { ...init.headers, 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: 'manual', // never follow a redirect: the API key would travel with it
      signal: AbortSignal.any(limits),
    });
    if (res.status < 300) text = await readAnswer(res);
  } catch (err) {
    throw asUpstreamError(err);
  }

  if (res.status >= 500 || (res.status >= 300 && res.status < 400)) { discard(res); throw new UpstreamError('status', { status: res.status }); }
  if (res.status >= 400) {
    const waitMs = res.status === 429 ? retryAfterMs(res) : undefined;
    discard(res);
    return { status: res.status, body: null, waitMs };
  }

  let parsed: unknown = null;
  if (text.trim() !== '') {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new UpstreamError('shape', { status: res.status, detail: 'the answer is not JSON' });
    }
  }
  return { status: res.status, body: parsed };
}

// attempt(), again if it is worth it and allowed: at most `retries` more times, waiting 200 ms, then 400 ms
// (or as long as a 429's Retry-After asks, up to retryAfterCapMs), and never past a shared deadline.
async function attemptWithRetries(url: string, init: { method: string; headers: Record<string, string>; body?: unknown }, mode: Mode, retries: number, signal?: AbortSignal): Promise<FetchResult> {
  for (let n = 0; ; n++) {
    let wait = state.settings.retryDelayMs * 2 ** n;
    let why: string;
    try {
      const res = await attempt(url, init, mode, signal);
      if (res.status !== 429 || n >= retries || signal?.aborted) return { status: res.status, body: res.body };
      if (res.waitMs) wait = Math.min(res.waitMs, state.settings.retryAfterCapMs);
      why = 'HTTP 429';
    } catch (err) {
      const failure = asUpstreamError(err);
      if (n >= retries || !retryable(failure) || signal?.aborted) throw failure;
      why = `${failure.kind}${failure.status ? ` (HTTP ${failure.status})` : ''}${failure.detail ? `: ${failure.detail}` : ''}`;
    }
    state.retries += 1;
    logRetry(url, n + 1, retries + 1, why, wait);
    await sleep(wait);
  }
}

export async function request(url: string, { method = 'GET', headers = {}, body, mode = 'user', cache: useCache = false, refresh = false, signal, onSaved }: RequestOptions = {}): Promise<FetchResult> {
  const key = `${method} ${url}`;
  const mayServeSaved = useCache && !refresh && method === 'GET'; // a re-read that asks for the truth never gets old data
  if (useCache && !refresh) {
    const hit = state.cache.get(key);
    if (hit && hit.expires > state.settings.now()) return hit.result;
  }

  // Only a person waiting for a read retries: a write may be done twice, and background work asks again later anyway.
  const retries = method === 'GET' && mode === 'user' ? state.settings.retries : 0;
  const serveSaved = (): FetchResult | null => {
    const saved = mayServeSaved ? savedCopy(key) : null;
    if (!saved) return null;
    state.savedDataServed += 1;
    onSaved?.(saved.savedAt);
    return { ...saved.result, savedAt: saved.savedAt };
  };

  let result: FetchResult;
  try {
    result = await attemptWithRetries(url, { method, headers, body }, mode, retries, signal);
  } catch (err) {
    const saved = serveSaved();
    if (saved) return saved;
    throw err;
  }
  // A 429 that is still a 429 after the retries is the partner saying "not now": saved data is better than nothing.
  if (result.status === 429) {
    const saved = serveSaved();
    if (saved) return saved;
  }
  if (useCache && method === 'GET' && result.status === 200) remember(key, result);
  return result;
}
