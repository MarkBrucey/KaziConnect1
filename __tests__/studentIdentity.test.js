// Automated tests for telling students apart (Endpoints 7, 8, 9 and 19).
//
// Students log in with their email, which belongs to one account only, and the server gives each account its
// own ID (usr_...). A student ID typed by hand proves nothing, so an account ID may only be used by that
// student, logged in. Partners such as SettleIn keep applying with no login and their own student IDs.
// Every test follows arrange, act, assert.

const request = require('supertest');
const { createServer } = require('../app');
const db = require('../db');
const { DEMO_PASSWORD } = require('../seedData');

const DAY = 24 * 60 * 60 * 1000;
const future = (days) => new Date(Date.now() + days * DAY).toISOString().replace(/\.\d{3}Z$/, 'Z');

let server;
beforeAll((done) => { server = createServer(); server.listen(0, done); });
afterAll(async () => { await new Promise((r) => server.close(r)); if (db.close) await db.close(); });
beforeEach(async () => { await db.reset(); });

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
async function tokenFor(email, password = DEMO_PASSWORD) {
  const res = await request(server).post('/api/auth/login').send({ email, password });
  return res.body.token;
}
async function register(name, email) {
  const res = await request(server).post('/api/auth/register').send({ name, email, password: 'safe-password-1', role: 'student' });
  return res.body;
}
const apply = (body, token) => {
  const req = request(server).post('/api/applications');
  if (token) req.set(bearer(token));
  return req.send({ jobId: 'job_12345', preferredDate: future(30), ...body });
};

function expectMessage(res, status, text) {
  expect(res.status).toBe(status);
  expect(Object.keys(res.body)).toEqual(['message']);
  expect(res.body.message).toContain(text);
}

describe('Logging in tells students apart by email', () => {
  it('gives two students their own account IDs, even with the same name', async () => {
    const first = await register('Amina Otieno', 'amina.one@example.com');
    const second = await register('Amina Otieno', 'amina.two@example.com');

    expect(first.user.id).toMatch(/^usr_\d+$/);
    expect(second.user.id).toMatch(/^usr_\d+$/);
    expect(first.user.id).not.toBe(second.user.id);
  });

  it('refuses a second account with the same email, in any letter case, with 409', async () => {
    await register('Amina Otieno', 'amina@example.com');

    const res = await request(server).post('/api/auth/register')
      .send({ name: 'Someone Else', email: 'AMINA@example.com', password: 'other-password-2', role: 'student' });

    expectMessage(res, 409, 'already exists');
  });
});

describe('Endpoint 7: who may use an account ID', () => {
  it('lets a logged in student apply as themselves', async () => {
    const token = await tokenFor('student@kaziconnect.demo');

    const res = await apply({ studentId: 'usr_1002' }, token);

    expect(res.status).toBe(201);
    expect(res.body.studentId).toBe('usr_1002');
  });

  it('refuses another student\'s account ID with no login, and saves nothing', async () => {
    const before = await db.countApplications();

    const res = await apply({ studentId: 'usr_1002', note: 'not really the demo student' });

    expectMessage(res, 400, 'Log in as that student');
    expect(await db.countApplications()).toBe(before);
  });

  it('refuses an account ID that does not exist yet, so nobody can claim a future account', async () => {
    const res = await apply({ studentId: 'usr_9999' });

    expectMessage(res, 400, 'account ID');
  });

  it('refuses an account ID in other letter cases and with spaces around it', async () => {
    const upper = await apply({ studentId: 'USR_1002' });
    const spaced = await apply({ studentId: '  usr_1002  ' });

    expect(upper.status).toBe(400);
    expect(spaced.status).toBe(400);
  });

  it('refuses a logged in student who sends someone else\'s ID', async () => {
    const other = await register('Brian Kamau', 'brian@example.com');

    const res = await apply({ studentId: 'usr_1002' }, other.token);

    expectMessage(res, 400, `your own account ID, ${other.user.id}`);
  });

  it('refuses a logged in student who sends a made up student ID instead of their own', async () => {
    const token = await tokenFor('student@kaziconnect.demo');

    const res = await apply({ studentId: 'stu_0042' }, token);

    expectMessage(res, 400, 'your own account ID, usr_1002');
  });

  it('refuses an employer\'s login with 403', async () => {
    const token = await tokenFor('employer@kaziconnect.demo');

    const res = await apply({ studentId: 'usr_1001' }, token);

    expectMessage(res, 403, 'Only students');
  });

  it('refuses a login token that is not valid with 401, and saves nothing', async () => {
    const before = await db.countApplications();

    const res = await apply({ studentId: 'stu_0042' }, 'a'.repeat(64));

    expect(res.status).toBe(401);
    expect(await db.countApplications()).toBe(before);
  });

  it('keeps working for a partner with no login and its own student ID (unchanged)', async () => {
    const res = await apply({ studentId: 'stu_0042' });

    expect(res.status).toBe(201);
    expect(res.body.studentId).toBe('stu_0042');
  });
});

describe('Endpoint 19: a student\'s list holds only what they sent themselves', () => {
  it('does not show an application someone else tried to make with their account ID', async () => {
    const token = await tokenFor('student@kaziconnect.demo');
    await apply({ studentId: 'usr_1002', note: 'impostor' });
    await apply({ jobId: 'job_12346', studentId: 'usr_1002', note: 'mine' }, token);

    const res = await request(server).get('/api/me/applications').set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.map((a) => a.note)).toEqual(['mine']);
  });
});

describe('Endpoints 8 and 9: an account\'s applications belong to that account', () => {
  async function demoStudentApplication() {
    const token = await tokenFor('student@kaziconnect.demo');
    const res = await apply({ studentId: 'usr_1002' }, token);
    return { token, id: res.body.applicationId };
  }

  it('lets the student change and then withdraw their own application', async () => {
    const { token, id } = await demoStudentApplication();

    const changed = await request(server).put(`/api/applications/${id}`).set(bearer(token)).send({ preferredDate: future(40) });
    const withdrawn = await request(server).delete(`/api/applications/${id}`).set(bearer(token));

    expect(changed.status).toBe(200);
    expect(withdrawn.status).toBe(204);
  });

  it('refuses a change with no login with 401, and changes nothing', async () => {
    const { id } = await demoStudentApplication();
    const before = (await db.findApplicationById(id)).preferred_at;

    const res = await request(server).put(`/api/applications/${id}`).send({ preferredDate: future(40) });

    expectMessage(res, 401, 'Log in as that student');
    expect((await db.findApplicationById(id)).preferred_at).toEqual(before);
  });

  it('refuses a withdrawal with no login with 401, and the application stays', async () => {
    const { id } = await demoStudentApplication();

    const res = await request(server).delete(`/api/applications/${id}`);

    expectMessage(res, 401, 'Log in as that student');
    expect(await db.findApplicationById(id)).not.toBeNull();
  });

  it('refuses another student with 403', async () => {
    const { id } = await demoStudentApplication();
    const other = await register('Brian Kamau', 'brian@example.com');

    const changed = await request(server).put(`/api/applications/${id}`).set(bearer(other.token)).send({ preferredDate: future(40) });
    const withdrawn = await request(server).delete(`/api/applications/${id}`).set(bearer(other.token));

    expectMessage(changed, 403, 'your own applications');
    expectMessage(withdrawn, 403, 'your own applications');
  });

  it('keeps a partner\'s application open to change and withdraw with no login (unchanged)', async () => {
    const made = await apply({ studentId: 'stu_0042' });

    const changed = await request(server).put(`/api/applications/${made.body.applicationId}`).send({ preferredDate: future(40) });
    const withdrawn = await request(server).delete(`/api/applications/${made.body.applicationId}`);

    expect(changed.status).toBe(200);
    expect(withdrawn.status).toBe(204);
  });
});
