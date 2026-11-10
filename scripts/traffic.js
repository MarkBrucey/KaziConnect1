// Week 12: sends a mix of requests to Kazi Connect, to give the request log and /api/stats something to show.
// Good reads, a job that does not exist, a request with no key, and a path that does not exist.
//
// Run it (Node 20.9 or newer, no packages needed):
//   API=http://localhost:3000 KEY=<your-api-key> node scripts/traffic.js
//   API=https://kaziconnect1-1xmu.onrender.com KEY=<the key Kazi issued you> N=200 node scripts/traffic.js
// N is how many requests to send (default 60), 50 ms apart. The key is only sent, never printed.

const API = (process.env.API || 'http://localhost:3000').replace(/\/+$/, '');
const KEY = process.env.KEY || '';
const N = Number(process.env.N || 60);

const mix = [
  { method: 'GET', path: '/api/jobs?status=active', key: true },
  { method: 'GET', path: '/api/jobs?status=active', key: true },
  { method: 'GET', path: '/api/jobs/job_12345', key: true },
  { method: 'GET', path: '/api/jobs/job_99999', key: true }, // no such job
  { method: 'GET', path: '/api/jobs?status=active', key: false }, // no key at all
  { method: 'GET', path: '/api/not-a-route', key: true }, // no such path
];

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const counts = {};
  for (let i = 0; i < N; i++) {
    const r = mix[Math.floor(Math.random() * mix.length)];
    try {
      const res = await fetch(API + r.path, { method: r.method, headers: r.key && KEY ? { 'X-API-Key': KEY } : {} });
      await res.arrayBuffer();
      counts[res.status] = (counts[res.status] || 0) + 1;
    } catch {
      counts.failed = (counts.failed || 0) + 1;
    }
    await pause(50);
  }
  console.log('Status codes received:', counts);
})();
