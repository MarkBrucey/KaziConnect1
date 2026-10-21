// The request and response shapes of the contract, taken from types/api.d.ts, which
// `npm run types` generates from openapi.yaml. Mappers return these, so a change to the contract
// that the code does not follow fails `npm run typecheck`.

import type { components } from '../types/api';

export type Schemas = components['schemas'];
export type Job = Schemas['Job'];
export type JobStatus = Schemas['JobStatus'];
export type EmployerJob = Schemas['EmployerJob'];
export type ApplicationStatus = Schemas['ApplicationStatus'];
export type Application = Schemas['Application'];
export type Applicant = Schemas['Applicant'];
export type User = Schemas['User'];
export type EventOpening = Schemas['EventOpening'];
export type StaffingOffer = Schemas['StaffingOffer'];
export type NewJob = Schemas['NewJob'];
export type NewApplication = Schemas['NewApplication'];
export type ApplicationUpdate = Schemas['ApplicationUpdate'];
export type NewUser = Schemas['NewUser'];
export type Credentials = Schemas['Credentials'];
export type NewPassword = Schemas['NewPassword'];
export type PasswordResetRequest = Schemas['PasswordResetRequest'];
export type JobStatusUpdate = Schemas['JobStatusUpdate'];
export type ApplicationDecision = Schemas['ApplicationDecision'];
export type NewStaffingOffer = Schemas['NewStaffingOffer'];
