// ENDPOINT 7: POST /api/applications   (Statement 6)

import * as db from '@/db';
import { toApplication } from '@/mappers';
import { validateNewApplication } from '@/validation';
import { handle } from '@/lib/guards';
import { fail, json } from '@/lib/http';
import { StoreConflict, filledForApplicants } from '@/lib/conflict';
import type { NewApplication } from '@/lib/contract';

export const dynamic = 'force-dynamic';

export const POST = handle(async (_req, { body }) => {
  // 1. Validate the body. Nothing is written if this fails.
  const problem = validateNewApplication(body);
  if (problem) return fail(400, problem);
  const b = body as NewApplication;

  // 2. The job it refers to must exist, still be open, and not be filled. A job has one place: an open
  //    job that already has an accepted applicant tells the applicant it is filled. (A closed job keeps
  //    its message from before, word for word, as Endpoints 1 to 21 must answer exactly as they did.)
  const jobId = b.jobId.trim();
  const job = await db.findJobById(jobId);
  if (!job) return fail(400, `jobId ${jobId} does not match any job`);
  const closed = (): Response => fail(409, `Job ${jobId} is ${job.listing_status === 'active' ? 'closed' : job.listing_status} and is not accepting applications`);
  if (job.listing_status !== 'active') return closed();
  if (await db.findAcceptedApplication(jobId)) return fail(409, filledForApplicants(jobId));

  // 3. Write, then return the new resource shaped exactly like the contract. The store checks the job
  //    again as it writes, in case it filled or closed a moment ago.
  let row;
  try {
    row = await db.createApplication({
      jobId,
      studentId: b.studentId.trim(),
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
