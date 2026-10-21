// ENDPOINT 3: GET /api/jobs/{jobId}   (Statements 3 and 4)
// ENDPOINT 17: PATCH /api/jobs/{jobId}   (website need W4) close or reopen, the job's employer only.
// Closing a job marks every application still waiting on it as filled.

import * as db from '@/db';
import { toJob } from '@/mappers';
import { validateJobStatusUpdate } from '@/validation';
import { handle, requireRole, withAuth } from '@/lib/guards';
import type { AuthedContext, PublicContext } from '@/lib/guards';
import { empty, fail, json } from '@/lib/http';
import { ownJob } from '@/lib/jobs';
import type { JobStatusUpdate } from '@/lib/contract';

export const dynamic = 'force-dynamic';

type Params = { jobId: string };

export const GET = handle(async (_req, { params }: PublicContext<Params>) => {
  const row = await db.findJobById(params.jobId);
  if (!row) return empty(404);
  return json(toJob(row));
});

export const PATCH = withAuth(requireRole('employer')(async (_req, { params, user, body }: AuthedContext<Params>) => {
  const problem = validateJobStatusUpdate(body);
  if (problem) return fail(400, problem);
  const job = await ownJob(params.jobId, user);
  if (job instanceof Response) return job;
  const updated = await db.setJobStatus(job._id, (body as JobStatusUpdate).status);
  return json(toJob(updated!));
}));

export { notFound as POST, notFound as PUT, notFound as DELETE } from '@/lib/notFound';
