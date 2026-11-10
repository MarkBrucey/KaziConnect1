# Resilience notes (Week 11)

Kazi Connect's feature that depends on an upstream partner is **Event work** (Endpoint 22, `GET /api/event-openings`): the employer's dashboard lists staffing roles on upcoming events, read live from **Sherehe**. Every Sherehe call goes through one file, `clients/fetcher.ts`, so that is where the timeout and the retries live. The saved list lives in `lib/savedOpenings.ts`, and the banner is on the Event work page (`components/EventWork.tsx`).

## The "before" pictures (Part A)

Run on 10 November 2026 against a stand-in Sherehe (`scripts/flakySherehe.js`, the handout's four modes in Sherehe's own shapes), with the code that was on `uat` before this week (1.3.1). Full output: `evidence/resilience/drill_before_week11.txt`.

* **Normal:** the stand-in answered in 2 to 8 ms, and the whole Event work call took 12 to 41 ms.
* **Slow:** the employer waited **10,013 ms** and then got "Event information is unavailable right now". Kazi already had a 10 second timeout from Week 10, so the page never hung forever, but 10 seconds is a long time to stare at "Looking for open roles...".
* **Flaky:** loads 1 and 2 failed with 502 and load 3 worked. **Two loads out of three failed** although a second attempt a moment later would have worked.

## What we tested, after the change

Same drill, same stand-in, on this branch. Full output: `evidence/resilience/drill_after_week11.txt`. Screenshots: `evidence/resilience/`.

| Failure | What the employer saw | What Kazi's log said |
|---|---|---|
| Normal | Live roles in 10 to 46 ms, no banner | nothing |
| Flaky (fails twice, then works) | Live roles after about 615 ms, no banner, on **all three** loads | `[partner] GET /api/events attempt 1 of 3 failed (HTTP 503), retrying in 200 ms` then the same for attempt 2 with 400 ms |
| Slow (10 s answers) | The saved roles after **6,619 ms**, with the banner "Showing saved roles from (the time they were saved). Sherehe is not responding right now..." | two `retrying` lines with `(timeout)`, then `[sherehe] event openings (served the saved list instead): timeout` |
| Error (always 500) | The saved roles after 618 ms, with the banner | exactly **two** retries, then `served the saved list instead: status (HTTP 500)` |
| Partner stopped (stand-in killed) | The saved roles after 614 ms, with the banner (`2_sherehe_stopped_saved_roles_with_banner.png`) | two retries with `(network: ECONNREFUSED)`, then `served the saved list instead: network: ECONNREFUSED` |
| Kazi restarted, Sherehe slow (nothing saved) | After 6,628 ms the friendly box "Open roles are not available. Event work is unavailable right now. Your jobs are not affected." with a Try again button (`3_restarted_nothing_saved_friendly_message.png`) | two retries, then `[sherehe] a request to Sherehe: timeout` |
| Sherehe back | Live roles in 24 ms, banner gone, no code changed | nothing |

No line in the log contains the key, a query string, or anything Sherehe wrote in its error body. The automated versions of every row are in `__tests__/resilience.test.js` (27 tests).

## Our numbers, and why

| Setting | Value | Why |
|---|---|---|
| Timeout per attempt, a person waiting | **2,000 ms** | Measured on 10 November 2026 through the live Endpoint 22 (`evidence/resilience/live_timings_2026-11-10.txt`): once awake, Sherehe added 22 to 282 ms and the whole call took 178 to 438 ms. 2 seconds is more than four times the slowest normal answer. |
| Retries | **2** (3 attempts at most), reads only | The handout's cap. Writes (making or withdrawing an offer) are never retried. |
| Wait between attempts | **200 ms, then 400 ms**; a 429 waits for Sherehe's `Retry-After`, at most 5 s | Short, and longer each time, so a struggling Sherehe gets at most three calls per page load, never a flood. |
| Worst case for the employer | **3 × 2,000 + 200 + 400 = 6,600 ms** | Inside the 10 second budget the page already had before this week (a shared deadline still stops everything at 10 s). The drill measured 6,619 ms. |
| Background (the offer poller) | 60,000 ms per attempt, same retry rules | Nobody is waiting, and this long timeout is what lets Kazi wake a sleeping Sherehe. |

The same live measurement showed the failure that matters most for us: **Sherehe sleeps on Render's free plan.** The first four calls failed after about 10 seconds each while it woke up, roughly 40 seconds in all, and then every call took under half a second. No timeout a person could bear gets through that wake up, so for us the saved list matters more than the retries.

## What a real employer would go through without this code

A hotel manager in Westlands opens the Event work tab on her dashboard to find catering roles for a December wedding. Sherehe has just been redeployed and drops two requests. Before this week she got "Event work is unavailable right now" twice in a row and, quite reasonably, assumed the feature was broken and closed the tab. On a slow Sherehe she watched "Looking for open roles..." for ten seconds before the same message. Now the flaky case is invisible to her (about 0.6 seconds), and in the slow or down case she sees the roles she saw earlier within 7 seconds, clearly marked as saved with the time, so she can plan who to offer and come back to send the offer when Sherehe answers.

## What we did not build

A **circuit breaker** would notice that Sherehe has failed, say, five times in a row and stop calling it for a minute, serving the saved list at once instead of making every employer wait up to 6.6 seconds and sending Sherehe three calls per page load while it is already struggling; ours still tries every request up to three times.

## Still to do with the real partner (Part E)

The drill above used the stand-in. **The live drill with Sherehe's sub team (they stop their server, we watch the banner appear, they restart it) has not been done yet**, and these notes will be updated with its results when it is. Until then the closest real evidence is the live measurement above, where the real Sherehe was asleep and Kazi's live 1.3.1 answered 502 for about 40 seconds.

## Two honest limits

* The saved list lives in memory, so a restart (or a Render deploy) clears it. That is fine for this course; production would keep it in a cache or the database.
* A saved list hides a failure from employers, so it could hide a wrong key (Sherehe answering 401). The log still records every failure, so the log is where we look.
