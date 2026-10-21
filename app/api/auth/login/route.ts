// ENDPOINT 11: POST /api/auth/login   (website need W1)
// The same message for an unknown email and a wrong password, so the reply
// never reveals which emails have accounts.

import * as db from '@/db';
import { verifyPassword } from '@/auth';
import { validateLogin } from '@/validation';
import { handle } from '@/lib/guards';
import { fail, json } from '@/lib/http';
import { startSession } from '@/lib/session';
import type { Credentials } from '@/lib/contract';

export const dynamic = 'force-dynamic';

export const POST = handle(async (_req, { body }) => {
  const problem = validateLogin(body);
  if (problem) return fail(400, problem);
  const b = body as Credentials;
  const user = await db.findUserByEmail(b.email.trim().toLowerCase());
  const ok = user && await verifyPassword(b.password, user.password_hash);
  if (!user || !ok) return fail(401, 'Email or password is incorrect.');
  return json(await startSession(user));
});

export { notFound as GET, notFound as PUT, notFound as PATCH, notFound as DELETE } from '@/lib/notFound';
