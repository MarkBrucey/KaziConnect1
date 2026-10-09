// PostgreSQL store: used when DATABASE_URL is set (for example a free Neon
// database). Same functions as memoryStore.js. On first start it creates the
// tables and loads the sample data, so a brand new database works straight away.

const { EventEmitter } = require('events');
const { Pool } = require('pg');
const { SEED_JOBS, SEED_APPLICATIONS, FIRST_IDS, seedUsers } = require('./seedData');

const events = new EventEmitter();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
pool.on('error', (err) => console.error('Database connection error:', err.message)); // e.g. Neon going to sleep

const one = async (sql, params) => (await pool.query(sql, params)).rows[0] || null;
const many = async (sql, params) => (await pool.query(sql, params)).rows;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  _id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'employer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(_id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(_id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS jobs (
  _id TEXT PRIMARY KEY,
  job_title TEXT NOT NULL,
  job_category TEXT NOT NULL,
  county_name TEXT NOT NULL,
  area_name TEXT NOT NULL,
  duration_text TEXT NOT NULL,
  is_urgent BOOLEAN NOT NULL DEFAULT false,
  listing_status TEXT NOT NULL CHECK (listing_status IN ('active', 'closed')),
  pay_min NUMERIC(12, 2) NOT NULL,
  pay_max NUMERIC(12, 2) NOT NULL,
  employer_id TEXT REFERENCES users(_id),
  created_by TEXT,
  internal_notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS applications (
  _id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  job_ref TEXT NOT NULL REFERENCES jobs(_id),
  application_status TEXT NOT NULL CHECK (application_status IN ('pending', 'accepted', 'filled')),
  preferred_at TIMESTAMPTZ NOT NULL,
  student_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewer_notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS applications_job_ref ON applications (job_ref);
CREATE INDEX IF NOT EXISTS applications_student_id ON applications (student_id);
CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions (user_id);
CREATE SEQUENCE IF NOT EXISTS job_number_seq START ${FIRST_IDS.job};
CREATE SEQUENCE IF NOT EXISTS application_number_seq START ${FIRST_IDS.application};
CREATE SEQUENCE IF NOT EXISTS user_number_seq START ${FIRST_IDS.user};
`;

async function seed(client) {
  for (const u of seedUsers()) {
    await client.query('INSERT INTO users (_id, full_name, email, password_hash, role, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
      [u._id, u.full_name, u.email, u.password_hash, u.role, u.created_at]);
  }
  for (const j of SEED_JOBS) {
    await client.query(`INSERT INTO jobs (_id, job_title, job_category, county_name, area_name, duration_text, is_urgent, listing_status, pay_min, pay_max, employer_id, created_by, internal_notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
      [j._id, j.job_title, j.job_category, j.county_name, j.area_name, j.duration_text, j.is_urgent, j.listing_status, j.pay_min, j.pay_max, j.employer_id, j.created_by, j.internal_notes]);
  }
  for (const a of SEED_APPLICATIONS) {
    await client.query(`INSERT INTO applications (_id, student_id, job_ref, application_status, preferred_at, student_note, created_at, updated_at, reviewer_notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [a._id, a.student_id, a.job_ref, a.application_status, a.preferred_at, a.student_note, a.created_at, a.updated_at, a.reviewer_notes]);
  }
}

// Creates the tables if they are missing, and loads the sample data into an empty database.
async function init() {
  await pool.query(SCHEMA);
  const { n } = await one('SELECT count(*)::int AS n FROM jobs');
  if (n === 0) await seed(pool);
}

// Used only by the automated tests: wipe everything and reload the sample data.
async function reset() {
  await pool.query(SCHEMA);
  await pool.query('TRUNCATE password_resets, sessions, applications, jobs, users CASCADE');
  await pool.query(`ALTER SEQUENCE job_number_seq RESTART WITH ${FIRST_IDS.job};
    ALTER SEQUENCE application_number_seq RESTART WITH ${FIRST_IDS.application};
    ALTER SEQUENCE user_number_seq RESTART WITH ${FIRST_IDS.user};`);
  await seed(pool);
}

async function inTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Jobs

async function findJobs({ status, county, category } = {}) {
  return many(`SELECT * FROM jobs
    WHERE ($1::text IS NULL OR lower(listing_status) = lower($1))
      AND ($2::text IS NULL OR lower(county_name) = lower($2))
      AND ($3::text IS NULL OR lower(job_category) = lower($3))
    ORDER BY _id`, [status ?? null, county ?? null, category ?? null]);
}

const findJobById = (id) => one('SELECT * FROM jobs WHERE _id = $1', [id]);
const findJobsByEmployer = (userId) => many('SELECT * FROM jobs WHERE employer_id = $1 ORDER BY _id DESC', [userId]);

async function countPendingApplications(jobId) {
  return (await one("SELECT count(*)::int AS n FROM applications WHERE job_ref = $1 AND application_status = 'pending'", [jobId])).n;
}

function createJob({ employerId, title, category, county, area, duration, urgent, payMin, payMax }) {
  return one(`INSERT INTO jobs (_id, job_title, job_category, county_name, area_name, duration_text, is_urgent, listing_status, pay_min, pay_max, employer_id, created_by)
    VALUES ('job_' || nextval('job_number_seq'), $1, $2, $3, $4, $5, $6, 'active', $7, $8, $9, $9) RETURNING *`,
    [title, category, county, area, duration, urgent, payMin, payMax, employerId]);
}

async function setJobStatus(id, status) {
  const { job, filled } = await inTransaction(async (client) => {
    const j = (await client.query('UPDATE jobs SET listing_status = $2 WHERE _id = $1 RETURNING *', [id, status])).rows[0];
    let f = [];
    if (j && status === 'closed') {
      f = (await client.query("UPDATE applications SET application_status = 'filled', updated_at = now() WHERE job_ref = $1 AND application_status = 'pending' RETURNING *", [id])).rows;
    }
    return { job: j || null, filled: f };
  });
  filled.forEach((a) => events.emit('statusChanged', a._id, a));
  return job;
}

// Applications

const findApplicationById = (id) => one('SELECT * FROM applications WHERE _id = $1', [id]);
const findApplicationsByJob = (jobId) => many('SELECT * FROM applications WHERE job_ref = $1 ORDER BY created_at DESC, _id DESC', [jobId]);
const findApplicationsByStudent = (studentId) => many('SELECT * FROM applications WHERE student_id = $1 ORDER BY created_at DESC, _id DESC', [studentId]);
async function countApplications() { return (await one('SELECT count(*)::int AS n FROM applications')).n; }

function createApplication({ jobId, studentId, preferredAt, note }) {
  return one(`INSERT INTO applications (_id, student_id, job_ref, application_status, preferred_at, student_note)
    VALUES ('app_' || nextval('application_number_seq'), $1, $2, 'pending', $3, $4) RETURNING *`,
    [studentId, jobId, preferredAt, note]);
}

function replaceApplicationDetails(id, { preferredAt, note }) {
  return one('UPDATE applications SET preferred_at = $2, student_note = $3, updated_at = now() WHERE _id = $1 RETURNING *', [id, preferredAt, note]);
}

async function deleteApplication(id) {
  const row = await one('DELETE FROM applications WHERE _id = $1 RETURNING *', [id]);
  if (row) events.emit('removed', id, { ...row, application_status: 'cancelled' });
  return row;
}

async function setApplicationStatus(id, status) {
  const row = await one('UPDATE applications SET application_status = $2, updated_at = now() WHERE _id = $1 RETURNING *', [id, status]);
  if (row) events.emit('statusChanged', id, row);
  return row;
}

async function acceptApplication(id) {
  const { accepted, filled } = await inTransaction(async (client) => {
    const a = (await client.query("UPDATE applications SET application_status = 'accepted', updated_at = now() WHERE _id = $1 RETURNING *", [id])).rows[0];
    if (!a) return { accepted: null, filled: [] };
    const f = (await client.query("UPDATE applications SET application_status = 'filled', updated_at = now() WHERE job_ref = $1 AND _id <> $2 AND application_status = 'pending' RETURNING *", [a.job_ref, id])).rows;
    await client.query("UPDATE jobs SET listing_status = 'closed' WHERE _id = $1", [a.job_ref]);
    return { accepted: a, filled: f };
  });
  if (accepted) events.emit('statusChanged', id, accepted);
  filled.forEach((a) => events.emit('statusChanged', a._id, a));
  return accepted;
}

// Users and sessions

async function createUser({ name, email, passwordHash, role }) {
  return one(`INSERT INTO users (_id, full_name, email, password_hash, role)
    VALUES ('usr_' || nextval('user_number_seq'), $1, $2, $3, $4)
    ON CONFLICT (email) DO NOTHING RETURNING *`, [name, email, passwordHash, role]);
}

const findUserByEmail = (email) => one('SELECT * FROM users WHERE email = $1', [email]);
const findUserById = (id) => one('SELECT * FROM users WHERE _id = $1', [id]);

async function createSession({ tokenHash, userId, expiresAt }) {
  await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [tokenHash, userId, expiresAt]);
}
const findSession = (tokenHash) => one('SELECT * FROM sessions WHERE token_hash = $1', [tokenHash]);
async function deleteSession(tokenHash) { await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]); }

// Password resets

async function createPasswordReset({ tokenHash, userId, expiresAt }) {
  await pool.query('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [tokenHash, userId, expiresAt]);
}

async function countPasswordResetsSince(userId, since) {
  return (await one('SELECT count(*)::int AS n FROM password_resets WHERE user_id = $1 AND created_at >= $2', [userId, since])).n;
}

const findPasswordReset = (tokenHash) => one('SELECT * FROM password_resets WHERE token_hash = $1', [tokenHash]);

// Sets the new password, uses up every reset link for the user, and logs them
// out everywhere, all in one transaction. Returns false if this link was already used.
function completePasswordReset({ tokenHash, userId, passwordHash }) {
  return inTransaction(async (client) => {
    const claimed = (await client.query('UPDATE password_resets SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL RETURNING user_id', [tokenHash])).rows[0];
    if (!claimed) return false; // already used: nothing changed
    await client.query('UPDATE users SET password_hash = $2 WHERE _id = $1', [userId, passwordHash]);
    await client.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
    await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    return true;
  });
}

const close = () => pool.end();

module.exports = {
  kind: 'postgres', events, init, reset, close,
  findJobs, findJobById, findJobsByEmployer, countPendingApplications, createJob, setJobStatus,
  findApplicationById, findApplicationsByJob, findApplicationsByStudent, countApplications,
  createApplication, replaceApplicationDetails, deleteApplication, setApplicationStatus, acceptApplication,
  createUser, findUserByEmail, findUserById, createSession, findSession, deleteSession,
  createPasswordReset, countPasswordResetsSince, findPasswordReset, completePasswordReset,
};
