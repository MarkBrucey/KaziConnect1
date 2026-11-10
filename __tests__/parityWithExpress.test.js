// Endpoints 1 to 21 must answer exactly as they did when they were an Express app: Ujuzi builds
// against them. __tests__/fixtures/parity.golden.json holds the real Express app's answer to each of
// 151 requests (recorded from main before the move to Next.js): every status, every header except
// Date, and every body. This replays the same requests, in the same order, against the Next.js app.
//
// The requests cover the happy paths, every error path, wrong methods, HEAD, OPTIONS, trailing slashes,
// upper-case paths, odd JSON bodies and content types, compressed bodies, the exact 20 KB limit,
// repeated query keys and malformed ids. If one of these fails, the API has changed for its clients.

const { createServer } = require('../app');
const db = require('../db');
const { runSpecs } = require('./fixtures/parityRunner');
const golden = require('./fixtures/parity.golden.json');

let server;
let got = [];
beforeAll(async () => {
  await db.reset(); // the requests depend on the sample data and on ids counting up from the start
  server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  got = await runSpecs(`http://localhost:${server.address().port}`);
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (db.close) await db.close();
});

it('replays every recorded request', () => {
  expect(got).toHaveLength(golden.results.length);
  expect(golden.results.length).toBeGreaterThanOrEqual(150);
});

// Week 13 (1.4.0): version 1 of the job list (GET /api/jobs, Endpoints 1 and 2) now also says on every answer that it
// is deprecated, with three headers the Express app never sent. Nothing else about those answers may change, so the
// three headers are set aside before comparing, and checked on their own below.
const DEPRECATION = ['deprecation', 'sunset', 'link'];
function withoutDeprecation(answer) {
  const headers = { ...answer.headers };
  for (const name of DEPRECATION) delete headers[name];
  return { ...answer, headers };
}
// GET or HEAD of the job list itself, written any way Express accepted (upper case, a trailing slash).
function isJobList(request) {
  const [method, target] = request.split(' ');
  const path = target.split('?')[0].toLowerCase().replace(/\/+$/, '');
  return (method === 'GET' || method === 'HEAD') && path === '/api/jobs';
}

describe('answers exactly as the Express app did', () => {
  it.each(golden.results.map((g, i) => [i + 1, g.request]))('request %i: %s', (n) => {
    const index = n - 1;
    expect(got[index].request).toBe(golden.results[index].request);
    expect(withoutDeprecation(got[index].answer)).toEqual(golden.results[index].answer);
  });
});

describe('Week 13: the deprecation headers, and only where they belong', () => {
  it('every GET and HEAD of the v1 job list says it is deprecated, when it stops, and what replaces it', () => {
    const list = got.filter(({ request }) => isJobList(request));
    expect(list.length).toBeGreaterThanOrEqual(15);
    for (const { answer } of list) {
      expect(answer.headers.deprecation).toBe('true');
      expect(answer.headers.sunset).toBe('Tue, 10 Nov 2026 21:00:00 GMT');
      expect(answer.headers.link).toBe('</api/v2/jobs>; rel="successor-version"');
    }
  });

  it('no other request carries them: not POST /api/jobs, not OPTIONS, not one job, not any other endpoint', () => {
    const others = got.filter(({ request }) => !isJobList(request));
    expect(others.length).toBeGreaterThan(100);
    for (const { answer } of others) for (const name of DEPRECATION) expect(answer.headers[name]).toBeUndefined();
  });
});

it('sends no X-Powered-By and no ETag on any answer', () => {
  got.forEach(({ answer }) => {
    expect(answer.headers['x-powered-by']).toBeUndefined();
    expect(answer.headers.etag).toBeUndefined();
  });
});
