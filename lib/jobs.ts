import * as db from '../db';
import { fail } from './http';
import type { JobRow, UserRow } from './storeTypes';

// The job must exist and belong to the logged in employer. Returns the job row, or the 404 / 403 to send.
export async function ownJob(jobId: string, user: UserRow): Promise<JobRow | Response> {
  const job = await db.findJobById(jobId);
  if (!job) return fail(404, `Job ${jobId} not found`);
  if (job.employer_id !== user._id) return fail(403, 'You can only manage jobs you posted.');
  return job;
}
