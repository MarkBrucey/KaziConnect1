// A job has one place (Endpoints 7, 17 and 18). Once an employer has accepted one applicant, nobody
// else can be accepted for that job, the job cannot be reopened, and a new applicant is told it is
// filled. Before this, an employer could accept someone, reopen the job, and accept a second person,
// which left two "Accepted" applicants on one job.
//
// Runs against both stores (in memory, and PostgreSQL when DATABASE_URL is set). Arrange, act, assert.

const request = require('supertest');
const { createServer } = require('../app');
const db = require('../db');
const { DEMO_PASSWORD } = require('../seedData');
const { StoreConflict } = require('../lib/conflict');

const DAY = 24 * 60 * 60 * 1000;
const future = (days) => new Date(Date.now() + days * DAY).toISOString().replace(/\.\d{3}Z$/, 'Z');

let server;
beforeAll((done) => { server = createServer(); server.listen(0, done); });
afterAll(async () => { await new Promise((r) => server.close(r)); if (db.close) await db.close(); });
beforeEach(async () => { await db.reset(); });

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const employer = async () => (await request(server).post('/api/auth/login').send({ email: 'employer@kaziconnect.demo', password: DEMO_PASSWORD })).body.token;
const apply = (jobId, studentId) => request(server).post('/api/applications').send({ jobId, studentId, preferredDate: future(30) });
const accept = (token, id) => request(server).patch(`/api/applications/${id}`).set(bearer(token)).send({ status: 'accepted' });
const setJob = (token, jobId, status) => request(server).patch(`/api/jobs/${jobId}`).set(bearer(token)).send({ status });
const accepted = async (jobId) => (await db.findApplicationsByJob(jobId)).filter((a) => a.application_status === 'accepted').map((a) => a._id);

describe('the case that went wrong: accept, reopen, accept again', () => {
  it('refuses to reopen a job that has an accepted applicant, with 409 and a clear message', async () => {
    const token = await employer();
    const first = (await apply('job_12345', 'stu_0500')).body.applicationId;
    expect((await accept(token, first)).status).toBe(200);

    const res = await setJob(token, 'job_12345', 'active');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: `Job job_12345 is already filled: application ${first} was accepted, so it cannot be reopened. Post a new job if you need someone else.` });
    expect((await db.findJobById('job_12345')).listing_status).toBe('closed');
  });

  it('so a second applicant cannot apply, and nobody else can ever be accepted', async () => {
    const token = await employer();
    const first = (await apply('job_12345', 'stu_0500')).body.applicationId;
    await accept(token, first);
    await setJob(token, 'job_12345', 'active');

    const late = await apply('job_12345', 'stu_0600');

    expect(late.status).toBe(409);
    expect(late.body.message).toBe('Job job_12345 is closed and is not accepting applications');
    expect(await accepted('job_12345')).toEqual([first]);
  });

  it('still lets an employer reopen a job they closed when nobody was accepted', async () => {
    const token = await employer();
    await setJob(token, 'job_12346', 'closed');

    const res = await setJob(token, 'job_12346', 'active');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });
});

describe('an open job that already has an accepted applicant (the sample job_12348, or older data)', () => {
  it('tells a new applicant the job is already filled, and saves nothing', async () => {
    const before = await db.countApplications();

    const res = await apply('job_12348', 'stu_0500');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: 'Job job_12348 is already filled: another applicant was accepted, so it is not accepting applications.' });
    expect(await db.countApplications()).toBe(before);
  });

  it('refuses a second acceptance with 409 naming the applicant already accepted', async () => {
    const token = await employer();
    const second = (await apply('job_12345', 'stu_0500')).body.applicationId;
    await db.setApplicationStatus(second, 'accepted'); // as older data could have it, with app_1001 still waiting

    const res = await accept(token, 'app_1001');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: `Job job_12345 is already filled: application ${second} was accepted. Only one applicant can be accepted for a job.` });
    expect(await accepted('job_12345')).toEqual([second]);
  });
});

describe('the data store keeps the rule even if a route forgets to check', () => {
  it('acceptApplication refuses an application that is not waiting', async () => {
    await expect(db.acceptApplication('app_1003')).rejects.toMatchObject({ reason: 'not_pending', status: 'filled' });
  });

  it('acceptApplication refuses a second acceptance for the same job', async () => {
    const second = await db.createApplication({ jobId: 'job_12345', studentId: 'stu_0500', preferredAt: new Date(Date.now() + 30 * DAY), note: '' });
    await db.acceptApplication(second._id);
    await db.setApplicationStatus('app_1001', 'pending'); // put a waiting one back, as older data could have

    const attempt = db.acceptApplication('app_1001');

    await expect(attempt).rejects.toBeInstanceOf(StoreConflict);
    await expect(attempt).rejects.toMatchObject({ reason: 'filled', acceptedId: second._id });
  });

  it('createApplication refuses a filled job and a closed job', async () => {
    const input = { studentId: 'stu_0500', preferredAt: new Date(Date.now() + 30 * DAY), note: '' };

    await expect(db.createApplication({ ...input, jobId: 'job_12348' })).rejects.toMatchObject({ reason: 'filled', acceptedId: 'app_1002' });
    await expect(db.createApplication({ ...input, jobId: 'job_12350' })).rejects.toMatchObject({ reason: 'closed' });
  });

  it('setJobStatus refuses to reopen a filled job, and still closes it', async () => {
    await expect(db.setJobStatus('job_12348', 'active')).rejects.toMatchObject({ reason: 'filled', acceptedId: 'app_1002' });
    expect((await db.setJobStatus('job_12348', 'closed')).listing_status).toBe('closed');
  });
});

describe('two employers clicking Accept at the same moment', () => {
  it('exactly one acceptance wins; the other gets 409, and the job has one accepted applicant', async () => {
    const token = await employer();
    const a = (await apply('job_12349', 'stu_0500')).body.applicationId;
    const b = (await apply('job_12349', 'stu_0600')).body.applicationId;

    const results = await Promise.all([accept(token, a), accept(token, b)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = results.find((r) => r.status === 200).body.applicationId;
    expect(await accepted('job_12349')).toEqual([winner]);
    expect((await db.findJobById('job_12349')).listing_status).toBe('closed');
  });

  it('an application sent while the job is being filled is either refused or told it is filled, never left waiting', async () => {
    const token = await employer();
    const a = (await apply('job_12351', 'stu_0500')).body.applicationId;

    const [, late] = await Promise.all([accept(token, a), apply('job_12351', 'stu_0600')]);

    if (late.status === 201) {
      expect((await db.findApplicationById(late.body.applicationId)).application_status).toBe('filled');
    } else {
      expect(late.status).toBe(409);
    }
    expect(await accepted('job_12351')).toEqual([a]);
  });
});
