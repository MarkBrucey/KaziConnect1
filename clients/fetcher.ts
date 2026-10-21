// The one place Kazi Connect makes an HTTP call to a partner API.
//
//   * A timeout on every call: 10 seconds when a person is waiting for the answer
//     (mode 'user'), 60 seconds for background work such as the offer poller.
//   * A deadline() a caller can share between several calls, so a person waits at most that long
//     in total, however many calls the answer needs.
//   * A 5-minute cache for reads. Only a call that asks for it (cache: true) is cached,
//     and only a 200 answer to a GET, so errors are never remembered.
//   * A cap on how big an answer may be, so a misbehaving partner cannot fill our memory.
//   * Anything that stops us using the answer becomes an UpstreamError, which the API
//     turns into our own 502. A partner's reply body is never passed on.
//
// request() returns { status, body } for 2xx and 4xx answers. body is the parsed JSON of a
// 2xx answer (null when it had none); 4xx bodies are not read, so there is nothing to leak.
// It throws UpstreamError for a timeout, a network failure, a 5xx, a redirect, an answer that
// is too big, or a 2xx answer that is not JSON.

import { singleton } from '../lib/singleton';
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
  signal?: AbortSignal; // for example a deadline() shared with other calls
}

interface Settings {
  userTimeoutMs: number;
  backgroundTimeoutMs: number;
  now: () => number;
}

const DEFAULTS = { userTimeoutMs: 10 * 1000, backgroundTimeoutMs: 60 * 1000 };
export const CACHE_TTL_MS = 5 * 60 * 1000;
export const CACHE_MAX_ENTRIES = 200;
export const MAX_ANSWER_BYTES = 1024 * 1024;

// One cache and one set of settings per process, however many copies of this module Next makes:
// the tests reset them from the test file and expect the route handlers to obey.
const state = singleton('fetcher', () => ({
  settings: { ...DEFAULTS, now: () => Date.now() } as Settings,
  cache: new Map<string, { result: FetchResult; expires: number }>(),
}));

// For tests: a fake clock and short timeouts.
export function configure(changes: Partial<Settings>): void { state.settings = { ...state.settings, ...changes }; }
export function clearCache(): void { state.cache.clear(); }
export function reset(): void { state.settings = { ...DEFAULTS, now: () => Date.now() }; state.cache.clear(); }
export const cacheSize = (): number => state.cache.size;

const timeoutFor = (mode: Mode): number => (mode === 'background' ? state.settings.backgroundTimeoutMs : state.settings.userTimeoutMs);

// A signal that fires when a person has waited long enough (or the background limit is up), to
// be passed to several calls that together make one answer.
export const deadline = (mode: Mode = 'user'): AbortSignal => AbortSignal.timeout(timeoutFor(mode));

function remember(key: string, result: FetchResult): void {
  const now = state.settings.now();
  for (const [k, entry] of state.cache) if (entry.expires <= now) state.cache.delete(k);
  while (state.cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = state.cache.keys().next();
    if (oldest.done) break;
    state.cache.delete(oldest.value);
  }
  state.cache.set(key, { result, expires: now + CACHE_TTL_MS });
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

export async function request(url: string, { method = 'GET', headers = {}, body, mode = 'user', cache: useCache = false, signal }: RequestOptions = {}): Promise<FetchResult> {
  const key = `${method} ${url}`;
  if (useCache) {
    const hit = state.cache.get(key);
    if (hit && hit.expires > state.settings.now()) return hit.result;
    state.cache.delete(key);
  }

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
  if (res.status >= 400) return { status: res.status, body: null };

  let parsed: unknown = null;
  if (text.trim() !== '') {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new UpstreamError('shape', { status: res.status, detail: 'the answer is not JSON' });
    }
  }
  const result: FetchResult = { status: res.status, body: parsed };
  if (useCache && method === 'GET' && res.status === 200) remember(key, result);
  return result;
}
