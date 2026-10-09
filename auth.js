// Accounts: password hashing, login tokens, and the checks routes use.
//
// Passwords are never stored. Each one is run through scrypt (built into Node)
// with its own random salt, and only the result is kept. Login tokens are long
// random strings; the database stores only their SHA-256 hash, so a leaked
// database does not reveal anyone's token.

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const SESSION_DAYS = 7;

function hashPasswordSync(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const newToken = () => crypto.randomBytes(32).toString('hex');
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const sessionExpiry = () => new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

// Route guard: the request must carry a valid "Authorization: Bearer <token>".
// On success req.user is the user's database row.
function authenticate(db) {
  return async (req, res, next) => {
    const header = req.get('authorization') || '';
    const match = /^Bearer\s+([a-f0-9]{64})$/i.exec(header.trim());
    if (!match) {
      return res.status(401).json({ message: 'Log in first, then send your token as: Authorization: Bearer <token>' });
    }
    const session = await db.findSession(hashToken(match[1]));
    if (!session || new Date(session.expires_at) <= new Date()) {
      return res.status(401).json({ message: 'Your session has expired or is not valid. Log in again.' });
    }
    const user = await db.findUserById(session.user_id);
    if (!user) return res.status(401).json({ message: 'Your session is not valid. Log in again.' });
    req.user = user;
    req.tokenHash = hashToken(match[1]);
    next();
  };
}

// Route guard: the logged in user must have this role.
function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) {
      const who = role === 'employer' ? 'employers' : 'students';
      return res.status(403).json({ message: `Only ${who} can do this.` });
    }
    next();
  };
}

module.exports = { hashPasswordSync, hashPassword, verifyPassword, newToken, hashToken, sessionExpiry, authenticate, requireRole };
