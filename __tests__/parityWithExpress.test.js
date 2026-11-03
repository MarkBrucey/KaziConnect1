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

describe('answers exactly as the Express app did', () => {
  it.each(golden.results.map((g, i) => [i + 1, g.request]))('request %i: %s', (n) => {
    const index = n - 1;
    expect(got[index].request).toBe(golden.results[index].request);
    expect(got[index].answer).toEqual(golden.results[index].answer);
  });
});

it('sends no X-Powered-By and no ETag on any answer', () => {
  got.forEach(({ answer }) => {
    expect(answer.headers['x-powered-by']).toBeUndefined();
    expect(answer.headers.etag).toBeUndefined();
  });
});
