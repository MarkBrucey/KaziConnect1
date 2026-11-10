# Resilience notes: Week 11

What Kazi Connect does when Sherehe, its upstream partner, is slow, fails now and then, or is gone. The feature is Event work (Endpoint 22 reads Sherehe's open roles; 23 and 25 write to it). All numbers below were measured on 10 November 2026; none is estimated. Lines marked **To fill in** wait for something that has not happened yet.

## What was built

* `clients/fetcher.ts`: a timeout on every attempt, at most 2 retries for a read a person is waiting for, a `Retry-After` wait on a 429, and saved data when a cached read still fails.
* `GET /api/event-openings` returns the last good list with an `X-Data-Saved-At` header when Sherehe cannot be asked, and the Event work page shows "Showing saved open roles from ...".
* `helpers/shereheStub.ts`, our stand-in for Sherehe, gained the handout's four modes (`ok`, `slow`, `flaky`, `error`) and `down`, switchable without a restart: `npx tsx helpers/shereheStub.ts`, then `curl <address>/__mode/slow`.

## Part A: the before pictures

The same stand-in, driven through the Kazi from before this work (the ring's copy, commit 7bc9f9b: 10 second timeout, no retries) and the new one, one request each, for a county not read before so that the 5-minute copy cannot answer.

| Stand-in mode | Before | After |
|---|---|---|
| `ok` | 200 in 13.9 ms | 200 in 13.0 ms |
| `slow` (answers after 10 s) | 502 after **10.0 s**: the page hangs, then fails | 502 after **9.6 s** (3 attempts of 3 s, with 0.2 s and 0.4 s between them) |
| `flaky` (fails twice, then works), three reads in a row | 502, 502, 200: **two out of three fail** (4 ms each) | 200, 200, 200, each in 0.61 s, each after exactly 2 retries |
| `error` (always 503) | 502 in 3 ms | 502 in 0.61 s, after 2 retries |
| `down` (connection dropped) | 502 in 5 ms | 502 in 0.61 s, after 2 retries |
| `ok` five minutes after the last good read, then `error` | 502 in 14 ms: nothing to show | **200 in 0.63 s with the saved list** and `X-Data-Saved-At: 2026-11-10T14:45:07.535Z` |
| `ok` again | 200 in 2.7 ms | 200 in 1.9 ms, live, no header, nothing changed |

The server log said why, one line per retry, with the path only (no address, no query, never the key):

```text
[sherehe] attempt 1 of 3 failed (timeout) for /api/events, retrying in 200 ms
[sherehe] attempt 2 of 3 failed (timeout) for /api/events, retrying in 400 ms
[sherehe] attempt 1 of 3 failed (status (HTTP 503)) for /api/events, retrying in 200 ms
[sherehe] attempt 2 of 3 failed (status (HTTP 503)) for /api/events, retrying in 400 ms
```

`GET /api/stats` counted them: `"sherehe": { "retries": 14, "savedDataServed": 1 }` after the run.

## Our numbers, and why

| Setting | Value | Why |
|---|---|---|
| Timeout, a person waiting | **3 s an attempt** | A normal answer took 13 ms from the stand-in and 27 ms from Sherehe's own test copy through Kazi (a live read of 10 openings), so 3 s is more than 100 times normal. That leaves room for a bad moment, and still gives up while a person is waiting. The handout's 1.5 s would also work for this; we chose 3 s so that one slow answer from a freshly restarted Sherehe is not thrown away. |
| Retries | **2**, reads only | A second try a moment later often works (the flaky row above). Never for a POST or DELETE (an offer could be made twice), never for a 4xx other than 429 (asking again changes nothing), never for the background offer check (it asks again every 3 minutes). |
| Delay | **200 ms, then 400 ms** | Short, and longer each time, so a struggling Sherehe is not hit in a tight loop. A 429 waits for its `Retry-After`, up to 5 s. |
| Worst case | **9.6 s** | `(retries + 1) x timeout + delays = 3 x 3000 + 200 + 400 = 9600 ms`. Measured with the stand-in answering after 10 s: 9.609 s. |
| Background offer check | 60 s, no retries | Nobody is waiting, and the next check is 3 minutes away. |
| Saved data | up to 1 hour old | Event openings change slowly, and an hour keeps the banner honest. Older than that, the call fails with the 502 instead. |

We kept the worst case about where it was before (10 s) on purpose: it was the wait the project had already chosen for a person. We know it is long: for a page that normally answers in 30 ms, a person has probably given up by 5 s. The trade is that a Sherehe that is merely slow for a moment still gets a chance. If a shorter worst case is wanted, lower `userTimeoutMs` in `clients/fetcher.ts`: 1.5 s gives 5.1 s.

## What a real user would experience without this code

An employer opens Dashboard, then Event work, to offer workers for a wedding. If Sherehe is slow, the page says "Looking for open roles..." for ten full seconds and then shows the empty "Open roles are not available" box, and the employer has no way to tell whether it is Sherehe or their own connection. If Sherehe is failing now and then, two reloads out of three show that same box even though a second try would have worked, so the employer gives up on a page that was nearly fine. When Sherehe is down for a few minutes, an employer who looked at the roles a minute ago sees nothing at all, although the list had not changed. With this code the first case ends sooner than a person would usually wait, the second never reaches the employer, and the third shows the roles they were just looking at with a line saying when they were saved. They can still see which roles exist, and an attempt to offer still fails honestly with the 502 message, because an offer is never made from saved data.

## What we did not build

A circuit breaker is a switch that stops calling a partner that has been failing for a while and tries it again now and then. Ours still asks Sherehe three times for every read, even in the middle of an outage, as the `error` row shows (0.61 s and 3 calls to Sherehe for every reload); a circuit breaker would answer from saved data at once and leave a struggling Sherehe alone, at the price of noticing its recovery a little later.

## What we tested

Automatically, on every `npm test`: `__tests__/retries.test.js` (37 tests: the numbers, what is retried and what never is, `Retry-After`, saved data and when it is not used, the stand-in's switch) and `__tests__/savedOpenings.test.js` (7 tests through the real server: the header, the same list, the 502 when nothing was saved, an offer never made from saved data, recovery). We broke the code on purpose in six different ways (retrying writes, no `Retry-After` cap, saved data for a refresh or a 401 or after an hour, no doubling of the wait, the rest) and each was caught by a test.

| Failure | What the user saw | What the log said |
|---|---|---|
| Partner stopped (stand-in) | The saved list with the banner, or the "unavailable" box when nothing was saved | `attempt 1 of 3 failed (network...)`, two retry lines, then `[sherehe] a request to Sherehe: ...` |
| Slow | The "unavailable" box after 9.6 s | `attempt 1 of 3 failed (timeout)`, two retry lines |
| Flaky | The list, 0.6 s later than usual | two retry lines, no failure line |
| Always failing (503) | The saved list, or the "unavailable" box | two retry lines, then the failure line |
| Wrong key (401) | The "unavailable" box, not old data | no retry lines: a 401 is never retried, and never hidden behind saved data |

**Not checked:** the banner on the Event work page has not been looked at in a browser. The header that drives it is tested, and the page code passes the source checks and the type check.

## Real partner drill (Part E)

Run on 10 November 2026 against Sherehe's own test copy (port 4101, started by Sherehe's team for this lab, not the ring's Sherehe), through a private copy of Kazi built from this branch (port 4102, API keys on). Sherehe stopped its copy on our word at 14:56:18 UTC and started it again on our word at 14:56:38 UTC; we changed nothing on our side.

| Step | What the user would have seen | Measured |
|---|---|---|
| Normal, 14:50:52 | The open roles | 200 in 27 ms, 10 openings |
| Partner stopped, read at 14:56:25 (5 minutes after the last good read) | The saved roles, with the banner | 200 in 0.63 s after 2 retries, `X-Data-Saved-At: 2026-11-10T14:50:52.293Z` |
| Partner stopped, a county never read | The "unavailable" box | 502 in 0.61 s with our own message |
| Partner stopped, the jobs list | Jobs, as always | 200 |
| Partner back, 14:56:44 | The open roles, banner gone | 200 in 19 ms, no header, no change to the code |

The log lines for the stopped partner: `[sherehe] attempt 1 of 3 failed (network: ECONNREFUSED) for /api/events, retrying in 200 ms`, then `attempt 2 of 3 ... retrying in 400 ms`. Kazi's own counters afterwards: `"sherehe": { "retries": 4, "savedDataServed": 1 }`.

**Being a good consumer:** each read made at most three calls to Sherehe, never a flood. Sherehe recorded the stop and the start from its side. **To fill in:** how many calls Kazi's retries made, as seen in Sherehe's own log, if Sherehe reports it.

**The other direction** (Ujuzi calling Kazi) was drilled the same day: Kazi was stopped at 14:33:16 UTC and started at 14:34:02 UTC on Ujuzi's word, and Ujuzi saw its saved jobs with its flag and recovered; its figures are in its own notes and in `INTEGRATION_LOG.md`.
