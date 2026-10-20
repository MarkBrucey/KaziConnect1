// The mapping step between what the database gives us and what the contract
// promises. Every response goes through one of these functions, so the field
// names, the types and the set of fields always match openapi.yaml exactly.

// Database row -> Job schema
function toJob(row) {
  return {
    id: String(row._id),                 // _id        -> id
    title: row.job_title,                // job_title  -> title
    category: row.job_category,          // job_category -> category
    county: row.county_name,             // county_name  -> county
    area: row.area_name,                 // area_name -> area (estate or neighbourhood)
    duration: row.duration_text,         // duration_text -> duration
    urgent: Boolean(row.is_urgent),      // is_urgent -> urgent
    status: row.listing_status,          // listing_status -> status
    payRange: {
      min: Number(row.pay_min),          // "15000.00" (string) -> 15000 (number)
      max: Number(row.pay_max),
    },
    // employer_id, created_by and internal_notes are internal and are left out on purpose.
  };
}

// Database row + count -> EmployerJob schema (an employer's own job, with how many are waiting)
function toEmployerJob(row, pendingApplications) {
  return { ...toJob(row), pendingApplications };
}

// Database row -> User schema. The password hash never leaves the server.
function toUser(row) {
  return {
    id: String(row._id),                 // _id -> id
    name: row.full_name,                 // full_name -> name
    email: row.email,
    role: row.role,
    // password_hash and created_at are left out on purpose.
  };
}

// Database row -> JobStatus schema (Endpoint 4: the lightweight availability check)
function toJobStatus(row) {
  return {
    jobId: String(row._id),              // _id -> jobId
    status: row.listing_status,          // listing_status -> status
  };
}

// Database row -> ApplicationStatus schema
function toApplicationStatus(row) {
  return {
    applicationId: String(row._id),      // _id -> applicationId
    status: row.application_status,      // application_status -> status
    // student_id, job_ref, updated_at and reviewer_notes are not in the contract.
  };
}

// Dates leave the API as ISO 8601 strings like 2027-01-15T09:00:00Z,
// never as raw Date objects or timestamps.
function toIsoDateTime(date) {
  return date.toISOString().replace(/\.000Z$/, 'Z');
}

// Database row -> Application schema (Week 6: returned by POST and PUT)
function toApplication(row) {
  return {
    applicationId: String(row._id),               // _id           -> applicationId
    jobId: row.job_ref,                           // job_ref       -> jobId
    studentId: row.student_id,                    // student_id    -> studentId
    preferredDate: toIsoDateTime(row.preferred_at), // preferred_at (Date) -> preferredDate (string)
    note: row.student_note,                       // student_note  -> note
    status: row.application_status,               // application_status -> status
    // updated_at and reviewer_notes are internal and are left out on purpose.
  };
}

// Application row + account row -> Applicant schema (Endpoint 16 only).
// studentName is empty when the application did not come from a Kazi Connect
// account, for example one SettleIn created with its own student ID.
function toApplicant(row, account) {
  return { ...toApplication(row), studentName: account ? account.full_name : '' };
}

// Event work (Endpoints 22 to 25). Sherehe's words (events, roles, offers) stop here.
//
//   fromShereheEvent / fromShereheRole / fromShereheOffer   Sherehe JSON -> our own plain objects
//   toEventOpening, toStaffingOffer                          our objects -> the contract's schemas
//   toJobInput                                               our objects -> the job opened on acceptance
//
// The from... functions check what Sherehe sent. If a field is missing or the wrong type they
// throw an UpstreamError, which the API turns into a 502, so an unexpected reply never reaches
// a client as undefined values.

const { UpstreamError } = require('./clients/upstreamError');
const { CATEGORIES, COUNTIES } = require('./sharedLists');

function expectShape(ok, what) {
  if (!ok) throw new UpstreamError('shape', { detail: what });
}
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isWhole = (v, min) => Number.isInteger(v) && v >= min;
const isDateText = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

// Counties use the shared spelling when we know it ("nairobi" -> "Nairobi").
function sharedCounty(name) {
  const text = name.trim();
  return COUNTIES.find((county) => county.toLowerCase() === text.toLowerCase()) || text;
}

// A category outside the shared list becomes "events", since this is event work.
function sharedCategory(name) {
  const text = String(name).trim().toLowerCase();
  return CATEGORIES.includes(text) ? text : 'events';
}

// Sherehe Event -> { id, name, county, area, startsAt, status }
function fromShereheEvent(raw) {
  expectShape(raw && typeof raw === 'object', 'an event is not an object');
  expectShape(isText(raw.id) && isText(raw.name), 'an event has no id or name');
  expectShape(isText(raw.county) && isText(raw.area), 'an event has no county or area');
  expectShape(isDateText(raw.startsAt), 'an event has no valid startsAt');
  expectShape(isText(raw.status), 'an event has no status');
  return { id: raw.id, name: raw.name.trim(), county: sharedCounty(raw.county), area: raw.area.trim(), startsAt: raw.startsAt, status: raw.status };
}

// Sherehe Role -> { id, eventId, title, category, openSlots, shiftStart, shiftEnd, payPerShift }
function fromShereheRole(raw) {
  expectShape(raw && typeof raw === 'object', 'a role is not an object');
  expectShape(isText(raw.id) && isText(raw.eventId) && isText(raw.title), 'a role has no id, eventId or title');
  expectShape(isText(raw.category), 'a role has no category');
  expectShape(isWhole(raw.headcount, 1) && isWhole(raw.filled, 0), 'a role has no valid headcount or filled');
  expectShape(isDateText(raw.shiftStart) && isDateText(raw.shiftEnd), 'a role has no valid shift times');
  expectShape(typeof raw.payPerShift === 'number' && Number.isFinite(raw.payPerShift) && raw.payPerShift >= 0, 'a role has no valid payPerShift');
  return {
    id: raw.id, eventId: raw.eventId, title: raw.title.trim(), category: sharedCategory(raw.category),
    openSlots: Math.max(0, raw.headcount - raw.filled),   // headcount - filled -> openSlots
    shiftStart: raw.shiftStart, shiftEnd: raw.shiftEnd, payPerShift: raw.payPerShift,
  };
}

const OFFER_STATUSES = ['pending', 'accepted', 'declined'];

// Sherehe Offer -> { id, roleId, eventId, workersOffered, status }
function fromShereheOffer(raw) {
  expectShape(raw && typeof raw === 'object', 'an offer is not an object');
  expectShape(isText(raw.id) && isText(raw.roleId), 'an offer has no id or roleId');
  expectShape(isWhole(raw.workersOffered, 1), 'an offer has no valid workersOffered');
  expectShape(OFFER_STATUSES.includes(raw.status), 'an offer has an unknown status');
  return { id: raw.id, roleId: raw.roleId, eventId: typeof raw.eventId === 'string' ? raw.eventId : '', workersOffered: raw.workersOffered, status: raw.status };
}

// Whole seconds, like every other date the API sends (2026-11-20T09:15:00Z). toIsoDateTime above
// is left exactly as it was, because Endpoints 1 to 21 use it.
const toWholeSecondsIso = (date) => toIsoDateTime(new Date(Math.floor(date.getTime() / 1000) * 1000));

// Event + Role -> EventOpening schema (Endpoint 22)
function toEventOpening(event, role) {
  return {
    roleId: role.id,
    eventName: event.name,
    county: event.county,
    area: event.area,
    startsAt: toWholeSecondsIso(new Date(role.shiftStart)),  // when this role's shift starts
    title: role.title,
    category: role.category,
    openSlots: role.openSlots,
    payPerShift: role.payPerShift,
  };
}

// staffing_offers row -> StaffingOffer schema (Endpoints 23 and 24)
function toStaffingOffer(row) {
  return {
    id: String(row._id),                           // _id        -> id
    roleId: row.role_id,                           // role_id    -> roleId
    eventName: row.event_name,                     // event_name -> eventName
    workersOffered: row.workers_offered,           // workers_offered -> workersOffered
    status: row.status,
    jobId: row.job_id || null,                     // job_id: null until the offer is accepted
    createdAt: toWholeSecondsIso(row.created_at),  // created_at -> createdAt
    // sherehe_offer_id and job_draft are internal and are left out on purpose.
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "One shift, 5 Dec 2026, about 10 hours". Kenya is UTC+3 all year, so the date is the Kenyan one.
function shiftDuration(shiftStart, shiftEnd) {
  const start = new Date(shiftStart);
  const kenya = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const hours = Math.max(1, Math.round((new Date(shiftEnd) - start) / (60 * 60 * 1000)));
  return `One shift, ${kenya.getUTCDate()} ${MONTHS[kenya.getUTCMonth()]} ${kenya.getUTCFullYear()}, about ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

// Event + Role -> the job Kazi opens when the organiser accepts. The field names are the
// ones db.createJob takes. The pay is one amount: payPerShift for both ends of the range.
function toJobInput(event, role) {
  return {
    title: `${role.title}, ${event.name}`.slice(0, 100),
    category: role.category,
    county: event.county,
    area: event.area,
    duration: shiftDuration(role.shiftStart, role.shiftEnd),
    urgent: false,
    payMin: role.payPerShift,
    payMax: role.payPerShift,
  };
}

module.exports = {
  toJob, toJobStatus, toEmployerJob, toUser, toApplicationStatus, toApplication, toApplicant, toIsoDateTime,
  fromShereheEvent, fromShereheRole, fromShereheOffer, toEventOpening, toStaffingOffer, toJobInput,
};
