// ENDPOINT 26: GET /api/stats   (Week 12: monitoring)
// Running totals since this server started: requests, 4xx and 5xx counts, the error rate (5xx only), average
// time, a row per endpoint pattern, and how Sherehe is doing (retries, failures, saved lists served).
// See monitoring.ts. The reply does not count itself; it shows up in the next one.
//
// It always needs a key:
//   API keys on (API_KEYS set): any valid X-API-Key. proxy.ts has already checked it and the rate limit.
//   API keys off (the API is open, as on the live site today): the X-API-Key must equal STATS_KEY, a setting of
//   at least 16 characters kept in Render's environment, never in git. With no STATS_KEY it always answers 401.

import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { stats } from '@/monitoring';
import { MIN_KEY_LENGTH, readConfig } from '@/lib/apiKeys';
import { MISSING_KEY } from '@/lib/apiGate';
import { fail, json } from '@/lib/http';
import { servedCount } from '@/lib/savedOpenings';

export const dynamic = 'force-dynamic';

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

function statsKeyMatches(sent: string | null): boolean {
  const expected = (process.env.STATS_KEY || '').trim();
  if (expected.length < MIN_KEY_LENGTH || !sent) return false;
  return timingSafeEqual(digest(sent), digest(expected)); // same length always, and no early exit
}

export async function GET(req: NextRequest): Promise<Response> {
  if (!readConfig().required && !statsKeyMatches(req.headers.get('x-api-key'))) return fail(401, MISSING_KEY);
  return json(stats(servedCount()), 200, { 'Cache-Control': 'no-store' });
}

export { notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE } from '@/lib/notFound';
