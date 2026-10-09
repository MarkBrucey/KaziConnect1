// Accounts (added after Week 7): register, log in, log out, and "my" lists.

const express = require('express');
const db = require('./db');
const { toUser, toEmployerJob, toApplication } = require('./mappers');
const { hashPassword, verifyPassword, newToken, hashToken, sessionExpiry, authenticate, requireRole } = require('./auth');
const { validateRegistration, validateLogin, validatePasswordResetRequest, validateNewPassword } = require('./validation');
const mailer = require('./mailer');

const auth = express.Router();
const me = express.Router();
const fail = (res, status, message) => res.status(status).json({ message });
const loggedIn = authenticate(db);

async function startSession(user) {
  const token = newToken();
  await db.createSession({ tokenHash: hashToken(token), userId: user._id, expiresAt: sessionExpiry() });
  return { token, user: toUser(user) };
}

// ENDPOINT 10: POST /api/auth/register   (FundiLink Statement F1)
auth.post('/register', async (req, res) => {
  const problem = validateRegistration(req.body);
  if (problem) return fail(res, 400, problem);
  const user = await db.createUser({
    name: req.body.name.trim(),
    email: req.body.email.trim().toLowerCase(),
    passwordHash: await hashPassword(req.body.password),
    role: req.body.role,
  });
  if (!user) return fail(res, 409, 'An account with this email already exists. Log in instead.');
  res.status(201).json(await startSession(user));
});

// ENDPOINT 11: POST /api/auth/login   (FundiLink Statement F1)
// The same message for an unknown email and a wrong password, so the reply
// never reveals which emails have accounts.
auth.post('/login', async (req, res) => {
  const problem = validateLogin(req.body);
  if (problem) return fail(res, 400, problem);
  const user = await db.findUserByEmail(req.body.email.trim().toLowerCase());
  const ok = user && await verifyPassword(req.body.password, user.password_hash);
  if (!ok) return fail(res, 401, 'Email or password is incorrect.');
  res.status(200).json(await startSession(user));
});

// ENDPOINT 12: POST /api/auth/logout   (FundiLink Statement F1)
auth.post('/logout', loggedIn, async (req, res) => {
  await db.deleteSession(req.tokenHash);
  res.status(204).end();
});

const RESET_MINUTES = 30;
const RESETS_PER_HOUR = 3;
const RESET_REPLY = { message: 'If an account exists for that email, we have sent a link to reset its password. The link works for 30 minutes.' };

// ENDPOINT 20: POST /api/auth/password-resets   (FundiLink Statement F6)
// Always the same 202 reply, so it never reveals which emails have accounts.
// At most 3 reset emails per account per hour, so nobody can flood an inbox.
auth.post('/password-resets', async (req, res) => {
  const problem = validatePasswordResetRequest(req.body);
  if (problem) return fail(res, 400, problem);
  const user = await db.findUserByEmail(req.body.email.trim().toLowerCase());
  if (user) {
    const recent = await db.countPasswordResetsSince(user._id, new Date(Date.now() - 60 * 60 * 1000));
    if (recent < RESETS_PER_HOUR) {
      const token = newToken();
      await db.createPasswordReset({ tokenHash: hashToken(token), userId: user._id, expiresAt: new Date(Date.now() + RESET_MINUTES * 60 * 1000) });
      await mailer.sendPasswordReset({ to: user.email, name: user.full_name, token });
    }
  }
  res.status(202).json(RESET_REPLY);
});

// ENDPOINT 21: PUT /api/auth/password   (FundiLink Statement F6)
// Sets a new password using the token from the reset email. The link works
// once, for 30 minutes. Afterwards the account is logged out everywhere.
auth.put('/password', async (req, res) => {
  const problem = validateNewPassword(req.body);
  if (problem) return fail(res, 400, problem);
  const tokenHash = hashToken(req.body.token);
  const link = await db.findPasswordReset(tokenHash);
  const usable = link && !link.used_at && new Date(link.expires_at) > new Date();
  if (!usable) return fail(res, 400, 'This reset link is not valid or has expired. Ask for a new one.');
  const done = await db.completePasswordReset({ tokenHash, userId: link.user_id, passwordHash: await hashPassword(req.body.password) });
  if (!done) return fail(res, 400, 'This reset link is not valid or has expired. Ask for a new one.');
  res.status(204).end();
});

// ENDPOINT 13: GET /api/me   (FundiLink Statement F1)
me.get('/', loggedIn, (req, res) => res.status(200).json(toUser(req.user)));

// ENDPOINT 15: GET /api/me/jobs   (FundiLink Statement F2) employers only
me.get('/jobs', loggedIn, requireRole('employer'), async (req, res) => {
  const rows = await db.findJobsByEmployer(req.user._id);
  const jobs = await Promise.all(rows.map(async (row) => toEmployerJob(row, await db.countPendingApplications(row._id))));
  res.status(200).json(jobs);
});

// ENDPOINT 19: GET /api/me/applications   (FundiLink Statement F5) students only
me.get('/applications', loggedIn, requireRole('student'), async (req, res) => {
  res.status(200).json((await db.findApplicationsByStudent(req.user._id)).map(toApplication));
});

module.exports = { auth, me };
