// Follows the staffing offers employers have made, until the organiser decides each one.
//
// Sherehe cannot call us, so every few minutes this asks it (K4) about each offer that is
// still pending:
//   accepted  Kazi opens the job for the offer's employer, from the job worked out when the
//             offer was made, and the offer records the job's id. (db.acceptStaffingOffer does
//             both in one step, so running twice never makes two jobs.)
//   declined  the offer is marked declined.
//   pending   nothing happens; it is asked about again next time.
// Offers that are accepted or declined are final and are never asked about again.
//
// If Sherehe cannot be reached the offer simply stays pending and is tried again next time.
// Nothing here throws, so a Sherehe outage can never stop the server (requirement R7).
//
// server.js starts it. createServer() does not, so tests and `npm run verify` call runOnce().

const db = require('../db');
const shereheClient = require('../clients/shereheClient');
const { UpstreamError, logUpstream } = require('../clients/upstreamError');

const DEFAULT_INTERVAL_MS = 3 * 60 * 1000;
const MIN_INTERVAL_MS = 5 * 1000;
const FIRST_RUN_DELAY_MS = 5 * 1000; // soon after a start, since a sleeping free host only wakes when asked

let running = false;

// One pass over the pending offers. Returns what happened.
async function runOnce() {
  const result = { skipped: false, checked: 0, accepted: 0, declined: 0, failed: 0 };
  if (running) return { ...result, skipped: true }; // the last pass is still going
  running = true;
  try {
    for (const offer of await db.findPendingStaffingOffers()) {
      result.checked++;
      try {
        const remote = await shereheClient.getOffer(offer.sherehe_offer_id, { mode: 'background' });
        if (!remote) {
          logUpstream(new UpstreamError('status', { status: 404, detail: `Sherehe has no offer for ${offer._id}; left pending` }), 'checking offers');
        } else if (remote.status === 'accepted') {
          if (await db.acceptStaffingOffer(offer._id)) result.accepted++;
        } else if (remote.status === 'declined') {
          if (await db.declineStaffingOffer(offer._id)) result.declined++;
        }
      } catch (err) {
        result.failed++;
        logUpstream(err, `checking offer ${offer._id}`);
        if (err instanceof UpstreamError && err.kind === 'config') break; // every other offer would fail the same way
      }
    }
  } catch (err) {
    result.failed++;
    logUpstream(err, 'reading the pending offers');
  } finally {
    running = false;
  }
  return result;
}

// Runs soon after the start, then every OFFER_POLL_MS (default 3 minutes, never under 5 seconds).
// Each pass is scheduled when the last one ends, so passes never overlap. Call stop() to end it.
function startOfferPoller({ intervalMs, firstRunMs = FIRST_RUN_DELAY_MS } = {}) {
  const every = Math.max(MIN_INTERVAL_MS, intervalMs || Number(process.env.OFFER_POLL_MS) || DEFAULT_INTERVAL_MS);
  let timer = null;
  let stopped = false;

  const schedule = (ms) => {
    if (stopped) return;
    timer = setTimeout(tick, ms);
    timer.unref(); // waiting for the next pass never keeps the process alive on its own
  };
  async function tick() {
    try {
      await runOnce();
    } catch (err) {
      logUpstream(err, 'offer poller');
    }
    schedule(every);
  }

  schedule(firstRunMs);
  return { every, stop() { stopped = true; clearTimeout(timer); } };
}

module.exports = { runOnce, startOfferPoller };
