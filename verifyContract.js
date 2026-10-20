// Kazi Connect API: contract verification for Week 5 (reads) and Week 6 (writes).
// Endpoint numbers match ENDPOINT_LIST.md.
//
// Starts the server, sends real requests, and checks every real response
// against openapi.yaml: the status code is one the contract declares for that
// case, field names are exact, types and enums are right, dates are real
// date-time strings, nothing extra, nothing missing, and responses the
// contract gives no body (204 and the Week 5 400/404/426) really have none.
//
// Week 6 cases deliberately send bad input (missing fields, wrong types,
// unusable values, unknown IDs) and confirm the data store was left exactly
// as it was. Every success is confirmed by re-fetching with a Week 5 GET.
//
// Endpoints 22 to 25 (Event work) call Sherehe, so they are checked against a local stand-in
// for it (helpers/shereheStub.js, built from partner-tests/sherehe_openapi.yaml): no real
// Sherehe and no API key are needed. They include what happens when Sherehe is down.
//
// Run with: npm run verify   Results are written to VERIFICATION.md.

// Always check against the in-memory sample data, never a real database:
// the checks create and delete applications, which must not touch live data.
delete process.env.DATABASE_URL;

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const WebSocket = require('ws');
const { createServer } = require('./app');
const db = require('./db');
const { isRealDateTime } = require('./validation');
const fetcher = require('./clients/fetcher');
const { runOnce } = require('./jobs/offerPoller');
const { createShereheStub } = require('./helpers/shereheStub');
const { DEMO_PASSWORD } = require('./seedData');

const ROOT = __dirname;
const contract = YAML.parse(fs.readFileSync(path.join(ROOT, 'openapi.yaml'), 'utf8'));
const DAY = 24 * 60 * 60 * 1000;
const future = (days) => new Date(Date.now() + days * DAY).toISOString().replace(/\.\d{3}Z$/, 'Z');

// Contract helpers

function resolve(schema) {
  while (schema && schema.$ref) {
    schema = schema.$ref.replace('#/', '').split('/').reduce((node, key) => node[key], contract);
  }
  return schema;
}

function declaredResponse(pathTemplate, method, status) {
  const op = contract.paths[pathTemplate] && contract.paths[pathTemplate][method.toLowerCase()];
  return op && op.responses ? resolve(op.responses[String(status)]) || null : null;
}

function schemaCheck(value, schema, where, problems) {
  schema = resolve(schema);
  if (value === null && schema.nullable) return; // for example jobId, which is null until an offer is accepted
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return problems.push(`${where} should be an array`);
    value.forEach((item, i) => schemaCheck(item, schema.items, `${where}[${i}]`, problems));
    return;
  }
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return problems.push(`${where} should be an object`);
    }
    const props = schema.properties || {};
    for (const key of Object.keys(props)) {
      if (!(key in value)) problems.push(`${where}.${key} is missing`);
      else schemaCheck(value[key], props[key], `${where}.${key}`, problems);
    }
    for (const key of Object.keys(value)) {
      if (!(key in props)) problems.push(`${where}.${key} is not in the contract`);
    }
    return;
  }
  if (schema.type === 'string' && typeof value !== 'string') return problems.push(`${where} should be a string, got ${typeof value}`);
  if (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) return problems.push(`${where} should be a number, got ${typeof value}`);
  if (schema.type === 'integer' && !Number.isInteger(value)) return problems.push(`${where} should be an integer`);
  if (schema.type === 'boolean' && typeof value !== 'boolean') return problems.push(`${where} should be a boolean, got ${typeof value}`);
  if (schema.enum && !schema.enum.includes(value)) problems.push(`${where} is "${value}", which is not one of ${schema.enum.join(', ')}`);
  if (schema.format === 'date-time' && !isRealDateTime(value)) problems.push(`${where} "${value}" is not a date-time string`);
}

// One HTTP request, checked against the contract

async function checkHttp(base, c) {
  const method = c.method || 'GET';
  const init = { method, headers: { Accept: 'application/json', ...(c.headers || {}) } };
  if (c.rawBody !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = c.rawBody;
  } else if (c.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(c.body);
  }
  if (c.before) await c.before(); // for example: make the Sherehe stand-in go down
  const before = c.snapshot ? await c.snapshot() : null;
  let res;
  let text;
  try {
    res = await fetch(base + c.url, init);
    text = await res.text();
  } finally {
    if (c.after) await c.after(); // and bring it back
  }
  const problems = [];
  const declared = declaredResponse(c.path, method, res.status);
  let body = null;

  if (res.status !== c.expect) problems.push(`status ${res.status}, expected ${c.expect}`);
  if (!declared) problems.push(`status ${res.status} is not declared in the contract for ${method} ${c.path}`);

  const schema = declared && declared.content && declared.content['application/json']
    ? declared.content['application/json'].schema : null;
  if (schema) {
    if (!(res.headers.get('content-type') || '').includes('application/json')) problems.push('Content-Type is not application/json');
    try {
      body = JSON.parse(text);
      schemaCheck(body, schema, 'response', problems);
    } catch (err) {
      problems.push('response body is not valid JSON');
    }
  } else if (declared && text.length > 0) {
    problems.push('the contract gives this response no body, but a body was sent');
  }

  if (c.snapshot && JSON.stringify(await c.snapshot()) !== JSON.stringify(before)) {
    problems.push('the stored data changed, but this request should have written nothing');
  }
  if (c.also && problems.length === 0) await c.also({ body, res, problems, base });
  return { ...c, method, status: res.status, body, problems };
}

// WebSocket helpers

function nextMessage(ws, ms = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no message within 3 seconds')), ms);
    ws.once('message', (data) => { clearTimeout(timer); resolve(JSON.parse(data.toString())); });
  });
}

function openSocket(url) {
  return new Promise((resolve, reject) => {
    let status = null;
    const ws = new WebSocket(url);
    const first = nextMessage(ws);
    ws.on('upgrade', (res) => { status = res.statusCode; });
    ws.once('open', () => resolve({ ws, status, first }));
    ws.once('error', reject);
  });
}

async function checkWsSubscribe(wsBase, c) {
  const problems = [];
  const schema = contract.components.schemas.ApplicationStatus;
  const { ws, status, first } = await openSocket(wsBase + c.url);
  if (status !== 101) problems.push(`handshake status ${status}, expected 101`);
  if (!declaredResponse(c.path, 'GET', 101)) problems.push('101 is not declared in the contract');

  const onConnect = await first;
  schemaCheck(onConnect, schema, 'message on connect', problems);
  const current = (await db.findApplicationById('app_1001')).application_status;
  if (onConnect.status !== current) problems.push(`first message status "${onConnect.status}", expected "${current}"`);

  const pushed = nextMessage(ws);
  await db.setApplicationStatus('app_1001', 'accepted');
  const update = await pushed;
  schemaCheck(update, schema, 'pushed message', problems);
  if (update.status !== 'accepted') problems.push(`pushed status "${update.status}", expected "accepted"`);
  await db.setApplicationStatus('app_1001', current); // put the sample data back
  ws.close();
  return { ...c, method: 'WS', status, body: [onConnect, update], problems };
}

async function checkWsCancelled(base, wsBase, c) {
  const problems = [];
  const schema = contract.components.schemas.ApplicationStatus;
  const { ws, first } = await openSocket(wsBase + c.url);
  await first;
  const closed = new Promise((resolve) => ws.once('close', (code) => resolve(code)));
  const finalMessage = nextMessage(ws);
  const res = await fetch(`${base}/api/applications/app_1004`, { method: 'DELETE' });
  if (res.status !== 204) problems.push(`DELETE returned ${res.status}, expected 204`);
  const message = await finalMessage;
  schemaCheck(message, schema, 'final message', problems);
  if (message.status !== 'cancelled') problems.push(`final message status "${message.status}", expected "cancelled"`);
  const code = await closed;
  if (code !== 1000) problems.push(`socket closed with code ${code}, expected 1000`);
  return { ...c, method: 'WS', status: res.status, body: message, problems };
}

async function checkWsRefused(wsBase, c) {
  const problems = [];
  const status = await new Promise((resolve) => {
    const ws = new WebSocket(wsBase + c.url);
    ws.on('unexpected-response', (req, res) => { resolve(res.statusCode); req.destroy(); });
    ws.on('open', () => { resolve(101); ws.close(); });
    ws.on('error', () => resolve(null));
  });
  if (status !== c.expect) problems.push(`handshake status ${status}, expected ${c.expect}`);
  if (!declaredResponse(c.path, 'GET', status)) problems.push(`status ${status} is not declared in the contract`);
  return { ...c, method: 'WS', status, body: null, problems };
}

// Helpers for Week 6 cases

const store = async () => ({ count: await db.countApplications(), rows: await Promise.all(['app_1001', 'app_1002', 'app_1003', 'app_1004', 'app_1005'].map((id) => db.findApplicationById(id))) });
const refetchStatus = async (base, id) => {
  const res = await fetch(`${base}/api/applications/${id}/status`);
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
};
const allMatch = (field, value) => ({ body, problems }) => {
  body.filter((job) => String(job[field]).toLowerCase() !== value)
      .forEach((job) => problems.push(`${job.id} has ${field} "${job[field]}", filter asked for "${value}"`));
};

const P_JOBS = '/api/jobs';
const P_JOB = '/api/jobs/{jobId}';
const P_JOBSTATUS = '/api/jobs/{jobId}/status';
const P_STATUS = '/api/applications/{applicationId}/status';
const P_SUB = '/api/applications/{applicationId}/subscribe';
const P_APPS = '/api/applications';
const P_APP = '/api/applications/{applicationId}';

const DATE_1 = future(60);
const DATE_2 = future(67);
let putFirstResult = null;

// Week 5 cases: reads (numbered as in ENDPOINT_LIST.md)

const readCases = [
  { ep: 1, kind: 'http', path: P_JOBS, url: '/api/jobs?status=active', expect: 200, what: 'active jobs', also: allMatch('status', 'active') },
  { ep: 1, kind: 'http', path: P_JOBS, url: '/api/jobs', expect: 400, what: 'status missing' },
  { ep: 2, kind: 'http', path: P_JOBS, url: '/api/jobs?county=Nairobi&category=accommodation&status=active', expect: 200, what: 'filtered by county and category',
    also: (ctx) => {
      allMatch('county', 'nairobi')(ctx); allMatch('category', 'accommodation')(ctx); allMatch('status', 'active')(ctx);
      if (ctx.body.length === 0) ctx.problems.push('expected at least one match in the sample data');
    } },
  { ep: 2, kind: 'http', path: P_JOBS, url: '/api/jobs?county=Turkana&category=accommodation&status=active', expect: 200, what: 'no matches, empty list',
    also: ({ body, problems }) => { if (body.length !== 0) problems.push('expected an empty list'); } },
  { ep: 2, kind: 'http', path: P_JOBS, url: '/api/jobs?county=Nairobi&category=accommodation&statuts=active', expect: 400, what: 'old misspelt parameter statuts' },
  { ep: 2, kind: 'http', path: P_JOBS, url: '/api/jobs?county=&category=accommodation&status=active', expect: 400, what: 'county sent empty' },
  { ep: 3, kind: 'http', path: P_JOB, url: '/api/jobs/job_12345', expect: 200, what: 'job exists',
    also: ({ body, problems }) => { if (body.id !== 'job_12345') problems.push('returned the wrong job'); } },
  { ep: 3, kind: 'http', path: P_JOB, url: '/api/jobs/job_99999', expect: 404, what: 'job not found' },
  { ep: 4, kind: 'http', path: P_JOBSTATUS, url: '/api/jobs/job_12345/status', expect: 200, what: 'active job',
    also: ({ body, problems }) => { if (body.jobId !== 'job_12345' || body.status !== 'active') problems.push('expected job_12345 to be active'); } },
  { ep: 4, kind: 'http', path: P_JOBSTATUS, url: '/api/jobs/job_12350/status', expect: 200, what: 'closed job',
    also: ({ body, problems }) => { if (body.status !== 'closed') problems.push('expected job_12350 to be closed'); } },
  { ep: 4, kind: 'http', path: P_JOBSTATUS, url: '/api/jobs/job_99999/status', expect: 404, what: 'job not found' },
  { ep: 5, kind: 'http', path: P_STATUS, url: '/api/applications/app_1001/status', expect: 200, what: 'application exists',
    also: ({ body, problems }) => { if (body.applicationId !== 'app_1001') problems.push('returned the wrong application'); } },
  { ep: 5, kind: 'http', path: P_STATUS, url: '/api/applications/app_9999/status', expect: 404, what: 'application not found' },
  { ep: 6, kind: 'ws', path: P_SUB, url: '/api/applications/app_1001/subscribe', expect: 101, what: 'subscribe, get status, receive a push' },
  { ep: 6, kind: 'wsRefused', path: P_SUB, url: '/api/applications/app_9999/subscribe', expect: 404, what: 'application not found' },
  { ep: 6, kind: 'http', path: P_SUB, url: '/api/applications/app_1001/subscribe', expect: 426, what: 'plain HTTP instead of WebSocket' },
];

// Week 6 cases: writes, good input and deliberately bad input

const goodNew = { jobId: 'job_12345', studentId: 'stu_0500', preferredDate: DATE_1, note: 'Can start at 8am' };
const without = (obj, key) => { const copy = { ...obj }; delete copy[key]; return copy; };

const writeCases = [
  // POST
  { ep: 7, kind: 'http', method: 'POST', path: P_APPS, url: '/api/applications', body: goodNew, expect: 201, good: true, what: 'valid application',
    also: async ({ body, res, problems, base }) => {
      if (body.status !== 'pending') problems.push(`new application status "${body.status}", expected "pending"`);
      if (body.preferredDate !== DATE_1) problems.push('preferredDate was not stored as sent');
      if (res.headers.get('location') !== `/api/applications/${body.applicationId}`) problems.push('Location header missing or wrong');
      const again = await refetchStatus(base, body.applicationId);
      if (again.status !== 200 || again.body.status !== 'pending') problems.push('re-fetch with GET /status did not find the new pending application');
    } },
  { ep: 7, kind: 'http', method: 'POST', path: P_APPS, url: '/api/applications', body: without(goodNew, 'preferredDate'), expect: 400, what: 'missing required field preferredDate', snapshot: store },
  { ep: 7, kind: 'http', method: 'POST', path: P_APPS, url: '/api/applications', body: without(goodNew, 'jobId'), expect: 400, what: 'missing required field jobId', snapshot: store },
  { ep: 7, kind: 'http', method: 'POST', path: P_APPS, url: '/api/applications', body: without(goodNew, 'studentId'), expect: 400, what: 'missing required field studentId', snapshot: store },
  { ep: 7, kind: 'http', method: 'POST', path: P_APPS, url: '/api/applications', body: { ...goodNew, studentId: 42 }, expect: 400, what: 'wrong type: studentId is a number', snapshot: store },
  { ep: 7, kind: 'http', method: 'POST', path: P_APPS, url: '/api/applications', body: { ...goodNew, note: ['x'] }, expect: 400, what: 'wrong type: note is an array', snapshot: store },
  { ep: 7, kind: 'http', method: 'POST', path: P_APPS, url: '/api/applications', body: { ...goodNew, studentId: '   ' }, expect: 400, what: 'unusable: empty studentId', snapshot: store },
  { ep: 7, kind: 'http', method: 'POST', path: P_APPS, url: '/api/applications', body: { ...goodNew, preferredDate: 'next Tuesday' }, expect: 400, what: 'unusable: date is not a date-time', snapshot: store },
  { ep: 7, kind: 'http', method: 'POST', path: P_APPS, url: '/api/applications', body: { ...goodNew, preferredDate: '2027-02-30T09:00:00Z' }, expect: 400, what: 'unusable: 30 February', snapshot: store },
  { ep: 7, kind: 'http', method: 'POST', path: P_APPS, url: '/api/applications', body: { ...goodNew, preferredDate: '2020-01-01T09:00:00Z' }, expect: 400, what: 'unusable: date in the past', snapshot: store },
  { ep: 7, kind: 'http', method: 'POST', path: P_APPS, url: '/api/applications', body: { ...goodNew, status: 'accepted' }, expect: 400, what: 'field not allowed: client sets status', snapshot: store },
  { ep: 7, kind: 'http', method: 'POST', path: P_APPS, url: '/api/applications', body: { ...goodNew, jobId: 'job_99999' }, expect: 400, what: 'jobId does not exist', snapshot: store },
  { ep: 7, kind: 'http', method: 'POST', path: P_APPS, url: '/api/applications', body: { ...goodNew, jobId: 'job_12350' }, expect: 409, what: 'job is closed', snapshot: store },
  { ep: 7, kind: 'http', method: 'POST', path: P_APPS, url: '/api/applications', rawBody: '{"jobId": "job_12345",', expect: 400, what: 'body is not valid JSON', snapshot: store },

  // PUT, on the application created above (app_1005)
  { ep: 8, kind: 'http', method: 'PUT', path: P_APP, url: '/api/applications/app_1005', body: { preferredDate: DATE_2, note: 'Rescheduled' }, expect: 200, good: true, what: 'valid reschedule',
    also: async ({ body, problems, base }) => {
      putFirstResult = body;
      if (body.preferredDate !== DATE_2 || body.note !== 'Rescheduled') problems.push('the new details were not applied');
      const row = await db.findApplicationById('app_1005');
      if (row.preferred_at.getTime() !== Date.parse(DATE_2)) problems.push('the stored row was not updated');
      const again = await refetchStatus(base, 'app_1005');
      if (again.status !== 200 || again.body.status !== 'pending') problems.push('re-fetch with GET /status failed');
    } },
  { ep: 8, kind: 'http', method: 'PUT', path: P_APP, url: '/api/applications/app_1005', body: { preferredDate: DATE_2, note: 'Rescheduled' }, expect: 200, good: true, what: 'same PUT again gives the same end state',
    also: async ({ body, problems }) => {
      if (JSON.stringify(body) !== JSON.stringify(putFirstResult)) problems.push('the second identical PUT produced a different result');
      if ((await db.countApplications()) !== 5) problems.push('the second PUT changed the number of applications');
    } },
  { ep: 8, kind: 'http', method: 'PUT', path: P_APP, url: '/api/applications/app_1005', body: { note: 'no date' }, expect: 400, what: 'missing required field preferredDate', snapshot: store },
  { ep: 8, kind: 'http', method: 'PUT', path: P_APP, url: '/api/applications/app_1005', body: { preferredDate: DATE_2, note: 123 }, expect: 400, what: 'wrong type: note is a number', snapshot: store },
  { ep: 8, kind: 'http', method: 'PUT', path: P_APP, url: '/api/applications/app_1005', body: { preferredDate: '2026-13-45T09:00:00Z' }, expect: 400, what: 'unusable: month 13', snapshot: store },
  { ep: 8, kind: 'http', method: 'PUT', path: P_APP, url: '/api/applications/app_1005', body: { preferredDate: DATE_2, jobId: 'job_12346' }, expect: 400, what: 'field not allowed: changing the job', snapshot: store },
  { ep: 8, kind: 'http', method: 'PUT', path: P_APP, url: '/api/applications/app_9999', body: { preferredDate: DATE_2 }, expect: 404, what: 'ID does not exist, nothing created', snapshot: store },
  { ep: 8, kind: 'http', method: 'PUT', path: P_APP, url: '/api/applications/app_1002', body: { preferredDate: DATE_2 }, expect: 409, what: 'application already accepted', snapshot: store },
  { ep: 8, kind: 'http', method: 'PUT', path: P_APP, url: '/api/applications/app_1003', body: { preferredDate: DATE_2 }, expect: 409, what: 'application already filled', snapshot: store },

  // DELETE
  { ep: 9, kind: 'http', method: 'DELETE', path: P_APP, url: '/api/applications/app_1005', expect: 204, good: true, what: 'cancel a pending application',
    also: async ({ problems, base }) => {
      if (await db.findApplicationById('app_1005')) problems.push('the application is still in the data store');
      const again = await refetchStatus(base, 'app_1005');
      if (again.status !== 404) problems.push(`re-fetch with GET /status returned ${again.status}, expected 404`);
    } },
  { ep: 9, kind: 'http', method: 'DELETE', path: P_APP, url: '/api/applications/app_1005', expect: 404, what: 'cancel the same application again', snapshot: store },
  { ep: 9, kind: 'http', method: 'DELETE', path: P_APP, url: '/api/applications/app_9999', expect: 404, what: 'ID does not exist', snapshot: store },
  { ep: 9, kind: 'http', method: 'DELETE', path: P_APP, url: '/api/applications/app_1002', expect: 409, what: 'application already accepted', snapshot: store },
  { ep: 9, kind: 'wsCancelled', path: P_SUB, url: '/api/applications/app_1004/subscribe', expect: 204, good: true, what: 'subscriber told "cancelled" when app_1004 is deleted' },
];

// Event work cases: Endpoints 22 to 25, against the local Sherehe stand-in

const P_OPENINGS = '/api/event-openings';
const P_OFFERS = '/api/staffing-offers';
const P_OFFER = '/api/staffing-offers/{offerId}';
const P_MYOFFERS = '/api/me/staffing-offers';

async function login(base, email, password) {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return (await res.json()).token;
}

async function buildEventCases(base, stub) {
  const employer = await login(base, 'employer@kaziconnect.demo', DEMO_PASSWORD);
  const student = await login(base, 'student@kaziconnect.demo', DEMO_PASSWORD);
  const registered = await (await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Other Employer', email: 'other.employer@example.com', password: 'safe-password-1', role: 'employer' }),
  })).json();
  const as = (token) => ({ Authorization: `Bearer ${token}` });
  const otherEmployer = registered.token;

  // Everything an offer touches: our rows for both employers, and what the stand-in holds
  const offerState = async () => ({
    ours: [...await db.findStaffingOffersByEmployer('usr_1001'), ...await db.findStaffingOffersByEmployer(registered.user.id)].map((o) => [o._id, o.status, o.job_id]),
    sherehe: stub.offers.map((o) => [o.id, o.status]),
  });
  const down = { before: () => { stub.setMode('drop'); fetcher.clearCache(); }, after: () => stub.setMode('up') };
  const refetchOffers = async (token) => (await (await fetch(`${base}${P_MYOFFERS}`, { headers: { Accept: 'application/json', ...as(token) } })).json());
  const sorted = (list, key) => list.every((x, i) => i === 0 || list[i - 1][key] <= x[key]);

  const openingBody = { roleId: 'rol_3001', workersOffered: 4, note: 'Four trained catering students' };
  const http = (c) => ({ kind: 'http', ...c });

  return [
    // Endpoint 22: read
    http({ ep: 22, path: P_OPENINGS, url: '/api/event-openings', headers: as(employer), expect: 200, what: 'open roles on upcoming events',
      also: ({ body, problems }) => {
        if (body.length === 0) problems.push('expected at least one opening');
        if (body.some((o) => o.openSlots < 1)) problems.push('an opening has no free slot');
        if (!sorted(body, 'startsAt')) problems.push('openings are not soonest first');
        if (body.some((o) => ['rol_3002', 'rol_3005'].includes(o.roleId))) problems.push('a full role or a role on a finished event was listed');
      } }),
    http({ ep: 22, path: P_OPENINGS, url: '/api/event-openings?county=mombasa', headers: as(employer), expect: 200, what: 'filtered by county, any letter case',
      also: ({ body, problems }) => { allMatch('county', 'mombasa')({ body, problems }); if (body.length !== 1) problems.push('expected exactly one Mombasa opening'); } }),
    http({ ep: 22, path: P_OPENINGS, url: '/api/event-openings?county=Lamu', headers: as(employer), expect: 200, what: 'no events there, empty list',
      also: ({ body, problems }) => { if (body.length !== 0) problems.push('expected an empty list'); } }),
    http({ ep: 22, path: P_OPENINGS, url: '/api/event-openings', expect: 401, what: 'no login token' }),
    http({ ep: 22, path: P_OPENINGS, url: '/api/event-openings', headers: as(student), expect: 403, what: 'a student is not allowed' }),
    http({ ep: 22, path: P_OPENINGS, url: '/api/event-openings', headers: as(employer), expect: 502, what: 'Sherehe is down', ...down,
      also: ({ body, problems }) => { if (/hunter2|X-API-Key|stub/i.test(JSON.stringify(body))) problems.push("Sherehe's own words reached the client"); } }),

    // Endpoint 23: write
    http({ ep: 23, method: 'POST', path: P_OFFERS, url: '/api/staffing-offers', headers: as(employer), body: openingBody, expect: 201, good: true, what: 'valid offer',
      also: async ({ body, problems }) => {
        if (body.status !== 'pending' || body.jobId !== null) problems.push('a new offer should be pending with no job yet');
        if (stub.offers.length !== 1 || stub.offers[0].roleId !== 'rol_3001') problems.push('the offer was not made at Sherehe');
        const mine = await refetchOffers(employer);
        if (mine.length !== 1 || mine[0].id !== body.id) problems.push('re-fetch with Endpoint 24 did not find the new offer');
      } }),
    ...[
      ['missing required field roleId', { workersOffered: 2 }],
      ['wrong type: workersOffered is text', { roleId: 'rol_3004', workersOffered: '3' }],
      ['unusable: workersOffered is 0', { roleId: 'rol_3004', workersOffered: 0 }],
      ['unusable: roleId is empty', { roleId: '  ', workersOffered: 1 }],
      ['field not allowed: client sets status', { roleId: 'rol_3004', workersOffered: 1, status: 'accepted' }],
      ['unusable: more workers than Sherehe has free slots', { roleId: 'rol_3004', workersOffered: 9 }],
    ].map(([what, body]) => http({ ep: 23, method: 'POST', path: P_OFFERS, url: '/api/staffing-offers', headers: as(employer), body, expect: 400, what, snapshot: offerState })),
    http({ ep: 23, method: 'POST', path: P_OFFERS, url: '/api/staffing-offers', headers: as(employer), rawBody: '{"roleId": "rol_3004",', expect: 400, what: 'body is not valid JSON', snapshot: offerState }),
    http({ ep: 23, method: 'POST', path: P_OFFERS, url: '/api/staffing-offers', body: { roleId: 'rol_3004', workersOffered: 1 }, expect: 401, what: 'no login token', snapshot: offerState }),
    http({ ep: 23, method: 'POST', path: P_OFFERS, url: '/api/staffing-offers', headers: as(student), body: { roleId: 'rol_3004', workersOffered: 1 }, expect: 403, what: 'a student is not allowed', snapshot: offerState }),
    http({ ep: 23, method: 'POST', path: P_OFFERS, url: '/api/staffing-offers', headers: as(employer), body: { roleId: 'rol_9999', workersOffered: 1 }, expect: 404, what: 'no such role', snapshot: offerState }),
    http({ ep: 23, method: 'POST', path: P_OFFERS, url: '/api/staffing-offers', headers: as(employer), body: { roleId: 'rol_3002', workersOffered: 1 }, expect: 404, what: 'role is already full, so not open', snapshot: offerState }),
    http({ ep: 23, method: 'POST', path: P_OFFERS, url: '/api/staffing-offers', headers: as(otherEmployer), body: { roleId: 'rol_3001', workersOffered: 1 }, expect: 409, what: 'an offer is already waiting on the role', snapshot: offerState }),
    http({ ep: 23, method: 'POST', path: P_OFFERS, url: '/api/staffing-offers', headers: as(employer), body: { roleId: 'rol_3004', workersOffered: 1 }, expect: 409, what: 'role filled up at Sherehe after it was listed', snapshot: offerState,
      before: async () => { await fetch(`${base}/api/event-openings`, { headers: as(employer) }); stub.fillRole('rol_3004'); } }),
    http({ ep: 23, method: 'POST', path: P_OFFERS, url: '/api/staffing-offers', headers: as(employer), body: { roleId: 'rol_3003', workersOffered: 1 }, expect: 502, what: 'Sherehe is down, nothing is kept', snapshot: offerState,
      before: async () => { await fetch(`${base}/api/event-openings`, { headers: as(employer) }); stub.setMode('drop'); }, after: down.after }),
    http({ ep: 23, method: 'POST', path: P_OFFERS, url: '/api/staffing-offers', headers: as(employer), body: { roleId: 'rol_3003', workersOffered: 1 }, expect: 201, good: true, what: 'a second offer, on another role',
      also: ({ body, problems }) => { if (body.id !== 'sof_1002') problems.push(`expected sof_1002, got ${body.id}`); } }),

    // Endpoint 24: read
    http({ ep: 24, path: P_MYOFFERS, url: '/api/me/staffing-offers', headers: as(employer), expect: 200, what: 'my offers, newest first',
      also: ({ body, problems }) => { if (body.map((o) => o.id).join() !== 'sof_1002,sof_1001') problems.push(`expected sof_1002,sof_1001, got ${body.map((o) => o.id)}`); } }),
    http({ ep: 24, path: P_MYOFFERS, url: '/api/me/staffing-offers', headers: as(otherEmployer), expect: 200, what: "another employer sees none of them",
      also: ({ body, problems }) => { if (body.length !== 0) problems.push('expected an empty list'); } }),
    http({ ep: 24, path: P_MYOFFERS, url: '/api/me/staffing-offers', headers: as(employer), expect: 200, what: 'still works when Sherehe is down', ...down,
      also: ({ body, problems }) => { if (body.length !== 2) problems.push('expected both offers'); } }),
    http({ ep: 24, path: P_MYOFFERS, url: '/api/me/staffing-offers', expect: 401, what: 'no login token' }),
    http({ ep: 24, path: P_MYOFFERS, url: '/api/me/staffing-offers', headers: as(student), expect: 403, what: 'a student is not allowed' }),

    // Endpoint 25: withdraw
    http({ ep: 25, method: 'DELETE', path: P_OFFER, url: '/api/staffing-offers/sof_1002', headers: as(employer), expect: 204, good: true, what: 'withdraw a pending offer',
      also: async ({ problems }) => {
        if (stub.offers.some((o) => o.roleId === 'rol_3003')) problems.push('the offer is still at Sherehe');
        if (await db.findStaffingOfferById('sof_1002')) problems.push('the offer is still in our data store');
        if ((await refetchOffers(employer)).some((o) => o.id === 'sof_1002')) problems.push('Endpoint 24 still lists it');
      } }),
    http({ ep: 25, method: 'DELETE', path: P_OFFER, url: '/api/staffing-offers/sof_1002', headers: as(employer), expect: 404, what: 'withdraw the same offer again', snapshot: offerState }),
    http({ ep: 25, method: 'DELETE', path: P_OFFER, url: '/api/staffing-offers/sof_9999', headers: as(employer), expect: 404, what: 'no such offer', snapshot: offerState }),
    http({ ep: 25, method: 'DELETE', path: P_OFFER, url: '/api/staffing-offers/sof_1001', headers: as(otherEmployer), expect: 403, what: "someone else's offer", snapshot: offerState }),
    http({ ep: 25, method: 'DELETE', path: P_OFFER, url: '/api/staffing-offers/sof_1001', expect: 401, what: 'no login token', snapshot: offerState }),
    http({ ep: 25, method: 'DELETE', path: P_OFFER, url: '/api/staffing-offers/sof_1001', headers: as(student), expect: 403, what: 'a student is not allowed', snapshot: offerState }),
    http({ ep: 25, method: 'DELETE', path: P_OFFER, url: '/api/staffing-offers/sof_1001', headers: as(employer), expect: 502, what: 'Sherehe is down, the offer stays', snapshot: offerState, ...down }),
    http({ ep: 25, method: 'DELETE', path: P_OFFER, url: '/api/staffing-offers/sof_1001', headers: as(employer), expect: 409, what: 'organiser accepted it just now, before we noticed', snapshot: offerState,
      before: () => stub.decide('ofr_4001', 'accepted') }),

    // The poller notices the acceptance and opens the job (read back with Endpoints 24, 3 and 1)
    http({ ep: 24, path: P_MYOFFERS, url: '/api/me/staffing-offers', headers: as(employer), expect: 200, what: 'after the poller runs: accepted, with the job it opened',
      before: async () => { await runOnce(); },
      also: async ({ body, problems }) => {
        const offer = body.find((o) => o.id === 'sof_1001');
        if (!offer || offer.status !== 'accepted' || !offer.jobId) return problems.push('sof_1001 should be accepted with a jobId');
        const job = await (await fetch(`${base}/api/jobs/${offer.jobId}`)).json();
        if (job.status !== 'active' || job.category !== 'catering' || job.payRange.min !== 1500 || job.payRange.max !== 1500) problems.push('the job opened does not have the role\'s category and pay');
        if (Object.keys(job).some((k) => /role|source|sherehe/i.test(k))) problems.push('the job shows where it came from');
        const listed = await (await fetch(`${base}/api/jobs?status=active&category=catering&county=Nairobi`)).json();
        if (!listed.some((j) => j.id === offer.jobId)) problems.push('the job is not in the public listing (Endpoints 1 and 2)');
      } }),
    http({ ep: 25, method: 'DELETE', path: P_OFFER, url: '/api/staffing-offers/sof_1001', headers: as(employer), expect: 409, what: 'offer is already accepted', snapshot: offerState }),
  ];
}

// Report

function sample(body) {
  if (body === null || body === undefined) return '(no body)';
  if (Array.isArray(body) && body.length > 1 && body[0] && body[0].id) {
    return `${body.length} items. First item:\n${JSON.stringify(body[0], null, 2)}`;
  }
  return JSON.stringify(body, null, 2);
}

const ok = (r) => r.problems.length === 0;
const requestLabel = (r) => (r.kind === 'http' ? `${r.method} ${r.url}` : `WebSocket ${r.url}`);
const mark = (bool) => (bool ? 'Yes' : 'No');

function writeReport(reads, writes, events) {
  const all = reads.concat(writes, events);
  const lines = [];
  lines.push('# Kazi Connect API: Contract Verification', '');
  lines.push(`Generated by \`npm run verify\` on ${new Date().toISOString()}.`);
  lines.push('Every request below was sent to the running server, and its real response was checked against `openapi.yaml` field by field: status code, exact field names, types, enums, date-time format, no extra fields and no missing fields.', '');
  lines.push(`**Result: ${all.filter(ok).length} of ${all.length} checks passed** (Week 5: ${reads.filter(ok).length} of ${reads.length}; Week 6: ${writes.filter(ok).length} of ${writes.length}; Event work: ${events.filter(ok).length} of ${events.length}).`, '');

  lines.push('## Week 5: GET endpoints', '');
  lines.push('| Endpoint | Request | Case | Contract expects | Got | Result |', '|---|---|---|---|---|---|');
  for (const r of reads) lines.push(`| ${r.ep} | \`${requestLabel(r)}\` | ${r.what} | ${r.expect} | ${r.status} | ${ok(r) ? 'Pass' : 'FAIL'} |`);
  lines.push('', '| Endpoint | Exact field names | Correct types | No extra fields | No missing fields | Correct status codes |', '|---|---|---|---|---|---|');
  for (const ep of [1, 2, 3, 4, 5, 6]) {
    const probs = reads.filter((r) => r.ep === ep).flatMap((r) => r.problems);
    const has = (re) => probs.some((p) => re.test(p));
    lines.push(`| ${ep} | ${mark(!has(/not in the contract|is missing/))} | ${mark(!has(/should be|not one of|date-time/))} | ${mark(!has(/not in the contract/))} | ${mark(!has(/is missing/))} | ${mark(!has(/status/))} |`);
  }

  lines.push('', '## Week 6: write endpoints, good input and bad input', '');
  lines.push('Every bad request was also checked to confirm the data store was left exactly as it was. Every success was confirmed by re-fetching with the Week 5 GET endpoint.', '');
  lines.push('| Endpoint | Request | Case | Input | Contract expects | Got | Result |', '|---|---|---|---|---|---|---|');
  for (const r of writes) lines.push(`| ${r.ep} | \`${requestLabel(r)}\` | ${r.what} | ${r.good ? 'good' : 'bad'} | ${r.expect} | ${r.status} | ${ok(r) ? 'Pass' : 'FAIL'} |`);
  const w = (fn) => writes.filter(fn);
  const bad = w((r) => !r.good);
  lines.push('', '### Part D checklist', '');
  lines.push(`* Every required field is actually enforced: **${mark(w((r) => /missing required/.test(r.what)).every(ok))}**`);
  lines.push(`* Every success returns the correct status code (201 / 200 / 204, not a blanket 200): **${mark(w((r) => r.good).every(ok))}**`);
  lines.push(`* PUT and DELETE on a nonexistent ID return 404, not a silent success: **${mark(w((r) => r.expect === 404).every(ok))}**`);
  lines.push(`* A rejected request leaves no partial or garbage data behind: **${mark(bad.every((r) => !r.problems.some((p) => /stored data changed/.test(p))))}**`);
  lines.push(`* Sending the same valid PUT twice produces the same end state: **${mark(w((r) => /same PUT again/.test(r.what)).every(ok))}**`);
  lines.push(`* Bad input cases tested: **${bad.length}**, good input cases tested: **${writes.length - bad.length}**`);

  lines.push('', '## Event work: Endpoints 22 to 25, against a local Sherehe stand-in', '');
  lines.push('These endpoints call Sherehe. They are checked against `helpers/shereheStub.js`, a local stand-in built from `partner-tests/sherehe_openapi.yaml`, so this report never needs the real Sherehe or its API key. The stand-in is taken down on purpose in some cases, to prove what Kazi Connect does when Sherehe cannot be used.', '');
  lines.push('| Endpoint | Request | Case | Contract expects | Got | Result |', '|---|---|---|---|---|---|');
  for (const r of events) lines.push(`| ${r.ep} | \`${requestLabel(r)}\` | ${r.what} | ${r.expect} | ${r.status} | ${ok(r) ? 'Pass' : 'FAIL'} |`);
  const e = (fn) => events.filter(fn);
  const eventBad = e((r) => (r.method === 'POST' || r.method === 'DELETE') && !r.good);
  lines.push('', '### Event work checklist', '');
  lines.push(`* Every Sherehe failure answers 502 with Kazi's own message, and nothing Sherehe said reaches the client: **${mark(e((r) => r.expect === 502).every(ok))}**`);
  lines.push(`* Every success returns the correct status code (200 / 201 / 204): **${mark(e((r) => r.good || r.expect === 200).every(ok))}**`);
  lines.push(`* A rejected or failed request leaves our data and Sherehe's exactly as they were: **${mark(eventBad.every((r) => !r.problems.some((p) => /stored data changed/.test(p))))}**`);
  lines.push(`* Endpoint 24 still works while Sherehe is down: **${mark(e((r) => /still works when Sherehe is down/.test(r.what)).every(ok))}**`);
  lines.push(`* An accepted offer becomes a job with the role's category and pay, listed by Endpoints 1 and 2: **${mark(e((r) => /after the poller runs/.test(r.what)).every(ok))}**`);

  lines.push('', '## Details', '');
  for (const r of all) {
    lines.push(`### Endpoint ${r.ep}: ${r.what}`, '', `Request: \`${requestLabel(r)}\``);
    if (r.rawBody !== undefined || r.body !== undefined) {
      lines.push(`Sent: \`${r.rawBody !== undefined ? r.rawBody : JSON.stringify(r.body)}\``);
    }
    lines.push(`Status: expected ${r.expect}, got ${r.status}`);
    lines.push(ok(r) ? 'Problems: none' : `Problems:\n${r.problems.map((p) => `* ${p}`).join('\n')}`);
    lines.push('', 'Response:', '```json', sample(r.response), '```', '');
  }
  lines.push('Endpoint 6 is a WebSocket, which Swagger UI cannot open, so it is verified here with a WebSocket client. The other endpoints can also be checked by hand in Swagger UI at http://localhost:3000/docs with Try it out; screenshots of those runs are in the evidence folder, named by endpoint number.');
  fs.writeFileSync(path.join(ROOT, 'VERIFICATION.md'), lines.join('\n') + '\n');
}

async function run(list, base, wsBase) {
  const results = [];
  for (const c of list) {
    let r;
    try {
      if (c.kind === 'http') r = await checkHttp(base, c);
      else if (c.kind === 'ws') r = await checkWsSubscribe(wsBase, c);
      else if (c.kind === 'wsCancelled') r = await checkWsCancelled(base, wsBase, c);
      else r = await checkWsRefused(wsBase, c);
    } catch (err) {
      r = { ...c, method: c.method || 'GET', status: null, body: null, problems: [`request failed: ${err.message}`] };
    }
    r.response = r.body;
    r.body = c.body;
    results.push(r);
    console.log(`${ok(r) ? 'pass' : 'FAIL'}  Endpoint ${r.ep}  ${r.what.padEnd(48)} expected ${r.expect}, got ${r.status}`);
    r.problems.forEach((p) => console.log(`        ${p}`));
  }
  return results;
}

async function main() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const wsBase = `ws://localhost:${port}`;

  console.log('Week 5: GET endpoints');
  const reads = await run(readCases, base, wsBase);
  console.log('\nWeek 6: write endpoints, good and bad input');
  const writes = await run(writeCases, base, wsBase);

  console.log('\nEvent work: Endpoints 22 to 25, against a local Sherehe stand-in');
  const stub = createShereheStub();
  await stub.start();
  process.env.SHEREHE_API_URL = stub.url;
  process.env.SHEREHE_API_KEY = stub.apiKey;
  const events = await run(await buildEventCases(base, stub), base, wsBase);
  await stub.stop();

  writeReport(reads, writes, events);
  const all = reads.concat(writes, events);
  const passed = all.filter(ok).length;
  console.log(`\n${passed} of ${all.length} checks passed. Full report written to VERIFICATION.md`);
  server.close();
  process.exit(passed === all.length ? 0 : 1);
}

main();
