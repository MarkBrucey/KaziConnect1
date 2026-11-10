// ENDPOINT 26: GET /api/stats   (Week 12, monitoring)
// How the API is being used since this server started: requests, 4xx and 5xx counts, error rate, average time,
// a breakdown per route, and how often Sherehe had to be retried or saved data shown. It shows every caller's
// traffic, so only the "team" key may read it, and only when API keys are switched on at all.

import type { NextRequest } from 'next/server';
import { identify, readConfig } from '@/lib/apiKeys';
import { fail, json } from '@/lib/http';
import { snapshot } from '@/monitoring';

export const dynamic = 'force-dynamic';

export const TEAM_CONSUMER = 'team';

export async function GET(req: NextRequest): Promise<Response> {
  const config = readConfig();
  if (!config.required) return fail(403, 'Statistics are only available when API keys are switched on (set API_KEYS).');
  const consumer = identify(req.headers.get('x-api-key'), config);
  if (!consumer || consumer.name !== TEAM_CONSUMER) return fail(403, 'Statistics are for the team key only.');
  return json(snapshot());
}

export { notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE } from '@/lib/notFound';
