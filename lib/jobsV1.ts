// Version 1 of the job list (Endpoints 1 and 2), shared by GET /api/jobs and GET /api/v1/jobs.
// FROZEN: a bare list of Job, an empty 400 for a query that is not valid. Do not change the shape of anything here;
// Ujuzi reads it. The only Week 13 addition is the Deprecation, Sunset and Link headers.

import { deprecated, JOBS_V1 } from '../deprecate';
import { handle } from './guards';
import { empty, json } from './http';
import { findJobList } from './jobs';

export const listJobsV1 = deprecated(handle(async (req) => {
  const list = await findJobList(req);
  return list ? json(list) : empty(400);
}), JOBS_V1);
