// ENDPOINT 4: GET /api/jobs/{jobId}/status   (Statement 3)

import * as db from '@/db';
import { toJobStatus } from '@/mappers';
import { handle } from '@/lib/guards';
import type { PublicContext } from '@/lib/guards';
import { empty, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = handle(async (_req, { params }: PublicContext<{ jobId: string }>) => {
  const row = await db.findJobById(params.jobId);
  if (!row) return empty(404);
  return json(toJobStatus(row));
});

export { notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE } from '@/lib/notFound';
