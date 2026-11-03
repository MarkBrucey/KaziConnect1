// ENDPOINT 21: PUT /api/auth/password   (website need W6)
// Sets a new password using the token from the reset email. The link works
// once, for 30 minutes. Afterwards the account is logged out everywhere.

import * as db from '@/db';
import { hashPassword, hashToken } from '@/auth';
import { validateNewPassword } from '@/validation';
import { handle } from '@/lib/guards';
import { fail, noContent } from '@/lib/http';
import type { NewPassword } from '@/lib/contract';

export const dynamic = 'force-dynamic';

const INVALID_LINK = 'This reset link is not valid or has expired. Ask for a new one.';

export const PUT = handle(async (_req, { body }) => {
  const problem = validateNewPassword(body);
  if (problem) return fail(400, problem);
  const b = body as NewPassword;
  const tokenHash = hashToken(b.token);
  const link = await db.findPasswordReset(tokenHash);
  const usable = link && !link.used_at && new Date(link.expires_at) > new Date();
  if (!link || !usable) return fail(400, INVALID_LINK);
  const done = await db.completePasswordReset({ tokenHash, userId: link.user_id, passwordHash: await hashPassword(b.password) });
  if (!done) return fail(400, INVALID_LINK);
  return noContent();
});

export { notFound as GET, notFound as POST, notFound as PATCH, notFound as DELETE } from '@/lib/notFound';
