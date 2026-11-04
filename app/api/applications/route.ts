// ENDPOINT 7: POST /api/applications   (Statement 6)

import * as db from '@/db';
import { toApplication } from '@/mappers';
import { validateNewApplication } from '@/validation';
import { withOptionalAuth } from '@/lib/guards';
import { whyNotApplicant } from '@/lib/identity';
import { fail, json } from '@/lib/http';
import { StoreConflict, filledForApplicants } from '@/lib/conflict';
import type { NewApplication } from '@/lib/contract';

export const dynamic = 'force-dynamic';

export const POST = withOptionalAuth(async (_req, { body, user }) => {
  // 1. Validate the body. Nothing is written if this fails.
  const problem = validateNewApplication(body);
  if (problem) return fail(400, problem);
  const b = body as NewApplication;

  // 2. Who is applying. No login is needed, and a partner sends its own ID for the student. A login that is
  //    sent is checked, and an account ID (usr_...) may only be used by that student, logged in (lib/identity.ts).
  const studentId = b.studentId.trim();
  const refused = whyNotApplicant(studentId, user);
  if (refused) return fail(...refused);

  // 3. The job it refers to must exist, still be open, and not be filled. A job has one place: an open
  //    job that already has an accepted applicant tells the applicant it is filled. (A closed job keeps
  //    its message from before, word for word, as Endpoints 1 to 21 must answer exactly as they did.)
  const jobId = b.jobId.trim();
  const job = await db.findJobById(jobId);
  if (!job) return fail(400, `jobId ${jobId} does not match any job`);
  const closed = (): Response => fail(409, `Job ${jobId} is ${job.listing_status === 'active' ? 'closed' : job.listing_status} and is not accepting applications`);
  if (job.listing_status !== 'active') return closed();
  if (await db.findAcceptedApplication(jobId)) return fail(409, filledForApplicants(jobId));

  // 4. Write, then return the new resource shaped exactly like the contract. The store checks the job
  //    again as it writes, in case it filled or closed a moment ago.
  let row;
  try {
    row = await db.createApplication({
      jobId,
      studentId,
      preferredAt: new Date(b.preferredDate),
      note: b.note === undefined ? '' : b.note,
    });
  } catch (err) {
    if (err instanceof StoreConflict && err.reason === 'filled') return fail(409, filledForApplicants(jobId));
    if (err instanceof StoreConflict && err.reason === 'closed') return closed();
    throw err;
  }
  return json(toApplication(row), 201, { Location: `/api/applications/${row._id}` });
});

export { notFound as GET, notFound as PUT, notFound as PATCH, notFound as DELETE } from '@/lib/notFound';
