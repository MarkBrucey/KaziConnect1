// Sends a random mix of good requests, missing ids, requests with no key and paths that do not exist, so the
// request log and GET /api/stats (Week 12) have something to show. It can aim at Kazi Connect itself or, with
// TARGET=sherehe, at Sherehe's partner API with Kazi's own key (for Sherehe's monitoring).
//
//   API=http://localhost:4002 KEY=<a key Kazi issued> npm run traffic
//   TARGET=sherehe API=<sherehe address> KEY=<the key Sherehe issued to Kazi> N=120 npm run traffic
//
// N is the number of requests (default 60). PAUSE_MS is the wait between them: 700 ms by default for Kazi, which
// allows each consumer 100 a minute (so no 429s), and 300 ms for Sherehe (about 200 a minute, under its 300).
// Set PAUSE_MS=50 on purpose to see the rate limit answer 429. The key is only ever sent as X-API-Key, never printed.

interface Item { path: string; key: boolean }

const TARGET = (process.env.TARGET || 'kazi').toLowerCase();
const API = (process.env.API || (TARGET === 'sherehe' ? '' : 'http://localhost:3000')).replace(/\/+$/, '');
const KEY = process.env.KEY || '';
const N = Number(process.env.N || 60);
const PAUSE_MS = Number(process.env.PAUSE_MS || (TARGET === 'sherehe' ? 300 : 700));

const MIX: Record<string, Item[]> = {
  kazi: [
    { path: '/api/jobs?status=active', key: true },
    { path: '/api/jobs?status=active', key: true },
    { path: '/api/jobs?status=active&county=Nairobi', key: true },
    { path: '/api/jobs/job_12345', key: true },
    { path: '/api/jobs/job_99999', key: true }, // no such id
    { path: '/api/jobs?status=active', key: false }, // no key at all
    { path: '/api/not-a-route', key: true }, // no such path
  ],
  sherehe: [
    { path: '/api/events?status=upcoming&county=Nairobi', key: true },
    { path: '/api/events?status=upcoming', key: true },
    { path: '/api/events/evt_2001/roles', key: true },
    { path: '/api/events/evt_nope', key: true }, // no such event
    { path: '/api/events?status=upcoming&county=Atlantis', key: true }, // not a county
    { path: '/api/events?status=upcoming', key: false }, // no key at all
    { path: '/api/not-a-path', key: true }, // no such path
  ],
};

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const mix = MIX[TARGET];
  if (!mix) { console.error('TARGET must be kazi or sherehe'); process.exit(2); }
  if (!API) { console.error('Set API to the address to send to, for example API=http://localhost:4001'); process.exit(2); }
  if (!KEY) { console.error('Set KEY to a key the target issued to you (it is sent as X-API-Key and never printed)'); process.exit(2); }
  const counts: Record<string, number> = {};
  for (let i = 0; i < N; i++) {
    const item = mix[Math.floor(Math.random() * mix.length)];
    try {
      const res = await fetch(API + item.path, { headers: item.key ? { 'X-API-Key': KEY } : {} });
      counts[res.status] = (counts[res.status] || 0) + 1;
      await res.arrayBuffer(); // read the answer so the connection is freed
    } catch {
      counts.failed = (counts.failed || 0) + 1;
    }
    await pause(PAUSE_MS);
  }
  console.log(`Sent ${N} requests to ${TARGET}. Status codes received:`, counts);
}

void main();
