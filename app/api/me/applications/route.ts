// ENDPOINT 19: GET /api/me/applications   (website need W5) students only

import * as db from '@/db';
import { toApplication } from '@/mappers';
import { requireRole, withAuth } from '@/lib/guards';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = withAuth(requireRole('student')(async (_req, { user }) => {
  return json((await db.findApplicationsByStudent(user._id)).map(toApplication));
}));

export { notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE } from '@/lib/notFound';
