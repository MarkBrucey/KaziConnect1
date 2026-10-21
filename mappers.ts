// The mapping step between what the database gives us and what the contract
// promises. Every response goes through one of these functions, so the field
// names, the types and the set of fields always match openapi.yaml exactly.
//
// The return types come from types/api.d.ts (generated from openapi.yaml), so if the contract and
// these functions disagree, `npm run typecheck` fails.

import type { Applicant, Application, ApplicationStatus, EmployerJob, EventOpening, Job, JobStatus, StaffingOffer, User } from './lib/contract';
import type { ApplicationEvent, ApplicationRow, JobDraft, JobRow, StaffingOfferRow, UserRow } from './lib/storeTypes';
import type { components as ShereheTypes } from './types/sherehe';
import { UpstreamError } from './clients/upstreamError';
import { CATEGORIES, COUNTIES } from './sharedLists';

// Database row -> Job schema
export function toJob(row: JobRow): Job {
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
    // employer_id, created_by, internal_notes and source_role_id are internal and are left out on purpose.
  };
}

// Database row + count -> EmployerJob schema (an employer's own job, with how many are waiting)
export function toEmployerJob(row: JobRow, pendingApplications: number): EmployerJob {
  return { ...toJob(row), pendingApplications };
}

// Database row -> User schema. The password hash never leaves the server.
export function toUser(row: UserRow): User {
  return {
    id: String(row._id),                 // _id -> id
    name: row.full_name,                 // full_name -> name
    email: row.email,
    role: row.role,
    // password_hash and created_at are left out on purpose.
  };
}

// Database row -> JobStatus schema (Endpoint 4: the lightweight availability check)
export function toJobStatus(row: JobRow): JobStatus {
  return {
    jobId: String(row._id),              // _id -> jobId
    status: row.listing_status,          // listing_status -> status
  };
}

// Database row -> ApplicationStatus schema
export function toApplicationStatus(row: ApplicationEvent): ApplicationStatus {
  return {
    applicationId: String(row._id),      // _id -> applicationId
    status: row.application_status,      // application_status -> status
    // student_id, job_ref, updated_at and reviewer_notes are not in the contract.
  };
}

// Dates leave the API as ISO 8601 strings like 2027-01-15T09:00:00Z,
// never as raw Date objects or timestamps.
export function toIsoDateTime(date: Date): string {
  return date.toISOString().replace(/\.000Z$/, 'Z');
}

// Database row -> Application schema (Week 6: returned by POST and PUT)
export function toApplication(row: ApplicationRow): Application {
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
// account, for example one Ujuzi created with its own student ID.
export function toApplicant(row: ApplicationRow, account: UserRow | null): Applicant {
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
// a client as undefined values. The shapes they return are cut from types/sherehe.d.ts, so a
// field Sherehe renames or drops in its contract stops `npm run typecheck`.

type ShereheEvent = ShereheTypes['schemas']['Event'];
type ShereheRole = ShereheTypes['schemas']['Role'];
type ShereheOffer = ShereheTypes['schemas']['Offer'];

export type PartnerEvent = Pick<ShereheEvent, 'id' | 'name' | 'county' | 'area' | 'startsAt' | 'status'>;
// category is plain text here: anything outside the shared list has already become "events".
export type PartnerRole = Pick<ShereheRole, 'id' | 'eventId' | 'title' | 'shiftStart' | 'shiftEnd' | 'payPerShift'> & {
  category: string;
  openSlots: number;
};
export type PartnerOffer = Pick<ShereheOffer, 'id' | 'roleId' | 'eventId' | 'workersOffered' | 'status'>;

function expectShape(ok: boolean, what: string): asserts ok {
  if (!ok) throw new UpstreamError('shape', { detail: what });
}
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const isWhole = (v: unknown, min: number): v is number => Number.isInteger(v) && (v as number) >= min;
const isDateText = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object';

// Counties use the shared spelling when we know it ("nairobi" -> "Nairobi").
function sharedCounty(name: string): string {
  const text = name.trim();
  return COUNTIES.find((county) => county.toLowerCase() === text.toLowerCase()) || text;
}

// A category outside the shared list becomes "events", since this is event work.
function sharedCategory(name: string): string {
  const text = String(name).trim().toLowerCase();
  return CATEGORIES.includes(text) ? text : 'events';
}

// Sherehe Event -> { id, name, county, area, startsAt, status }
export function fromShereheEvent(raw: unknown): PartnerEvent {
  expectShape(isObject(raw), 'an event is not an object');
  const e = raw as ShereheEvent;
  expectShape(isText(e.id) && isText(e.name), 'an event has no id or name');
  expectShape(isText(e.county) && isText(e.area), 'an event has no county or area');
  expectShape(isDateText(e.startsAt), 'an event has no valid startsAt');
  expectShape(isText(e.status), 'an event has no status');
  return { id: e.id, name: e.name.trim(), county: sharedCounty(e.county), area: e.area.trim(), startsAt: e.startsAt, status: e.status };
}

// Sherehe Role -> { id, eventId, title, category, openSlots, shiftStart, shiftEnd, payPerShift }
export function fromShereheRole(raw: unknown): PartnerRole {
  expectShape(isObject(raw), 'a role is not an object');
  const r = raw as ShereheRole;
  expectShape(isText(r.id) && isText(r.eventId) && isText(r.title), 'a role has no id, eventId or title');
  expectShape(isText(r.category), 'a role has no category');
  expectShape(isWhole(r.headcount, 1) && isWhole(r.filled, 0), 'a role has no valid headcount or filled');
  expectShape(isDateText(r.shiftStart) && isDateText(r.shiftEnd), 'a role has no valid shift times');
  expectShape(typeof r.payPerShift === 'number' && Number.isFinite(r.payPerShift) && r.payPerShift >= 0, 'a role has no valid payPerShift');
  return {
    id: r.id, eventId: r.eventId, title: r.title.trim(), category: sharedCategory(r.category),
    openSlots: Math.max(0, r.headcount - r.filled),   // headcount - filled -> openSlots
    shiftStart: r.shiftStart, shiftEnd: r.shiftEnd, payPerShift: r.payPerShift,
  };
}

const OFFER_STATUSES: readonly string[] = ['pending', 'accepted', 'declined'];

// Sherehe Offer -> { id, roleId, eventId, workersOffered, status }
export function fromShereheOffer(raw: unknown): PartnerOffer {
  expectShape(isObject(raw), 'an offer is not an object');
  const o = raw as ShereheOffer;
  expectShape(isText(o.id) && isText(o.roleId), 'an offer has no id or roleId');
  expectShape(isWhole(o.workersOffered, 1), 'an offer has no valid workersOffered');
  expectShape(OFFER_STATUSES.includes(o.status), 'an offer has an unknown status');
  return { id: o.id, roleId: o.roleId, eventId: typeof o.eventId === 'string' ? o.eventId : '', workersOffered: o.workersOffered, status: o.status };
}

// Whole seconds, like every other date the API sends (2026-11-20T09:15:00Z). toIsoDateTime above
// is left exactly as it was, because Endpoints 1 to 21 use it.
const toWholeSecondsIso = (date: Date): string => toIsoDateTime(new Date(Math.floor(date.getTime() / 1000) * 1000));

// Event + Role -> EventOpening schema (Endpoint 22)
export function toEventOpening(event: PartnerEvent, role: PartnerRole): EventOpening {
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
export function toStaffingOffer(row: StaffingOfferRow): StaffingOffer {
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
function shiftDuration(shiftStart: string, shiftEnd: string): string {
  const start = new Date(shiftStart);
  const kenya = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const hours = Math.max(1, Math.round((new Date(shiftEnd).getTime() - start.getTime()) / (60 * 60 * 1000)));
  return `One shift, ${kenya.getUTCDate()} ${MONTHS[kenya.getUTCMonth()]} ${kenya.getUTCFullYear()}, about ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

// Event + Role -> the job Kazi opens when the organiser accepts. The field names are the
// ones db.createJob takes. The pay is one amount: payPerShift for both ends of the range.
export function toJobInput(event: PartnerEvent, role: PartnerRole): JobDraft {
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
