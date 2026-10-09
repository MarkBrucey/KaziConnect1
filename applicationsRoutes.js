const express = require('express');
const db = require('./db');
const { toApplicationStatus, toApplication } = require('./mappers');
const { validateNewApplication, validateApplicationUpdate, validateApplicationDecision } = require('./validation');
const { authenticate, requireRole } = require('./auth');

const router = express.Router();
const fail = (res, status, message) => res.status(status).json({ message });

// Week 5: reads

// ENDPOINT 5: GET /api/applications/{applicationId}/status   (Statement 5)
router.get('/:applicationId/status', async (req, res) => {
  const row = await db.findApplicationById(req.params.applicationId);
  if (!row) return res.status(404).end();
  res.status(200).json(toApplicationStatus(row));
});

// ENDPOINT 6 over plain HTTP (for example from Swagger UI's Try it out).
// Real WebSocket connections never reach this handler: they are taken over
// by the upgrade handler in realtime.js.   (Statement 5)
router.get('/:applicationId/subscribe', async (req, res) => {
  const row = await db.findApplicationById(req.params.applicationId);
  if (!row) return res.status(404).end();
  res.status(426).set('Upgrade', 'websocket').end();
});

// Week 6: writes. Validate first, write second.

// ENDPOINT 7: POST /api/applications   (Statement 6)
router.post('/', async (req, res) => {
  // 1. Validate the body. Nothing is written if this fails.
  const problem = validateNewApplication(req.body);
  if (problem) return fail(res, 400, problem);

  // 2. The job it refers to must exist and still be open.
  const jobId = req.body.jobId.trim();
  const job = await db.findJobById(jobId);
  if (!job) return fail(res, 400, `jobId ${jobId} does not match any job`);
  if (job.listing_status !== 'active') {
    return fail(res, 409, `Job ${jobId} is ${job.listing_status} and is not accepting applications`);
  }

  // 3. Write, then return the new resource shaped exactly like the contract.
  const row = await db.createApplication({
    jobId,
    studentId: req.body.studentId.trim(),
    preferredAt: new Date(req.body.preferredDate),
    note: req.body.note === undefined ? '' : req.body.note,
  });
  res.status(201).location(`/api/applications/${row._id}`).json(toApplication(row));
});

// ENDPOINT 8: PUT /api/applications/{applicationId}   (Statement 7)
router.put('/:applicationId', async (req, res) => {
  const id = req.params.applicationId;

  // 1. Validate the body.
  const problem = validateApplicationUpdate(req.body);
  if (problem) return fail(res, 400, problem);

  // 2. It must already exist. A PUT never quietly becomes a create.
  const row = await db.findApplicationById(id);
  if (!row) return fail(res, 404, `Application ${id} not found`);

  // 3. Only pending applications can be changed.
  if (row.application_status !== 'pending') {
    return fail(res, 409, `Application ${id} is ${row.application_status}; only pending applications can be changed`);
  }

  // 4. Set the absolute state. Leaving note out clears it, so the same
  //    request sent twice always gives the same result.
  const updated = await db.replaceApplicationDetails(id, {
    preferredAt: new Date(req.body.preferredDate),
    note: req.body.note === undefined ? '' : req.body.note,
  });
  res.status(200).json(toApplication(updated));
});

// ENDPOINT 18: PATCH /api/applications/{applicationId}   (FundiLink Statement F3)
// The employer who posted the job accepts an application. Every other waiting
// application for that job becomes filled, the job closes, and WebSocket
// subscribers hear about each change straight away.
router.patch('/:applicationId', authenticate(db), requireRole('employer'), async (req, res) => {
  const id = req.params.applicationId;
  const problem = validateApplicationDecision(req.body);
  if (problem) return fail(res, 400, problem);
  const row = await db.findApplicationById(id);
  if (!row) return fail(res, 404, `Application ${id} not found`);
  const job = await db.findJobById(row.job_ref);
  if (!job || job.employer_id !== req.user._id) return fail(res, 403, 'You can only decide on applications for jobs you posted.');
  if (row.application_status !== 'pending') {
    return fail(res, 409, `Application ${id} is ${row.application_status}; only pending applications can be accepted`);
  }
  res.status(200).json(toApplication(await db.acceptApplication(id)));
});

// ENDPOINT 9: DELETE /api/applications/{applicationId}   (Statement 8)
router.delete('/:applicationId', async (req, res) => {
  const id = req.params.applicationId;

  // 1. It must exist.
  const row = await db.findApplicationById(id);
  if (!row) return fail(res, 404, `Application ${id} not found`);

  // 2. Only pending applications can be cancelled.
  if (row.application_status !== 'pending') {
    return fail(res, 409, `Application ${id} is ${row.application_status}; only pending applications can be cancelled`);
  }

  // 3. Delete it for real, then answer 204 with no body.
  await db.deleteApplication(id);
  res.status(204).end();
});

module.exports = router;
