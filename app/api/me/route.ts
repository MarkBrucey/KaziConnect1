// ENDPOINT 13: GET /api/me   (website need W1)

import { toUser } from '@/mappers';
import { withAuth } from '@/lib/guards';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = withAuth((_req, { user }) => json(toUser(user)));

export { notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE } from '@/lib/notFound';
