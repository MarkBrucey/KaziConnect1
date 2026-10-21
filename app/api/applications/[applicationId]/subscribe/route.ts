// ENDPOINT 6 over plain HTTP (for example from Swagger UI's Try it out).
// Real WebSocket connections never reach this handler: they are taken over by the upgrade
// handler in realtime.ts, which app.ts attaches to the server.   (Statement 5)

import * as db from '@/db';
import { handle } from '@/lib/guards';
import type { PublicContext } from '@/lib/guards';
import { empty } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = handle(async (_req, { params }: PublicContext<{ applicationId: string }>) => {
  const row = await db.findApplicationById(params.applicationId);
  if (!row) return empty(404);
  return empty(426, { Upgrade: 'websocket' });
});

export { notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE } from '@/lib/notFound';
