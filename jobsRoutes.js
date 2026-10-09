const express = require('express');
const db = require('./db');
const { toJob, toJobStatus, toApplicant } = require('./mappers');
const { authenticate, requireRole } = require('./auth');
const { validateNewJob, validateJobStatusUpdate } = require('./validation');

const router = express.Router();
const fail = (res, status, message) => res.status(status).json({ message });
const loggedIn = authenticate(db);

// Reads the query parameters. Returns null if a required one is missing or
// blank, or if an optional one was sent but left empty.
function readQuery(req, required, optional) {
  const values = {};
  for (const name of required.concat(optional)) {
    const value = req.query[name];
    if (value === undefined && optional.includes(name)) continue;
    if (typeof value !== 'string' || value.trim() === '') return null;
    values[name] = value.trim();
  }
  return values;
}

// The job must exist and belong to the logged in employer. Returns the job
// row, or sends 404 / 403 and returns null.
async function ownJob(req, res) {
  const job = await db.findJobById(req.params.jobId);
  if (!job) { fail(res, 404, `Job ${req.params.jobId} not found`); return null; }
  if (job.employer_id !== req.user._id) { fail(res, 403, 'You can only manage jobs you posted.'); return null; }
  return job;
}

// ENDPOINT 1: GET /api/jobs?status=active                                    (Statement 1)
// ENDPOINT 2: GET /api/jobs?county=Nairobi&category=accommodation&status=active (Statement 2)
// Both are the same route: county and category are optional filters.
router.get('/', async (req, res) => {
  const q = readQuery(req, ['status'], ['county', 'category']);
  if (!q) return res.status(400).end();
  res.status(200).json((await db.findJobs(q)).map(toJob));
});

// ENDPOINT 14: POST /api/jobs   (FundiLink Statement F2) employers only
router.post('/', loggedIn, requireRole('employer'), async (req, res) => {
  const problem = validateNewJob(req.body);
  if (problem) return fail(res, 400, problem);
  const b = req.body;
  const row = await db.createJob({
    employerId: req.user._id,
    title: b.title.trim(),
    category: b.category.trim().toLowerCase(),
    county: b.county.trim(),
    area: b.area.trim(),
    duration: b.duration.trim(),
    urgent: b.urgent === true,
    payMin: b.payRange.min,
    payMax: b.payRange.max,
  });
  res.status(201).location(`/api/jobs/${row._id}`).json(toJob(row));
});

// ENDPOINT 4: GET /api/jobs/{jobId}/status   (Statement 3)
router.get('/:jobId/status', async (req, res) => {
  const row = await db.findJobById(req.params.jobId);
  if (!row) return res.status(404).end();
  res.status(200).json(toJobStatus(row));
});

// ENDPOINT 16: GET /api/jobs/{jobId}/applications   (FundiLink Statement F3) the job's employer only
router.get('/:jobId/applications', loggedIn, requireRole('employer'), async (req, res) => {
  const job = await ownJob(req, res);
  if (!job) return;
  const rows = await db.findApplicationsByJob(job._id);
  // Add the applicant's name when the application came from a Kazi Connect account.
  const applicants = await Promise.all(rows.map(async (row) => {
    const account = row.student_id.startsWith('usr_') ? await db.findUserById(row.student_id) : null;
    return toApplicant(row, account);
  }));
  res.status(200).json(applicants);
});

// ENDPOINT 3: GET /api/jobs/{jobId}   (Statements 3 and 4)
router.get('/:jobId', async (req, res) => {
  const row = await db.findJobById(req.params.jobId);
  if (!row) return res.status(404).end();
  res.status(200).json(toJob(row));
});

// ENDPOINT 17: PATCH /api/jobs/{jobId}   (FundiLink Statement F4) close or reopen, the job's employer only.
// Closing a job marks every application still waiting on it as filled.
router.patch('/:jobId', loggedIn, requireRole('employer'), async (req, res) => {
  const problem = validateJobStatusUpdate(req.body);
  if (problem) return fail(res, 400, problem);
  const job = await ownJob(req, res);
  if (!job) return;
  res.status(200).json(toJob(await db.setJobStatus(job._id, req.body.status)));
});

module.exports = router;
