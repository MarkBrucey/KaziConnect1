// ENDPOINT 25: DELETE /api/staffing-offers/{offerId}   (website need W7, Sherehe need K5)

import * as db from '@/db';
import * as shereheClient from '@/clients/shereheClient';
import { PartnerRejection } from '@/clients/upstreamError';
import { requireRole, withAuth } from '@/lib/guards';
import type { AuthedContext } from '@/lib/guards';
import { fail, noContent } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const DELETE = withAuth(requireRole('employer')(async (_req, { params, user }: AuthedContext<{ offerId: string }>) => {
  const id = params.offerId;
  const row = await db.findStaffingOfferById(id);
  if (!row) return fail(404, `Staffing offer ${id} not found`);
  if (row.employer_id !== user._id) return fail(403, 'You can only withdraw offers you made.');
  if (row.status !== 'pending') return fail(409, `This offer is already ${row.status}, so it can no longer be withdrawn.`);

  try {
    await shereheClient.withdrawOffer(row.sherehe_offer_id); // 'gone' (Sherehe no longer has it) is as good as withdrawn
  } catch (err) {
    if (err instanceof PartnerRejection) return fail(409, 'The organiser has already accepted or declined this offer, so it can no longer be withdrawn.');
    throw err;
  }
  await db.deleteStaffingOffer(id);
  return noContent();
}));

export { notFound as GET, notFound as POST, notFound as PUT, notFound as PATCH } from '@/lib/notFound';
