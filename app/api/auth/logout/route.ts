// ENDPOINT 12: POST /api/auth/logout   (website need W1)

import * as db from '@/db';
import { withAuth } from '@/lib/guards';
import { noContent } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (_req, { tokenHash }) => {
  await db.deleteSession(tokenHash);
  return noContent();
});

export { notFound as GET, notFound as PUT, notFound as PATCH, notFound as DELETE } from '@/lib/notFound';
