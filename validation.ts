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
//
// The bodies arrive as `unknown`. A validator that returns null has checked the shape, so the
// route may then read the body as the matching request type from lib/contract.ts.

type Body = Record<string, unknown>;
type Problem = string | null;

const NOTE_MAX_LENGTH = 500;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isPlainObject(value: unknown): value is Body {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// A real calendar date and time. JavaScript alone would quietly turn
// 30 February into 2 March, so the day is checked against the month.
export function isRealDateTime(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  const m = DATE_TIME.exec(text);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth && !Number.isNaN(Date.parse(text));
}

// Check 1: presence, and no fields the contract does not allow.
function checkFields(body: unknown, allowed: string[], required: string[]): Problem {
  if (!isPlainObject(body)) return 'Request body must be a JSON object';
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length) return `Unknown field(s): ${unknown.join(', ')}. Allowed fields: ${allowed.join(', ')}`;
  const missing = required.filter((key) => body[key] === undefined || body[key] === null);
  if (missing.length) return `Missing required field(s): ${missing.join(', ')}`;
  return null;
}

// Checks 2 and 3 for a required text field.
function checkRequiredText(body: Body, name: string): Problem {
  const value = body[name];
  if (typeof value !== 'string') return `${name} must be a string`;
  if (value.trim() === '') return `${name} must not be empty`;
  return null;
}

// Checks 2 and 3 for the optional note.
function checkNote(body: Body): Problem {
  if (body.note === undefined) return null;
  if (typeof body.note !== 'string') return 'note must be a string';
  if (body.note.length > NOTE_MAX_LENGTH) return `note must be ${NOTE_MAX_LENGTH} characters or fewer`;
  return null;
}

// Checks 2 and 3 for preferredDate.
function checkPreferredDate(body: Body): Problem {
  const value = body.preferredDate;
  const example = 'for example 2027-01-15T09:00:00Z';
  if (typeof value !== 'string') return `preferredDate must be a string in date-time format, ${example}`;
  if (!isRealDateTime(value)) return `preferredDate must be a real date-time, ${example}`;
  if (Date.parse(value) <= Date.now()) return 'preferredDate must be in the future';
  return null;
}

// POST /api/applications body: NewApplication
export function validateNewApplication(body: unknown): Problem {
  const problem = checkFields(body, ['jobId', 'studentId', 'preferredDate', 'note'], ['jobId', 'studentId', 'preferredDate']);
  if (problem) return problem;
  const b = body as Body;
  return checkRequiredText(b, 'jobId')
    || checkRequiredText(b, 'studentId')
    || checkPreferredDate(b)
    || checkNote(b);
}

// PUT /api/applications/{applicationId} body: ApplicationUpdate
export function validateApplicationUpdate(body: unknown): Problem {
  const problem = checkFields(body, ['preferredDate', 'note'], ['preferredDate']);
  if (problem) return problem;
  const b = body as Body;
  return checkPreferredDate(b) || checkNote(b);
}

// Accounts, employer jobs and decisions (added after Week 7)

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function checkTextLength(body: Body, name: string, min: number, max: number): Problem {
  const value = body[name];
  if (typeof value !== 'string') return `${name} must be a string`;
  const length = value.trim().length;
  if (length < min) return min === 1 ? `${name} must not be empty` : `${name} must be at least ${min} characters`;
  if (length > max) return `${name} must be ${max} characters or fewer`;
  return null;
}

// POST /api/auth/register body: NewUser
export function validateRegistration(body: unknown): Problem {
  const problem = checkFields(body, ['name', 'email', 'password', 'role'], ['name', 'email', 'password', 'role'])
    || checkTextLength(body as Body, 'name', 1, 80);
  if (problem) return problem;
  const b = body as Body;
  if (typeof b.email !== 'string' || !EMAIL.test(b.email.trim()) || b.email.length > 254) return 'email must be a valid email address';
  if (typeof b.password !== 'string') return 'password must be a string';
  if (b.password.length < 8) return 'password must be at least 8 characters';
  if (b.password.length > 128) return 'password must be 128 characters or fewer';
  if (b.role !== 'student' && b.role !== 'employer') return 'role must be student or employer';
  return null;
}

// POST /api/auth/login body: Credentials
export function validateLogin(body: unknown): Problem {
  const problem = checkFields(body, ['email', 'password'], ['email', 'password']);
  if (problem) return problem;
  const b = body as Body;
  return checkRequiredText(b, 'email') || checkRequiredText(b, 'password');
}

// POST /api/jobs body: NewJob
export function validateNewJob(body: unknown): Problem {
  const fields = checkFields(body, ['title', 'category', 'county', 'area', 'duration', 'urgent', 'payRange'],
    ['title', 'category', 'county', 'area', 'duration', 'payRange']);
  if (fields) return fields;
  const b = body as Body;
  const problem = checkTextLength(b, 'title', 3, 100)
    || checkTextLength(b, 'category', 2, 40)
    || checkTextLength(b, 'county', 2, 40)
    || checkTextLength(b, 'area', 2, 60)
    || checkTextLength(b, 'duration', 2, 40)
    || (b.urgent !== undefined && typeof b.urgent !== 'boolean' ? 'urgent must be true or false' : null);
  if (problem) return problem;
  const pay = b.payRange;
  if (!isPlainObject(pay)) return 'payRange must be an object with min and max';
  const extra = Object.keys(pay).filter((k) => !['min', 'max'].includes(k));
  if (extra.length) return `Unknown field(s) in payRange: ${extra.join(', ')}`;
  for (const k of ['min', 'max']) {
    const amount = pay[k];
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return `payRange.${k} must be a number`;
    if (amount < 0) return `payRange.${k} must not be negative`;
    if (amount > 10000000) return `payRange.${k} must be 10,000,000 or less`;
  }
  if ((pay.min as number) > (pay.max as number)) return 'payRange.min must not be more than payRange.max';
  return null;
}

// PATCH /api/jobs/{jobId} body: JobStatusUpdate
export function validateJobStatusUpdate(body: unknown): Problem {
  const problem = checkFields(body, ['status'], ['status']);
  if (problem) return problem;
  const status = (body as Body).status;
  return status !== 'active' && status !== 'closed' ? 'status must be active or closed' : null;
}

// PATCH /api/applications/{applicationId} body: ApplicationDecision
export function validateApplicationDecision(body: unknown): Problem {
  const problem = checkFields(body, ['status'], ['status']);
  if (problem) return problem;
  return (body as Body).status !== 'accepted' ? 'status must be accepted' : null;
}

// POST /api/auth/password-resets body: PasswordResetRequest
export function validatePasswordResetRequest(body: unknown): Problem {
  const problem = checkFields(body, ['email'], ['email']);
  if (problem) return problem;
  const email = (body as Body).email;
  return typeof email !== 'string' || !EMAIL.test(email.trim()) ? 'email must be a valid email address' : null;
}

// PUT /api/auth/password body: NewPassword
export function validateNewPassword(body: unknown): Problem {
  const problem = checkFields(body, ['token', 'password'], ['token', 'password']);
  if (problem) return problem;
  const b = body as Body;
  if (typeof b.token !== 'string' || !/^[a-f0-9]{64}$/.test(b.token)) return 'token is not a valid reset token';
  if (typeof b.password !== 'string') return 'password must be a string';
  if (b.password.length < 8) return 'password must be at least 8 characters';
  if (b.password.length > 128) return 'password must be 128 characters or fewer';
  return null;
}

// POST /api/staffing-offers body: NewStaffingOffer (Event work)
// The cap on workersOffered only guards against absurd numbers. Sherehe decides how many
// slots are really free, and its refusal comes back as a 400 from the route.
export function validateStaffingOffer(body: unknown): Problem {
  const problem = checkFields(body, ['roleId', 'workersOffered', 'note'], ['roleId', 'workersOffered']);
  if (problem) return problem;
  const b = body as Body;
  const text = checkRequiredText(b, 'roleId');
  if (text) return text;
  if ((b.roleId as string).trim().length > 80) return 'roleId must be 80 characters or fewer';
  const workers = b.workersOffered;
  if (typeof workers !== 'number' || !Number.isInteger(workers)) return 'workersOffered must be a whole number';
  if (workers < 1) return 'workersOffered must be at least 1';
  if (workers > 10000) return 'workersOffered must be 10,000 or fewer';
  return checkNote(b);
}
