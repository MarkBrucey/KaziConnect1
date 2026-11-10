# Monitoring notes (Week 12)

## What we record, and what we never record (Part A)

Every request that reaches Kazi Connect becomes one line of JSON in the server log (on Render, the service's Logs tab):

```json
{"time":"2026-11-10T14:05:31.112Z","method":"GET","path":"/api/jobs","status":200,"ms":4.2,"caller":"key-3f9c1a"}
```

| We log | We never log |
|---|---|
| time, method, path, status, milliseconds | any API key or login token, even partly |
| `caller`: `key-` plus the first 6 characters of the key's SHA-256, or `none` | passwords, request or response bodies |
| | query strings (`?county=`, `?status=` and anything else people put there) |

The caller label tells our own tests apart from Ujuzi's traffic without writing a key: the same key always gives the same label, and nobody can work the key back out of six characters of its hash.

## Predictions, written before we had any data

1. **Slowest endpoint:** `GET /api/event-openings` (Endpoint 22), because it is the only one that waits for another team's server (Sherehe) over the internet. Everything else only reads our own database. Inside the 5 minute cache it should be as fast as the rest.
2. **Most errors:** `GET /api/jobs/:jobId`, as `404` client errors: any typo or old link to a job that does not exist answers 404, and the traffic script deliberately asks for one. We expect **no 5xx at all** from our own code; the only 5xx we can imagine are 502s from Endpoint 22 when Sherehe is down.

## The traffic (Part D)

Run on 10 November 2026 against a local build of this branch, data in memory, with API keys switched on for two consumers (`team`, our own key, and `ujuzi`, the key we would issue Ujuzi) and the Week 9 rate limit of 100 calls a minute. Full record: `evidence/monitoring/drill_week12.txt`; log lines: `evidence/monitoring/requests_sample.txt`; the `/api/stats` reply: `evidence/monitoring/stats_after_traffic.json`.

* The three-request check (Part B): our key gave `200` with `"caller":"key-f58840"`, a wrong key and no key both gave `401` with `"caller":"none"`. `grep -c` for each key in the log printed **0**, and so did a search for `?status=`.
* `scripts/traffic.js` with our key, N=60: `200` 26, `401` 10, `404` 24. Then N=200 straight after: `200` 35, `401` 8, `404` 14, **`429` 143**.
* **Ujuzi's own code:** Ujuzi's `npm run ring:check` (its `scripts/ringCheck.ts`, unchanged) pointed at this Kazi with the Ujuzi key. Its Kazi steps passed (live read, contract check, apply, WebSocket status, withdraw), and Kazi logged them under a **different label, `key-aea0c0`**: `GET /api/jobs 200`, `POST /api/applications 201`, `DELETE /api/applications/app_1005 204`. Its two Ujuzi steps failed because this drill did not start a Ujuzi server. This was Ujuzi's code run by us, not Ujuzi's sub team running the traffic script against our URL; that live step is still to do with them (see the end of this file).

## What the numbers say (Part E)

`/api/stats` after all of that (78 seconds of uptime): **267 requests, 201 client errors, 0 server errors, error rate 0%, average 3.4 ms.**

| Route | Calls | 4xx | 5xx | avg ms | max ms |
|---|---|---|---|---|---|
| `GET /api/jobs` | 132 | 90 | 0 | 3.2 | 20.0 |
| `GET /api/jobs/:jobId` | 79 | 58 | 0 | 3.0 | 10.2 |
| `GET (no route)` | 53 | 53 | 0 | 3.3 | 12.2 |
| `POST /api/applications` (Ujuzi) | 1 | 0 | 0 | 10.2 | 10.2 |
| `DELETE /api/applications/:applicationId` (Ujuzi) | 1 | 0 | 0 | 10.9 | 10.9 |
| `GET /openapi.yaml` | 1 | 0 | 0 | 61.1 | 61.1 |

### Predicted against measured

1. **Slowest endpoint.** We predicted Endpoint 22 (Event work), because it waits for Sherehe. The traffic script never called it, so this run cannot say. The live measurement from Week 11 can: on 10 November the live Endpoint 22 took **178 to 438 ms** once Sherehe was awake, against about 150 ms for a cached answer, and **over 10 seconds (then a 502) for about 40 seconds while Sherehe woke up** (`evidence/resilience/live_timings_2026-11-10.txt`). So the prediction holds, but only Week 11's data shows it. Among the endpoints this run did call, nothing averaged more than 11 ms; the slowest single request was the first one after start (`/openapi.yaml`, 61 ms).
2. **Most errors.** We predicted `GET /api/jobs/:jobId`, with 404s. **Wrong.** The most errors were on `GET /api/jobs` (90 of 132), and the biggest cause overall was our own rate limit: **143 of the 201 client errors were `429`**, all from the N=200 run. `GET /api/jobs/:jobId` had 58 errors, but only 15 were 404s for `job_99999`; the other 43 were 429s. We did predict **no 5xx**, and that held: 0.

### One real pattern, with figures

The **first request after a start is several times slower than the rest**: `GET /api/jobs` averaged **3.2 ms** over 132 calls, but its slowest call was **20 ms**, and that was the very first `GET /api/jobs` of the run (13:52:03.612); `/openapi.yaml`, the first request of all, took 61 ms. A second, smaller pattern: 45 API calls came with no valid key (`"caller":"none"`); 20 got `401` and the other 25 got `429`. After 20 wrong or missing keys from one address, the Week 9 guard against key guessing (`API_FAILED_KEY_LIMIT`, 20 a minute) answers 429 instead of 401.

### Why we think it happens, and what we would check next

The slow first request is most likely Next.js loading each route's compiled code the first time it is used, plus the first read of `openapi.yaml` from disk. To check, we would restart the server, call each route twice and compare the first and second `ms` for every route: if every route is slow exactly once, it is loading, not data. On Render the same thing is hidden inside a much bigger cold start: the free plan sleeps, and on 10 November waking Kazi took **44 seconds** before the first answer.

We also tested one idea on purpose: does the job list slow down when there are many more jobs? On a fresh server we timed `GET /api/jobs?status=active` 30 times with the 6 sample jobs (median **3.5 ms**, slowest 9.3 ms), posted 500 more jobs, and timed it again with 506 active jobs: median **5.0 ms**, slowest 11.5 ms. So it grows, but slowly, in memory. The live site reads PostgreSQL, so the next check is the same test with `DATABASE_URL` set, and a look at the response size: 506 jobs is roughly 100 KB on every call, which is the strongest argument for paging (and for Week 13's `{ data, count }` shape, which makes paging possible later without another break).

### Are the 401s a mistake or probing?

Here, a mistake by design: all 46 `none` lines came from one address (this machine): the traffic script's "no key" entry, the wrong-key test, and one public `/openapi.yaml` read the drill used to see that the server was up. On the live site we would read the same lines in Render's log and look at how many different addresses they come from, and how fast.

## One alert for production

Watch **`partner.failures`** in `/api/stats` (Sherehe calls that failed after all three attempts). **Alert when it rises by 5 or more within 5 minutes**, by a message to our team chat and to Sherehe's sub team.

Why not the error rate? Because Week 11 changed what a Sherehe outage looks like: once a list has been saved, Endpoint 22 answers `200` with `Kazi-Stale: true`, so **Sherehe can be down for an hour and `errorRatePercent` stays at 0**. The failures are only visible in `partner.failures` (and `partner.savedListServed`). While a person looks into it, the feature is already doing the right thing for employers: showing the saved roles with the banner and the time, and refusing to send offers until Sherehe answers.

## Still to do with the real partner

* Ujuzi's sub team runs `scripts/traffic.js` against the live URL with the key Kazi issued them, so their own traffic shows up under their label. On the live site API keys are still switched off (as agreed in Week 9), so until they are switched on every live caller is `none`, unless it sends a key anyway.
* To read `/api/stats` on the live site, add `STATS_KEY` (any random text of 16 or more characters) to the Render settings. It is not set yet.
