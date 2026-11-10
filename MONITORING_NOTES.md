# Monitoring notes: Week 12

Kazi Connect now writes one JSON line for every `/api` request and reports totals at `GET /api/stats` (Endpoint 26). This file holds what we predicted before looking at any numbers, and then what the numbers said.

## Part A: predictions, written before any traffic (2026-11-10)

These were written from knowing the code, before the first line of the log or the first `/api/stats` answer existed.

1. **Slowest endpoint: `POST /api/auth/login`.** It checks a password, and checking a password is deliberately slow work (it is hashed on purpose), while every other endpoint only reads a few rows held in memory or in PostgreSQL. Among the endpoints our traffic script calls, I expect `GET /api/jobs` (a list, filtered and turned into our own field names) to be slower on average than `GET /api/jobs/:jobId` (one row).
2. **Most errors: by rate, `GET /api/jobs/:jobId`.** Our traffic script asks for `job_99999`, which does not exist, as often as for a job that does, so about half of that route's calls should be 404s. By plain count I expect `GET /api/jobs`, `GET /api/jobs/:jobId` and `(no route)` to be close, one call in seven each. I expect **no 5xx at all**, so an error rate of 0%.

## Parts B and C: the log and `/stats`, checked

Run on 10 November 2026 against a private copy of Kazi Connect started from this branch on port 4102 (API keys on, in-memory data). The three requests of the handout, with the real log lines they produced:

```text
{"time":"2026-11-10T14:36:12.303Z","method":"GET","path":"/api/jobs","status":200,"ms":30.2,"caller":"key-5e18d1"}
{"time":"2026-11-10T14:36:12.310Z","method":"GET","path":"/api/jobs","status":401,"ms":1.1,"caller":"none"}
{"time":"2026-11-10T14:36:12.315Z","method":"GET","path":"/api/jobs","status":401,"ms":0.7,"caller":"none"}
```

`grep -c` for the real key in the whole log printed **0**, for the team key **0**, and for the demo password (used for the logins below) **0**. The query string (`?status=active`) is not in any line. The refused calls are there, because the log runs before the key check.

## Parts D and E: what the numbers said

Traffic: `npm run traffic` with `N=120` and a 700 ms pause (Kazi allows each consumer 100 calls a minute), then 20 logins on purpose. Status codes the script received: `200: 72, 401: 17, 404: 31`, with no 429 and no failed connection. `GET /api/stats` then said (own call excluded from the totals, rows shortened):

| Route | Calls | 4xx | 5xx | Average ms | Slowest ms |
|---|---|---|---|---|---|
| `GET /api/jobs` | 67 | 19 | 0 | 3.3 | 33.7 |
| `GET /api/jobs/:jobId` | 39 | 14 | 0 | 2.9 | 10.7 |
| `GET (no route)` | 17 | 17 | 0 | 3.0 | 10.1 |
| `POST /api/auth/login` | 20 | 0 | 0 | 23.8 | 34.3 |

Overall (after the logins): 144 requests including the one to `/stats`, 0 server errors, error rate 0%, average 6 ms.

**Predicted against measured**

1. *Slowest: login.* Confirmed, but only after a deliberate test, because the traffic script does not log in. Login averaged 23.8 ms against about 3 ms for every other route: roughly eight times slower, as expected from password hashing. Among the routes the script does call, `GET /api/jobs` (3.3 ms) was slower than `GET /api/jobs/:jobId` (2.9 ms), the order I predicted, though the gap is small.
2. *Most errors.* By count the three routes were close, as predicted (19, 14 and 17). By rate, `GET /api/jobs/:jobId` was the highest of the routes the script calls: 14 of 39 calls were 404s (36%). I had guessed about half, because the script asks for a missing id as often as for a real one. 36% is lower than that, which is within what a random mix of only 39 calls gives. No 5xx at all, so the 0% error rate was right.

**One real pattern, with figures.** `GET /api/jobs` averaged 3.3 ms but its slowest single call was 33.7 ms, ten times the average, and the first line of the log (30.2 ms) is the first request the server ever received. The average alone would have hidden that.

**Why we think it happens, and what we would check next.** A hypothesis, not yet proved: the first request pays for loading the route's code, which later requests do not. To check it: restart the server, send the same request twice, and compare the two `ms` values in the log; if the second is about 3 ms the first-request cost is confirmed. It matters on the free host, which sleeps when quiet, because every first request after a sleep would then be slow.

**A difference from the handout.** The handout's `(no route)` row holds calls refused before they reach a route (401, 429) as well as 404s. Ours counts a refused call under the path it asked for, so `GET /api/jobs` holds the 401s and `(no route)` holds only paths that are not ours (here, 17 calls to `/api/not-a-route`). We chose this so the stats show which endpoint draws refused calls; the log lines still show the 401s, with caller `none`.

**One alert for production.** `errorRatePercent` above 2% for five minutes: page a person. It is built from 5xx only, so callers' mistakes do not trigger it. While the person fixes the cause, the feature should already be doing what Week 11 built: the Event work page serves saved openings with a banner for up to an hour, and `sherehe.savedDataServed` in the same answer says how often that is happening, so a rising count there is the first sign that Sherehe, not Kazi, is the problem.

**Our partner's traffic (Ujuzi, 10 November 2026).** Ujuzi's team ran its own traffic script against the ring's Kazi with its own key: 60 requests from 15:01:46 to 15:02:28 UTC, 700 ms apart, under our limit of 100 a minute. Its script reported 35 answers of 200, 8 of 401 (the calls it sent on purpose with no key) and 17 of 404 (8 missing jobs, 9 unknown paths), and no 429. Kazi's log for the same window held exactly 60 lines: caller `ujuzi` 200 x35 and 404 x17, caller `none` 401 x8. Route by route (list 15, job 7 + 8 missing, job status 13, unknown path 9, no key 8) the two sides agree, and the two callers have different labels. The 52 keyed calls averaged 4.4 ms, the slowest 12.6 ms. Nothing differed, so there is no bug to log from it.

**Our traffic to Sherehe (10 November 2026).** For Sherehe's monitoring we sent 120 requests with Kazi's own key to Sherehe's Week 12 test copy, from 16:04:24 to 16:05:01 UTC, about 195 a minute (under its 300): `npm run traffic` with `TARGET=sherehe`. Our script received 200 x47, 400 x19, 401 x11 (the calls sent on purpose with no key) and 404 x43, with no 429. Sherehe's own log, for its caller label for our key, held 109 lines in that window with 47 x 200, 19 x 400 and 43 x 404: the same counts, average 3.5 ms, slowest 17.7 ms, no 5xx. The 11 no-key calls were in its log as `none` with 401, but its window held 32 `none` lines, because its own script also sent 20 and made one probe of its stats. They add up (11 + 20 + 1) only because both sides know their own numbers. Sherehe's `/api/stats` counts every 4xx as a client error and only 5xx as a server error, as ours does: 246 requests, 139 client errors, 0 server errors, 0%.

**A limit we share with Sherehe.** A caller with no valid key is labelled `none` in the log, and everyone without a valid key shares that label, so a keyless call cannot be traced to a person. This is on purpose (neither log writes addresses or keys), and it means that when Ujuzi reports a 401 we ask for the time and the request, and look for it among the `none` lines.

