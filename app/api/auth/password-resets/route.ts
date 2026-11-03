// ENDPOINT 20: POST /api/auth/password-resets   (website need W6)
// Always the same 202 reply, so it never reveals which emails have accounts.
// At most 3 reset emails per account per hour, so nobody can flood an inbox.

import * as db from '@/db';
import { hashToken, newToken } from '@/auth';
import { sendPasswordReset } from '@/mailer';
import { validatePasswordResetRequest } from '@/validation';
import { handle } from '@/lib/guards';
import { fail, json } from '@/lib/http';
import type { PasswordResetRequest } from '@/lib/contract';

export const dynamic = 'force-dynamic';

const RESET_MINUTES = 30;
const RESETS_PER_HOUR = 3;
const RESET_REPLY = { message: 'If an account exists for that email, we have sent a link to reset its password. The link works for 30 minutes.' };

export const POST = handle(async (_req, { body }) => {
  const problem = validatePasswordResetRequest(body);
  if (problem) return fail(400, problem);
  const user = await db.findUserByEmail((body as PasswordResetRequest).email.trim().toLowerCase());
  if (user) {
    const recent = await db.countPasswordResetsSince(user._id, new Date(Date.now() - 60 * 60 * 1000));
    if (recent < RESETS_PER_HOUR) {
      const token = newToken();
      await db.createPasswordReset({ tokenHash: hashToken(token), userId: user._id, expiresAt: new Date(Date.now() + RESET_MINUTES * 60 * 1000) });
      await sendPasswordReset({ to: user.email, name: user.full_name, token });
    }
  }
  return json(RESET_REPLY, 202);
});

export { notFound as GET, notFound as PUT, notFound as PATCH, notFound as DELETE } from '@/lib/notFound';
