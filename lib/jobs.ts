import * as db from '../db';
import { toJob } from '../mappers';
import { fail, readQuery } from './http';
import type { Job } from './contract';
import type { JobRow, UserRow } from './storeTypes';

// The job list behind Endpoints 1 and 2 (v1) and GET /api/v2/jobs: the same query rules and the same data in
// every version; only the shape of the answer differs. null means the query is not valid (the 400).
export async function findJobList(req: Request): Promise<Job[] | null> {
  const q = readQuery(req, ['status'], ['county', 'category']);
  if (!q) return null;
  return (await db.findJobs(q)).map(toJob);
}

// The job must exist and belong to the logged in employer. Returns the job row, or the 404 / 403 to send.
export async function ownJob(jobId: string, user: UserRow): Promise<JobRow | Response> {
  const job = await db.findJobById(jobId);
  if (!job) return fail(404, `Job ${jobId} not found`);
  if (job.employer_id !== user._id) return fail(403, 'You can only manage jobs you posted.');
  return job;
}
