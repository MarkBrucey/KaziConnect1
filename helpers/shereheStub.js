// A local stand-in for Sherehe, built from partner-tests/sherehe_openapi.yaml: same paths,
// same fields, same status codes, and the contract's own examples as its sample data
// (evt_2001, rol_3001, ofr_4001). The automated tests, `npm run verify` and local trials of the
// Event work page all use it, so none of them needs the real Sherehe or its API key.
//
// Beyond the contract it has controls for the things a test must make happen:
//   stub.setMode('drop' | 'error' | 'garbage' | 'wrongShape' | 'redirect' | 'up')   misbehave
//   stub.failOn('/roles')              answer 503 only for paths containing this text
//   stub.setDelay(ms)                  answer slowly
//   stub.decide(offerId, 'accepted' | 'declined')   what the organiser would do on Sherehe's website
//   stub.fillRole(roleId)              make a role full
//   stub.dropOffer(offerId)            Sherehe loses an offer behind Kazi's back
//   stub.requests                      every request received (method, path, key, body)
//
// Run it by hand with: node helpers/shereheStub.js   (it prints the address and the key)

const http = require('http');
const { COUNTIES } = require('../sharedLists');

const KEY = 'stub-partner-key';

const EVENTS = [
  { id: 'evt_2001', name: 'Wanjiku and Otieno wedding', type: 'wedding', county: 'Nairobi', area: 'Westlands', venue: 'Sarit Expo Centre', startsAt: '2026-12-05T14:00:00Z', endsAt: '2026-12-05T22:00:00Z', expectedGuests: 300, status: 'upcoming' },
  { id: 'evt_2002', name: 'Coast Tech Summit', type: 'conference', county: 'Mombasa', area: 'Nyali', venue: 'Nyali Beach Hall', startsAt: '2026-12-12T07:00:00Z', endsAt: '2026-12-12T15:00:00Z', expectedGuests: 150, status: 'upcoming' },
  { id: 'evt_2003', name: 'Kasarani Charity Concert', type: 'concert', county: 'Nairobi', area: 'Kasarani', venue: 'Kasarani Grounds', startsAt: '2026-09-01T15:00:00Z', endsAt: '2026-09-01T21:00:00Z', expectedGuests: 800, status: 'completed' },
];

const ROLES = [
  { id: 'rol_3001', eventId: 'evt_2001', title: 'Waiters', category: 'catering', headcount: 6, filled: 0, shiftStart: '2026-12-05T13:00:00Z', shiftEnd: '2026-12-05T23:00:00Z', payPerShift: 1500 },
  { id: 'rol_3002', eventId: 'evt_2001', title: 'Ushers', category: 'events', headcount: 4, filled: 4, shiftStart: '2026-12-05T13:00:00Z', shiftEnd: '2026-12-05T21:00:00Z', payPerShift: 1200 },
  { id: 'rol_3003', eventId: 'evt_2001', title: 'Security guards', category: 'security', headcount: 3, filled: 1, shiftStart: '2026-12-05T12:00:00Z', shiftEnd: '2026-12-06T00:00:00Z', payPerShift: 2000 },
  { id: 'rol_3004', eventId: 'evt_2002', title: 'Registration desk', category: 'events', headcount: 5, filled: 0, shiftStart: '2026-12-12T06:00:00Z', shiftEnd: '2026-12-12T16:00:00Z', payPerShift: 1800 },
  { id: 'rol_3005', eventId: 'evt_2003', title: 'Stage crew', category: 'events', headcount: 8, filled: 0, shiftStart: '2026-09-01T12:00:00Z', shiftEnd: '2026-09-01T22:00:00Z', payPerShift: 1600 },
];

const clone = (value) => JSON.parse(JSON.stringify(value));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isWhole = (v) => Number.isInteger(v);

function createShereheStub({ apiKey = KEY } = {}) {
  let server = null;
  let state = freshState();

  function freshState() {
    return { events: clone(EVENTS), roles: clone(ROLES), offers: new Map(), nextOffer: 4001, mode: 'up', failOn: null, delayMs: 0, requests: [] };
  }

  const send = (res, status, body, headers = {}) => {
    const text = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, { ...(text ? { 'Content-Type': 'application/json' } : {}), ...headers });
    res.end(text);
  };
  const message = (res, status, text) => send(res, status, { message: text });

  function readBody(req) {
    return new Promise((resolve) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => resolve(raw));
    });
  }

  function newOffer(st, body) {
    const role = st.roles.find((r) => r.id === body.roleId);
    const event = role && st.events.find((e) => e.id === role.eventId);
    if (!role || !event || event.status !== 'upcoming') return { status: 404, text: `Role ${body.roleId} not found` };
    const open = role.headcount - role.filled;
    if (open === 0) return { status: 409, text: `Role ${role.id} is full` };
    if (body.workersOffered > open) return { status: 400, text: 'workersOffered must be a whole number from 1 to the open slots' };
    const offer = {
      id: `ofr_${st.nextOffer++}`, roleId: role.id, eventId: role.eventId, workersOffered: body.workersOffered,
      note: body.note === undefined ? '' : body.note, status: 'pending', createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
    st.offers.set(offer.id, offer);
    return { status: 201, offer };
  }

  async function handle(req, res) {
    // A request keeps working on the state that existed when it arrived. After stub.reset() a slow
    // request that is still waiting (a client that timed out) can then never write into the next
    // test's data. That is also how a real Sherehe behaves: the offer may exist although we gave up.
    const st = state;
    const url = new URL(req.url, 'http://stub');
    const raw = await readBody(req);
    let body;
    try { body = raw ? JSON.parse(raw) : undefined; } catch (err) { body = Symbol.for('invalid-json'); }
    st.requests.push({ method: req.method, path: url.pathname, search: url.search, key: req.headers['x-api-key'] || null, body: typeof body === 'symbol' ? raw : body });
    if (st.delayMs) await sleep(st.delayMs);

    // Misbehaviour comes first, so it applies whatever was asked.
    if (st.mode === 'drop') return req.socket.destroy();
    if (st.mode === 'error') return message(res, 503, 'stub internal failure: database password is hunter2');
    if (st.mode === 'garbage') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>maintenance page</html>'); }
    if (st.mode === 'wrongShape') return send(res, 200, { unexpected: true });
    if (st.mode === 'redirect') { res.writeHead(302, { Location: 'http://127.0.0.1:9/elsewhere' }); return res.end(); }

    if (st.failOn && url.pathname.includes(st.failOn)) return message(res, 503, 'stub internal failure');
    if (req.headers['x-api-key'] !== apiKey) return message(res, 401, 'Send your partner key as X-API-Key');

    const path = url.pathname;
    let m;

    if (req.method === 'GET' && path === '/api/events') {
      if (url.searchParams.get('status') !== 'upcoming') return message(res, 400, 'status must be upcoming');
      const county = url.searchParams.get('county');
      if (county !== null && !COUNTIES.some((c) => c.toLowerCase() === county.trim().toLowerCase())) return message(res, 400, "county must be one of Kenya's 47 counties");
      return send(res, 200, st.events.filter((e) => e.status === 'upcoming' && (county === null || e.county.toLowerCase() === county.trim().toLowerCase())));
    }
    if (req.method === 'GET' && (m = /^\/api\/events\/([^/]+)$/.exec(path))) {
      const event = st.events.find((e) => e.id === m[1]);
      return event ? send(res, 200, event) : message(res, 404, `Event ${m[1]} not found`);
    }
    if (req.method === 'GET' && (m = /^\/api\/events\/([^/]+)\/roles$/.exec(path))) {
      if (!st.events.some((e) => e.id === m[1])) return message(res, 404, `Event ${m[1]} not found`);
      return send(res, 200, st.roles.filter((r) => r.eventId === m[1]));
    }

    if (req.method === 'POST' && path === '/api/offers') {
      if (body === null || typeof body !== 'object' || Array.isArray(body)) return message(res, 400, 'Request body must be a JSON object');
      const unknown = Object.keys(body).filter((k) => !['roleId', 'workersOffered', 'note'].includes(k));
      if (unknown.length) return message(res, 400, `Unknown field(s): ${unknown.join(', ')}`);
      if (typeof body.roleId !== 'string' || body.roleId.trim() === '') return message(res, 400, 'roleId is required');
      if (!isWhole(body.workersOffered) || body.workersOffered < 1) return message(res, 400, 'workersOffered must be a whole number from 1 to the open slots');
      if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 500)) return message(res, 400, 'note must be a string of 500 characters or fewer');
      const made = newOffer(st, body);
      if (made.status !== 201) return message(res, made.status, made.text);
      return send(res, 201, made.offer, { Location: `/api/offers/${made.offer.id}` });
    }
    if (m = /^\/api\/offers\/([^/]+)$/.exec(path)) {
      const offer = st.offers.get(m[1]);
      if (req.method === 'GET') return offer ? send(res, 200, offer) : message(res, 404, `Offer ${m[1]} not found`);
      if (req.method === 'DELETE') {
        if (!offer) return message(res, 404, `Offer ${m[1]} not found`);
        if (offer.status !== 'pending') return message(res, 409, `Offer ${offer.id} is ${offer.status}`);
        st.offers.delete(offer.id);
        return send(res, 204);
      }
    }
    return message(res, 404, 'Not found');
  }

  return {
    apiKey,
    get url() { return `http://127.0.0.1:${server.address().port}`; },
    get requests() { return state.requests; },
    get offers() { return [...state.offers.values()].map(clone); },
    start(port = 0) {
      server = http.createServer((req, res) => { handle(req, res).catch(() => req.socket.destroy()); });
      return new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    },
    stop() {
      return new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
    },
    reset() { state = freshState(); },
    setMode(mode) { state.mode = mode; },
    failOn(text) { state.failOn = text; },
    setDelay(ms) { state.delayMs = ms; },
    // What the organiser does on Sherehe's own website: decide a pending offer.
    decide(offerId, status) {
      const offer = state.offers.get(offerId);
      if (!offer) throw new Error(`stub has no offer ${offerId}`);
      offer.status = status;
      if (status === 'accepted') {
        const role = state.roles.find((r) => r.id === offer.roleId);
        role.filled = Math.min(role.headcount, role.filled + offer.workersOffered);
      }
    },
    dropOffer(offerId) { state.offers.delete(offerId); },
    fillRole(roleId) {
      const role = state.roles.find((r) => r.id === roleId);
      role.filled = role.headcount;
    },
  };
}

module.exports = { createShereheStub, STUB_KEY: KEY };

if (require.main === module) {
  const stub = createShereheStub();
  stub.start(Number(process.env.STUB_PORT) || 4000).then(() => {
    console.log(`Sherehe stub running on ${stub.url}`);
    console.log(`Use it with:  SHEREHE_API_URL=${stub.url} SHEREHE_API_KEY=${stub.apiKey} npm start`);
  });
}
