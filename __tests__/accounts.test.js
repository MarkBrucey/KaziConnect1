// Automated tests for accounts, Endpoints 10 to 13 and 19 (added after Week 7).
// Every test follows arrange, act, assert, and checks the real response shape.

const request = require('supertest');
const { createServer } = require('../app');
const db = require('../db');
const { DEMO_PASSWORD } = require('../seedData');
const { hashToken } = require('../auth');

const USER_FIELDS = ['email', 'id', 'name', 'role'];
const TOKEN = /^[a-f0-9]{64}$/;
const DAY = 24 * 60 * 60 * 1000;
const future = (days) => new Date(Date.now() + days * DAY).toISOString().replace(/\.\d{3}Z$/, 'Z');

function expectAuthShape(body) {
  expect(Object.keys(body).sort()).toEqual(['token', 'user']);
  expect(body.token).toMatch(TOKEN);
  expect(Object.keys(body.user).sort()).toEqual(USER_FIELDS);
  expect(body.user).not.toHaveProperty('password');
  expect(body.user).not.toHaveProperty('password_hash');
}

function expectErrorBody(res) {
  expect(Object.keys(res.body)).toEqual(['message']);
  expect(typeof res.body.message).toBe('string');
}

let server;
beforeAll((done) => { server = createServer(); server.listen(0, done); });
afterAll(async () => { await new Promise((r) => server.close(r)); if (db.close) await db.close(); });
beforeEach(async () => { await db.reset(); });

const register = (body) => request(server).post('/api/auth/register').send(body);
const login = (email, password = DEMO_PASSWORD) => request(server).post('/api/auth/login').send({ email, password });
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const newStudent = () => ({ name: 'Amina Otieno', email: 'amina@example.com', password: 'safe-password-1', role: 'student' });

describe('Endpoint 10: POST /api/auth/register', () => {
  it('creates an account: 201 with a token and the user, never the password', async () => {
    const res = await register(newStudent());

    expect(res.status).toBe(201);
    expectAuthShape(res.body);
    expect(res.body.user).toEqual({ id: 'usr_1003', name: 'Amina Otieno', email: 'amina@example.com', role: 'student' });
  });

  it('stores only a scrambled password, never the real one', async () => {
    await register(newStudent());

    const row = await db.findUserByEmail('amina@example.com');
    expect(row.password_hash).toMatch(/^scrypt\$/);
    expect(row.password_hash).not.toContain('safe-password-1');
  });

  it('gives a token that works straight away', async () => {
    const { body } = await register(newStudent());

    const me = await request(server).get('/api/me').set(bearer(body.token));
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('amina@example.com');
  });

  it('saves the email in lower case so the same person cannot register twice', async () => {
    const res = await register({ ...newStudent(), email: 'Amina@Example.COM' });

    expect(res.body.user.email).toBe('amina@example.com');
  });

  describe('rejects invalid input with 400 and a message, and creates no account', () => {
    it.each([
      ['name is missing', (b) => { delete b.name; }, /name/],
      ['email is missing', (b) => { delete b.email; }, /email/],
      ['password is missing', (b) => { delete b.password; }, /password/],
      ['role is missing', (b) => { delete b.role; }, /role/],
      ['email is not an email address', (b) => { b.email = 'amina-at-example'; }, /valid email/],
      ['password is only 7 characters', (b) => { b.password = 'seven77'; }, /at least 8/],
      ['role is not student or employer', (b) => { b.role = 'admin'; }, /student or employer/],
      ['the client tries to add an extra field', (b) => { b.isAdmin = true; }, /Unknown field/],
      ['name is a number', (b) => { b.name = 42; }, /name must be a string/],
    ])('%s', async (_name, change, pattern) => {
      const body = newStudent();
      change(body);

      const res = await register(body);

      expect(res.status).toBe(400);
      expectErrorBody(res);
      expect(res.body.message).toMatch(pattern);
      expect(await db.findUserByEmail('amina@example.com')).toBeNull();
    });
  });

  it('boundary: a password of exactly 8 characters is accepted', async () => {
    const res = await register({ ...newStudent(), password: 'eight888' });

    expect(res.status).toBe(201);
  });

  it('refuses an email that already has an account with 409', async () => {
    const res = await register({ ...newStudent(), email: 'Employer@KaziConnect.demo' });

    expect(res.status).toBe(409);
    expectErrorBody(res);
    expect((await db.findUserByEmail('employer@kaziconnect.demo')).full_name).toBe('Demo Employer');
  });
});

describe('Endpoint 11: POST /api/auth/login', () => {
  it('logs in with the right email and password: 200 with a token and the user', async () => {
    const res = await login('employer@kaziconnect.demo');

    expect(res.status).toBe(200);
    expectAuthShape(res.body);
    expect(res.body.user).toEqual({ id: 'usr_1001', name: 'Demo Employer', email: 'employer@kaziconnect.demo', role: 'employer' });
  });

  it('gives a new, different token every time', async () => {
    const first = await login('employer@kaziconnect.demo');
    const second = await login('employer@kaziconnect.demo');

    expect(first.body.token).not.toBe(second.body.token);
  });

  it('accepts the email in any upper and lower case', async () => {
    const res = await login('STUDENT@kaziconnect.demo');

    expect(res.status).toBe(200);
  });

  it('refuses a wrong password with 401', async () => {
    const res = await login('employer@kaziconnect.demo', 'wrong-password');

    expect(res.status).toBe(401);
    expectErrorBody(res);
  });

  it('gives the same message for an unknown email as for a wrong password', async () => {
    const wrongPassword = await login('employer@kaziconnect.demo', 'wrong-password');
    const unknownEmail = await login('nobody@example.com', 'wrong-password');

    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body.message).toBe(wrongPassword.body.message);
  });

  it('rejects a missing password with 400', async () => {
    const res = await request(server).post('/api/auth/login').send({ email: 'employer@kaziconnect.demo' });

    expect(res.status).toBe(400);
    expectErrorBody(res);
  });
});

describe('Endpoint 12: POST /api/auth/logout', () => {
  it('logs out: 204, and the token stops working', async () => {
    const { body } = await login('student@kaziconnect.demo');

    const res = await request(server).post('/api/auth/logout').set(bearer(body.token));

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    const me = await request(server).get('/api/me').set(bearer(body.token));
    expect(me.status).toBe(401);
  });

  it('edge case: logging out twice gives 401 the second time', async () => {
    const { body } = await login('student@kaziconnect.demo');
    await request(server).post('/api/auth/logout').set(bearer(body.token));

    const res = await request(server).post('/api/auth/logout').set(bearer(body.token));

    expect(res.status).toBe(401);
  });

  it('refuses a request with no token with 401', async () => {
    const res = await request(server).post('/api/auth/logout');

    expect(res.status).toBe(401);
    expectErrorBody(res);
  });
});

describe('Endpoint 13: GET /api/me', () => {
  it('returns exactly the logged in user', async () => {
    const { body } = await login('student@kaziconnect.demo');

    const res = await request(server).get('/api/me').set(bearer(body.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'usr_1002', name: 'Demo Student', email: 'student@kaziconnect.demo', role: 'student' });
  });

  it.each([
    ['no Authorization header', {}],
    ['a header that is not a Bearer token', { Authorization: 'Basic abc' }],
    ['a token that is too short', { Authorization: 'Bearer abc123' }],
    ['a well formed token that was never issued', { Authorization: `Bearer ${'a'.repeat(64)}` }],
  ])('refuses %s with 401 and a message', async (_name, headers) => {
    const res = await request(server).get('/api/me').set(headers);

    expect(res.status).toBe(401);
    expectErrorBody(res);
  });
});

describe('Sessions expire', () => {
  it('refuses a token whose session has expired with 401', async () => {
    const token = 'e'.repeat(64);
    await db.createSession({ tokenHash: hashToken(token), userId: 'usr_1002', expiresAt: new Date(Date.now() - 1000) });

    const res = await request(server).get('/api/me').set(bearer(token));

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/expired/);
  });

  it('accepts the same kind of token while its session is still valid', async () => {
    const token = 'f'.repeat(64);
    await db.createSession({ tokenHash: hashToken(token), userId: 'usr_1002', expiresAt: new Date(Date.now() + 60000) });

    const res = await request(server).get('/api/me').set(bearer(token));

    expect(res.status).toBe(200);
  });
});

describe('Endpoint 19: GET /api/me/applications', () => {
  it('edge case: a student with no applications gets an empty list', async () => {
    const { body } = await login('student@kaziconnect.demo');

    const res = await request(server).get('/api/me/applications').set(bearer(body.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('lists the applications made under the student\'s account, newest first', async () => {
    const { body } = await login('student@kaziconnect.demo');
    await request(server).post('/api/applications').send({ jobId: 'job_12345', studentId: 'usr_1002', preferredDate: future(30) });
    await request(server).post('/api/applications').send({ jobId: 'job_12346', studentId: 'usr_1002', preferredDate: future(31) });

    const res = await request(server).get('/api/me/applications').set(bearer(body.token));

    expect(res.status).toBe(200);
    expect(res.body.map((a) => a.jobId)).toEqual(['job_12346', 'job_12345']);
    res.body.forEach((a) => {
      expect(Object.keys(a).sort()).toEqual(['applicationId', 'jobId', 'note', 'preferredDate', 'status', 'studentId']);
      expect(a.studentId).toBe('usr_1002');
    });
  });

  it('refuses an employer with 403', async () => {
    const { body } = await login('employer@kaziconnect.demo');

    const res = await request(server).get('/api/me/applications').set(bearer(body.token));

    expect(res.status).toBe(403);
    expectErrorBody(res);
  });

  it('refuses a request with no token with 401', async () => {
    const res = await request(server).get('/api/me/applications');

    expect(res.status).toBe(401);
  });
});
