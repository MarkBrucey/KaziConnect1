// Automated tests for the employer side, Endpoints 14 to 18 (added after Week 7).
// Every test follows arrange, act, assert, and checks the real response shape.

const request = require('supertest');
const WebSocket = require('ws');
const { createServer } = require('../app');
const db = require('../db');
const { DEMO_PASSWORD } = require('../seedData');

const JOB_FIELDS = ['area', 'category', 'county', 'duration', 'id', 'payRange', 'status', 'title', 'urgent'];
const APPLICATION_FIELDS = ['applicationId', 'jobId', 'note', 'preferredDate', 'status', 'studentId'];
const DAY = 24 * 60 * 60 * 1000;
const future = (days) => new Date(Date.now() + days * DAY).toISOString().replace(/\.\d{3}Z$/, 'Z');

function expectErrorBody(res) {
  expect(Object.keys(res.body)).toEqual(['message']);
  expect(typeof res.body.message).toBe('string');
}

let server;
let wsBase;
beforeAll((done) => {
  server = createServer();
  server.listen(0, () => { wsBase = `ws://localhost:${server.address().port}`; done(); });
});
afterAll(async () => { await new Promise((r) => server.close(r)); if (db.close) await db.close(); });
beforeEach(async () => { await db.reset(); });

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
async function tokenFor(email) {
  const res = await request(server).post('/api/auth/login').send({ email, password: DEMO_PASSWORD });
  return res.body.token;
}
async function newEmployerToken() {
  const res = await request(server).post('/api/auth/register')
    .send({ name: 'Other Employer', email: 'other@example.com', password: 'safe-password-1', role: 'employer' });
  return res.body.token;
}
const employer = () => tokenFor('employer@kaziconnect.demo');
const student = () => tokenFor('student@kaziconnect.demo');
const sink = () => ({ title: 'Fix leaking kitchen sink', category: 'Plumbing', county: 'Nairobi', area: 'Westlands', duration: 'About 2 hours', urgent: true, payRange: { min: 1500, max: 1500 } });
const apply = (jobId, studentId = 'stu_0500') => request(server).post('/api/applications').send({ jobId, studentId, preferredDate: future(30) });

describe('Endpoint 14: POST /api/jobs', () => {
  it('posts a job: 201, exact Job shape, Location header, kind of work saved in lower case', async () => {
    const token = await employer();

    const res = await request(server).post('/api/jobs').set(bearer(token)).send(sink());

    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(JOB_FIELDS);
    expect(res.body).toEqual({
      id: 'job_12353', title: 'Fix leaking kitchen sink', category: 'plumbing', county: 'Nairobi',
      area: 'Westlands', duration: 'About 2 hours', urgent: true, status: 'active', payRange: { min: 1500, max: 1500 },
    });
    expect(res.headers.location).toBe('/api/jobs/job_12353');
  });

  it('really stores it: the job appears in the public listings straight away', async () => {
    const token = await employer();
    await request(server).post('/api/jobs').set(bearer(token)).send(sink());

    const list = await request(server).get('/api/jobs?status=active&category=plumbing');

    expect(list.body.map((j) => j.id)).toEqual(['job_12353']);
  });

  it('treats a job as not urgent when urgent is left out', async () => {
    const token = await employer();
    const { urgent, ...body } = sink();

    const res = await request(server).post('/api/jobs').set(bearer(token)).send(body);

    expect(res.status).toBe(201);
    expect(res.body.urgent).toBe(false);
  });

  describe('rejects invalid input with 400 and a message, and posts nothing', () => {
    it.each([
      ['title is missing', (b) => { delete b.title; }, /title/],
      ['payRange is missing', (b) => { delete b.payRange; }, /payRange/],
      ['area is missing', (b) => { delete b.area; }, /area/],
      ['title is only 2 characters', (b) => { b.title = 'Ab'; }, /at least 3/],
      ['payRange.min is text', (b) => { b.payRange = { min: '1500', max: 1500 }; }, /payRange.min must be a number/],
      ['pay is negative', (b) => { b.payRange = { min: -1, max: 1500 }; }, /must not be negative/],
      ['min is more than max', (b) => { b.payRange = { min: 2000, max: 1500 }; }, /not be more than/],
      ['urgent is the word yes', (b) => { b.urgent = 'yes'; }, /true or false/],
      ['the client tries to set status', (b) => { b.status = 'closed'; }, /Unknown field/],
    ])('%s', async (_name, change, pattern) => {
      const token = await employer();
      const body = sink();
      change(body);

      const res = await request(server).post('/api/jobs').set(bearer(token)).send(body);

      expect(res.status).toBe(400);
      expectErrorBody(res);
      expect(res.body.message).toMatch(pattern);
      expect(await db.findJobById('job_12353')).toBeNull();
    });
  });

  it('boundary: a title of exactly 3 characters is accepted', async () => {
    const token = await employer();

    const res = await request(server).post('/api/jobs').set(bearer(token)).send({ ...sink(), title: 'Mop' });

    expect(res.status).toBe(201);
  });

  it('refuses a student with 403 and posts nothing', async () => {
    const res = await request(server).post('/api/jobs').set(bearer(await student())).send(sink());

    expect(res.status).toBe(403);
    expectErrorBody(res);
    expect(await db.findJobById('job_12353')).toBeNull();
  });

  it('refuses a request with no token with 401', async () => {
    const res = await request(server).post('/api/jobs').send(sink());

    expect(res.status).toBe(401);
    expectErrorBody(res);
  });
});

describe('Endpoint 15: GET /api/me/jobs', () => {
  it('lists the employer\'s own jobs with how many applications are waiting', async () => {
    const res = await request(server).get('/api/me/jobs').set(bearer(await employer()));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(8);
    res.body.forEach((job) => {
      expect(Object.keys(job).sort()).toEqual([...JOB_FIELDS, 'pendingApplications'].sort());
      expect(Number.isInteger(job.pendingApplications)).toBe(true);
    });
    const counts = Object.fromEntries(res.body.map((j) => [j.id, j.pendingApplications]));
    expect(counts.job_12345).toBe(1);
    expect(counts.job_12347).toBe(1);
    expect(counts.job_12346).toBe(0);
  });

  it('edge case: a new employer with no jobs gets an empty list', async () => {
    const res = await request(server).get('/api/me/jobs').set(bearer(await newEmployerToken()));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('refuses a student with 403', async () => {
    const res = await request(server).get('/api/me/jobs').set(bearer(await student()));

    expect(res.status).toBe(403);
  });
});

describe('Endpoint 16: GET /api/jobs/{jobId}/applications', () => {
  it('shows the job\'s applicants to the employer who posted it', async () => {
    const res = await request(server).get('/api/jobs/job_12345/applications').set(bearer(await employer()));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(Object.keys(res.body[0]).sort()).toEqual([...APPLICATION_FIELDS, 'studentName'].sort());
    expect(res.body[0]).toMatchObject({ applicationId: 'app_1001', jobId: 'job_12345', status: 'pending', studentName: '' });
  });

  it('shows the applicant\'s name when they applied from a Kazi Connect account', async () => {
    await apply('job_12346', 'usr_1002');

    const res = await request(server).get('/api/jobs/job_12346/applications').set(bearer(await employer()));

    expect(res.body[0].studentName).toBe('Demo Student');
  });

  it('edge case: a job with no applicants gives an empty list', async () => {
    const res = await request(server).get('/api/jobs/job_12346/applications').set(bearer(await employer()));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns 404 for a job that does not exist', async () => {
    const res = await request(server).get('/api/jobs/job_99999/applications').set(bearer(await employer()));

    expect(res.status).toBe(404);
    expectErrorBody(res);
  });

  it('refuses a different employer with 403', async () => {
    const res = await request(server).get('/api/jobs/job_12345/applications').set(bearer(await newEmployerToken()));

    expect(res.status).toBe(403);
    expectErrorBody(res);
  });

  it('refuses a request with no token with 401', async () => {
    const res = await request(server).get('/api/jobs/job_12345/applications');

    expect(res.status).toBe(401);
  });
});

describe('Endpoint 17: PATCH /api/jobs/{jobId}', () => {
  it('closes a job: it leaves the listings, waiting applicants become filled, and new applications get 409', async () => {
    const token = await employer();

    const res = await request(server).patch('/api/jobs/job_12345').set(bearer(token)).send({ status: 'closed' });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(JOB_FIELDS);
    expect(res.body.status).toBe('closed');
    expect((await db.findApplicationById('app_1001')).application_status).toBe('filled');
    const listing = await request(server).get('/api/jobs?status=active');
    expect(listing.body.map((j) => j.id)).not.toContain('job_12345');
    expect((await apply('job_12345')).status).toBe(409);
  });

  it('is idempotent: closing twice gives the same end state', async () => {
    const token = await employer();
    const first = await request(server).patch('/api/jobs/job_12345').set(bearer(token)).send({ status: 'closed' });

    const second = await request(server).patch('/api/jobs/job_12345').set(bearer(token)).send({ status: 'closed' });

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it('reopens a closed job', async () => {
    const res = await request(server).patch('/api/jobs/job_12350').set(bearer(await employer())).send({ status: 'active' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });

  it.each([
    ['an unknown status', { status: 'archived' }, /active or closed/],
    ['an extra field', { status: 'closed', title: 'New title' }, /Unknown field/],
    ['no status at all', {}, /status/],
  ])('rejects %s with 400 and changes nothing', async (_name, body, pattern) => {
    const res = await request(server).patch('/api/jobs/job_12345').set(bearer(await employer())).send(body);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(pattern);
    expect((await db.findJobById('job_12345')).listing_status).toBe('active');
  });

  it('returns 404 for a job that does not exist', async () => {
    const res = await request(server).patch('/api/jobs/job_99999').set(bearer(await employer())).send({ status: 'closed' });

    expect(res.status).toBe(404);
    expectErrorBody(res);
  });

  it('refuses a different employer with 403 and changes nothing', async () => {
    const res = await request(server).patch('/api/jobs/job_12345').set(bearer(await newEmployerToken())).send({ status: 'closed' });

    expect(res.status).toBe(403);
    expect((await db.findJobById('job_12345')).listing_status).toBe('active');
  });
});

describe('Endpoint 18: PATCH /api/applications/{applicationId} (accept)', () => {
  it('accepts one applicant: 200, the others become filled, and the job closes', async () => {
    const first = (await apply('job_12346', 'stu_0500')).body.applicationId;
    const second = (await apply('job_12346', 'stu_0600')).body.applicationId;

    const res = await request(server).patch(`/api/applications/${first}`).set(bearer(await employer())).send({ status: 'accepted' });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(APPLICATION_FIELDS);
    expect(res.body.status).toBe('accepted');
    expect((await db.findApplicationById(second)).application_status).toBe('filled');
    expect((await db.findJobById('job_12346')).listing_status).toBe('closed');
  });

  it('tells the other applicant "filled" live over the WebSocket', async () => {
    const first = (await apply('job_12346', 'stu_0500')).body.applicationId;
    const second = (await apply('job_12346', 'stu_0600')).body.applicationId;
    const ws = new WebSocket(`${wsBase}/api/applications/${second}/subscribe`);
    const messages = [];
    ws.on('message', (d) => messages.push(JSON.parse(d.toString())));
    await new Promise((resolve) => ws.once('open', resolve));
    await new Promise((resolve) => setTimeout(resolve, 100));

    await request(server).patch(`/api/applications/${first}`).set(bearer(await employer())).send({ status: 'accepted' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    ws.close();

    expect(messages.map((m) => m.status)).toEqual(['pending', 'filled']);
  });

  it('returns 409 for an application that is no longer pending', async () => {
    const res = await request(server).patch('/api/applications/app_1002').set(bearer(await employer())).send({ status: 'accepted' });

    expect(res.status).toBe(409);
    expectErrorBody(res);
  });

  it('returns 404 for an application that does not exist', async () => {
    const res = await request(server).patch('/api/applications/app_9999').set(bearer(await employer())).send({ status: 'accepted' });

    expect(res.status).toBe(404);
    expectErrorBody(res);
  });

  it('rejects any status other than accepted with 400', async () => {
    const res = await request(server).patch('/api/applications/app_1001').set(bearer(await employer())).send({ status: 'filled' });

    expect(res.status).toBe(400);
    expect((await db.findApplicationById('app_1001')).application_status).toBe('pending');
  });

  it('refuses a different employer with 403 and changes nothing', async () => {
    const res = await request(server).patch('/api/applications/app_1001').set(bearer(await newEmployerToken())).send({ status: 'accepted' });

    expect(res.status).toBe(403);
    expect((await db.findApplicationById('app_1001')).application_status).toBe('pending');
  });

  it('refuses a student with 403', async () => {
    const res = await request(server).patch('/api/applications/app_1001').set(bearer(await student())).send({ status: 'accepted' });

    expect(res.status).toBe(403);
  });
});
