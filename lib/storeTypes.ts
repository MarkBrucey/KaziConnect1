// The shapes the data store works in, and the one interface both stores implement.
//
// Rows look the way a database hands data back, NOT the way openapi.yaml promises it: snake_case
// names, an _id key, money as text, and internal columns that must never leave the server.
// mappers.ts turns these rows into the schemas in the contract.

import type { EventEmitter } from 'events';

export type UserRole = 'student' | 'employer';
export type JobListingStatus = 'active' | 'closed';
export type StoredApplicationStatus = 'pending' | 'accepted' | 'filled';
// 'cancelled' is never stored: a deleted application is announced once, with that status.
export type ApplicationStatusValue = StoredApplicationStatus | 'cancelled';
export type StaffingOfferStatus = 'pending' | 'accepted' | 'declined';

export interface UserRow {
  _id: string;
  full_name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  created_at: Date;
}

export interface JobRow {
  _id: string;
  job_title: string;
  job_category: string;
  county_name: string;
  area_name: string;
  duration_text: string;
  is_urgent: boolean;
  listing_status: JobListingStatus;
  pay_min: string; // money is text: "15000.00"
  pay_max: string;
  employer_id: string | null;
  created_by: string | null;
  internal_notes: string;
  source_role_id?: string | null; // internal: the Sherehe role a job was opened from
}

export interface ApplicationRow {
  _id: string;
  student_id: string;
  job_ref: string;
  application_status: StoredApplicationStatus;
  preferred_at: Date;
  student_note: string;
  created_at: Date;
  updated_at: Date;
  reviewer_notes: string;
}

// An application as announced to WebSocket subscribers: the row, with 'cancelled' possible.
export type ApplicationEvent = Omit<ApplicationRow, 'application_status'> & { application_status: ApplicationStatusValue };

export interface SessionRow {
  token_hash: string;
  user_id: string;
  expires_at: Date;
  created_at: Date;
}

export interface PasswordResetRow {
  token_hash: string;
  user_id: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}

// What an accepted offer turns into: the arguments of createJob, worked out when the offer is made.
export interface JobDraft {
  title: string;
  category: string;
  county: string;
  area: string;
  duration: string;
  urgent: boolean;
  payMin: number;
  payMax: number;
}

export interface StaffingOfferRow {
  _id: string;
  employer_id: string;
  sherehe_offer_id: string;
  role_id: string;
  event_name: string;
  workers_offered: number;
  status: StaffingOfferStatus;
  job_id: string | null;
  job_draft: JobDraft;
  created_at: Date;
}

export interface JobFilter {
  status?: string;
  county?: string;
  category?: string;
}

export interface NewJobInput extends JobDraft {
  employerId: string;
  sourceRoleId?: string | null;
}

export interface NewApplicationInput {
  jobId: string;
  studentId: string;
  preferredAt: Date;
  note: string;
}

export interface NewStaffingOfferInput {
  employerId: string;
  shereheOfferId: string;
  roleId: string;
  eventName: string;
  workersOffered: number;
  jobDraft: JobDraft;
}

// 'statusChanged' (id, row): an application's status changed
// 'removed'       (id, row): an application was cancelled and deleted
export type StoreEvents = {
  statusChanged: [id: string, row: ApplicationEvent];
  removed: [id: string, row: ApplicationEvent];
};
export type StoreEmitter = EventEmitter<StoreEvents>;

// Both stores have exactly the same functions, and every function is async.
export interface Store {
  kind: 'memory' | 'postgres';
  events: StoreEmitter;
  init(): Promise<void>;
  reset(): Promise<void>;
  close?: () => Promise<void>;

  findJobs(filter?: JobFilter): Promise<JobRow[]>;
  findJobById(id: string): Promise<JobRow | null>;
  findJobsByEmployer(userId: string): Promise<JobRow[]>;
  countPendingApplications(jobId: string): Promise<number>;
  findAcceptedApplication(jobId: string): Promise<ApplicationRow | null>;
  createJob(job: NewJobInput): Promise<JobRow>;
  setJobStatus(id: string, status: JobListingStatus): Promise<JobRow | null>;

  findApplicationById(id: string): Promise<ApplicationRow | null>;
  findApplicationsByJob(jobId: string): Promise<ApplicationRow[]>;
  findApplicationsByStudent(studentId: string): Promise<ApplicationRow[]>;
  countApplications(): Promise<number>;
  createApplication(input: NewApplicationInput): Promise<ApplicationRow>;
  replaceApplicationDetails(id: string, details: { preferredAt: Date; note: string }): Promise<ApplicationRow | null>;
  deleteApplication(id: string): Promise<ApplicationRow | null>;
  setApplicationStatus(id: string, status: StoredApplicationStatus): Promise<ApplicationRow | null>;
  acceptApplication(id: string): Promise<ApplicationRow | null>;

  createUser(user: { name: string; email: string; passwordHash: string; role: UserRole }): Promise<UserRow | null>;
  findUserByEmail(email: string): Promise<UserRow | null>;
  findUserById(id: string): Promise<UserRow | null>;
  createSession(session: { tokenHash: string; userId: string; expiresAt: Date }): Promise<void>;
  findSession(tokenHash: string): Promise<SessionRow | null>;
  deleteSession(tokenHash: string): Promise<void>;

  createPasswordReset(reset: { tokenHash: string; userId: string; expiresAt: Date }): Promise<void>;
  countPasswordResetsSince(userId: string, since: Date): Promise<number>;
  findPasswordReset(tokenHash: string): Promise<PasswordResetRow | null>;
  completePasswordReset(input: { tokenHash: string; userId: string; passwordHash: string }): Promise<boolean>;

  createStaffingOffer(offer: NewStaffingOfferInput): Promise<StaffingOfferRow | null>;
  findStaffingOfferById(id: string): Promise<StaffingOfferRow | null>;
  findPendingStaffingOffer(roleId: string): Promise<StaffingOfferRow | null>;
  findStaffingOffersByEmployer(userId: string): Promise<StaffingOfferRow[]>;
  findPendingStaffingOffers(): Promise<StaffingOfferRow[]>;
  deleteStaffingOffer(id: string): Promise<StaffingOfferRow | null>;
  declineStaffingOffer(id: string): Promise<StaffingOfferRow | null>;
  acceptStaffingOffer(id: string): Promise<{ offer: StaffingOfferRow; job: JobRow } | null>;
}
