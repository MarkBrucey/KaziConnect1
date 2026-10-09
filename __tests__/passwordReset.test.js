// Automated tests for "Forgot password?", Endpoints 20 and 21.
// No email service is set up during tests, so the mailer keeps each message in
// its outbox instead of sending it, and the tests read the reset link from there.

const request = require('supertest');
const { createServer } = require('../app');
const db = require('../db');
const mailer = require('../mailer');
const { DEMO_PASSWORD } = require('../seedData');
const { hashToken } = require('../auth');

const SITE = 'https://kazi.example.test';
let server;
beforeAll((done) => {
  process.env.APP_URL = SITE;
  server = createServer();
  server.listen(0, done);
});
afterAll(async () => {
  delete process.env.APP_URL;
  await new Promise((r) => server.close(r));
  if (db.close) await db.close();
});
beforeEach(async () => { await db.reset(); mailer.outbox.length = 0; });

const askForReset = (email) => request(server).post('/api/auth/password-resets').send({ email });
const setPassword = (token, password) => request(server).put('/api/auth/password').send({ token, password });
const login = (email, password) => request(server).post('/api/auth/login').send({ email, password });
const tokenFromEmail = (message) => /#reset=([a-f0-9]{64})/.exec(message.text)[1];

describe('Endpoint 20: POST /api/auth/password-resets', () => {
  it('emails a reset link to an account that exists: 202 with a message', async () => {
    const res = await askForReset('student@kaziconnect.demo');

    expect(res.status).toBe(202);
    expect(Object.keys(res.body)).toEqual(['message']);
    expect(mailer.outbox).toHaveLength(1);
    expect(mailer.outbox[0].to).toBe('student@kaziconnect.demo');
    expect(mailer.outbox[0].text).toMatch(new RegExp(`^${SITE}/#reset=[a-f0-9]{64}$`, 'm'));
  });

  it('gives exactly the same reply for an email with no account, and sends nothing', async () => {
    const known = await askForReset('student@kaziconnect.demo');
    mailer.outbox.length = 0;

    const unknown = await askForReset('nobody@example.com');

    expect(unknown.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
    expect(mailer.outbox).toHaveLength(0);
  });

  it('accepts the email in any upper and lower case', async () => {
    await askForReset('Student@KaziConnect.DEMO');

    expect(mailer.outbox).toHaveLength(1);
  });

  it('stores only a scrambled copy of the reset token', async () => {
    await askForReset('student@kaziconnect.demo');
    const token = tokenFromEmail(mailer.outbox[0]);

    expect(await db.findPasswordReset(token)).toBeNull();
    expect(await db.findPasswordReset(hashToken(token))).not.toBeNull();
  });

  it('builds the link from the site\'s own address, never from a faked Host header', async () => {
    await request(server).post('/api/auth/password-resets').set('Host', 'attacker.example').send({ email: 'student@kaziconnect.demo' });

    expect(mailer.outbox[0].text).toContain(SITE);
    expect(mailer.outbox[0].text).not.toContain('attacker.example');
  });

  it('edge case: sends at most 3 reset emails an hour, but the reply never changes', async () => {
    const replies = [];
    for (let i = 0; i < 4; i++) replies.push(await askForReset('student@kaziconnect.demo'));

    expect(replies.map((r) => r.status)).toEqual([202, 202, 202, 202]);
    expect(mailer.outbox).toHaveLength(3);
  });

  it.each([
    ['email is missing', {}, /email/],
    ['email is not an email address', { email: 'student-at-kazi' }, /valid email/],
    ['an extra field is sent', { email: 'student@kaziconnect.demo', password: 'x' }, /Unknown field/],
  ])('rejects the request with 400 when %s, and sends nothing', async (_name, body, pattern) => {
    const res = await request(server).post('/api/auth/password-resets').send(body);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(pattern);
    expect(mailer.outbox).toHaveLength(0);
  });
});

describe('Endpoint 21: PUT /api/auth/password', () => {
  async function resetToken() {
    await askForReset('student@kaziconnect.demo');
    return tokenFromEmail(mailer.outbox[mailer.outbox.length - 1]);
  }

  it('sets a new password: 204, the new one works and the old one stops working', async () => {
    const token = await resetToken();

    const res = await setPassword(token, 'my-new-password-1');

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect((await login('student@kaziconnect.demo', 'my-new-password-1')).status).toBe(200);
    expect((await login('student@kaziconnect.demo', DEMO_PASSWORD)).status).toBe(401);
  });

  it('logs the account out everywhere', async () => {
    const before = (await login('student@kaziconnect.demo', DEMO_PASSWORD)).body.token;
    const token = await resetToken();

    await setPassword(token, 'my-new-password-1');

    const me = await request(server).get('/api/me').set({ Authorization: `Bearer ${before}` });
    expect(me.status).toBe(401);
  });

  it('works only once: using the same link again gives 400', async () => {
    const token = await resetToken();
    await setPassword(token, 'my-new-password-1');

    const again = await setPassword(token, 'another-password-2');

    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/not valid or has expired/);
    expect((await login('student@kaziconnect.demo', 'my-new-password-1')).status).toBe(200);
  });

  it('cancels the other reset links the person asked for', async () => {
    const first = await resetToken();
    const second = await resetToken();
    await setPassword(second, 'my-new-password-1');

    const res = await setPassword(first, 'another-password-2');

    expect(res.status).toBe(400);
  });

  it('edge case: refuses a link that is more than 30 minutes old', async () => {
    const token = 'c'.repeat(64);
    await db.createPasswordReset({ tokenHash: hashToken(token), userId: 'usr_1002', expiresAt: new Date(Date.now() - 1000) });

    const res = await setPassword(token, 'my-new-password-1');

    expect(res.status).toBe(400);
    expect((await login('student@kaziconnect.demo', DEMO_PASSWORD)).status).toBe(200);
  });

  it('refuses a token that was never issued with 400', async () => {
    const res = await setPassword('d'.repeat(64), 'my-new-password-1');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not valid or has expired/);
  });

  it.each([
    ['the password is only 7 characters', (t) => ({ token: t, password: 'seven77' }), /at least 8/],
    ['the password is missing', (t) => ({ token: t }), /password/],
    ['the token is missing', () => ({ password: 'my-new-password-1' }), /token/],
    ['the token is not a reset token', () => ({ token: 'abc', password: 'my-new-password-1' }), /not a valid reset token/],
  ])('rejects with 400 when %s, and the link still works afterwards', async (_name, makeBody, pattern) => {
    const token = await resetToken();

    const res = await request(server).put('/api/auth/password').send(makeBody(token));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(pattern);
    expect((await setPassword(token, 'my-new-password-1')).status).toBe(204);
  });
});
