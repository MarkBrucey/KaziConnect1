// Week 7: automated tests for the jobs resource, Endpoints 1 to 4.
//
// Every test follows arrange, act, assert, and checks the real response
// against openapi.yaml: the exact field names, their types and their values,
// not just the status code. Run with: npm test

const request = require('supertest');
const { createServer } = require('../app');
const db = require('../db');

const JOB_FIELDS = ['area', 'category', 'county', 'duration', 'id', 'payRange', 'status', 'title', 'urgent'];

// Strong shape check for one Job: exactly the contract's fields, right types.
function expectJobShape(job) {
  expect(Object.keys(job).sort()).toEqual(JOB_FIELDS); // nothing missing, nothing extra
  expect(typeof job.id).toBe('string');
  expect(typeof job.title).toBe('string');
  expect(typeof job.category).toBe('string');
  expect(typeof job.county).toBe('string');
  expect(typeof job.area).toBe('string');
  expect(typeof job.duration).toBe('string');
  expect(typeof job.urgent).toBe('boolean');
  expect(['active', 'closed']).toContain(job.status);
  expect(Object.keys(job.payRange).sort()).toEqual(['max', 'min']);
  expect(typeof job.payRange.min).toBe('number');
  expect(typeof job.payRange.max).toBe('number');
  expect(job.payRange.min).toBeLessThanOrEqual(job.payRange.max);
}

let server;
beforeAll((done) => { server = createServer(); server.listen(0, done); });
afterAll(async () => { await new Promise((r) => server.close(r)); if (db.close) await db.close(); });
beforeEach(async () => { await db.reset(); }); // arrange: every test starts from the same sample data

describe('Endpoint 1: GET /api/jobs?status=active', () => {
  it('returns every active job, each with exactly the contract fields', async () => {
    const res = await request(server).get('/api/jobs?status=active');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(6);
    res.body.forEach((job) => {
      expectJobShape(job);
      expect(job.status).toBe('active');
    });
  });

  it('turns pay stored as text in the database into real numbers', async () => {
    const res = await request(server).get('/api/jobs?status=active');

    const job = res.body.find((j) => j.id === 'job_12345');
    expect(job.payRange).toEqual({ min: 15000, max: 22000 });
  });

  it('never leaks internal database columns', async () => {
    const res = await request(server).get('/api/jobs?status=active');

    res.body.forEach((job) => {
      expect(job).not.toHaveProperty('_id');
      expect(job).not.toHaveProperty('job_title');
      expect(job).not.toHaveProperty('internal_notes');
      expect(job).not.toHaveProperty('created_by');
      expect(job).not.toHaveProperty('employer_id');
      expect(job).not.toHaveProperty('area_name');
    });
  });

  it('rejects a request with no status with 400 and no body', async () => {
    const res = await request(server).get('/api/jobs');

    expect(res.status).toBe(400);
    expect(res.text).toBe('');
  });

  it('edge case: a status that nothing has returns an empty list, not an error', async () => {
    const res = await request(server).get('/api/jobs?status=archived');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('edge case: matches status whatever the upper and lower case', async () => {
    const res = await request(server).get('/api/jobs?status=ACTIVE');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(6);
  });
});

describe('Endpoint 2: GET /api/jobs?county=...&category=...&status=active', () => {
  it('returns only active jobs in that county and category', async () => {
    const res = await request(server).get('/api/jobs?county=Nairobi&category=accommodation&status=active');

    expect(res.status).toBe(200);
    expect(res.body.map((j) => j.id).sort()).toEqual(['job_12345', 'job_12346']);
    res.body.forEach((job) => {
      expectJobShape(job);
      expect(job.county).toBe('Nairobi');
      expect(job.category).toBe('accommodation');
      expect(job.status).toBe('active');
    });
  });

  it('leaves out a closed job even when county and category match', async () => {
    const res = await request(server).get('/api/jobs?county=Nairobi&category=accommodation&status=active');

    expect(res.body.map((j) => j.id)).not.toContain('job_12350');
  });

  it('works with just one of the filters', async () => {
    const res = await request(server).get('/api/jobs?county=Kiambu&status=active');

    expect(res.status).toBe(200);
    expect(res.body.map((j) => j.id)).toEqual(['job_12347']);
  });

  it('rejects an empty county with 400', async () => {
    const res = await request(server).get('/api/jobs?county=&category=accommodation&status=active');

    expect(res.status).toBe(400);
    expect(res.text).toBe('');
  });

  it('rejects the old misspelt parameter statuts with 400, because status is then missing', async () => {
    const res = await request(server).get('/api/jobs?county=Nairobi&category=accommodation&statuts=active');

    expect(res.status).toBe(400);
  });

  it('edge case: a county with no jobs returns an empty list', async () => {
    const res = await request(server).get('/api/jobs?county=Turkana&category=accommodation&status=active');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('edge case: filters ignore upper and lower case', async () => {
    const res = await request(server).get('/api/jobs?county=nairobi&category=ACCOMMODATION&status=active');

    expect(res.body.map((j) => j.id).sort()).toEqual(['job_12345', 'job_12346']);
  });
});

describe('Endpoint 3: GET /api/jobs/{jobId}', () => {
  it('returns the full job with the exact contract fields and values', async () => {
    const res = await request(server).get('/api/jobs/job_12345');

    expect(res.status).toBe(200);
    expectJobShape(res.body);
    expect(res.body).toEqual({
      id: 'job_12345',
      title: 'Campus Housing Assistant',
      category: 'accommodation',
      county: 'Nairobi',
      area: 'Parklands',
      duration: 'Part time, 3 months',
      urgent: true,
      status: 'active',
      payRange: { min: 15000, max: 22000 },
    });
  });

  it('returns 404 with no body for a job that does not exist', async () => {
    const res = await request(server).get('/api/jobs/job_99999');

    expect(res.status).toBe(404);
    expect(res.text).toBe('');
  });

  it('edge case: still returns a closed job, marked closed', async () => {
    const res = await request(server).get('/api/jobs/job_12350');

    expect(res.status).toBe(200);
    expectJobShape(res.body);
    expect(res.body.status).toBe('closed');
  });

  it('edge case: keeps decimal pay exactly', async () => {
    const res = await request(server).get('/api/jobs/job_12351');

    expect(res.body.payRange.min).toBe(9500.5);
  });
});

describe('Endpoint 4: GET /api/jobs/{jobId}/status', () => {
  it('returns only jobId and status for an active job', async () => {
    const res = await request(server).get('/api/jobs/job_12345/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jobId: 'job_12345', status: 'active' });
  });

  it('is lightweight: no title, pay or other job fields', async () => {
    const res = await request(server).get('/api/jobs/job_12345/status');

    expect(Object.keys(res.body).sort()).toEqual(['jobId', 'status']);
  });

  it('edge case: reports a filled job as closed', async () => {
    const res = await request(server).get('/api/jobs/job_12350/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jobId: 'job_12350', status: 'closed' });
  });

  it('returns 404 with no body for a job that does not exist', async () => {
    const res = await request(server).get('/api/jobs/job_99999/status');

    expect(res.status).toBe(404);
    expect(res.text).toBe('');
  });
});
