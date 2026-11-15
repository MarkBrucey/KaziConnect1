// 1.5.0: a job can take more than one person. A job opened from an accepted staffing offer has one
// place per worker offered; it keeps taking applications until every place has an accepted applicant,
// and then it closes. Every other job takes one person and answers exactly as before.
// These go through the API, against whichever store db.js picks: memory by default, PostgreSQL when
// DATABASE_URL is set. Every test follows arrange, act, assert.

const request = require('supertest');
const { createServer } = require('../app');
const db = require('../db');
const { toJob } = require('../mappers');
const { filledForApplicants, filledForEmployer, cannotReopen } = require('../lib/conflict');
const { DEMO_PASSWORD } = require('../seedData');

const JOB_FIELDS = ['area', 'category', 'county', 'duration', 'id', 'payRange', 'status', 'title', 'urgent'];
const PLACE_FIELDS = [...JOB_FIELDS, 'places', 'placesFilled'].sort();
const DRAFT = {
  title: 'Ushers, Kamau wedding', category: 'events', county: 'Nairobi', area: 'Kilimani',
  duration: 'One shift, 12 Dec 2026, about 10 hours', urgent: false, payMin: 1600, payMax: 1600,
};
const SHIFT = '2027-01-15T09:00:00Z';

let server;
let offers = 0;
beforeAll(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (db.close) await db.close();
});
beforeEach(async () => { await db.reset(); });

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
async function employerToken() {
  const res = await request(server).post('/api/auth/login').send({ email: 'employer@kaziconnect.demo', password: DEMO_PASSWORD });
  return res.body.token;
}
// The job an accepted offer of n workers opens, as the offer poller opens it.
async function jobFromOffer(n) {
  offers += 1;
  const offer = await db.createStaffingOffer({
    employerId: 'usr_1001', shereheOfferId: `ofr_${9000 + offers}`, roleId: `rol_${9000 + offers}`,
    eventName: 'Kamau wedding', workersOffered: n, jobDraft: DRAFT,
  });
  const { job } = await db.acceptStaffingOffer(offer._id);
  return job._id;
}
const apply = (jobId, studentId) => request(server).post('/api/applications').send({ jobId, studentId, preferredDate: SHIFT });
const accept = (token, applicationId) => request(server).patch(`/api/applications/${applicationId}`).set(bearer(token)).send({ status: 'accepted' });
const setStatus = (token, jobId, status) => request(server).patch(`/api/jobs/${jobId}`).set(bearer(token)).send({ status });
const getJob = (jobId) => request(server).get(`/api/jobs/${jobId}`);
async function applyAll(jobId, n) {
  const ids = [];
  for (let i = 1; i <= n; i += 1) ids.push((await apply(jobId, `grd_09${String(i).padStart(2, '0')}`)).body.applicationId);
  return ids;
}

describe('a job opened from an accepted offer of several workers', () => {
  it('is one job with one place per worker, none filled, answering with places and placesFilled', async () => {
    const jobId = await jobFromOffer(3);

    const res = await getJob(jobId);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(PLACE_FIELDS);
    expect(res.body).toMatchObject({ title: 'Ushers, Kamau wedding', status: 'active', places: 3, placesFilled: 0 });
  });

  it('takes several applicants and stays open, the others still waiting, until the last place is taken', async () => {
    const jobId = await jobFromOffer(3);
    const token = await employerToken();
    const [a1, a2, a3, a4] = await applyAll(jobId, 4);

    const first = await accept(token, a1);
    const afterOne = await getJob(jobId);
    await accept(token, a2);
    const afterTwo = await getJob(jobId);
    const waiting = await request(server).get(`/api/applications/${a3}/status`);

    expect(first.status).toBe(200);
    expect(first.body.status).toBe('accepted');
    expect(afterOne.body).toMatchObject({ status: 'active', places: 3, placesFilled: 1 });
    expect(afterTwo.body).toMatchObject({ status: 'active', places: 3, placesFilled: 2 });
    expect(waiting.body.status).toBe('pending');
    expect(a4).toMatch(/^app_/);
  });

  it('closes when the last place is taken, and tells everyone still waiting it is filled', async () => {
    const jobId = await jobFromOffer(2);
    const token = await employerToken();
    const [a1, a2, a3] = await applyAll(jobId, 3);

    await accept(token, a1);
    const last = await accept(token, a2);
    const job = await getJob(jobId);
    const left = await request(server).get(`/api/applications/${a3}/status`);

    expect(last.status).toBe(200);
    expect(job.body).toMatchObject({ status: 'closed', places: 2, placesFilled: 2 });
    expect(left.body.status).toBe('filled');
  });

  it('cannot be reopened once all its places are filled, and says so in words for several places', async () => {
    const jobId = await jobFromOffer(2);
    const token = await employerToken();
    const [a1, a2] = await applyAll(jobId, 2);
    await accept(token, a1);
    await accept(token, a2);

    const res = await setStatus(token, jobId, 'active');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: cannotReopen(jobId, a1, 2) });
    expect(res.body.message).toBe(`Job ${jobId} is already filled: all 2 places have an accepted applicant, so it cannot be reopened. Post a new job if you need someone else.`);
  });

  it('can be closed and reopened while a place is open, keeping the applicant already accepted', async () => {
    const jobId = await jobFromOffer(3);
    const token = await employerToken();
    const [a1] = await applyAll(jobId, 2);
    await accept(token, a1);

    const closed = await setStatus(token, jobId, 'closed');
    const reopened = await setStatus(token, jobId, 'active');
    const again = await apply(jobId, 'grd_0950');

    expect(closed.body).toMatchObject({ status: 'closed', places: 3, placesFilled: 1 });
    expect(reopened.status).toBe(200);
    expect(reopened.body).toMatchObject({ status: 'active', places: 3, placesFilled: 1 });
    expect(again.status).toBe(201);
  });

  it('never takes more people than it has places, even when accepts arrive at the same moment', async () => {
    const jobId = await jobFromOffer(2);
    const token = await employerToken();
    const ids = await applyAll(jobId, 5);

    const results = await Promise.all(ids.map((id) => accept(token, id)));
    const job = await getJob(jobId);

    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    results.filter((r) => r.status !== 200).forEach((r) => expect(r.status).toBe(409));
    expect(job.body).toMatchObject({ status: 'closed', places: 2, placesFilled: 2 });
  });

  it("shows its places in the employer's own list and in version 2 of the job list", async () => {
    const jobId = await jobFromOffer(4);
    const token = await employerToken();

    const mine = await request(server).get('/api/me/jobs').set(bearer(token));
    const v2 = await request(server).get('/api/v2/jobs?status=active');

    expect(mine.body.find((j) => j.id === jobId)).toMatchObject({ places: 4, placesFilled: 0, pendingApplications: 0 });
    expect(v2.body.data.find((j) => j.id === jobId)).toMatchObject({ places: 4, placesFilled: 0 });
  });
});

describe('every other job: one place, answering exactly as before', () => {
  it('an offer of one worker opens an ordinary job, without the place fields', async () => {
    const jobId = await jobFromOffer(1);

    const res = await getJob(jobId);

    expect(Object.keys(res.body).sort()).toEqual(JOB_FIELDS);
  });

  it('a sample job, and every job in the list, answers without the place fields', async () => {
    const one = await getJob('job_12345');
    const list = await request(server).get('/api/jobs?status=active');

    expect(Object.keys(one.body).sort()).toEqual(JOB_FIELDS);
    list.body.forEach((job) => expect(Object.keys(job).sort()).toEqual(JOB_FIELDS));
  });

  it('accepting its one applicant closes it, as it always did', async () => {
    const token = await employerToken();
    const [a1, a2] = await applyAll('job_12346', 2);

    await accept(token, a1);
    const job = await getJob('job_12346');
    const other = await request(server).get(`/api/applications/${a2}/status`);

    expect(job.body.status).toBe('closed');
    expect(other.body.status).toBe('filled');
  });
});

describe('the words and the mapper', () => {
  it('keep the one place messages word for word, and name the places when there are several', () => {
    expect(filledForApplicants('job_1')).toBe('Job job_1 is already filled: another applicant was accepted, so it is not accepting applications.');
    expect(filledForApplicants('job_1', 3)).toBe('Job job_1 is already filled: all 3 places have been taken, so it is not accepting applications.');
    expect(filledForEmployer('job_1', 'app_1')).toBe('Job job_1 is already filled: application app_1 was accepted. Only one applicant can be accepted for a job.');
    expect(filledForEmployer('job_1', 'app_1', 3)).toBe('Job job_1 is already filled: all 3 places have an accepted applicant. No more applicants can be accepted for it.');
  });

  it('toJob adds places and placesFilled only for a job with more than one place', () => {
    const row = {
      _id: 'job_1', job_title: 'T', job_category: 'events', county_name: 'Nairobi', area_name: 'A', duration_text: 'D',
      is_urgent: false, listing_status: 'active', pay_min: '1.00', pay_max: '1.00', employer_id: null, created_by: null, internal_notes: '',
    };

    expect(Object.keys(toJob(row)).sort()).toEqual(JOB_FIELDS);
    expect(Object.keys(toJob({ ...row, places: 1, places_filled: 0 })).sort()).toEqual(JOB_FIELDS);
    expect(toJob({ ...row, places: 3, places_filled: 2 })).toMatchObject({ places: 3, placesFilled: 2 });
  });
});
