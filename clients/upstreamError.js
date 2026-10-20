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
const PARTNER_UNAVAILABLE = 'Event information is unavailable right now. Try again in a minute.';

class UpstreamError extends Error {
  // kind: 'config' | 'timeout' | 'network' | 'status' | 'shape'
  // detail is for our logs only: a short note we wrote, never text taken from the partner's reply.
  constructor(kind, { status = null, detail = '' } = {}) {
    super(`Partner request failed: ${kind}`);
    this.name = 'UpstreamError';
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

class PartnerRejection extends Error {
  constructor(kind) {
    super(`Partner rejected the request: ${kind}`);
    this.name = 'PartnerRejection';
    this.kind = kind;
  }
}

// One line in the server log. Never the partner's reply, and never the API key.
function logUpstream(err, where) {
  if (process.env.JEST_WORKER_ID) return;
  const what = err instanceof UpstreamError
    ? `${err.kind}${err.status ? ` (HTTP ${err.status})` : ''}${err.detail ? `: ${err.detail}` : ''}`
    : String(err && err.message);
  console.error(`[sherehe] ${where}: ${what}`);
}

module.exports = { UpstreamError, PartnerRejection, PARTNER_UNAVAILABLE, logUpstream };
