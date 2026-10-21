// The requests used to prove that the Next.js move changed nothing for Endpoints 1 to 21.
//
// They were sent to the real Express app (main before the move) and to the Next.js app, and the answers
// compared: status, every header except Date, and the body. The Express answers are kept in
// parity.golden.json, so the proof does not depend on Express still being around. parityRunner.js sends
// these requests; parityWithExpress.test.js compares what comes back with the golden file.
//
// The requests run in this order against fresh sample data, so each one can depend on the ones before it
// (an application created early is cancelled later). A "keep" name saves the token a login returns, and
// "auth" sends a saved token. "gz" compresses the body the way body-parser could decode it.
const zlib = require('zlib');
const FUTURE = '2099-01-01T09:00:00Z';
const big = 'x'.repeat(25 * 1024);
const all = [
  // Endpoints 1 and 2
  { path: '/api/jobs?status=active' }, { path: '/api/jobs?status=closed' }, { path: '/api/jobs' }, { path: '/api/jobs?status=' },
  { path: '/api/jobs?county=Nairobi&category=accommodation&status=active' }, { path: '/api/jobs?county=nairobi&category=CATERING&status=active' },
  { path: '/api/jobs?county=Turkana&category=accommodation&status=active' }, { path: '/api/jobs?county=&category=accommodation&status=active' },
  { path: '/api/jobs?county=Nairobi&category=accommodation&statuts=active' },
  // 3, 4
  { path: '/api/jobs/job_12345' }, { path: '/api/jobs/job_99999' }, { path: '/api/jobs/job_12345/status' }, { path: '/api/jobs/job_12350/status' }, { path: '/api/jobs/job_99999/status' },
  // 5, 6 over plain HTTP
  { path: '/api/applications/app_1001/status' }, { path: '/api/applications/app_9999/status' },
  { path: '/api/applications/app_1001/subscribe' }, { path: '/api/applications/app_9999/subscribe' },
  // 7
  { method: 'POST', path: '/api/applications', json: { jobId: 'job_12345', studentId: 'grd_0101', preferredDate: FUTURE, note: 'Can start at 8am' } },
  { method: 'POST', path: '/api/applications', json: { jobId: 'job_12345', preferredDate: FUTURE } },
  { method: 'POST', path: '/api/applications', json: { jobId: 'job_12345', studentId: 42, preferredDate: FUTURE } },
  { method: 'POST', path: '/api/applications', json: { jobId: 'job_12345', studentId: 'a', preferredDate: '2027-02-30T09:00:00Z' } },
  { method: 'POST', path: '/api/applications', json: { jobId: 'job_12345', studentId: 'a', preferredDate: '2020-01-01T09:00:00Z' } },
  { method: 'POST', path: '/api/applications', json: { jobId: 'job_12345', studentId: 'a', preferredDate: FUTURE, status: 'accepted' } },
  { method: 'POST', path: '/api/applications', json: { jobId: 'job_99999', studentId: 'a', preferredDate: FUTURE } },
  { method: 'POST', path: '/api/applications', json: { jobId: 'job_12350', studentId: 'a', preferredDate: FUTURE } },
  { method: 'POST', path: '/api/applications', raw: '{"jobId": "job_12345",' },
  { method: 'POST', path: '/api/applications', json: { jobId: 'job_12345', studentId: 'a', preferredDate: FUTURE, note: big } },
  // 8, 9
  { method: 'PUT', path: '/api/applications/app_1005', json: { preferredDate: FUTURE, note: 'Rescheduled' } },
  { method: 'PUT', path: '/api/applications/app_1005', json: { preferredDate: FUTURE, note: 'Rescheduled' } },
  { method: 'PUT', path: '/api/applications/app_1005', json: { note: 'no date' } },
  { method: 'PUT', path: '/api/applications/app_9999', json: { preferredDate: FUTURE } },
  { method: 'PUT', path: '/api/applications/app_1002', json: { preferredDate: FUTURE } },
  { method: 'DELETE', path: '/api/applications/app_1005' }, { method: 'DELETE', path: '/api/applications/app_1005' },
  { method: 'DELETE', path: '/api/applications/app_9999' }, { method: 'DELETE', path: '/api/applications/app_1002' },
  { path: '/api/applications/app_1005/status' },
  // CORS, unknown paths, headers
  { method: 'OPTIONS', path: '/api/jobs' }, { method: 'OPTIONS', path: '/api/anything/at/all' }, { method: 'OPTIONS', path: '/api/staffing-offers/sof_1' },
  { path: '/api/zzz' }, { method: 'POST', path: '/api/zzz', json: {} }, { path: '/api/jobs/job_12345/nothing' },
  { path: '/api/jobs', headers: { Origin: 'https://example.com' } },
  // 10 to 13
  { method: 'POST', path: '/api/auth/register', json: { name: 'Ab Test', email: 'ab@example.com', password: 'safe-password-1', role: 'employer' }, keep: 'newEmployer' },
  { method: 'POST', path: '/api/auth/register', json: { name: 'Ab Test', email: 'ab@example.com', password: 'safe-password-1', role: 'employer' } },
  { method: 'POST', path: '/api/auth/register', json: { name: 'x', email: 'bad', password: 'short', role: 'boss' } },
  { method: 'POST', path: '/api/auth/login', json: { email: 'employer@kaziconnect.demo', password: 'KaziDemo2026' }, keep: 'employer' },
  { method: 'POST', path: '/api/auth/login', json: { email: 'student@kaziconnect.demo', password: 'KaziDemo2026' }, keep: 'student' },
  { method: 'POST', path: '/api/auth/login', json: { email: 'employer@kaziconnect.demo', password: 'wrong-password' } },
  { method: 'POST', path: '/api/auth/login', json: { email: 'nobody@kaziconnect.demo', password: 'wrong-password' } },
  { path: '/api/me', auth: 'employer' }, { path: '/api/me', auth: 'student' }, { path: '/api/me' }, { path: '/api/me', headers: { Authorization: 'Bearer nonsense' } },
  // 14 to 19
  { method: 'POST', path: '/api/jobs', auth: 'employer', json: { title: 'Fix leaking kitchen sink', category: 'Plumbing', county: 'Nairobi', area: 'Westlands', duration: 'About 2 hours', urgent: true, payRange: { min: 1500, max: 1500 } }, keepId: 'jobId' },
  { method: 'POST', path: '/api/jobs', auth: 'employer', json: { title: 'x' } },
  { method: 'POST', path: '/api/jobs', auth: 'student', json: { title: 'Fix leaking kitchen sink', category: 'Plumbing', county: 'Nairobi', area: 'Westlands', duration: 'About 2 hours', payRange: { min: 1, max: 2 } } },
  { method: 'POST', path: '/api/jobs', json: {} },
  { path: '/api/me/jobs', auth: 'employer' }, { path: '/api/me/jobs', auth: 'student' }, { path: '/api/me/jobs' },
  { path: '/api/jobs/job_12345/applications', auth: 'employer' }, { path: '/api/jobs/job_12345/applications', auth: 'newEmployer' }, { path: '/api/jobs/job_99999/applications', auth: 'employer' },
  { method: 'PATCH', path: '/api/jobs/job_12346', auth: 'employer', json: { status: 'closed' } },
  { method: 'PATCH', path: '/api/jobs/job_12346', auth: 'employer', json: { status: 'active' } },
  { method: 'PATCH', path: '/api/jobs/job_12346', auth: 'newEmployer', json: { status: 'closed' } },
  { method: 'PATCH', path: '/api/jobs/job_12346', auth: 'employer', json: { status: 'weird' } },
  { method: 'PATCH', path: '/api/applications/app_1001', auth: 'employer', json: { status: 'accepted' } },
  { method: 'PATCH', path: '/api/applications/app_1001', auth: 'employer', json: { status: 'accepted' } },
  { method: 'PATCH', path: '/api/applications/app_1001', auth: 'newEmployer', json: { status: 'accepted' } },
  { path: '/api/applications/app_1001/status' }, { path: '/api/jobs/job_12345/status' },
  { path: '/api/me/applications', auth: 'student' }, { path: '/api/me/applications', auth: 'employer' },
  // 20, 21 and 12
  { method: 'POST', path: '/api/auth/password-resets', json: { email: 'student@kaziconnect.demo' } },
  { method: 'POST', path: '/api/auth/password-resets', json: { email: 'nobody@example.com' } },
  { method: 'POST', path: '/api/auth/password-resets', json: { email: 'bad' } },
  { method: 'PUT', path: '/api/auth/password', json: { token: 'a'.repeat(64), password: 'new-password-1' } },
  { method: 'PUT', path: '/api/auth/password', json: { token: 'short', password: 'new-password-1' } },
  { method: 'POST', path: '/api/auth/logout', auth: 'newEmployer' }, { path: '/api/me', auth: 'newEmployer' },
  { method: 'POST', path: '/api/auth/logout' },

  // ---- extra edge cases (added for the Next.js move)
  { path: '/api/jobs/?status=active' }, { path: '/api/jobs/job_12345/' }, { path: '/api/jobs/job_12345/status/' }, { path: '/api/applications/app_1001/status/' },
  { path: '/api/jobs/job%5F12345' }, { path: '/api/jobs/%zz' }, { path: '/api/jobs/job_12345%2Fstatus' },
  { path: '/api/jobs?status=active&status=closed' }, { path: '/api/jobs?status=active&county=Nairobi&county=Mombasa' }, { path: '/api/jobs?status' },
  { path: '/api/jobs?status=%20active%20' }, { path: '/api/jobs?status=ACTIVE&county=NAIROBI&category=Accommodation' }, { path: '/api/jobs?STATUS=active' },
  { method: 'DELETE', path: '/api/jobs' }, { method: 'PUT', path: '/api/jobs' }, { method: 'PATCH', path: '/api/jobs' },
  { method: 'POST', path: '/api/jobs/job_12345/status', json: {} }, { method: 'PUT', path: '/api/me', json: {} }, { path: '/api/applications' },
  { method: 'GET', path: '/api/auth/login' }, { method: 'PUT', path: '/api/auth/login', json: {} }, { path: '/api/auth/register' }, { path: '/api/auth/password' },
  { method: 'POST', path: '/api/applications/app_1001/status', json: {} }, { method: 'PUT', path: '/api/applications/app_1001/subscribe', json: {} },
  { method: 'HEAD', path: '/api/jobs?status=active' }, { method: 'HEAD', path: '/api/jobs/job_99999' }, { method: 'HEAD', path: '/api/auth/login' }, { method: 'HEAD', path: '/api/zzz' },
  { method: 'OPTIONS', path: '/api/jobs', headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' } },
  { method: 'OPTIONS', path: '/api/zzz' }, { method: 'OPTIONS', path: '/api/me/jobs' },
  // bodies and content types
  { method: 'POST', path: '/api/applications', raw: '', headers: { 'Content-Type': 'application/json' } },
  { method: 'POST', path: '/api/applications', raw: '   ', headers: { 'Content-Type': 'application/json' } },
  { method: 'POST', path: '/api/applications', raw: 'null', headers: { 'Content-Type': 'application/json' } },
  { method: 'POST', path: '/api/applications', raw: '"abc"', headers: { 'Content-Type': 'application/json' } },
  { method: 'POST', path: '/api/applications', raw: '123', headers: { 'Content-Type': 'application/json' } },
  { method: 'POST', path: '/api/applications', raw: '[]', headers: { 'Content-Type': 'application/json' } },
  { method: 'POST', path: '/api/applications', raw: '[{"jobId":"job_12345"}]', headers: { 'Content-Type': 'application/json' } },
  { method: 'POST', path: '/api/applications', raw: '{"jobId":"job_12345","studentId":"a","preferredDate":"2099-01-01T09:00:00Z"}', headers: { 'Content-Type': 'text/plain' } },
  { method: 'POST', path: '/api/applications', raw: '{"jobId":"job_12345","studentId":"a","preferredDate":"2099-01-01T09:00:00Z"}', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  { method: 'POST', path: '/api/applications', raw: '{"jobId":"job_12345","studentId":"a","preferredDate":"2099-01-01T09:00:00Z"}', headers: { 'Content-Type': 'APPLICATION/JSON; charset=UTF-8' } },
  { method: 'POST', path: '/api/applications', raw: '{"jobId":"job_12345","studentId":"a","preferredDate":"2099-01-01T09:00:00Z"}', headers: { 'Content-Type': 'application/json; charset=iso-8859-1' } },
  { method: 'POST', path: '/api/applications', raw: '{"jobId":"job_12345","studentId":"a","preferredDate":"2099-01-01T09:00:00Z"}', headers: { 'Content-Type': 'application/vnd.api+json' } },
  { method: 'POST', path: '/api/applications', raw: '﻿{"jobId":"job_12345","studentId":"a","preferredDate":"2099-01-01T09:00:00Z"}', headers: { 'Content-Type': 'application/json' } },
  { method: 'POST', path: '/api/applications', raw: '{"jobId":"job_12345","studentId":"a","preferredDate":"2099-01-01T09:00:00Z","note":"' + 'x'.repeat(20480 - 114) + '"}' },
  { method: 'POST', path: '/api/applications', raw: '{"jobId":"job_12345","studentId":"a","preferredDate":"2099-01-01T09:00:00Z","note":"' + 'x'.repeat(20480 - 113) + '"}' },
  { method: 'POST', path: '/api/zzz', raw: '{' }, { method: 'POST', path: '/api/zzz', raw: 'x'.repeat(30000) }, { method: 'DELETE', path: '/api/jobs', raw: '{' },
  { method: 'POST', path: '/api/auth/login', raw: '{"email":"employer@kaziconnect.demo","password":"KaziDemo2026"}', headers: { 'Content-Type': 'application/json' } },
  { method: 'POST', path: '/api/jobs', raw: '{bad', headers: { 'Content-Type': 'application/json' } },
  { method: 'PATCH', path: '/api/jobs/job_12345', raw: '{bad', headers: { 'Content-Type': 'application/json' } },
  { method: 'PUT', path: '/api/applications/app_9999', raw: '{bad', headers: { 'Content-Type': 'application/json' } },
  { method: 'DELETE', path: '/api/applications/app_9999', raw: '{bad', headers: { 'Content-Type': 'application/json' } },
  { method: 'POST', path: '/api/me/jobs', json: {} },
  // letter case in the path (Express routing ignores it)
  { path: '/API/jobs?status=active' }, { path: '/Api/Jobs/job_12345' }, { path: '/api/JOBS/job_12345/STATUS' }, { path: '/api/Applications/app_1001/Status' }, { method: 'POST', path: '/API/Auth/Login', json: { email: 'employer@kaziconnect.demo', password: 'KaziDemo2026' } },
  // compressed request bodies (body-parser inflated gzip, deflate and br)
  { method: 'POST', path: '/api/applications', gz: 'gzip', raw: '{"jobId":"job_12345","studentId":"gz","preferredDate":"2099-01-01T09:00:00Z"}' },
  { method: 'POST', path: '/api/applications', gz: 'deflate', raw: '{"jobId":"job_12345","studentId":"gz","preferredDate":"2099-01-01T09:00:00Z"}' },
  { method: 'POST', path: '/api/applications', gz: 'br', raw: '{"jobId":"job_12345","studentId":"gz","preferredDate":"2099-01-01T09:00:00Z"}' },
  { method: 'POST', path: '/api/applications', gz: 'fake-gzip', raw: '{"jobId":"job_12345","studentId":"gz","preferredDate":"2099-01-01T09:00:00Z"}' },
  { method: 'POST', path: '/api/applications', gz: 'unknown', raw: '{"jobId":"job_12345","studentId":"gz","preferredDate":"2099-01-01T09:00:00Z"}' },
  { method: 'POST', path: '/api/applications', gz: 'gzip', raw: JSON.stringify({ note: 'x'.repeat(30000) }) },
  // the new event-work paths: auth and method behaviour
  { path: '/api/event-openings' }, { method: 'POST', path: '/api/event-openings', json: {} }, { method: 'GET', path: '/api/staffing-offers' }, { method: 'POST', path: '/api/staffing-offers', json: {} },
  { method: 'DELETE', path: '/api/staffing-offers/sof_1' }, { path: '/api/staffing-offers/sof_1' }, { path: '/api/me/staffing-offers' }, { method: 'POST', path: '/api/me/staffing-offers', json: {} },
];


// Event work (Endpoints 22 to 25) is new in 1.3.0, so Express has nothing to compare it with.
module.exports.specs = all.filter((spec) => !/event-openings|staffing-offers/.test(spec.path));
