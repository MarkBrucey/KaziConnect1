// Week 7: automated tests for the applications resource, Endpoints 5 to 9.
//
// Every test follows arrange, act, assert. Write tests cover the happy path,
// validation failures, IDs that do not exist, and edge cases, and check that a rejected
// request leaves the stored data exactly as it was. Run with: npm test

const request = require('supertest');
const WebSocket = require('ws');
const { createServer } = require('../app');
const db = require('../db');

const APPLICATION_FIELDS = ['applicationId', 'jobId', 'note', 'preferredDate', 'status', 'studentId'];
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const DAY = 24 * 60 * 60 * 1000;
const future = (days) => new Date(Date.now() + days * DAY).toISOString().replace(/\.\d{3}Z$/, 'Z');

// Strong shape check for one Application: exactly the contract's fields.
function expectApplicationShape(app) {
  expect(Object.keys(app).sort()).toEqual(APPLICATION_FIELDS);
  expect(typeof app.applicationId).toBe('string');
  expect(typeof app.jobId).toBe('string');
  expect(typeof app.studentId).toBe('string');
  expect(typeof app.note).toBe('string');
  expect(app.preferredDate).toMatch(DATE_TIME); // a real date-time string, not a timestamp
  expect(['pending', 'accepted', 'filled']).toContain(app.status);
}

// Error bodies on writes: exactly { message } with a useful message.
function expectErrorBody(res) {
  expect(Object.keys(res.body)).toEqual(['message']);
  expect(typeof res.body.message).toBe('string');
  expect(res.body.message.length).toBeGreaterThan(0);
}

const snapshot = (id) => JSON.stringify(db.findApplicationById(id));

let server;
let wsBase;
beforeAll((done) => {
  server = createServer();
  server.listen(0, () => { wsBase = `ws://localhost:${server.address().port}`; done(); });
});
afterAll((done) => { server.close(done); });
beforeEach(() => db.reset()); // arrange: every test starts from the same sample data

// WebSocket helpers

function nextMessage(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no message within 3 seconds')), 3000);
    ws.once('message', (data) => { clearTimeout(timer); resolve(JSON.parse(data.toString())); });
  });
}

function connect(path) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsBase + path);
    const first = nextMessage(ws);
    ws.once('open', () => resolve({ ws, first }));
    ws.once('error', reject);
  });
}

function handshakeStatus(path) {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsBase + path);
    ws.on('unexpected-response', (req, res) => { resolve(res.statusCode); req.destroy(); });
    ws.on('upgrade', (res) => { resolve(res.statusCode); ws.close(); });
    ws.on('error', () => {});
  });
}

describe('Endpoint 5: GET /api/applications/{applicationId}/status', () => {
  it('returns exactly applicationId and status', async () => {
    const res = await request(server).get('/api/applications/app_1001/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ applicationId: 'app_1001', status: 'pending' });
  });

  it('edge case: reports accepted and filled applications correctly', async () => {
    const accepted = await request(server).get('/api/applications/app_1002/status');
    const filled = await request(server).get('/api/applications/app_1003/status');

    expect(accepted.body.status).toBe('accepted');
    expect(filled.body.status).toBe('filled');
  });

  it('returns 404 with no body for an application that does not exist', async () => {
    const res = await request(server).get('/api/applications/app_9999/status');

    expect(res.status).toBe(404);
    expect(res.text).toBe('');
  });
});

describe('Endpoint 6: WebSocket /api/applications/{applicationId}/subscribe', () => {
  it('sends the current status on connect, then pushes every change', async () => {
    const { ws, first } = await connect('/api/applications/app_1001/subscribe');

    expect(await first).toEqual({ applicationId: 'app_1001', status: 'pending' });

    const pushed = nextMessage(ws);
    db.setApplicationStatus('app_1001', 'accepted');
    expect(await pushed).toEqual({ applicationId: 'app_1001', status: 'accepted' });
    ws.close();
  });

  it('edge case: sends a final "cancelled" message and closes when the application is deleted', async () => {
    const { ws, first } = await connect('/api/applications/app_1004/subscribe');
    await first;
    const finalMessage = nextMessage(ws);
    const closed = new Promise((resolve) => ws.once('close', resolve));

    await request(server).delete('/api/applications/app_1004');

    expect(await finalMessage).toEqual({ applicationId: 'app_1004', status: 'cancelled' });
    expect(await closed).toBe(1000);
  });

  it('answers the handshake with 101 for an application that exists', async () => {
    expect(await handshakeStatus('/api/applications/app_1001/subscribe')).toBe(101);
  });

  it('refuses the connection with 404 for an application that does not exist', async () => {
    expect(await handshakeStatus('/api/applications/app_9999/subscribe')).toBe(404);
  });

  it('answers a plain HTTP request with 426 Upgrade Required', async () => {
    const res = await request(server).get('/api/applications/app_1001/subscribe');

    expect(res.status).toBe(426);
    expect(res.headers.upgrade).toBe('websocket');
  });
});

describe('Endpoint 7: POST /api/applications', () => {
  const valid = () => ({ jobId: 'job_12345', studentId: 'stu_0500', preferredDate: future(60), note: 'Can start at 8am' });

  it('creates an application: 201, exact contract shape, and a Location header', async () => {
    const body = valid();

    const res = await request(server).post('/api/applications').send(body);

    expect(res.status).toBe(201);
    expectApplicationShape(res.body);
    expect(res.body).toEqual({ applicationId: 'app_1005', ...body, status: 'pending' });
    expect(res.headers.location).toBe('/api/applications/app_1005');
  });

  it('really stores it: the Week 5 GET finds the new application', async () => {
    const created = await request(server).post('/api/applications').send(valid());

    const res = await request(server).get(`/api/applications/${created.body.applicationId}/status`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
    expect(db.countApplications()).toBe(5);
  });

  it('stores an empty note when the note is left out', async () => {
    const { note, ...withoutNote } = valid();

    const res = await request(server).post('/api/applications').send(withoutNote);

    expect(res.status).toBe(201);
    expect(res.body.note).toBe('');
  });

  it('is not idempotent: the same body twice creates two different applications', async () => {
    const body = valid();

    const first = await request(server).post('/api/applications').send(body);
    const second = await request(server).post('/api/applications').send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.applicationId).not.toBe(second.body.applicationId);
    expect(db.countApplications()).toBe(6);
  });

  describe('rejects invalid input with 400 and a message, and writes nothing', () => {
    const cases = [
      ['jobId is missing', (b) => { delete b.jobId; }, /jobId/],
      ['studentId is missing', (b) => { delete b.studentId; }, /studentId/],
      ['preferredDate is missing', (b) => { delete b.preferredDate; }, /preferredDate/],
      ['studentId is a number', (b) => { b.studentId = 42; }, /studentId must be a string/],
      ['note is an array', (b) => { b.note = ['x']; }, /note must be a string/],
      ['preferredDate is a number', (b) => { b.preferredDate = 20270115; }, /preferredDate must be a string/],
      ['studentId is only spaces', (b) => { b.studentId = '   '; }, /studentId must not be empty/],
      ['preferredDate is not a date-time', (b) => { b.preferredDate = 'next Tuesday'; }, /real date-time/],
      ['preferredDate is 30 February', (b) => { b.preferredDate = '2027-02-30T09:00:00Z'; }, /real date-time/],
      ['preferredDate is in the past', (b) => { b.preferredDate = '2020-01-01T09:00:00Z'; }, /in the future/],
      ['the client tries to set status', (b) => { b.status = 'accepted'; }, /Unknown field/],
      ['jobId does not match any job', (b) => { b.jobId = 'job_99999'; }, /does not match any job/],
    ];

    it.each(cases)('%s', async (_name, change, messagePattern) => {
      const body = valid();
      change(body);

      const res = await request(server).post('/api/applications').send(body);

      expect(res.status).toBe(400);
      expectErrorBody(res);
      expect(res.body.message).toMatch(messagePattern);
      expect(db.countApplications()).toBe(4); // nothing was written
    });

    it('the body is not valid JSON', async () => {
      const res = await request(server)
        .post('/api/applications')
        .set('Content-Type', 'application/json')
        .send('{"jobId": "job_12345",');

      expect(res.status).toBe(400);
      expectErrorBody(res);
      expect(db.countApplications()).toBe(4);
    });
  });

  it('edge case: a closed job returns 409 and writes nothing', async () => {
    const res = await request(server).post('/api/applications').send({ ...valid(), jobId: 'job_12350' });

    expect(res.status).toBe(409);
    expectErrorBody(res);
    expect(res.body.message).toMatch(/closed/);
    expect(db.countApplications()).toBe(4);
  });

  it('boundary: a note of exactly 500 characters is accepted, 501 is rejected', async () => {
    const ok = await request(server).post('/api/applications').send({ ...valid(), note: 'a'.repeat(500) });
    const tooLong = await request(server).post('/api/applications').send({ ...valid(), note: 'a'.repeat(501) });

    expect(ok.status).toBe(201);
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.message).toMatch(/500 characters/);
  });
});

describe('Endpoint 8: PUT /api/applications/{applicationId}', () => {
  const update = () => ({ preferredDate: future(67), note: 'Rescheduled' });

  it('reschedules a pending application: 200 with the updated application', async () => {
    const body = update();

    const res = await request(server).put('/api/applications/app_1001').send(body);

    expect(res.status).toBe(200);
    expectApplicationShape(res.body);
    expect(res.body).toEqual({
      applicationId: 'app_1001', jobId: 'job_12345', studentId: 'stu_0042',
      preferredDate: body.preferredDate, note: 'Rescheduled', status: 'pending',
    });
    expect(db.findApplicationById('app_1001').preferred_at.getTime()).toBe(Date.parse(body.preferredDate));
  });

  it('is idempotent: the same PUT twice gives the same end state', async () => {
    const body = update();

    const first = await request(server).put('/api/applications/app_1001').send(body);
    const stateAfterFirst = snapshot('app_1001').replace(/"updated_at":"[^"]*"/, '');
    const second = await request(server).put('/api/applications/app_1001').send(body);
    const stateAfterSecond = snapshot('app_1001').replace(/"updated_at":"[^"]*"/, '');

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(stateAfterSecond).toBe(stateAfterFirst);
    expect(db.countApplications()).toBe(4);
  });

  it('sets an absolute state: leaving note out clears it', async () => {
    const res = await request(server).put('/api/applications/app_1001').send({ preferredDate: future(67) });

    expect(res.status).toBe(200);
    expect(res.body.note).toBe('');
  });

  describe('rejects invalid input with 400 and a message, and changes nothing', () => {
    const cases = [
      ['preferredDate is missing', { note: 'no date' }, /preferredDate/],
      ['note is a number', { preferredDate: future(67), note: 123 }, /note must be a string/],
      ['preferredDate has month 13', { preferredDate: '2026-13-45T09:00:00Z' }, /real date-time/],
      ['the client tries to change the job', { preferredDate: future(67), jobId: 'job_12346' }, /Unknown field/],
      ['the client tries to set status', { preferredDate: future(67), status: 'accepted' }, /Unknown field/],
    ];

    it.each(cases)('%s', async (_name, body, messagePattern) => {
      const before = snapshot('app_1001');

      const res = await request(server).put('/api/applications/app_1001').send(body);

      expect(res.status).toBe(400);
      expectErrorBody(res);
      expect(res.body.message).toMatch(messagePattern);
      expect(snapshot('app_1001')).toBe(before);
    });
  });

  it('returns 404 for an application that does not exist, and never creates one', async () => {
    const res = await request(server).put('/api/applications/app_9999').send(update());

    expect(res.status).toBe(404);
    expectErrorBody(res);
    expect(db.findApplicationById('app_9999')).toBeNull();
    expect(db.countApplications()).toBe(4);
  });

  it('edge case: an accepted application cannot be changed (409)', async () => {
    const before = snapshot('app_1002');

    const res = await request(server).put('/api/applications/app_1002').send(update());

    expect(res.status).toBe(409);
    expectErrorBody(res);
    expect(snapshot('app_1002')).toBe(before);
  });

  it('edge case: a filled application cannot be changed (409)', async () => {
    const res = await request(server).put('/api/applications/app_1003').send(update());

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/filled/);
  });
});

describe('Endpoint 9: DELETE /api/applications/{applicationId}', () => {
  it('cancels a pending application: 204, no body, and it is really gone', async () => {
    const res = await request(server).delete('/api/applications/app_1004');

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    const again = await request(server).get('/api/applications/app_1004/status');
    expect(again.status).toBe(404);
    expect(db.countApplications()).toBe(3);
  });

  it('returns 404 with a message for an application that does not exist', async () => {
    const res = await request(server).delete('/api/applications/app_9999');

    expect(res.status).toBe(404);
    expectErrorBody(res);
    expect(db.countApplications()).toBe(4);
  });

  it('edge case: cancelling the same application twice gives 404 the second time', async () => {
    await request(server).delete('/api/applications/app_1004');

    const res = await request(server).delete('/api/applications/app_1004');

    expect(res.status).toBe(404);
    expectErrorBody(res);
  });

  it('edge case: an accepted application cannot be cancelled (409) and is kept', async () => {
    const res = await request(server).delete('/api/applications/app_1002');

    expect(res.status).toBe(409);
    expectErrorBody(res);
    expect(db.findApplicationById('app_1002')).not.toBeNull();
    expect(db.countApplications()).toBe(4);
  });
});
