// The one check that every /api call (and the WebSocket upgrade) goes through before anything else happens:
//   1. is a valid API key sent?  no -> 401 { message }; the handler never runs
//   2. has this consumer called too often?  yes -> 429 { message, retryAfter } with a Retry-After header
// Used by proxy.ts for HTTP and by realtime.ts for the WebSocket, so both count and answer the same way.

import { identify, readConfig, WEBSITE_CONSUMER } from './apiKeys';
import { hit, readLimits } from './rateLimit';

export type Gate =
  | { ok: true; consumer: string }
  | { ok: false; status: 401 | 429; message: string; retryAfter?: number };

export const MISSING_KEY = 'Missing or invalid API key';
export const TOO_MANY = 'Too many requests';

// The caller's address as the host's proxy reports it (Render sets X-Forwarded-For). Direct callers can send any
// value in this header, so it is only used to tell visitors of the website apart and to slow down key guessing.
export function clientAddress(forwardedFor: string | string[] | null | undefined, remote?: string | null): string {
  const text = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const first = (text || '').split(',')[0].trim();
  return first || remote || 'unknown';
}

export function gate({ key, address }: { key: string | null | undefined; address: string }): Gate {
  const config = readConfig();
  if (!config.required) return { ok: true, consumer: 'open' }; // keys are not switched on

  const limits = readLimits();
  const consumer = identify(key, config);
  if (!consumer) {
    const failed = hit(`wrong-key:${address}`, limits.failedMax, limits.windowMs); // guessing keys is slowed down
    if (!failed.allowed) return { ok: false, status: 429, message: TOO_MANY, retryAfter: failed.retryAfter };
    return { ok: false, status: 401, message: MISSING_KEY };
  }

  // The website's key is public and shared by every visitor, so each visitor's address gets its own allowance.
  const id = consumer.name === WEBSITE_CONSUMER ? `${consumer.name}:${address}` : consumer.name;
  const used = hit(id, limits.max, limits.windowMs);
  if (!used.allowed) return { ok: false, status: 429, message: TOO_MANY, retryAfter: used.retryAfter };
  return { ok: true, consumer: consumer.name };
}
