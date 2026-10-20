// In-memory store: used by the automated tests, and by the server whenever no
// DATABASE_URL is set. It has exactly the same functions as pgStore.js, so the
// rest of the code never needs to know which one it is talking to.
//
// Every function is async, like a real database call.

const { EventEmitter } = require('events');
const { SEED_JOBS, SEED_APPLICATIONS, FIRST_IDS, seedUsers } = require('./seedData');

// 'statusChanged' (id, row): an application's status changed
// 'removed'       (id, row): an application was cancelled and deleted
const events = new EventEmitter();

const jobs = [];
const applications = [];
const users = [];
const sessions = [];
const passwordResets = [];
const staffingOffers = [];
let next = { ...FIRST_IDS };
let cachedUsers = null;

const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const copy = (row) => (row ? { ...row } : null);
const newestFirst = (x, y) => (y.created_at - x.created_at) || (y._id > x._id ? 1 : -1);

function toAppRow(row) {
  return { ...row, preferred_at: new Date(row.preferred_at), created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) };
}

async function reset() {
  cachedUsers = cachedUsers || seedUsers();
  jobs.splice(0, jobs.length, ...SEED_JOBS.map((row) => ({ ...row })));
  applications.splice(0, applications.length, ...SEED_APPLICATIONS.map(toAppRow));
  users.splice(0, users.length, ...cachedUsers.map((row) => ({ ...row, created_at: new Date(row.created_at) })));
  sessions.splice(0, sessions.length);
  passwordResets.splice(0, passwordResets.length);
  staffingOffers.splice(0, staffingOffers.length);
  next = { ...FIRST_IDS };
}

async function init() { /* the data is loaded when this file is first used */ }

// Jobs

async function findJobs({ status, county, category } = {}) {
  return jobs.filter((row) =>
    (status === undefined || same(row.listing_status, status)) &&
    (county === undefined || same(row.county_name, county)) &&
    (category === undefined || same(row.job_category, category))).map(copy);
}

async function findJobById(id) { return copy(jobs.find((row) => row._id === id)); }

async function findJobsByEmployer(userId) {
  return jobs.filter((row) => row.employer_id === userId).map(copy).reverse();
}

async function countPendingApplications(jobId) {
  return applications.filter((a) => a.job_ref === jobId && a.application_status === 'pending').length;
}

// sourceRoleId is set only for jobs opened from an accepted Sherehe offer. It is
// internal: mappers.toJob() never sends it out.
async function createJob({ employerId, title, category, county, area, duration, urgent, payMin, payMax, sourceRoleId }) {
  const row = {
    _id: `job_${next.job++}`, job_title: title, job_category: category, county_name: county,
    area_name: area, duration_text: duration, is_urgent: urgent, listing_status: 'active',
    pay_min: Number(payMin).toFixed(2), pay_max: Number(payMax).toFixed(2),
    employer_id: employerId, created_by: employerId, internal_notes: '',
    source_role_id: sourceRoleId || null,
  };
  jobs.push(row);
  return copy(row);
}

// Closing a job marks every application still waiting on it as filled.
async function setJobStatus(id, status) {
  const row = jobs.find((r) => r._id === id);
  if (!row) return null;
  row.listing_status = status;
  if (status === 'closed') {
    for (const a of applications.filter((x) => x.job_ref === id && x.application_status === 'pending')) {
      a.application_status = 'filled';
      a.updated_at = new Date();
      events.emit('statusChanged', a._id, copy(a));
    }
  }
  return copy(row);
}

// Applications

async function findApplicationById(id) { return copy(applications.find((row) => row._id === id)); }

async function findApplicationsByJob(jobId) {
  return applications.filter((a) => a.job_ref === jobId).sort(newestFirst).map(copy);
}

async function findApplicationsByStudent(studentId) {
  return applications.filter((a) => a.student_id === studentId).sort(newestFirst).map(copy);
}

async function countApplications() { return applications.length; }

async function createApplication({ jobId, studentId, preferredAt, note }) {
  const now = new Date();
  const row = {
    _id: `app_${next.application++}`, student_id: studentId, job_ref: jobId, application_status: 'pending',
    preferred_at: preferredAt, student_note: note, created_at: now, updated_at: now, reviewer_notes: '',
  };
  applications.push(row);
  return copy(row);
}

// PUT sets an absolute state: the same input always produces the same row.
async function replaceApplicationDetails(id, { preferredAt, note }) {
  const row = applications.find((r) => r._id === id);
  if (!row) return null;
  row.preferred_at = preferredAt;
  row.student_note = note;
  row.updated_at = new Date();
  return copy(row);
}

async function deleteApplication(id) {
  const index = applications.findIndex((row) => row._id === id);
  if (index === -1) return null;
  const [row] = applications.splice(index, 1);
  events.emit('removed', id, { ...row, application_status: 'cancelled' });
  return copy(row);
}

async function setApplicationStatus(id, status) {
  const row = applications.find((r) => r._id === id);
  if (!row) return null;
  row.application_status = status;
  row.updated_at = new Date();
  events.emit('statusChanged', id, copy(row));
  return copy(row);
}

// Accepting one application fills every other waiting application for the
// same job, and closes the job.
async function acceptApplication(id) {
  const row = applications.find((r) => r._id === id);
  if (!row) return null;
  row.application_status = 'accepted';
  row.updated_at = new Date();
  events.emit('statusChanged', id, copy(row));
  for (const other of applications.filter((a) => a.job_ref === row.job_ref && a._id !== id && a.application_status === 'pending')) {
    other.application_status = 'filled';
    other.updated_at = new Date();
    events.emit('statusChanged', other._id, copy(other));
  }
  const job = jobs.find((j) => j._id === row.job_ref);
  if (job) job.listing_status = 'closed';
  return copy(row);
}

// Users and sessions

async function createUser({ name, email, passwordHash, role }) {
  if (users.some((u) => u.email === email)) return null; // email already registered
  const row = { _id: `usr_${next.user++}`, full_name: name, email, password_hash: passwordHash, role, created_at: new Date() };
  users.push(row);
  return copy(row);
}

async function findUserByEmail(email) { return copy(users.find((u) => u.email === email)); }
async function findUserById(id) { return copy(users.find((u) => u._id === id)); }

async function createSession({ tokenHash, userId, expiresAt }) {
  sessions.push({ token_hash: tokenHash, user_id: userId, expires_at: expiresAt, created_at: new Date() });
}
async function findSession(tokenHash) { return copy(sessions.find((s) => s.token_hash === tokenHash)); }
async function deleteSession(tokenHash) {
  const index = sessions.findIndex((s) => s.token_hash === tokenHash);
  if (index !== -1) sessions.splice(index, 1);
}

// Password resets

async function createPasswordReset({ tokenHash, userId, expiresAt }) {
  passwordResets.push({ token_hash: tokenHash, user_id: userId, expires_at: expiresAt, used_at: null, created_at: new Date() });
}

async function countPasswordResetsSince(userId, since) {
  return passwordResets.filter((r) => r.user_id === userId && r.created_at >= since).length;
}

async function findPasswordReset(tokenHash) { return copy(passwordResets.find((r) => r.token_hash === tokenHash)); }

// Sets the new password, uses up every reset link for the user, and logs them
// out everywhere. Returns false if this link was already used.
async function completePasswordReset({ tokenHash, userId, passwordHash }) {
  const link = passwordResets.find((r) => r.token_hash === tokenHash);
  if (!link || link.used_at) return false;
  const user = users.find((u) => u._id === userId);
  if (!user) return false;
  user.password_hash = passwordHash;
  const now = new Date();
  passwordResets.filter((r) => r.user_id === userId && !r.used_at).forEach((r) => { r.used_at = now; });
  for (let i = sessions.length - 1; i >= 0; i--) if (sessions[i].user_id === userId) sessions.splice(i, 1);
  return true;
}

// Staffing offers (Event work: offers of workers for a Sherehe role)

const hasPendingOffer = (roleId) => staffingOffers.some((o) => o.role_id === roleId && o.status === 'pending');

// Returns null when the role already has a pending offer (the database does the
// same with a unique index), so two requests can never both make one.
async function createStaffingOffer({ employerId, shereheOfferId, roleId, eventName, workersOffered, jobDraft }) {
  if (hasPendingOffer(roleId)) return null;
  const row = {
    _id: `sof_${next.staffingOffer++}`, employer_id: employerId, sherehe_offer_id: shereheOfferId,
    role_id: roleId, event_name: eventName, workers_offered: workersOffered, status: 'pending',
    job_id: null, job_draft: JSON.parse(JSON.stringify(jobDraft)), created_at: new Date(),
  };
  staffingOffers.push(row);
  return copy(row);
}

async function findStaffingOfferById(id) { return copy(staffingOffers.find((o) => o._id === id)); }
async function findPendingStaffingOffer(roleId) { return copy(staffingOffers.find((o) => o.role_id === roleId && o.status === 'pending')); }
async function findStaffingOffersByEmployer(userId) {
  return staffingOffers.filter((o) => o.employer_id === userId).sort(newestFirst).map(copy);
}
async function findPendingStaffingOffers() {
  return staffingOffers.filter((o) => o.status === 'pending').sort((x, y) => -newestFirst(x, y)).map(copy);
}

// Withdrawing deletes the offer, but only while it is still pending.
async function deleteStaffingOffer(id) {
  const index = staffingOffers.findIndex((o) => o._id === id && o.status === 'pending');
  if (index === -1) return null;
  const [row] = staffingOffers.splice(index, 1);
  return copy(row);
}

async function declineStaffingOffer(id) {
  const row = staffingOffers.find((o) => o._id === id && o.status === 'pending');
  if (!row) return null;
  row.status = 'declined';
  return copy(row);
}

// The organiser accepted: mark the offer accepted and open the job for the
// employer in one step. Returns null if the offer is no longer pending, so
// running this twice never makes two jobs.
async function acceptStaffingOffer(id) {
  const row = staffingOffers.find((o) => o._id === id && o.status === 'pending');
  if (!row) return null;
  row.status = 'accepted'; // claim it before any await, so a second call finds it already taken
  const job = await createJob({ employerId: row.employer_id, ...row.job_draft, sourceRoleId: row.role_id });
  row.job_id = job._id;
  return { offer: copy(row), job };
}

reset();

module.exports = {
  kind: 'memory', events, init, reset,
  findJobs, findJobById, findJobsByEmployer, countPendingApplications, createJob, setJobStatus,
  findApplicationById, findApplicationsByJob, findApplicationsByStudent, countApplications,
  createApplication, replaceApplicationDetails, deleteApplication, setApplicationStatus, acceptApplication,
  createUser, findUserByEmail, findUserById, createSession, findSession, deleteSession,
  createPasswordReset, countPasswordResetsSince, findPasswordReset, completePasswordReset,
  createStaffingOffer, findStaffingOfferById, findPendingStaffingOffer, findStaffingOffersByEmployer,
  findPendingStaffingOffers, deleteStaffingOffer, declineStaffingOffer, acceptStaffingOffer,
};
