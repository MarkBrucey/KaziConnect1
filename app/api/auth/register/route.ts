// ENDPOINT 10: POST /api/auth/register   (website need W1)

import * as db from '@/db';
import { hashPassword } from '@/auth';
import { validateRegistration } from '@/validation';
import { handle } from '@/lib/guards';
import { fail, json } from '@/lib/http';
import { startSession } from '@/lib/session';
import type { NewUser } from '@/lib/contract';

export const dynamic = 'force-dynamic';

export const POST = handle(async (_req, { body }) => {
  const problem = validateRegistration(body);
  if (problem) return fail(400, problem);
  const b = body as NewUser;
  const user = await db.createUser({
    name: b.name.trim(),
    email: b.email.trim().toLowerCase(),
    passwordHash: await hashPassword(b.password),
    role: b.role,
  });
  if (!user) return fail(409, 'An account with this email already exists. Log in instead.');
  return json(await startSession(user), 201);
});

export { notFound as GET, notFound as PUT, notFound as PATCH, notFound as DELETE } from '@/lib/notFound';
