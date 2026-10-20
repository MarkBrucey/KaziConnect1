// Event work (Endpoints 22 to 25, website need W7): employers see open roles on Sherehe
// events, offer workers for a role, follow their offers and withdraw them.
//
// Sherehe is only ever reached through clients/shereheClient. When it cannot be used these
// routes answer 502 with our own message, and Endpoints 1 to 21 never notice.

const express = require('express');
const db = require('./db');
const shereheClient = require('./clients/shereheClient');
const { UpstreamError, PartnerRejection, PARTNER_UNAVAILABLE, logUpstream } = require('./clients/upstreamError');
const { toEventOpening, toStaffingOffer, toJobInput } = require('./mappers');
const { authenticate, requireRole } = require('./auth');
const { validateStaffingOffer } = require('./validation');

const openings = express.Router();  // /api/event-openings
const offers = express.Router();    // /api/staffing-offers
const mine = express.Router();      // /api/me/staffing-offers
const fail = (res, status, message) => res.status(status).json({ message });
const employersOnly = [authenticate(db), requireRole('employer')];

// A Sherehe failure becomes our own 502. Any other error carries on to the app's 500 handler.
function partnerErrors(err, req, res, next) {
  if (!(err instanceof UpstreamError)) return next(err);
  logUpstream(err, `${req.method} ${req.originalUrl.split('?')[0]}`);
  return fail(res, 502, PARTNER_UNAVAILABLE);
}

const ROLE_TAKEN = 'This role is full, or an offer is already waiting on it.';

// ENDPOINT 22: GET /api/event-openings?county=Nairobi   (website need W7, Sherehe needs K1 and K2)
openings.get('/', ...employersOnly, async (req, res) => {
  const county = typeof req.query.county === 'string' ? req.query.county.trim() : '';
  const found = await shereheClient.findOpenings({ county: county || undefined });
  res.status(200).json(found.map(({ event, role }) => toEventOpening(event, role)));
});

// ENDPOINT 23: POST /api/staffing-offers   (website need W7, Sherehe need K3)
offers.post('/', ...employersOnly, async (req, res) => {
  // 1. Validate the body. Nothing is sent or written if this fails.
  const problem = validateStaffingOffer(req.body);
  if (problem) return fail(res, 400, problem);
  const roleId = req.body.roleId.trim();

  // 2. The role must be an open one on an upcoming event, and have no offer waiting already.
  const opening = await shereheClient.findOpening(roleId);
  if (!opening) return fail(res, 404, `No open role with the id ${roleId}`);
  if (await db.findPendingStaffingOffer(roleId)) return fail(res, 409, ROLE_TAKEN);

  // 3. Make the offer at Sherehe. Sherehe has the last word on free slots.
  let made;
  try {
    made = await shereheClient.createOffer({ roleId, workersOffered: req.body.workersOffered, note: req.body.note });
  } catch (err) {
    if (!(err instanceof PartnerRejection)) throw err;
    if (err.kind === 'invalid') return fail(res, 400, 'workersOffered must be a whole number from 1 up to the free slots on this role');
    if (err.kind === 'not_found') return fail(res, 404, `No open role with the id ${roleId}`);
    return fail(res, 409, ROLE_TAKEN);
  }

  // 4. Keep our side. The job to open on acceptance is worked out now, from the role as the
  //    employer saw it, so the poller later needs nothing from Sherehe but the offer's status.
  const row = await db.createStaffingOffer({
    employerId: req.user._id,
    shereheOfferId: made.id,
    roleId,
    eventName: opening.event.name,
    workersOffered: req.body.workersOffered,
    jobDraft: toJobInput(opening.event, opening.role),
  });
  if (!row) {
    // Two requests made an offer on this role at the same moment and the other one won:
    // take ours back from Sherehe so the organiser is not shown two.
    await shereheClient.withdrawOffer(made.id).catch((err) => logUpstream(err, 'withdrawing a duplicate offer'));
    return fail(res, 409, ROLE_TAKEN);
  }
  res.status(201).json(toStaffingOffer(row));
});

// ENDPOINT 24: GET /api/me/staffing-offers   (website need W7)
// Reads our own database only, so it works whether or not Sherehe is up. The poller keeps the
// statuses current.
mine.get('/', ...employersOnly, async (req, res) => {
  res.status(200).json((await db.findStaffingOffersByEmployer(req.user._id)).map(toStaffingOffer));
});

// ENDPOINT 25: DELETE /api/staffing-offers/{offerId}   (website need W7, Sherehe need K5)
offers.delete('/:offerId', ...employersOnly, async (req, res) => {
  const id = req.params.offerId;
  const row = await db.findStaffingOfferById(id);
  if (!row) return fail(res, 404, `Staffing offer ${id} not found`);
  if (row.employer_id !== req.user._id) return fail(res, 403, 'You can only withdraw offers you made.');
  if (row.status !== 'pending') return fail(res, 409, `This offer is already ${row.status}, so it can no longer be withdrawn.`);

  try {
    await shereheClient.withdrawOffer(row.sherehe_offer_id); // 'gone' (Sherehe no longer has it) is as good as withdrawn
  } catch (err) {
    if (err instanceof PartnerRejection) return fail(res, 409, 'The organiser has already accepted or declined this offer, so it can no longer be withdrawn.');
    throw err;
  }
  await db.deleteStaffingOffer(id);
  res.status(204).end();
});

[openings, offers, mine].forEach((router) => router.use(partnerErrors));

module.exports = { openings, offers, mine };
