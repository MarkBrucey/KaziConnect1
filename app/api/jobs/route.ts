// ENDPOINT 1: GET /api/jobs?status=active                                    (Statement 1)
// ENDPOINT 2: GET /api/jobs?county=Nairobi&category=accommodation&status=active (Statement 2)
// Both are the same route: county and category are optional filters. Deprecated in Week 13 (1.4.0): same answers,
// plus Deprecation, Sunset and Link headers. GET /api/v1/jobs is the same endpoint under a versioned address.
// ENDPOINT 14: POST /api/jobs   (website need W2) employers only. Not deprecated.

import * as db from '@/db';
import { toJob } from '@/mappers';
import { validateNewJob } from '@/validation';
import { requireRole, withAuth } from '@/lib/guards';
import type { AuthedContext } from '@/lib/guards';
import { fail, json } from '@/lib/http';
import { listJobsV1 } from '@/lib/jobsV1';
import type { NewJob } from '@/lib/contract';

export const dynamic = 'force-dynamic';

// Version 1 of the list, unchanged since Week 5 apart from three headers saying it is deprecated (Week 13):
// a bare list. Its successor, GET /api/v2/jobs, wraps the same list as { data, count }. See deprecate.ts.
export const GET = listJobsV1;

export const POST = withAuth(requireRole('employer')(async (_req, { user, body }: AuthedContext<Record<string, never>>) => {
  const problem = validateNewJob(body);
  if (problem) return fail(400, problem);
  const b = body as NewJob;
  const row = await db.createJob({
    employerId: user._id,
    title: b.title.trim(),
    category: b.category.trim().toLowerCase(),
    county: b.county.trim(),
    area: b.area.trim(),
    duration: b.duration.trim(),
    urgent: b.urgent === true,
    payMin: b.payRange.min,
    payMax: b.payRange.max,
  });
  return json(toJob(row), 201, { Location: `/api/jobs/${row._id}` });
}));

export { notFound as PUT, notFound as PATCH, notFound as DELETE } from '@/lib/notFound';
