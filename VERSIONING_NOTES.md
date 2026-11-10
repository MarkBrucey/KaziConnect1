# Versioning notes (Week 13)

## The change (Part A)

**In one sentence:** version 2 of Kazi Connect's job list, `GET /api/v2/jobs`, wraps the list as `{ "data": [...], "count": N }`, and version 1 (`GET /api/jobs`, Endpoints 1 and 2) is deprecated but keeps answering exactly as before.

**Why it is worth a break.** The job list is the one answer that grows: every employer posting and, since Event work, every accepted Sherehe offer adds a job. A bare list cannot carry anything but jobs, so the day we need paging (a page number, a "next" link, a total) we would have to break Ujuzi again. Wrapping it once, now, while there is a single consumer, makes the next change additive.

**Prediction: the exact line in Ujuzi's code that fails.** Ujuzi reads our job list in one place, `listActiveJobs` in `lib/clients/kaziClient.ts` (Ujuzi's `main`, commit 1582365):

```ts
70  const url = `${base('KAZI_API_URL')}/api/jobs?${query}`;
74  if (answer.status !== 200 || !Array.isArray(answer.body)) throw new KaziUnavailableError(`Kazi Connect answered ${answer.status} to the job list`);
75  return answer.body.map(asJob).filter((job): job is KaziJob => job !== undefined);
```

If `/api/jobs` answered the v2 shape, line 74 would throw, because `{ data, count }` is not an array, and Ujuzi's graduates would see no Kazi jobs at all. Because Ujuzi caches the list for 5 minutes, the failure would appear up to 5 minutes after our deploy, which would make it look unrelated to us.

**Checked, not guessed.** We ran Ujuzi's real client, unchanged, against a local build of this branch (`evidence/versioning/drill_week13.txt`):

* against Kazi with this change (v1 still at `/api/jobs`): `OK, 6 jobs, first job_12345`
* against a stand-in for "Kazi after v1 is switched off" (it answers `/api/jobs` with the v2 body): `FAILED with KaziUnavailableError: Kazi Connect answered 200 to the job list`, the message from line 74.

## How v2 sits beside v1 (Part B)

Next.js routes are files, not Express routers, so the handout's `v1.js` and `v2.js` map like this:

| Handout | Kazi Connect |
|---|---|
| the shared data | `lib/jobs.ts`, `findJobList()`: one query and one mapping for every version |
| `v1.js`, frozen | `lib/jobsV1.ts`: a bare list, the empty `400`, wrapped in `deprecated(...)`. Served at `/api/jobs` (`app/api/jobs/route.ts`, the address Ujuzi calls) and `/api/v1/jobs` |
| `v2.js` | `app/api/v2/jobs/route.ts`: `{ data, count }` from the same `findJobList()` |
| `deprecate.js` | `deprecate.ts`: adds `Deprecation`, `Sunset` and `Link` to every answer of a deprecated handler, and changes nothing else |
| `app.use('/', v1)` | `/api/jobs` simply keeps its route file, so old URLs never stopped working |
| mount after `requireApiKey` | every `/api` path goes through `proxy.ts` first, so v2 needs a key exactly like v1 (`versions.test.ts`) |
| `path: req.baseUrl + req.path` | not needed: Next keeps the full path, so the log and `/api/stats` show `/api/jobs`, `/api/v1/jobs` and `/api/v2/jobs` as three rows |

`POST /api/jobs` (Endpoint 14, creating a job) shares the path with v1 but is not deprecated and carries no new headers.

**Sunset date: Tuesday 10 November 2026, midnight in Nairobi** (`Tue, 10 Nov 2026 21:00:00 GMT`). The handout asks for no later than the day before Demo Day, and Demo Day is 11 November. That gives Ujuzi hours, not the months a real company would give, so the notice says plainly that v1 keeps answering until after Demo Day, as the course promises.

## Evidence that v1 did not change (Part C)

1. **The diff.** `v1_before.json` was taken from the branch before any Week 13 edit, `v1_after.json` after (`evidence/versioning/`). `diff v1_before.json v1_after.json` printed nothing: **v1 unchanged**. The headers of the same call now add exactly three lines (`v1_after_headers.txt`).
2. **Tests that stay.** `__tests__/versions.test.ts` (14 tests): v1's exact field names and bare list, `/api/jobs` equal to `/api/v1/jobs` byte for byte, the empty `400` kept, v2's `{ data, count }` with the same jobs in the same order, filters, an empty result, the deprecation headers on v1 only, and v2 refusing a call with no key.
3. **The Express replay.** `parityWithExpress.test.js` still replays the 151 requests recorded from the original Express app, 30 of them on `/api/jobs`, and every answer matches once the three new headers are set aside. A new test there checks that those headers appear on every `GET` and `HEAD` of the job list and on nothing else.
4. **`npm run verify`:** four new checks (v1 headers on both addresses, v2's shape, v2's empty `400`): 89 of 89 pass.

**Our own website moved first.** The home page's job list now reads `/api/v2/jobs`. Checked in a browser on 10 November 2026, keys off and keys on: 6 jobs shown, and the only API call was `GET /api/v2/jobs 200` (`evidence/versioning/website_lists_jobs_from_v2.png`).

## The notice (Part D)

`DEPRECATION_NOTICE.md`, to Ujuzi's sub team: what changes in words they can search for (`/api/jobs`, `Array.isArray(answer.body)`), why, a before and after they can copy, the three exact lines of their own file to change, the three headers, and the date.

**Sent:** TODO, the date and time it was sent to Ujuzi's sub team, and when they replied.

## Receiving a notice from Sherehe (Part E)

**Not received.** By 10 November 2026, 18:45, Sherehe's sub team had sent no deprecation notice, and Sherehe's repository (`main` at 092a94d) has no version 2. So there is nothing to migrate to yet, and we did not write a parser for a v2 nobody has described: a guessed parser would pass our tests and fail on the real thing. Every Sherehe call already goes through one file (`clients/shereheClient.ts`, with the shapes in `mappers.ts`), so a v2 will be one new mapping there plus a setting, as the handout's `partner.js` does. Our Week 11 saved list would hide a broken migration (a parser that throws serves the saved roles with a banner), so the check after switching will be `Kazi-Stale: false` and no `[sherehe]` line in the log.

## Who still uses v1? (Part F)

From the drill on a local build with keys on (`evidence/versioning/stats_who_uses_v1.json`, `joblist_log_lines.txt`):

| Row in `/api/stats` | Calls | Callers in the log |
|---|---|---|
| `GET /api/jobs` | 3 | our own key `key-77383b` (2), Ujuzi's key `key-f7d2fe` (1) |
| `GET /api/v1/jobs` | 1 | our own key |
| `GET /api/v2/jobs` | 3 | our own key (2), Ujuzi's key through the "v1 switched off" stand-in (1) |

**Is Ujuzi still on v1? Yes.** Its `main` calls `/api/jobs` (line 70 above). **Could we switch v1 off today? No:** Ujuzi's graduates would lose every Kazi job. On the live site API keys are still off, so every caller is logged as `none` and `/api/stats` cannot tell Ujuzi from anyone else there; that is one more reason to switch keys on before v1 is ever switched off.

## Reflection

I did not receive a breaking change this week: Sherehe's notice never came, so I cannot honestly say what it felt like to migrate under time pressure. The closest real experience was on 4 November, when my teammate updated events on Sherehe and they did not appear on Kazi. I asked what was wrong, and the cause turned out to be our own 5-minute cache: a refresh after it expired showed them. Nothing had changed shape. A real breaking change would have looked worse: Ujuzi's code would throw at line 74, and our Week 11 fallback would have hidden it behind a "saved data" banner.

Reading my own notice as Ujuzi, the strongest part is that it names their file and line numbers, so they do not have to hunt. What I would change is the timing. A sunset of "tonight" is only acceptable because the course keeps v1 running, and the notice says so. In real life that date would be an outage dressed up as a notice.

As the API owner next time, I would wrap every list in `{ data, count }` from Week 5, before anyone depended on it. Then this whole week would not have been needed. I would also switch API keys on from the start, so `/api/stats` could name who still calls v1 on the live site, not only in a local drill.
