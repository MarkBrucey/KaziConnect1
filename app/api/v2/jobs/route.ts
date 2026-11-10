// ENDPOINT 27: GET /api/v2/jobs?status=active[&county=...][&category=...]   version 2 of the job list (Week 13)
//
// The one change from v1: the list is wrapped, [ ... ] becomes { "data": [ ... ], "count": N }, so paging can be
// added later (a page number, a next link) without breaking anyone again. Everything else is as in v1: the same
// query parameters, the same jobs with the same fields, the same empty 400 for a query that is not valid, the same
// API key. Same data, a different view: the list itself comes from lib/jobs.ts, shared with v1.

import { handle } from '@/lib/guards';
import { empty, json } from '@/lib/http';
import { findJobList } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const data = await findJobList(req);
  if (!data) return empty(400);
  return json({ data, count: data.length });
});

export { notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE } from '@/lib/notFound';
