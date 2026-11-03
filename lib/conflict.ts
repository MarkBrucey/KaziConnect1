// A write the data store refuses because of the current state of the data, not because the request
// was badly formed. The route handlers turn it into a 409.
//
//   closed       the job is closed and takes no applications
//   filled       the job already has an accepted applicant (acceptedId says which)
//   not_pending  the application has already been decided (status says how)
//
// The rule behind "filled": a job has one place. Once one application is accepted, nobody else can be
// accepted, the job cannot be reopened, and new applications are refused with a message saying the
// job is filled. The stores check it as they write, so two requests at the same moment cannot both win.

export type ConflictReason = 'closed' | 'filled' | 'not_pending';

export class StoreConflict extends Error {
  readonly reason: ConflictReason;
  readonly acceptedId: string | null;
  readonly status: string | null;

  constructor(reason: ConflictReason, { acceptedId = null, status = null }: { acceptedId?: string | null; status?: string | null } = {}) {
    super(`conflict: ${reason}`);
    this.name = 'StoreConflict';
    this.reason = reason;
    this.acceptedId = acceptedId;
    this.status = status;
  }
}

// The messages the API sends for these cases (Endpoints 7, 17 and 18).
export const filledForApplicants = (jobId: string): string =>
  `Job ${jobId} is already filled: another applicant was accepted, so it is not accepting applications.`;
export const filledForEmployer = (jobId: string, acceptedId: string | null): string =>
  `Job ${jobId} is already filled: application ${acceptedId || 'another application'} was accepted. Only one applicant can be accepted for a job.`;
export const cannotReopen = (jobId: string, acceptedId: string | null): string =>
  `Job ${jobId} is already filled: application ${acceptedId || 'another application'} was accepted, so it cannot be reopened. Post a new job if you need someone else.`;
