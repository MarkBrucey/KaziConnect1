// ENDPOINT 8: PUT /api/applications/{applicationId}   (Statement 7)
// ENDPOINT 18: PATCH /api/applications/{applicationId}   (website need W3)
//   The employer who posted the job accepts an application. Every other waiting application for that
//   job becomes filled, the job closes, and WebSocket subscribers hear about each change straight away.
// ENDPOINT 9: DELETE /api/applications/{applicationId}   (Statement 8)

import * as db from '@/db';
import { toApplication } from '@/mappers';
import { validateApplicationDecision, validateApplicationUpdate } from '@/validation';
import { handle, requireRole, withAuth } from '@/lib/guards';
import type { AuthedContext, PublicContext } from '@/lib/guards';
import { fail, json, noContent } from '@/lib/http';
import type { ApplicationUpdate } from '@/lib/contract';

export const dynamic = 'force-dynamic';

type Params = { applicationId: string };

export const PUT = handle(async (_req, { params, body }: PublicContext<Params>) => {
  const id = params.applicationId;

  // 1. Validate the body.
  const problem = validateApplicationUpdate(body);
  if (problem) return fail(400, problem);
  const b = body as ApplicationUpdate;

  // 2. It must already exist. A PUT never quietly becomes a create.
  const row = await db.findApplicationById(id);
  if (!row) return fail(404, `Application ${id} not found`);

  // 3. Only pending applications can be changed.
  if (row.application_status !== 'pending') {
    return fail(409, `Application ${id} is ${row.application_status}; only pending applications can be changed`);
  }

  // 4. Set the absolute state. Leaving note out clears it, so the same
  //    request sent twice always gives the same result.
  const updated = await db.replaceApplicationDetails(id, {
    preferredAt: new Date(b.preferredDate),
    note: b.note === undefined ? '' : b.note,
  });
  return json(toApplication(updated!));
});

export const PATCH = withAuth(requireRole('employer')(async (_req, { params, user, body }: AuthedContext<Params>) => {
  const id = params.applicationId;
  const problem = validateApplicationDecision(body);
  if (problem) return fail(400, problem);
  const row = await db.findApplicationById(id);
  if (!row) return fail(404, `Application ${id} not found`);
  const job = await db.findJobById(row.job_ref);
  if (!job || job.employer_id !== user._id) return fail(403, 'You can only decide on applications for jobs you posted.');
  if (row.application_status !== 'pending') {
    return fail(409, `Application ${id} is ${row.application_status}; only pending applications can be accepted`);
  }
  return json(toApplication((await db.acceptApplication(id))!));
}));

export const DELETE = handle(async (_req, { params }: PublicContext<Params>) => {
  const id = params.applicationId;

  // 1. It must exist.
  const row = await db.findApplicationById(id);
  if (!row) return fail(404, `Application ${id} not found`);

  // 2. Only pending applications can be cancelled.
  if (row.application_status !== 'pending') {
    return fail(409, `Application ${id} is ${row.application_status}; only pending applications can be cancelled`);
  }

  // 3. Delete it for real, then answer 204 with no body.
  await db.deleteApplication(id);
  return noContent();
});

export { notFound as GET, notFound as POST } from '@/lib/notFound';
