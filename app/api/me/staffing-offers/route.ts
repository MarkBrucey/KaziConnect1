// ENDPOINT 24: GET /api/me/staffing-offers   (website need W7)
// Reads our own database only, so it works whether or not Sherehe is up. The poller keeps the
// statuses current.

import * as db from '@/db';
import { toStaffingOffer } from '@/mappers';
import { requireRole, withAuth } from '@/lib/guards';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = withAuth(requireRole('employer')(async (_req, { user }) => {
  return json((await db.findStaffingOffersByEmployer(user._id)).map(toStaffingOffer));
}));

export { notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE } from '@/lib/notFound';
