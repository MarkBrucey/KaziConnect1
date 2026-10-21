// ENDPOINT 15: GET /api/me/jobs   (website need W2) employers only

import * as db from '@/db';
import { toEmployerJob } from '@/mappers';
import { requireRole, withAuth } from '@/lib/guards';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = withAuth(requireRole('employer')(async (_req, { user }) => {
  const rows = await db.findJobsByEmployer(user._id);
  const jobs = await Promise.all(rows.map(async (row) => toEmployerJob(row, await db.countPendingApplications(row._id))));
  return json(jobs);
}));

export { notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE } from '@/lib/notFound';
