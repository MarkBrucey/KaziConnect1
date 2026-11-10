# Demo Day: Kazi Connect (Week 14, 11 November 2026)

Ring order: **Sherehe, then Kazi Connect, then Ujuzi.** In Sherehe's slot we are their downstream partner (our Event work page calls them). In our slot, Ujuzi calls us.

## Pre-flight check (Part A), run on 10 November 2026

| Check | Result |
|---|---|
| Fresh start works | The branch cloned into a new, empty folder and `sh run.sh` ran with no manual fixes: install, build, `verify` 89 of 89, server up |
| Tests pass | `npm test`: 776 passed, 1 skipped (it needs PostgreSQL); against a local PostgreSQL database, 777 of 777. `npm run typecheck` passes |
| Our integration uses the partner's v2 | **Not possible:** Sherehe has not shipped a v2 or sent a notice (`VERSIONING_NOTES.md`, Part E). We call Sherehe's only version |
| Keys valid both ways | Kazi to Sherehe: the live Event work page answered `200` on 10 November once Sherehe was awake. Ujuzi to Kazi: API keys are off on the live site, so Ujuzi needs none. **Do one real call each way on the morning of the demo** |
| Partner URLs current | Kazi: https://kaziconnect1-1xmu.onrender.com. Sherehe: https://sherehe-r0qm.onrender.com. Ujuzi: deployed to Render on 10 November (its address is on its Render page). All three are on Render, so the venue Wi-Fi does not matter |
| Demo data ready | The live database's jobs (Campus Housing Assistant, Hostel Front Desk Attendant, ...) and the demo logins below. No "test" or "asdf" rows |
| Nothing secret on screen | Never open Render's **Environment** page on the projector; use the **Logs** tab only. Keys live in Render, never in a terminal you show |

## Tonight, after the pull request is merged

1. Wait for Render's deploy to finish (kaziconnect1, **Events**: "Deploy live"), then open https://kaziconnect1-1xmu.onrender.com/api/v2/jobs?status=active. You should see `{"data":[...],"count":...}`.
2. Send `DEPRECATION_NOTICE.md` to Ujuzi's sub team (the full text, not only a link), and ask them to reply when they have read it.
3. Agree the fallback below with Ujuzi's and Sherehe's presenters.
4. Close the three jobs that already have an accepted applicant (Campus Housing Assistant, Student Residence Cleaner, Cafeteria Server): log in to the live Kazi as the demo employer, **Dashboard, Your job postings**, close each one. Otherwise they stay in the job list, and an application from Ujuzi or the website for them gets "already filled" (`INTEGRATION_LOG.md`, row 14).
5. Optional, for showing `/api/stats` live: in Render, add a setting `STATS_KEY` with a long random value (at least 16 characters). Keep it off the projector.

## 15 minutes before our slot

Render's free plan puts every service to sleep. On 10 November Kazi took **44 seconds** to wake, and Sherehe was asleep too. So:

* Open Kazi's (https://kaziconnect1-1xmu.onrender.com), Sherehe's (https://sherehe-r0qm.onrender.com) and Ujuzi's home pages, and wait until each one loads. Ujuzi keeps its data in memory, so it starts each wake with its demo courses again.
* Log in to Kazi as the demo employer (`employer@kaziconnect.demo`, password `KaziDemo2026`). Open **Dashboard, Event work**, and wait until the open roles appear. That wakes Sherehe.
* Open Render's **Logs** tab for kaziconnect1 in a window the audience can see. Each request appears there as one line.

## Our 3 minutes (Part B)

| Time | What to do and say |
|---|---|
| 0:00 | "We are Kazi Connect, casual jobs for students." Read one needs statement: *"Ujuzi needs to read active Kazi jobs in order to show graduates live demand on each course page."* (U1) |
| 0:30 | **Read:** open the home page; the job list comes from `GET /api/v2/jobs`. **Write:** log in as the demo student (`student@kaziconnect.demo`, `KaziDemo2026`) and apply for a job: "Application sent". **Failure:** run the command below the table and say: "Nobody can apply using someone else's account ID. That's our 400." Point at the `400` line in the log |
| 1:30 | **Lifecycle, a few seconds each:** the docs at `/docs`; tests (776, and `npm run verify` 89 of 89 in `VERIFICATION.md`); auth (login tokens; API keys and the rate limit are built, tested and switched off on the live site); monitoring (the log lines on screen); versioning (`curl -s -i .../api/jobs?status=active` shows `Deprecation: true` and the `Sunset` date) |
| 2:00 | **Ujuzi calls us, live.** Ujuzi's presenter opens a course page listing Kazi jobs, and the audience sees `"path":"/api/jobs","status":200` appear in our log. Ujuzi keeps our list for 5 minutes, so ask them to choose a course or county they have not opened in the last 5 minutes. Otherwise the call is answered from their copy and nothing appears |
| 2:45 | **Not finished:** "API keys are off on the live site until Ujuzi's server sends its key. Sherehe hasn't shipped a version 2, so we still call its version 1. A job that is already filled still shows as active until the employer closes it; version 2 of our job list is where we'd fix that." |
| 3:00 | Questions |

The failure command for 0:30 (Git Bash, macOS or Linux):

```bash
curl -s -i -X POST https://kaziconnect1-1xmu.onrender.com/api/applications -H "Content-Type: application/json" -d "{\"jobId\":\"job_12345\",\"studentId\":\"usr_1002\",\"preferredDate\":\"2026-12-01T09:00:00Z\"}"
```

It answers `400` with `studentId usr_1002 is a Kazi Connect account ID. Log in as that student to apply with it.` As a spare failure, `curl -s -i https://kaziconnect1-1xmu.onrender.com/api/jobs/job_99999` answers `404`.

After the demo, open **Your applications** as the demo student and press **Cancel application**, so the next demo starts clean.

**In Sherehe's slot** (before ours), they need us to call them live. Open Event work as the demo employer and **choose a county you have not opened in the last 5 minutes**. Kazi keeps Sherehe's lists for 5 minutes, and a fresh county makes the call reach Sherehe.

## The fallback (agree it with Ujuzi and Sherehe tonight)

Never fake a live call. Say what you see, then use these:

* **Kazi does not answer:** it is probably waking. Say so, and wait up to a minute (it took 44 seconds on 10 November). If it is really down, say so, and show the evidence instead: `evidence/monitoring/requests_sample.txt` (real log lines, with Ujuzi's own code calling us on 10 November) and `evidence/versioning/drill_week13.txt`. Say clearly that they are from 10 November, on a local build.
* **Sherehe does not answer** while Event work is on screen: the page shows the saved roles with the banner "Showing saved roles from ... Sherehe is not responding right now". That is Week 11 working, so say so. With nothing saved, it shows "Event work is unavailable right now. Your jobs are not affected."
* **Ujuzi does not answer:** show our log's lines from Ujuzi's caller label in the drill, and say they are from 10 November.

## Questions we may get

* **"Why does `/api/jobs` still work if it's deprecated?"** The course keeps version 1 running until after Demo Day so nobody's demo breaks. Ujuzi's code still reads it, and we checked that their `kaziClient.ts` line 74 would throw on version 2's shape.
* **"How do you know version 1 didn't change?"** The diff of `v1_before.json` and `v1_after.json` is empty. And 151 answers recorded from the original Express app still match on every test run, apart from the three new headers.
* **"What happens when Sherehe is slow?"** Each read gets 2 seconds, and is tried at most 3 times, with waits of 200 and 400 ms. After about 6.6 seconds at worst, the employer sees the saved list with a banner. Writes are never retried.
* **"Why are API keys off on the live site?"** Ujuzi calls us without a key today. Switching keys on first would cut them off. The keys are built and tested (`SECURITY_AUDIT.md`).
* **"What does `/api/stats` count?"** Every request since the server started, 4xx and 5xx counts, the 5xx error rate, the average time, one row per endpoint, and Sherehe's retries and failures. It starts again from zero on every restart.
