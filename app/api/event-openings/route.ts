// ENDPOINT 22: GET /api/event-openings?county=Nairobi   (website need W7, Sherehe needs K1 and K2)
// Only ever reaches Sherehe through clients/shereheClient. When Sherehe cannot be used the shared
// wrapper in lib/guards answers 502 in our own words, and Endpoints 1 to 21 never notice.
//
// Week 11: every answer says how fresh it is, in two headers, so the list itself (the body) stays exactly the
// EventOpening[] it always was:
//   Kazi-Stale: false   live from Sherehe (through the 5-minute cache)      Kazi-As-Of: when Kazi built the list
//   Kazi-Stale: true    Sherehe failed, so this is the last list we had     Kazi-As-Of: when that list was saved
// With nothing saved, a failure is still the 502. See lib/savedOpenings.ts.

import * as shereheClient from '@/clients/shereheClient';
import { UpstreamError, logUpstream } from '@/clients/upstreamError';
import { toEventOpening } from '@/mappers';
import { requireRole, withAuth } from '@/lib/guards';
import { json } from '@/lib/http';
import * as saved from '@/lib/savedOpenings';

export const dynamic = 'force-dynamic';

const freshness = (stale: boolean, asOf: string): Record<string, string> => ({ 'Kazi-Stale': String(stale), 'Kazi-As-Of': asOf });

export const GET = withAuth(requireRole('employer')(async (req) => {
  const raw = new URL(req.url).searchParams.getAll('county');
  const county = raw.length === 1 ? raw[0].trim() : '';
  if (county.length > 60) return json([], 200, freshness(false, new Date().toISOString())); // no county has a name this long, so nothing matches
  try {
    const found = await shereheClient.findOpenings({ county: county || undefined });
    const data = found.map(({ event, role }) => toEventOpening(event, role));
    return json(data, 200, freshness(false, saved.remember(county, data)));
  } catch (err) {
    const copy = err instanceof UpstreamError ? saved.recall(county) : null;
    if (!copy) throw err; // nothing saved: the guard logs it and answers 502
    logUpstream(err, 'event openings (served the saved list instead)');
    return json(copy.data, 200, freshness(true, copy.asOf));
  }
}));

export { notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE } from '@/lib/notFound';
