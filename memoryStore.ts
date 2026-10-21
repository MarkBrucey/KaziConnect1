// In-memory store: used by the automated tests, and by the server whenever no
// DATABASE_URL is set. It has exactly the same functions as pgStore.ts, so the
// rest of the code never needs to know which one it is talking to.
//
// Every function is async, like a real database call.
//
// All the data lives in one object kept by lib/singleton, so every copy of this module that Next
// makes for a route handler reads and writes the same rows as the server itself and the tests.

import { EventEmitter } from 'events';
import { singleton } from './lib/singleton';
import { SEED_JOBS, SEED_APPLICATIONS, FIRST_IDS, seedUsers } from './seedData';
import type { IdCounters, SeedApplication, SeedUserRow } from './seedData';
import type {
  ApplicationRow, JobFilter, JobListingStatus, JobRow, NewApplicationInput, NewJobInput,
  NewStaffingOfferInput, PasswordResetRow, SessionRow, StaffingOfferRow, StoredApplicationStatus, StoreEmitter, UserRole, UserRow,
} from './lib/storeTypes';

interface MemoryState {
  jobs: JobRow[];
  applications: ApplicationRow[];
  users: UserRow[];
  sessions: SessionRow[];
  passwordResets: PasswordResetRow[];
  staffingOffers: StaffingOfferRow[];
  next: IdCounters;
  cachedUsers: SeedUserRow[] | null;
  events: StoreEmitter;
}

export const kind = 'memory' as const;

// Fills the state with the sample data. Used when the state is first made, and by reset().
function load(state: MemoryState): void {
  state.cachedUsers = state.cachedUsers || seedUsers();
  state.jobs.splice(0, state.jobs.length, ...SEED_JOBS.map((row) => ({ ...row })));
  state.applications.splice(0, state.applications.length, ...SEED_APPLICATIONS.map(toAppRow));
  state.users.splice(0, state.users.length, ...state.cachedUsers.map((row) => ({ ...row, created_at: new Date(row.created_at) })));
  state.sessions.splice(0, state.sessions.length);
  state.passwordResets.splice(0, state.passwordResets.length);
  state.staffingOffers.splice(0, state.staffingOffers.length);
  state.next = { ...FIRST_IDS };
}

const state = singleton('memoryStore', () => {
  const created: MemoryState = {
    jobs: [], applications: [], users: [], sessions: [], passwordResets: [], staffingOffers: [],
    next: { ...FIRST_IDS }, cachedUsers: null, events: new EventEmitter() as StoreEmitter,
  };
  load(created);
  return created;
});

// 'statusChanged' (id, row): an application's status changed
// 'removed'       (id, row): an application was cancelled and deleted
export const events: StoreEmitter = state.events;

const same = (a: string, b: string): boolean => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const copy = <T extends object>(row: T | null | undefined): T | null => (row ? { ...row } : null);
const newestFirst = (x: { created_at: Date; _id: string }, y: { created_at: Date; _id: string }): number =>
  (y.created_at.getTime() - x.created_at.getTime()) || (y._id > x._id ? 1 : -1);

function toAppRow(row: SeedApplication): ApplicationRow {
  return { ...row, preferred_at: new Date(row.preferred_at), created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) };
}

export async function reset(): Promise<void> { load(state); }

export async function init(): Promise<void> { /* the data is loaded when this file is first used */ }

// Jobs

export async function findJobs({ status, county, category }: JobFilter = {}): Promise<JobRow[]> {
  return state.jobs.filter((row) =>
    (status === undefined || same(row.listing_status, status)) &&
    (county === undefined || same(row.county_name, county)) &&
    (category === undefined || same(row.job_category, category))).map((row) => ({ ...row }));
}

export async function findJobById(id: string): Promise<JobRow | null> { return copy(state.jobs.find((row) => row._id === id)); }

export async function findJobsByEmployer(userId: string): Promise<JobRow[]> {
  return state.jobs.filter((row) => row.employer_id === userId).map((row) => ({ ...row })).reverse();
}

export async function countPendingApplications(jobId: string): Promise<number> {
  return state.applications.filter((a) => a.job_ref === jobId && a.application_status === 'pending').length;
}

// sourceRoleId is set only for jobs opened from an accepted Sherehe offer. It is
// internal: mappers.toJob() never sends it out.
export async function createJob({ employerId, title, category, county, area, duration, urgent, payMin, payMax, sourceRoleId }: NewJobInput): Promise<JobRow> {
  const row: JobRow = {
    _id: `job_${state.next.job++}`, job_title: title, job_category: category, county_name: county,
    area_name: area, duration_text: duration, is_urgent: urgent, listing_status: 'active',
    pay_min: Number(payMin).toFixed(2), pay_max: Number(payMax).toFixed(2),
    employer_id: employerId, created_by: employerId, internal_notes: '',
    source_role_id: sourceRoleId || null,
  };
  state.jobs.push(row);
  return { ...row };
}

// Closing a job marks every application still waiting on it as filled.
export async function setJobStatus(id: string, status: JobListingStatus): Promise<JobRow | null> {
  const row = state.jobs.find((r) => r._id === id);
  if (!row) return null;
  row.listing_status = status;
  if (status === 'closed') {
    for (const a of state.applications.filter((x) => x.job_ref === id && x.application_status === 'pending')) {
      a.application_status = 'filled';
      a.updated_at = new Date();
      state.events.emit('statusChanged', a._id, { ...a });
    }
  }
  return { ...row };
}

// Applications

export async function findApplicationById(id: string): Promise<ApplicationRow | null> { return copy(state.applications.find((row) => row._id === id)); }

export async function findApplicationsByJob(jobId: string): Promise<ApplicationRow[]> {
  return state.applications.filter((a) => a.job_ref === jobId).sort(newestFirst).map((a) => ({ ...a }));
}

export async function findApplicationsByStudent(studentId: string): Promise<ApplicationRow[]> {
  return state.applications.filter((a) => a.student_id === studentId).sort(newestFirst).map((a) => ({ ...a }));
}

export async function countApplications(): Promise<number> { return state.applications.length; }

export async function createApplication({ jobId, studentId, preferredAt, note }: NewApplicationInput): Promise<ApplicationRow> {
  const now = new Date();
  const row: ApplicationRow = {
    _id: `app_${state.next.application++}`, student_id: studentId, job_ref: jobId, application_status: 'pending',
    preferred_at: preferredAt, student_note: note, created_at: now, updated_at: now, reviewer_notes: '',
  };
  state.applications.push(row);
  return { ...row };
}

// PUT sets an absolute state: the same input always produces the same row.
export async function replaceApplicationDetails(id: string, { preferredAt, note }: { preferredAt: Date; note: string }): Promise<ApplicationRow | null> {
  const row = state.applications.find((r) => r._id === id);
  if (!row) return null;
  row.preferred_at = preferredAt;
  row.student_note = note;
  row.updated_at = new Date();
  return { ...row };
}

export async function deleteApplication(id: string): Promise<ApplicationRow | null> {
  const index = state.applications.findIndex((row) => row._id === id);
  if (index === -1) return null;
  const [row] = state.applications.splice(index, 1);
  state.events.emit('removed', id, { ...row, application_status: 'cancelled' });
  return { ...row };
}

export async function setApplicationStatus(id: string, status: StoredApplicationStatus): Promise<ApplicationRow | null> {
  const row = state.applications.find((r) => r._id === id);
  if (!row) return null;
  row.application_status = status;
  row.updated_at = new Date();
  state.events.emit('statusChanged', id, { ...row });
  return { ...row };
}

// Accepting one application fills every other waiting application for the
// same job, and closes the job.
export async function acceptApplication(id: string): Promise<ApplicationRow | null> {
  const row = state.applications.find((r) => r._id === id);
  if (!row) return null;
  row.application_status = 'accepted';
  row.updated_at = new Date();
  state.events.emit('statusChanged', id, { ...row });
  for (const other of state.applications.filter((a) => a.job_ref === row.job_ref && a._id !== id && a.application_status === 'pending')) {
    other.application_status = 'filled';
    other.updated_at = new Date();
    state.events.emit('statusChanged', other._id, { ...other });
  }
  const job = state.jobs.find((j) => j._id === row.job_ref);
  if (job) job.listing_status = 'closed';
  return { ...row };
}

// Users and sessions

export async function createUser({ name, email, passwordHash, role }: { name: string; email: string; passwordHash: string; role: UserRole }): Promise<UserRow | null> {
  if (state.users.some((u) => u.email === email)) return null; // email already registered
  const row: UserRow = { _id: `usr_${state.next.user++}`, full_name: name, email, password_hash: passwordHash, role, created_at: new Date() };
  state.users.push(row);
  return { ...row };
}

export async function findUserByEmail(email: string): Promise<UserRow | null> { return copy(state.users.find((u) => u.email === email)); }
export async function findUserById(id: string): Promise<UserRow | null> { return copy(state.users.find((u) => u._id === id)); }

export async function createSession({ tokenHash, userId, expiresAt }: { tokenHash: string; userId: string; expiresAt: Date }): Promise<void> {
  state.sessions.push({ token_hash: tokenHash, user_id: userId, expires_at: expiresAt, created_at: new Date() });
}
export async function findSession(tokenHash: string): Promise<SessionRow | null> { return copy(state.sessions.find((s) => s.token_hash === tokenHash)); }
export async function deleteSession(tokenHash: string): Promise<void> {
  const index = state.sessions.findIndex((s) => s.token_hash === tokenHash);
  if (index !== -1) state.sessions.splice(index, 1);
}

// Password resets

export async function createPasswordReset({ tokenHash, userId, expiresAt }: { tokenHash: string; userId: string; expiresAt: Date }): Promise<void> {
  state.passwordResets.push({ token_hash: tokenHash, user_id: userId, expires_at: expiresAt, used_at: null, created_at: new Date() });
}

export async function countPasswordResetsSince(userId: string, since: Date): Promise<number> {
  return state.passwordResets.filter((r) => r.user_id === userId && r.created_at >= since).length;
}

export async function findPasswordReset(tokenHash: string): Promise<PasswordResetRow | null> { return copy(state.passwordResets.find((r) => r.token_hash === tokenHash)); }

// Sets the new password, uses up every reset link for the user, and logs them
// out everywhere. Returns false if this link was already used.
export async function completePasswordReset({ tokenHash, userId, passwordHash }: { tokenHash: string; userId: string; passwordHash: string }): Promise<boolean> {
  const link = state.passwordResets.find((r) => r.token_hash === tokenHash);
  if (!link || link.used_at) return false;
  const user = state.users.find((u) => u._id === userId);
  if (!user) return false;
  user.password_hash = passwordHash;
  const now = new Date();
  state.passwordResets.filter((r) => r.user_id === userId && !r.used_at).forEach((r) => { r.used_at = now; });
  for (let i = state.sessions.length - 1; i >= 0; i--) if (state.sessions[i].user_id === userId) state.sessions.splice(i, 1);
  return true;
}

// Staffing offers (Event work: offers of workers for a Sherehe role)

const hasPendingOffer = (roleId: string): boolean => state.staffingOffers.some((o) => o.role_id === roleId && o.status === 'pending');

// Returns null when the role already has a pending offer, or when this Sherehe offer is
// already held (the database does the same with unique indexes), so two requests can never
// both make an offer on a role, and one Sherehe offer is never stored twice.
export async function createStaffingOffer({ employerId, shereheOfferId, roleId, eventName, workersOffered, jobDraft }: NewStaffingOfferInput): Promise<StaffingOfferRow | null> {
  if (hasPendingOffer(roleId) || state.staffingOffers.some((o) => o.sherehe_offer_id === shereheOfferId)) return null;
  const row: StaffingOfferRow = {
    _id: `sof_${state.next.staffingOffer++}`, employer_id: employerId, sherehe_offer_id: shereheOfferId,
    role_id: roleId, event_name: eventName, workers_offered: workersOffered, status: 'pending',
    job_id: null, job_draft: JSON.parse(JSON.stringify(jobDraft)) as StaffingOfferRow['job_draft'], created_at: new Date(),
  };
  state.staffingOffers.push(row);
  return { ...row };
}

export async function findStaffingOfferById(id: string): Promise<StaffingOfferRow | null> { return copy(state.staffingOffers.find((o) => o._id === id)); }
export async function findPendingStaffingOffer(roleId: string): Promise<StaffingOfferRow | null> { return copy(state.staffingOffers.find((o) => o.role_id === roleId && o.status === 'pending')); }
export async function findStaffingOffersByEmployer(userId: string): Promise<StaffingOfferRow[]> {
  return state.staffingOffers.filter((o) => o.employer_id === userId).sort(newestFirst).map((o) => ({ ...o }));
}
export async function findPendingStaffingOffers(): Promise<StaffingOfferRow[]> {
  return state.staffingOffers.filter((o) => o.status === 'pending').sort((x, y) => -newestFirst(x, y)).map((o) => ({ ...o }));
}

// Withdrawing deletes the offer, but only while it is still pending.
export async function deleteStaffingOffer(id: string): Promise<StaffingOfferRow | null> {
  const index = state.staffingOffers.findIndex((o) => o._id === id && o.status === 'pending');
  if (index === -1) return null;
  const [row] = state.staffingOffers.splice(index, 1);
  return { ...row };
}

export async function declineStaffingOffer(id: string): Promise<StaffingOfferRow | null> {
  const row = state.staffingOffers.find((o) => o._id === id && o.status === 'pending');
  if (!row) return null;
  row.status = 'declined';
  return { ...row };
}

// The organiser accepted: mark the offer accepted and open the job for the
// employer in one step. Returns null if the offer is no longer pending, so
// running this twice never makes two jobs.
export async function acceptStaffingOffer(id: string): Promise<{ offer: StaffingOfferRow; job: JobRow } | null> {
  const row = state.staffingOffers.find((o) => o._id === id && o.status === 'pending');
  if (!row) return null;
  row.status = 'accepted'; // claim it before any await, so a second call finds it already taken
  const job = await createJob({ employerId: row.employer_id, ...row.job_draft, sourceRoleId: row.role_id });
  row.job_id = job._id;
  return { offer: { ...row }, job };
}
