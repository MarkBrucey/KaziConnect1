// The one place Kazi Connect makes an HTTP call to a partner API.
//
//   * A timeout on every call: 10 seconds when a person is waiting for the answer
//     (mode 'user'), 60 seconds for background work such as the offer poller.
//   * A 5-minute cache for reads. Only a call that asks for it (cache: true) is cached,
//     and only a 200 answer to a GET, so errors are never remembered.
//   * Anything that stops us using the answer becomes an UpstreamError, which the API
//     turns into our own 502. A partner's reply body is never passed on.
//
// request() returns { status, body } for 2xx and 4xx answers. body is the parsed JSON of a
// 2xx answer (null when it had none); 4xx bodies are not read, so there is nothing to leak.
// It throws UpstreamError for a timeout, a network failure, a 5xx, a redirect, or a 2xx
// answer that is not JSON.

const { UpstreamError } = require('./upstreamError');

const DEFAULTS = { userTimeoutMs: 10 * 1000, backgroundTimeoutMs: 60 * 1000 };
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

let settings = { ...DEFAULTS, now: () => Date.now() };
const cache = new Map(); // "GET <url>" -> { result, expires }

// For tests: a fake clock and short timeouts.
function configure(changes) { settings = { ...settings, ...changes }; }
function clearCache() { cache.clear(); }
function reset() { settings = { ...DEFAULTS, now: () => Date.now() }; cache.clear(); }
const cacheSize = () => cache.size;

function remember(key, result) {
  const now = settings.now();
  for (const [k, entry] of cache) if (entry.expires <= now) cache.delete(k);
  while (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value); // oldest first
  cache.set(key, { result, expires: now + CACHE_TTL_MS });
}

async function request(url, { method = 'GET', headers = {}, body, mode = 'user', cache: useCache = false } = {}) {
  const key = `${method} ${url}`;
  if (useCache) {
    const hit = cache.get(key);
    if (hit && hit.expires > settings.now()) return hit.result;
    cache.delete(key);
  }

  const timeoutMs = mode === 'background' ? settings.backgroundTimeoutMs : settings.userTimeoutMs;
  let res;
  let text;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual', // never follow a redirect: the API key would travel with it
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = res.status < 300 ? await res.text() : '';
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw new UpstreamError('timeout');
    throw new UpstreamError('network', { detail: err && err.cause && err.cause.code ? String(err.cause.code) : '' });
  }

  if (res.status >= 500 || (res.status >= 300 && res.status < 400)) throw new UpstreamError('status', { status: res.status });
  if (res.status >= 400) return { status: res.status, body: null };

  let parsed = null;
  if (text.trim() !== '') {
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new UpstreamError('shape', { status: res.status, detail: 'the answer is not JSON' });
    }
  }
  const result = { status: res.status, body: parsed };
  if (useCache && method === 'GET' && res.status === 200) remember(key, result);
  return result;
}

module.exports = { request, configure, clearCache, reset, cacheSize, CACHE_TTL_MS, CACHE_MAX_ENTRIES };
