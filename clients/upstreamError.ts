// What can go wrong when Kazi Connect calls a partner API (Sherehe).
//
// Two kinds of failure, handled differently:
//   UpstreamError    the partner could not be used at all (down, too slow, not configured,
//                    refused our key, or answered something unexpected). The API turns it
//                    into our own 502. Nothing the partner said is ever passed on.
//   PartnerRejection the partner understood us and said no for a reason a user can act on
//                    ('invalid', 'not_found' or 'conflict'). The route answers 400, 404 or 409
//                    in Kazi's own words.

// The one message a client sees for every UpstreamError.
export const PARTNER_UNAVAILABLE = 'Event information is unavailable right now. Try again in a minute.';

export type UpstreamKind = 'config' | 'timeout' | 'network' | 'status' | 'shape';

export class UpstreamError extends Error {
  readonly kind: UpstreamKind;
  readonly status: number | null;
  readonly detail: string;

  // detail is for our logs only: a short note we wrote, never text taken from the partner's reply.
  constructor(kind: UpstreamKind, { status = null, detail = '' }: { status?: number | null; detail?: string } = {}) {
    super(`Partner request failed: ${kind}`);
    this.name = 'UpstreamError';
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

export type RejectionKind = 'invalid' | 'not_found' | 'conflict';

export class PartnerRejection extends Error {
  readonly kind: RejectionKind;

  constructor(kind: RejectionKind) {
    super(`Partner rejected the request: ${kind}`);
    this.name = 'PartnerRejection';
    this.kind = kind;
  }
}

// One line in the server log. Never the partner's reply, and never the API key.
export function logUpstream(err: unknown, where: string): void {
  if (process.env.JEST_WORKER_ID) return;
  const what = err instanceof UpstreamError
    ? `${err.kind}${err.status ? ` (HTTP ${err.status})` : ''}${err.detail ? `: ${err.detail}` : ''}`
    : String(err instanceof Error ? err.message : err);
  console.error(`[sherehe] ${where}: ${what}`);
}
