// ENDPOINT 1: GET /api/jobs?status=active                                    (Statement 1)
// ENDPOINT 2: GET /api/jobs?county=Nairobi&category=accommodation&status=active (Statement 2)
// Both are the same route: county and category are optional filters.
// ENDPOINT 14: POST /api/jobs   (website need W2) employers only

import * as db from '@/db';
import { toJob } from '@/mappers';
import { validateNewJob } from '@/validation';
import { handle, requireRole, withAuth } from '@/lib/guards';
import type { AuthedContext } from '@/lib/guards';
import { empty, fail, json, readQuery } from '@/lib/http';
import type { NewJob } from '@/lib/contract';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const q = readQuery(req, ['status'], ['county', 'category']);
  if (!q) return empty(400);
  return json((await db.findJobs(q)).map(toJob));
});

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
