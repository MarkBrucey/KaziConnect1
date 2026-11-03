// ENDPOINT 23: POST /api/staffing-offers   (website need W7, Sherehe need K3)

import * as db from '@/db';
import * as shereheClient from '@/clients/shereheClient';
import { PartnerRejection, UpstreamError, logUpstream } from '@/clients/upstreamError';
import { toJobInput, toStaffingOffer } from '@/mappers';
import { validateStaffingOffer } from '@/validation';
import { requireRole, withAuth } from '@/lib/guards';
import type { AuthedContext } from '@/lib/guards';
import { fail, json } from '@/lib/http';
import { PARTNER_UNAVAILABLE, ROLE_TAKEN } from '@/lib/eventWork';
import type { NewStaffingOffer } from '@/lib/contract';

export const dynamic = 'force-dynamic';

export const POST = withAuth(requireRole('employer')(async (_req, { user, body }: AuthedContext<Record<string, never>>) => {
  // 1. Validate the body. Nothing is sent or written if this fails.
  const problem = validateStaffingOffer(body);
  if (problem) return fail(400, problem);
  const b = body as NewStaffingOffer;
  const roleId = b.roleId.trim();

  // 2. The role must be an open one on an upcoming event, and have no offer waiting already.
  const opening = await shereheClient.findOpening(roleId);
  if (!opening) return fail(404, `No open role with the id ${roleId}`);
  if (await db.findPendingStaffingOffer(roleId)) return fail(409, ROLE_TAKEN);

  // 3. Make the offer at Sherehe. Sherehe has the last word on free slots.
  let made;
  try {
    made = await shereheClient.createOffer({ roleId, workersOffered: b.workersOffered, note: b.note });
  } catch (err) {
    if (!(err instanceof PartnerRejection)) throw err;
    if (err.kind === 'invalid') return fail(400, 'workersOffered must be a whole number from 1 up to the free slots on this role');
    if (err.kind === 'not_found') return fail(404, `No open role with the id ${roleId}`);
    return fail(409, ROLE_TAKEN);
  }

  // 4. Keep our side. The job to open on acceptance is worked out now, from the role as the
  //    employer saw it, so the poller later needs nothing from Sherehe but the offer's status.
  const row = await db.createStaffingOffer({
    employerId: user._id,
    shereheOfferId: made.id,
    roleId,
    eventName: opening.event.name,
    workersOffered: b.workersOffered,
    jobDraft: toJobInput(opening.event, opening.role),
  });
  if (!row) {
    // The data store refused the new row. Normally another request made an offer on this role at
    // the same moment and won: take ours back from Sherehe so the organiser is not shown two.
    if (await db.findPendingStaffingOffer(roleId)) {
      await shereheClient.withdrawOffer(made.id).catch((err: unknown) => logUpstream(err, 'withdrawing a duplicate offer'));
      return fail(409, ROLE_TAKEN);
    }
    // Otherwise Sherehe gave us an offer id we already hold (for example after it restarted and
    // began numbering again). We cannot tell whose offer that id is now, so we withdraw nothing.
    logUpstream(new UpstreamError('shape', { detail: 'Sherehe returned an offer id we already hold' }), 'POST /api/staffing-offers');
    return fail(502, PARTNER_UNAVAILABLE);
  }
  return json(toStaffingOffer(row), 201);
}));

export { notFound as GET, notFound as PUT, notFound as PATCH, notFound as DELETE } from '@/lib/notFound';
