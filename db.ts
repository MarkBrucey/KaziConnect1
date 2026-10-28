// Chooses where Kazi Connect keeps its data:
//   DATABASE_URL set (for example a free Neon database)  -> PostgreSQL, data is kept
//   no DATABASE_URL (tests, or running on your computer) -> in memory, resets on restart
// Both stores have exactly the same functions, and every function is async.
//
// Everything is exported by name, because the tests (and the rest of the code) use this module as
// `db.findJobs(...)`, `db.reset()`, `db.events` and so on.

import * as memoryStore from './memoryStore';
import * as pgStore from './pgStore';
import type { Store } from './lib/storeTypes';

// Each line fails `npm run typecheck` if a store is missing a function, or has one with another shape.
const memory: Store = memoryStore;
const postgres: Store = pgStore;

const store: Store = process.env.DATABASE_URL ? postgres : memory;

export const kind = store.kind;
export const events = store.events;
export const init = store.init;
export const reset = store.reset;
export const close = store.close;

export const findJobs = store.findJobs;
export const findJobById = store.findJobById;
export const findJobsByEmployer = store.findJobsByEmployer;
export const countPendingApplications = store.countPendingApplications;
export const findAcceptedApplication = store.findAcceptedApplication;
export const createJob = store.createJob;
export const setJobStatus = store.setJobStatus;

export const findApplicationById = store.findApplicationById;
export const findApplicationsByJob = store.findApplicationsByJob;
export const findApplicationsByStudent = store.findApplicationsByStudent;
export const countApplications = store.countApplications;
export const createApplication = store.createApplication;
export const replaceApplicationDetails = store.replaceApplicationDetails;
export const deleteApplication = store.deleteApplication;
export const setApplicationStatus = store.setApplicationStatus;
export const acceptApplication = store.acceptApplication;

export const createUser = store.createUser;
export const findUserByEmail = store.findUserByEmail;
export const findUserById = store.findUserById;
export const createSession = store.createSession;
export const findSession = store.findSession;
export const deleteSession = store.deleteSession;

export const createPasswordReset = store.createPasswordReset;
export const countPasswordResetsSince = store.countPasswordResetsSince;
export const findPasswordReset = store.findPasswordReset;
export const completePasswordReset = store.completePasswordReset;

export const createStaffingOffer = store.createStaffingOffer;
export const findStaffingOfferById = store.findStaffingOfferById;
export const findPendingStaffingOffer = store.findPendingStaffingOffer;
export const findStaffingOffersByEmployer = store.findStaffingOffersByEmployer;
export const findPendingStaffingOffers = store.findPendingStaffingOffers;
export const deleteStaffingOffer = store.deleteStaffingOffer;
export const declineStaffingOffer = store.declineStaffingOffer;
export const acceptStaffingOffer = store.acceptStaffingOffer;
