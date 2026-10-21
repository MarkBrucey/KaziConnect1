// ENDPOINT 5: GET /api/applications/{applicationId}/status   (Statement 5)

import * as db from '@/db';
import { toApplicationStatus } from '@/mappers';
import { handle } from '@/lib/guards';
import type { PublicContext } from '@/lib/guards';
import { empty, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = handle(async (_req, { params }: PublicContext<{ applicationId: string }>) => {
  const row = await db.findApplicationById(params.applicationId);
  if (!row) return empty(404);
  return json(toApplicationStatus(row));
});

export { notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE } from '@/lib/notFound';
