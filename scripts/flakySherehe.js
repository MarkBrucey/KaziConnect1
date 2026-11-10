// Week 11: a stand-in for Sherehe that YOU control, to watch Kazi Connect's Event work fail and recover.
//
// It answers the two reads Kazi makes for the Event work page, in Sherehe's own shapes:
//   GET /api/events?status=upcoming[&county=...][&include=roles]
//   GET /api/events/{eventId}/roles
// and has four modes you can switch without restarting it:
//   ok      answers at once
//   slow    answers after 10 seconds
//   flaky   fails twice with 503, then works (calls 3, 6, 9 ... succeed)
//   error   always 500
// To make Sherehe "gone", stop this program (Ctrl+C).
//
// Run it (no packages needed, unlike the handout's Express version, because Kazi Connect no longer uses Express):
//   node scripts/flakySherehe.js                     listens on http://localhost:4000
//   curl http://localhost:4000/__mode/slow           switch mode
// Then start Kazi Connect pointed at it, with the cache off so every page load reaches the stand-in:
//   SHEREHE_API_URL=http://localhost:4000 SHEREHE_API_KEY=standin-key-for-drills PARTNER_CACHE_SECONDS=0 npm start
// It accepts any X-API-Key, and never prints the key it was sent.

const http = require('http');

const PORT = Number(process.env.STANDIN_PORT || 4000);
let mode = 'ok';
let calls = 0;

const events = [
  { id: 'evt_2001', name: 'Wanjiku and Otieno wedding', type: 'wedding', county: 'Nairobi', area: 'Westlands', venue: 'Sarit Expo Centre', startsAt: '2026-12-05T14:00:00Z', endsAt: '2026-12-05T22:00:00Z', expectedGuests: 300, status: 'upcoming' },
  { id: 'evt_2002', name: 'Coast Tech Summit', type: 'conference', county: 'Mombasa', area: 'Nyali', venue: 'Nyali Beach Hall', startsAt: '2026-12-12T07:00:00Z', endsAt: '2026-12-12T15:00:00Z', expectedGuests: 150, status: 'upcoming' },
];
const roles = [
  { id: 'rol_3001', eventId: 'evt_2001', title: 'Waiters', category: 'catering', headcount: 6, filled: 0, shiftStart: '2026-12-05T13:00:00Z', shiftEnd: '2026-12-05T23:00:00Z', payPerShift: 1500 },
  { id: 'rol_3003', eventId: 'evt_2001', title: 'Security guards', category: 'security', headcount: 3, filled: 1, shiftStart: '2026-12-05T12:00:00Z', shiftEnd: '2026-12-06T00:00:00Z', payPerShift: 2000 },
  { id: 'rol_3004', eventId: 'evt_2002', title: 'Registration desk', category: 'events', headcount: 5, filled: 0, shiftStart: '2026-12-12T06:00:00Z', shiftEnd: '2026-12-12T16:00:00Z', payPerShift: 1800 },
];

const send = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://standin');
  const switchTo = /^\/__mode\/(ok|slow|flaky|error)$/.exec(url.pathname);
  if (switchTo) { mode = switchTo[1]; calls = 0; console.log(`mode is now ${mode}`); return send(res, 200, { mode }); }

  calls += 1;
  console.log(`${new Date().toISOString()} ${req.method} ${url.pathname} (call ${calls}, mode ${mode})`);
  if (mode === 'slow') await sleep(10000);
  if (mode === 'flaky' && calls % 3 !== 0) return send(res, 503, { message: 'Try again' });
  if (mode === 'error') return send(res, 500, { message: 'Internal error' });
  if (!req.headers['x-api-key']) return send(res, 401, { message: 'Send your partner key as X-API-Key' });

  if (req.method === 'GET' && url.pathname === '/api/events') {
    const county = (url.searchParams.get('county') || '').toLowerCase();
    const list = events.filter((e) => !county || e.county.toLowerCase() === county);
    const withRoles = url.searchParams.get('include') === 'roles';
    return send(res, 200, withRoles ? list.map((e) => ({ ...e, roles: roles.filter((r) => r.eventId === e.id) })) : list);
  }
  const m = /^\/api\/events\/([^/]+)\/roles$/.exec(url.pathname);
  if (req.method === 'GET' && m) return send(res, 200, roles.filter((r) => r.eventId === m[1]));
  return send(res, 404, { message: 'Not found' });
}).listen(PORT, () => console.log(`Stand-in Sherehe on http://localhost:${PORT} (mode ${mode})`));
