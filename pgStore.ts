// PostgreSQL store: used when DATABASE_URL is set (for example a free Neon
// database). Same functions as memoryStore.ts. On first start it creates the
// tables and loads the sample data, so a brand new database works straight away.
//
// The connection pool and the event emitter are kept by lib/singleton, so the server and the
// copies of this module that Next makes for route handlers share one pool and one emitter.

import { EventEmitter } from 'events';
import { Pool } from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { singleton } from './lib/singleton';
import { StoreConflict } from './lib/conflict';
import { SEED_JOBS, SEED_APPLICATIONS, FIRST_IDS, seedUsers } from './seedData';
import type {
  ApplicationRow, JobFilter, JobListingStatus, JobRow, NewApplicationInput, NewJobInput,
  NewStaffingOfferInput, PasswordResetRow, SessionRow, StaffingOfferRow, StoredApplicationStatus, StoreEmitter, UserRole, UserRow,
} from './lib/storeTypes';

export const kind = 'postgres' as const;

export const events: StoreEmitter = singleton('pgStore.events', () => new EventEmitter() as StoreEmitter);

// Made on first use, so choosing the in-memory store never opens a connection.
const getPool = (): Pool => singleton('pgStore.pool', () => {
  const created = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  created.on('error', (err) => console.error('Database connection error:', err.message)); // e.g. Neon going to sleep
  return created;
});

async function one<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<T | null> {
  return (await getPool().query<T>(sql, params)).rows[0] || null;
}
async function many<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await getPool().query<T>(sql, params)).rows;
}

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

-- Event work (added with Endpoints 22 to 25). Additive only: nothing above is changed or dropped.
-- source_role_id is internal: the Sherehe role a job was opened from. toJob() never sends it.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_role_id TEXT;
CREATE SEQUENCE IF NOT EXISTS staffing_offer_number_seq START ${FIRST_IDS.staffingOffer};
CREATE TABLE IF NOT EXISTS staffing_offers (
  _id TEXT PRIMARY KEY,
  employer_id TEXT NOT NULL REFERENCES users(_id),
  sherehe_offer_id TEXT NOT NULL UNIQUE,
  role_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  workers_offered INTEGER NOT NULL CHECK (workers_offered > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')),
  job_id TEXT REFERENCES jobs(_id),
  job_draft JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staffing_offers_employer ON staffing_offers (employer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS staffing_offers_pending ON staffing_offers (created_at) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS staffing_offers_one_pending_per_role ON staffing_offers (role_id) WHERE status = 'pending';
`;

// The statements `npm run db:migrate` shows and runs. Every one of them is safe to run again.
export const MIGRATION_SQL = SCHEMA;

async function seed(client: Pool | PoolClient): Promise<void> {
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

// Creates the tables and indexes that are missing. Adds only; never changes or drops anything that exists.
export async function migrate(): Promise<void> {
  await getPool().query(SCHEMA);
}

// A job has one place: at most one accepted application per job. Before this rule the API let an
// employer reopen a filled job and accept a second applicant, so an older database can break it. This
// repairs that, saying in the log what it changed, then adds a unique index so the database itself
// refuses a second accepted application from now on. It changes nothing in a database that keeps the rule.
async function enforceOneAcceptedPerJob(): Promise<void> {
  const changes = await inTransaction(async (client) => {
    const log: string[] = [];
    // 1. Two or more accepted for one job: the one accepted first keeps it.
    const extra = (await client.query<{ _id: string; job_ref: string }>(`
      WITH ranked AS (
        SELECT _id, row_number() OVER (PARTITION BY job_ref ORDER BY updated_at, _id) AS n
        FROM applications WHERE application_status = 'accepted')
      UPDATE applications a SET application_status = 'filled', updated_at = now()
      FROM ranked r WHERE a._id = r._id AND r.n > 1
      RETURNING a._id, a.job_ref`)).rows;
    for (const row of extra) {
      const kept = (await client.query<{ _id: string }>("SELECT _id FROM applications WHERE job_ref = $1 AND application_status = 'accepted'", [row.job_ref])).rows[0];
      log.push(`Job ${row.job_ref} had more than one accepted application: kept ${kept ? kept._id : 'the first'} (accepted first), marked ${row._id} filled.`);
    }
    // 2. Still waiting on a job that is already filled: tell them it is filled.
    const waiting = (await client.query<{ _id: string; job_ref: string }>(`
      UPDATE applications SET application_status = 'filled', updated_at = now()
      WHERE application_status = 'pending'
        AND job_ref IN (SELECT job_ref FROM applications WHERE application_status = 'accepted')
      RETURNING _id, job_ref`)).rows;
    for (const row of waiting) log.push(`Job ${row.job_ref} is already filled: marked waiting application ${row._id} filled.`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS one_accepted_application_per_job
      ON applications (job_ref) WHERE application_status = 'accepted'`);
    return log;
  });
  changes.forEach((line) => console.log(`[data] ${line}`));
}

// Creates the tables if they are missing, and loads the sample data into an empty database.
export async function init(): Promise<void> {
  await migrate();
  const counted = await one<{ n: number }>('SELECT count(*)::int AS n FROM jobs');
  if (counted && counted.n === 0) await seed(getPool());
  await enforceOneAcceptedPerJob();
}

// Used only by the automated tests: wipe everything and reload the sample data.
export async function reset(): Promise<void> {
  const pool = getPool();
  await pool.query(SCHEMA);
  await pool.query('TRUNCATE staffing_offers, password_resets, sessions, applications, jobs, users CASCADE');
  await pool.query(`ALTER SEQUENCE job_number_seq RESTART WITH ${FIRST_IDS.job};
    ALTER SEQUENCE application_number_seq RESTART WITH ${FIRST_IDS.application};
    ALTER SEQUENCE user_number_seq RESTART WITH ${FIRST_IDS.user};
    ALTER SEQUENCE staffing_offer_number_seq RESTART WITH ${FIRST_IDS.staffingOffer};`);
  await seed(pool);
  await enforceOneAcceptedPerJob();
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
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

export async function findJobs({ status, county, category }: JobFilter = {}): Promise<JobRow[]> {
  return many<JobRow>(`SELECT * FROM jobs
    WHERE ($1::text IS NULL OR lower(listing_status) = lower($1))
      AND ($2::text IS NULL OR lower(county_name) = lower($2))
      AND ($3::text IS NULL OR lower(job_category) = lower($3))
    ORDER BY _id`, [status ?? null, county ?? null, category ?? null]);
}

export const findJobById = (id: string): Promise<JobRow | null> => one<JobRow>('SELECT * FROM jobs WHERE _id = $1', [id]);
export const findJobsByEmployer = (userId: string): Promise<JobRow[]> => many<JobRow>('SELECT * FROM jobs WHERE employer_id = $1 ORDER BY _id DESC', [userId]);

export async function countPendingApplications(jobId: string): Promise<number> {
  const counted = await one<{ n: number }>("SELECT count(*)::int AS n FROM applications WHERE job_ref = $1 AND application_status = 'pending'", [jobId]);
  return counted ? counted.n : 0;
}

// The application accepted for this job, or null. A job has one place, so there is at most one (the
// unique index one_accepted_application_per_job makes sure).
export const findAcceptedApplication = (jobId: string): Promise<ApplicationRow | null> =>
  one<ApplicationRow>("SELECT * FROM applications WHERE job_ref = $1 AND application_status = 'accepted' LIMIT 1", [jobId]);
const acceptedFor = async (client: PoolClient, jobId: string): Promise<{ _id: string } | undefined> =>
  (await client.query<{ _id: string }>("SELECT _id FROM applications WHERE job_ref = $1 AND application_status = 'accepted' LIMIT 1", [jobId])).rows[0];

// Two requests about the same job (accept, close, reopen, apply) can arrive at the same moment. Each
// one locks the job's row first, so they run one after the other and every check sees the result of
// the one before. Applying takes a shared lock, so many students can still apply at once.
const lockJob = async (client: PoolClient, jobId: string, mode: 'UPDATE' | 'SHARE' = 'UPDATE'): Promise<JobRow | undefined> =>
  (await client.query<JobRow>(`SELECT * FROM jobs WHERE _id = $1 FOR ${mode}`, [jobId])).rows[0];
const isOneAcceptedViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505' && (err as { constraint?: string }).constraint === 'one_accepted_application_per_job';

// sourceRoleId is set only for jobs opened from an accepted Sherehe offer.
const NEW_JOB_SQL = `INSERT INTO jobs (_id, job_title, job_category, county_name, area_name, duration_text, is_urgent, listing_status, pay_min, pay_max, employer_id, created_by, source_role_id)
    VALUES ('job_' || nextval('job_number_seq'), $1, $2, $3, $4, $5, $6, 'active', $7, $8, $9, $9, $10) RETURNING *`;
const newJobParams = ({ employerId, title, category, county, area, duration, urgent, payMin, payMax, sourceRoleId }: NewJobInput): unknown[] =>
  [title, category, county, area, duration, urgent, payMin, payMax, employerId, sourceRoleId ?? null];

export async function createJob(job: NewJobInput): Promise<JobRow> {
  return (await one<JobRow>(NEW_JOB_SQL, newJobParams(job)))!;
}

// Closing a job marks every application still waiting on it as filled.
// A job that already has an accepted applicant cannot be reopened.
export async function setJobStatus(id: string, status: JobListingStatus): Promise<JobRow | null> {
  const { job, filled } = await inTransaction(async (client) => {
    if (!(await lockJob(client, id))) return { job: null, filled: [] as ApplicationRow[] };
    const accepted = status === 'active' ? await acceptedFor(client, id) : undefined;
    if (accepted) throw new StoreConflict('filled', { acceptedId: accepted._id });
    const j = (await client.query<JobRow>('UPDATE jobs SET listing_status = $2 WHERE _id = $1 RETURNING *', [id, status])).rows[0];
    let f: ApplicationRow[] = [];
    if (j && status === 'closed') {
      f = (await client.query<ApplicationRow>("UPDATE applications SET application_status = 'filled', updated_at = now() WHERE job_ref = $1 AND application_status = 'pending' RETURNING *", [id])).rows;
    }
    return { job: j || null, filled: f };
  });
  filled.forEach((a) => events.emit('statusChanged', a._id, a));
  return job;
}

// Applications

export const findApplicationById = (id: string): Promise<ApplicationRow | null> => one<ApplicationRow>('SELECT * FROM applications WHERE _id = $1', [id]);
export const findApplicationsByJob = (jobId: string): Promise<ApplicationRow[]> => many<ApplicationRow>('SELECT * FROM applications WHERE job_ref = $1 ORDER BY created_at DESC, _id DESC', [jobId]);
export const findApplicationsByStudent = (studentId: string): Promise<ApplicationRow[]> => many<ApplicationRow>('SELECT * FROM applications WHERE student_id = $1 ORDER BY created_at DESC, _id DESC', [studentId]);
export async function countApplications(): Promise<number> {
  const counted = await one<{ n: number }>('SELECT count(*)::int AS n FROM applications');
  return counted ? counted.n : 0;
}

// Only an open job that nobody has been accepted for takes applications. FOR SHARE lets many students
// apply at once, but waits while an accept or a close on the same job finishes, so nobody joins a job
// that has just filled.
export function createApplication({ jobId, studentId, preferredAt, note }: NewApplicationInput): Promise<ApplicationRow> {
  return inTransaction(async (client) => {
    const job = await lockJob(client, jobId, 'SHARE');
    if (!job || job.listing_status !== 'active') throw new StoreConflict('closed');
    const accepted = await acceptedFor(client, jobId);
    if (accepted) throw new StoreConflict('filled', { acceptedId: accepted._id });
    return (await client.query<ApplicationRow>(`INSERT INTO applications (_id, student_id, job_ref, application_status, preferred_at, student_note)
      VALUES ('app_' || nextval('application_number_seq'), $1, $2, 'pending', $3, $4) RETURNING *`,
      [studentId, jobId, preferredAt, note])).rows[0];
  });
}

export function replaceApplicationDetails(id: string, { preferredAt, note }: { preferredAt: Date; note: string }): Promise<ApplicationRow | null> {
  return one<ApplicationRow>('UPDATE applications SET preferred_at = $2, student_note = $3, updated_at = now() WHERE _id = $1 RETURNING *', [id, preferredAt, note]);
}

export async function deleteApplication(id: string): Promise<ApplicationRow | null> {
  const row = await one<ApplicationRow>('DELETE FROM applications WHERE _id = $1 RETURNING *', [id]);
  if (row) events.emit('removed', id, { ...row, application_status: 'cancelled' });
  return row;
}

export async function setApplicationStatus(id: string, status: StoredApplicationStatus): Promise<ApplicationRow | null> {
  const row = await one<ApplicationRow>('UPDATE applications SET application_status = $2, updated_at = now() WHERE _id = $1 RETURNING *', [id, status]);
  if (row) events.emit('statusChanged', id, row);
  return row;
}

// Accepting one application fills every other waiting application for the same job, and closes the
// job. Only a waiting application can be accepted, and only if nobody has been accepted for the job.
export async function acceptApplication(id: string): Promise<ApplicationRow | null> {
  const target = await one<{ job_ref: string }>('SELECT job_ref FROM applications WHERE _id = $1', [id]);
  if (!target) return null;
  let result: { accepted: ApplicationRow | null; filled: ApplicationRow[] };
  try {
    result = await inTransaction(async (client) => {
      await lockJob(client, target.job_ref); // the job first, then its applications, always in that order
      const current = (await client.query<ApplicationRow>('SELECT * FROM applications WHERE _id = $1 FOR UPDATE', [id])).rows[0];
      if (!current) return { accepted: null, filled: [] as ApplicationRow[] };
      if (current.application_status !== 'pending') throw new StoreConflict('not_pending', { status: current.application_status });
      const already = await acceptedFor(client, current.job_ref);
      if (already) throw new StoreConflict('filled', { acceptedId: already._id });
      const a = (await client.query<ApplicationRow>("UPDATE applications SET application_status = 'accepted', updated_at = now() WHERE _id = $1 RETURNING *", [id])).rows[0];
      const f = (await client.query<ApplicationRow>("UPDATE applications SET application_status = 'filled', updated_at = now() WHERE job_ref = $1 AND _id <> $2 AND application_status = 'pending' RETURNING *", [a.job_ref, id])).rows;
      await client.query("UPDATE jobs SET listing_status = 'closed' WHERE _id = $1", [a.job_ref]);
      return { accepted: a, filled: f };
    });
  } catch (err) {
    if (!isOneAcceptedViolation(err)) throw err;
    const winner = await findAcceptedApplication(target.job_ref); // the database index caught a second accept
    throw new StoreConflict('filled', { acceptedId: winner ? winner._id : null });
  }
  const { accepted, filled } = result;
  if (accepted) events.emit('statusChanged', id, accepted);
  filled.forEach((a) => events.emit('statusChanged', a._id, a));
  return accepted;
}

// Users and sessions

export function createUser({ name, email, passwordHash, role }: { name: string; email: string; passwordHash: string; role: UserRole }): Promise<UserRow | null> {
  return one<UserRow>(`INSERT INTO users (_id, full_name, email, password_hash, role)
    VALUES ('usr_' || nextval('user_number_seq'), $1, $2, $3, $4)
    ON CONFLICT (email) DO NOTHING RETURNING *`, [name, email, passwordHash, role]);
}

export const findUserByEmail = (email: string): Promise<UserRow | null> => one<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
export const findUserById = (id: string): Promise<UserRow | null> => one<UserRow>('SELECT * FROM users WHERE _id = $1', [id]);

export async function createSession({ tokenHash, userId, expiresAt }: { tokenHash: string; userId: string; expiresAt: Date }): Promise<void> {
  await getPool().query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [tokenHash, userId, expiresAt]);
}
export const findSession = (tokenHash: string): Promise<SessionRow | null> => one<SessionRow>('SELECT * FROM sessions WHERE token_hash = $1', [tokenHash]);
export async function deleteSession(tokenHash: string): Promise<void> { await getPool().query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]); }

// Password resets

export async function createPasswordReset({ tokenHash, userId, expiresAt }: { tokenHash: string; userId: string; expiresAt: Date }): Promise<void> {
  await getPool().query('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [tokenHash, userId, expiresAt]);
}

export async function countPasswordResetsSince(userId: string, since: Date): Promise<number> {
  const counted = await one<{ n: number }>('SELECT count(*)::int AS n FROM password_resets WHERE user_id = $1 AND created_at >= $2', [userId, since]);
  return counted ? counted.n : 0;
}

export const findPasswordReset = (tokenHash: string): Promise<PasswordResetRow | null> => one<PasswordResetRow>('SELECT * FROM password_resets WHERE token_hash = $1', [tokenHash]);

// Sets the new password, uses up every reset link for the user, and logs them
// out everywhere, all in one transaction. Returns false if this link was already used.
export function completePasswordReset({ tokenHash, userId, passwordHash }: { tokenHash: string; userId: string; passwordHash: string }): Promise<boolean> {
  return inTransaction(async (client) => {
    const claimed = (await client.query('UPDATE password_resets SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL RETURNING user_id', [tokenHash])).rows[0];
    if (!claimed) return false; // already used: nothing changed
    await client.query('UPDATE users SET password_hash = $2 WHERE _id = $1', [userId, passwordHash]);
    await client.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
    await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    return true;
  });
}

// Staffing offers (Event work: offers of workers for a Sherehe role)

// Returns null when the role already has a pending offer, or when this Sherehe offer is already
// held: the unique indexes turn either into "do nothing".
export function createStaffingOffer({ employerId, shereheOfferId, roleId, eventName, workersOffered, jobDraft }: NewStaffingOfferInput): Promise<StaffingOfferRow | null> {
  return one<StaffingOfferRow>(`INSERT INTO staffing_offers (_id, employer_id, sherehe_offer_id, role_id, event_name, workers_offered, status, job_draft)
    VALUES ('sof_' || nextval('staffing_offer_number_seq'), $1, $2, $3, $4, $5, 'pending', $6)
    ON CONFLICT DO NOTHING RETURNING *`,
    [employerId, shereheOfferId, roleId, eventName, workersOffered, JSON.stringify(jobDraft)]);
}

export const findStaffingOfferById = (id: string): Promise<StaffingOfferRow | null> => one<StaffingOfferRow>('SELECT * FROM staffing_offers WHERE _id = $1', [id]);
export const findPendingStaffingOffer = (roleId: string): Promise<StaffingOfferRow | null> => one<StaffingOfferRow>("SELECT * FROM staffing_offers WHERE role_id = $1 AND status = 'pending'", [roleId]);
export const findStaffingOffersByEmployer = (userId: string): Promise<StaffingOfferRow[]> => many<StaffingOfferRow>('SELECT * FROM staffing_offers WHERE employer_id = $1 ORDER BY created_at DESC, _id DESC', [userId]);
export const findPendingStaffingOffers = (): Promise<StaffingOfferRow[]> => many<StaffingOfferRow>("SELECT * FROM staffing_offers WHERE status = 'pending' ORDER BY created_at, _id");

// Withdrawing deletes the offer, but only while it is still pending.
export const deleteStaffingOffer = (id: string): Promise<StaffingOfferRow | null> => one<StaffingOfferRow>("DELETE FROM staffing_offers WHERE _id = $1 AND status = 'pending' RETURNING *", [id]);
export const declineStaffingOffer = (id: string): Promise<StaffingOfferRow | null> => one<StaffingOfferRow>("UPDATE staffing_offers SET status = 'declined' WHERE _id = $1 AND status = 'pending' RETURNING *", [id]);

// The organiser accepted: mark the offer accepted and open the job for the
// employer in one transaction. Claiming the row first (WHERE status = 'pending')
// means two runs at once can never make two jobs; the loser gets null.
export function acceptStaffingOffer(id: string): Promise<{ offer: StaffingOfferRow; job: JobRow } | null> {
  return inTransaction(async (client) => {
    const claimed = (await client.query<StaffingOfferRow>("UPDATE staffing_offers SET status = 'accepted' WHERE _id = $1 AND status = 'pending' RETURNING *", [id])).rows[0];
    if (!claimed) return null;
    const job = (await client.query<JobRow>(NEW_JOB_SQL, newJobParams({ employerId: claimed.employer_id, ...claimed.job_draft, sourceRoleId: claimed.role_id }))).rows[0];
    const offer = (await client.query<StaffingOfferRow>('UPDATE staffing_offers SET job_id = $2 WHERE _id = $1 RETURNING *', [id, job._id])).rows[0];
    return { offer, job };
  });
}

export const close = (): Promise<void> => getPool().end();
