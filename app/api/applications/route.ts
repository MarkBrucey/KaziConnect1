// ENDPOINT 7: POST /api/applications   (Statement 6)

import * as db from '@/db';
import { toApplication } from '@/mappers';
import { validateNewApplication } from '@/validation';
import { handle } from '@/lib/guards';
import { fail, json } from '@/lib/http';
import type { NewApplication } from '@/lib/contract';

export const dynamic = 'force-dynamic';

export const POST = handle(async (_req, { body }) => {
  // 1. Validate the body. Nothing is written if this fails.
  const problem = validateNewApplication(body);
  if (problem) return fail(400, problem);
  const b = body as NewApplication;

  // 2. The job it refers to must exist and still be open.
  const jobId = b.jobId.trim();
  const job = await db.findJobById(jobId);
  if (!job) return fail(400, `jobId ${jobId} does not match any job`);
  if (job.listing_status !== 'active') {
    return fail(409, `Job ${jobId} is ${job.listing_status} and is not accepting applications`);
  }

  // 3. Write, then return the new resource shaped exactly like the contract.
  const row = await db.createApplication({
    jobId,
    studentId: b.studentId.trim(),
    preferredAt: new Date(b.preferredDate),
    note: b.note === undefined ? '' : b.note,
  });
  return json(toApplication(row), 201, { Location: `/api/applications/${row._id}` });
});

export { notFound as GET, notFound as PUT, notFound as PATCH, notFound as DELETE } from '@/lib/notFound';
