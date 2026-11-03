// ENDPOINT 16: GET /api/jobs/{jobId}/applications   (website need W3) the job's employer only

import * as db from '@/db';
import { toApplicant } from '@/mappers';
import { requireRole, withAuth } from '@/lib/guards';
import type { AuthedContext } from '@/lib/guards';
import { json } from '@/lib/http';
import { ownJob } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

export const GET = withAuth(requireRole('employer')(async (_req, { params, user }: AuthedContext<{ jobId: string }>) => {
  const job = await ownJob(params.jobId, user);
  if (job instanceof Response) return job;
  const rows = await db.findApplicationsByJob(job._id);
  // Add the applicant's name when the application came from a Kazi Connect account.
  const applicants = await Promise.all(rows.map(async (row) => {
    const account = row.student_id.startsWith('usr_') ? await db.findUserById(row.student_id) : null;
    return toApplicant(row, account);
  }));
  return json(applicants);
}));

export { notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE } from '@/lib/notFound';
