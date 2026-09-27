const express = require('express');
const db = require('./db');
const { toJob, toJobStatus } = require('./mappers');

const router = express.Router();

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

// ENDPOINT 1: GET /api/jobs?status=active                                    (Statement 1)
// ENDPOINT 2: GET /api/jobs?county=Nairobi&category=accommodation&status=active (Statement 2)
// Both are the same route: county and category are optional filters.
router.get('/', (req, res) => {
  const q = readQuery(req, ['status'], ['county', 'category']);
  if (!q) return res.status(400).end();
  res.status(200).json(db.findJobs(q).map(toJob));
});

// ENDPOINT 4: GET /api/jobs/{jobId}/status   (Statement 3)
router.get('/:jobId/status', (req, res) => {
  const row = db.findJobById(req.params.jobId);
  if (!row) return res.status(404).end();
  res.status(200).json(toJobStatus(row));
});

// ENDPOINT 3: GET /api/jobs/{jobId}   (Statements 3 and 4)
router.get('/:jobId', (req, res) => {
  const row = db.findJobById(req.params.jobId);
  if (!row) return res.status(404).end();
  res.status(200).json(toJob(row));
});

module.exports = router;
