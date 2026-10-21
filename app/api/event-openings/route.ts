// ENDPOINT 22: GET /api/event-openings?county=Nairobi   (website need W7, Sherehe needs K1 and K2)
// Only ever reaches Sherehe through clients/shereheClient. When Sherehe cannot be used the shared
// wrapper in lib/guards answers 502 in our own words, and Endpoints 1 to 21 never notice.

import * as shereheClient from '@/clients/shereheClient';
import { toEventOpening } from '@/mappers';
import { requireRole, withAuth } from '@/lib/guards';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = withAuth(requireRole('employer')(async (req) => {
  const raw = new URL(req.url).searchParams.getAll('county');
  const county = raw.length === 1 ? raw[0].trim() : '';
  if (county.length > 60) return json([]); // no county has a name this long, so nothing matches
  const found = await shereheClient.findOpenings({ county: county || undefined });
  return json(found.map(({ event, role }) => toEventOpening(event, role)));
}));

export { notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE } from '@/lib/notFound';
