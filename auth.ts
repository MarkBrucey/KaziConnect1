// Accounts: password hashing and login tokens.
//
// Passwords are never stored. Each one is run through scrypt (built into Node)
// with its own random salt, and only the result is kept. Login tokens are long
// random strings; the database stores only their SHA-256 hash, so a leaked
// database does not reveal anyone's token.
//
// The checks routes make (is there a valid token, is this the right role) are in lib/guards.ts.

import crypto from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEY_LENGTH = 64;
const SESSION_DAYS = 7;

export function hashPasswordSync(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const [scheme, saltHex, hashHex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

export const newToken = (): string => crypto.randomBytes(32).toString('hex');
export const hashToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');
export const sessionExpiry = (): Date => new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
