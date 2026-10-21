import * as db from '../db';
import { hashToken, newToken, sessionExpiry } from '../auth';
import { toUser } from '../mappers';
import type { AuthResponse } from './contract';
import type { UserRow } from './storeTypes';

// Logs a user in: makes a token, keeps only its hash, and returns the token with the user.
export async function startSession(user: UserRow): Promise<AuthResponse> {
  const token = newToken();
  await db.createSession({ tokenHash: hashToken(token), userId: user._id, expiresAt: sessionExpiry() });
  return { token, user: toUser(user) };
}
