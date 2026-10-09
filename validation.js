// Week 6: validation for the write endpoints.
//
// Every write request is checked here BEFORE anything is written. Each
// function returns the first problem it finds as a clear message, or null if
// the body is valid. The three kinds of check from the Week 6 handout are:
//   1. Are all required fields present?
//   2. Does every field have the right type?
//   3. Is every value actually usable (not empty, a real date, in the future)?
// The rules come straight from the NewApplication and ApplicationUpdate
// schemas in openapi.yaml.

const NOTE_MAX_LENGTH = 500;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// A real calendar date and time. JavaScript alone would quietly turn
// 30 February into 2 March, so the day is checked against the month.
function isRealDateTime(text) {
  const m = DATE_TIME.exec(text);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth && !Number.isNaN(Date.parse(text));
}

// Check 1: presence, and no fields the contract does not allow.
function checkFields(body, allowed, required) {
  if (!isPlainObject(body)) return 'Request body must be a JSON object';
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length) return `Unknown field(s): ${unknown.join(', ')}. Allowed fields: ${allowed.join(', ')}`;
  const missing = required.filter((key) => body[key] === undefined || body[key] === null);
  if (missing.length) return `Missing required field(s): ${missing.join(', ')}`;
  return null;
}

// Checks 2 and 3 for a required text field.
function checkRequiredText(body, name) {
  if (typeof body[name] !== 'string') return `${name} must be a string`;
  if (body[name].trim() === '') return `${name} must not be empty`;
  return null;
}

// Checks 2 and 3 for the optional note.
function checkNote(body) {
  if (body.note === undefined) return null;
  if (typeof body.note !== 'string') return 'note must be a string';
  if (body.note.length > NOTE_MAX_LENGTH) return `note must be ${NOTE_MAX_LENGTH} characters or fewer`;
  return null;
}

// Checks 2 and 3 for preferredDate.
function checkPreferredDate(body) {
  const value = body.preferredDate;
  const example = 'for example 2027-01-15T09:00:00Z';
  if (typeof value !== 'string') return `preferredDate must be a string in date-time format, ${example}`;
  if (!isRealDateTime(value)) return `preferredDate must be a real date-time, ${example}`;
  if (Date.parse(value) <= Date.now()) return 'preferredDate must be in the future';
  return null;
}

// POST /api/applications body: NewApplication
function validateNewApplication(body) {
  return checkFields(body, ['jobId', 'studentId', 'preferredDate', 'note'], ['jobId', 'studentId', 'preferredDate'])
    || checkRequiredText(body, 'jobId')
    || checkRequiredText(body, 'studentId')
    || checkPreferredDate(body)
    || checkNote(body);
}

// PUT /api/applications/{applicationId} body: ApplicationUpdate
function validateApplicationUpdate(body) {
  return checkFields(body, ['preferredDate', 'note'], ['preferredDate'])
    || checkPreferredDate(body)
    || checkNote(body);
}

// Accounts, employer jobs and decisions (added after Week 7)

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function checkTextLength(body, name, min, max) {
  if (typeof body[name] !== 'string') return `${name} must be a string`;
  const length = body[name].trim().length;
  if (length < min) return min === 1 ? `${name} must not be empty` : `${name} must be at least ${min} characters`;
  if (length > max) return `${name} must be ${max} characters or fewer`;
  return null;
}

// POST /api/auth/register body: NewUser
function validateRegistration(body) {
  return checkFields(body, ['name', 'email', 'password', 'role'], ['name', 'email', 'password', 'role'])
    || checkTextLength(body, 'name', 1, 80)
    || (typeof body.email !== 'string' || !EMAIL.test(body.email.trim()) || body.email.length > 254 ? 'email must be a valid email address' : null)
    || (typeof body.password !== 'string' ? 'password must be a string' : null)
    || (body.password.length < 8 ? 'password must be at least 8 characters' : null)
    || (body.password.length > 128 ? 'password must be 128 characters or fewer' : null)
    || (!['student', 'employer'].includes(body.role) ? 'role must be student or employer' : null);
}

// POST /api/auth/login body: Credentials
function validateLogin(body) {
  return checkFields(body, ['email', 'password'], ['email', 'password'])
    || checkRequiredText(body, 'email')
    || checkRequiredText(body, 'password');
}

// POST /api/jobs body: NewJob
function validateNewJob(body) {
  const problem = checkFields(body, ['title', 'category', 'county', 'area', 'duration', 'urgent', 'payRange'],
    ['title', 'category', 'county', 'area', 'duration', 'payRange'])
    || checkTextLength(body, 'title', 3, 100)
    || checkTextLength(body, 'category', 2, 40)
    || checkTextLength(body, 'county', 2, 40)
    || checkTextLength(body, 'area', 2, 60)
    || checkTextLength(body, 'duration', 2, 40)
    || (body.urgent !== undefined && typeof body.urgent !== 'boolean' ? 'urgent must be true or false' : null);
  if (problem) return problem;
  const pay = body.payRange;
  if (!isPlainObject(pay)) return 'payRange must be an object with min and max';
  const extra = Object.keys(pay).filter((k) => !['min', 'max'].includes(k));
  if (extra.length) return `Unknown field(s) in payRange: ${extra.join(', ')}`;
  for (const k of ['min', 'max']) {
    if (typeof pay[k] !== 'number' || !Number.isFinite(pay[k])) return `payRange.${k} must be a number`;
    if (pay[k] < 0) return `payRange.${k} must not be negative`;
    if (pay[k] > 10000000) return `payRange.${k} must be 10,000,000 or less`;
  }
  if (pay.min > pay.max) return 'payRange.min must not be more than payRange.max';
  return null;
}

// PATCH /api/jobs/{jobId} body: JobStatusUpdate
function validateJobStatusUpdate(body) {
  return checkFields(body, ['status'], ['status'])
    || (!['active', 'closed'].includes(body.status) ? 'status must be active or closed' : null);
}

// PATCH /api/applications/{applicationId} body: ApplicationDecision
function validateApplicationDecision(body) {
  return checkFields(body, ['status'], ['status'])
    || (body.status !== 'accepted' ? 'status must be accepted' : null);
}

// POST /api/auth/password-resets body: PasswordResetRequest
function validatePasswordResetRequest(body) {
  return checkFields(body, ['email'], ['email'])
    || (typeof body.email !== 'string' || !EMAIL.test(body.email.trim()) ? 'email must be a valid email address' : null);
}

// PUT /api/auth/password body: NewPassword
function validateNewPassword(body) {
  return checkFields(body, ['token', 'password'], ['token', 'password'])
    || (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token) ? 'token is not a valid reset token' : null)
    || (typeof body.password !== 'string' ? 'password must be a string' : null)
    || (body.password.length < 8 ? 'password must be at least 8 characters' : null)
    || (body.password.length > 128 ? 'password must be 128 characters or fewer' : null);
}

module.exports = {
  validatePasswordResetRequest, validateNewPassword,
  validateNewApplication, validateApplicationUpdate, isRealDateTime,
  validateRegistration, validateLogin, validateNewJob, validateJobStatusUpdate, validateApplicationDecision,
};
