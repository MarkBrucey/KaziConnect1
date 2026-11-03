// A fixed-window rate limiter: at most `max` calls per `windowMs` for one id (a consumer, or an address).
// It lives in this server's memory: it resets on a restart and does not add up across several copies of
// the server. That is the honest limit of this course project; a shared store such as Redis would fix it.
// The state is kept by lib/singleton, so the HTTP gate (proxy.ts) and the WebSocket gate (realtime.ts),
// which are separate copies of this module, count together.

import { singleton } from './singleton';

interface Entry { count: number; resetAt: number }

const state = singleton('rateLimit', () => ({
  hits: new Map<string, Entry>(),
  now: () => Date.now(),
}));

export const DEFAULT_MAX = 100;
export const DEFAULT_WINDOW_MS = 60 * 1000;
export const DEFAULT_FAILED_MAX = 20;
const MAX_IDS = 10000;

export interface Limits { max: number; windowMs: number; failedMax: number }

const positive = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && value !== undefined && value.trim() !== '' ? Math.floor(n) : fallback;
};

// API_RATE_LIMIT calls per API_RATE_WINDOW_MS per consumer (0 turns the limit off); API_FAILED_KEY_LIMIT wrong keys per address.
export function readLimits(env: Record<string, string | undefined> = process.env): Limits {
  return {
    max: positive(env.API_RATE_LIMIT, DEFAULT_MAX),
    windowMs: Math.max(1, positive(env.API_RATE_WINDOW_MS, DEFAULT_WINDOW_MS)),
    failedMax: positive(env.API_FAILED_KEY_LIMIT, DEFAULT_FAILED_MAX),
  };
}

export interface Hit { allowed: boolean; retryAfter: number }

// Counts one call for `id`. max 0 means no limit.
export function hit(id: string, max: number, windowMs: number): Hit {
  if (max === 0) return { allowed: true, retryAfter: 0 };
  const now = state.now();
  if (state.hits.size >= MAX_IDS) for (const [k, e] of state.hits) if (now >= e.resetAt) state.hits.delete(k);
  let entry = state.hits.get(id);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    state.hits.set(id, entry);
  }
  entry.count += 1;
  if (entry.count > max) return { allowed: false, retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  return { allowed: true, retryAfter: 0 };
}

// For tests: a fake clock, and a clean slate.
export function configure(changes: { now?: () => number }): void { if (changes.now) state.now = changes.now; }
export function reset(): void { state.hits.clear(); state.now = () => Date.now(); }
