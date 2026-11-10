# Integration Log: Week 10 (new ring)

Kazi Connect calling the live API of our upstream partner, **Sherehe** (events), while our downstream partner, **Ujuzi** (skills training), calls ours. The ring: Sherehe -> Kazi Connect -> Ujuzi -> Sherehe.

**The feature:** **Event work** on the employer dashboard (Endpoints 22 to 25, need W7). An employer sees the open staffing roles on upcoming Sherehe events and offers Kazi Connect workers for one; when the organiser accepts, a job opens for that employer and appears in the listings Ujuzi reads. That is our need from Sherehe, K1 to K5 in `API_NEEDS.md`. The browser asks only our server; only our server calls Sherehe (`clients/shereheClient.ts`), sending the key Sherehe issues to us in `X-API-Key`. The key lives in `SHEREHE_API_KEY` (Render's settings, or `.env`), never in git, the browser or the log.

**Honesty rule for this log:** every entry says whether it happened against **Sherehe's real API** or against our **stand-in** (`helpers/shereheStub.ts`), which answers from the examples in Sherehe's draft contract. Nothing here is invented. Lines marked **To fill in** wait for something that has not happened yet.

## 1. Preflight (Part A)

Checked on 28 October 2026 at 05:27 UTC with `npm run ring:status` and `npm run ring:check` (real runs; the output is quoted in section 2).

| What the first call needs | Status |
|---|---|
| Sherehe's base address, and confirmation it is running | **Two, both on this laptop** (so reachable only from it, and not on Render yet: the live deployment is being done by the team). Sherehe's own test copy for this lab, `http://localhost:4101` (checked running on 10 November 2026 at 14:56 UTC), and the ring's Sherehe, `http://localhost:4001`, which we use day to day. **To fill in:** the Render address, when it exists |
| Our key from Sherehe | For the local ring the key was made on this machine by the ring's setup in late October; Sherehe holds only its hash and we hold the key in Kazi's own settings file (never in git, never in this log). It is accepted by both copies above. **To fill in:** the date the Render key arrives, and who received it |
| The header name for the key | `X-API-Key`. Confirmed with real calls on 10 November 2026 (section 2): 200 with the key, 401 without it. **To fill in:** confirmation from their final contract or README |
| Their contract and README, open in a tab | We hold their **draft** contract, version 0.1.0. Our three open questions about it are in `CONTRACT_QUESTIONS.md`. **To fill in:** the version they finally hand off |
| A live channel, and a contact on each side | Messages between the three systems' windows on this laptop: Kazi's contact is the Kazi window, Sherehe's is the Sherehe window (and Ujuzi's the Ujuzi window); each window's name changes when it restarts, so the log names the system, not the window. All three keep their own copies and push nothing |
| Our check in slot | **To fill in** |

## 2. The first call, outside our app (Part B)

**Made on 10 November 2026, see below.** On 28 October there was no address and no key, and our own tools said so (`ring:check`: "Sherehe has not been deployed or has not issued a key yet: this is a part not set up, not a failure"). Both exist now on this laptop, and the first call was made from a terminal, before opening our app, against Sherehe's own test copy.

The call is K1, the first thing Event work needs (address and key come from `SHEREHE_API_URL` and `SHEREHE_API_KEY`):

```text
curl -i -H "X-API-Key: $SHEREHE_API_KEY" "$SHEREHE_API_URL/api/events?status=upcoming"
```

The result, from a real run:

| | Result |
|---|---|
| When, and from which machine | 10 November 2026, 14:56:58 UTC, from this laptop (against Sherehe's test copy on port 4101) |
| Status code (200 expected; 401 means the key or the header name is wrong) | **200**, `content-type: application/json` |
| Body (first event only) | 6 upcoming events in the list. The first one has exactly these fields: `id`, `name`, `type`, `county`, `area`, `venue`, `startsAt`, `endsAt`, `expectedGuests`, `status` |
| `id`, `name`, `county`, `area`, `startsAt`, `status` present, with the types in their contract | Yes: all are present and the types are as their contract says (text, except `expectedGuests`, a whole number) |
| Same call without the key (should be 401: shows their key check works) | **401**; a wrong key is **401** too |
| `GET /api/events/{eventId}/roles` for that event (K2) | **200**, 1 role with `id`, `eventId`, `title`, `category`, `headcount`, `filled`, `shiftStart`, `shiftEnd`, `payPerShift` (as in their contract). An event that does not exist: **404**. An unknown county: **400**. `include=roles`: one call gives all 6 events, each with its roles |
| `npm run test:partner` (our tests of Sherehe, written from their contract alone) | **To fill in.** Not yet run against a real address. So far run only against our stand-in: 35 passed, 1 skipped (`PARTNER_TEST_RESULTS.md`) |
| `npm run ring:check` | Passed 5 of 5 against the ring's Sherehe on 4001 earlier in this project (the ring is not running at this moment). **To fill in:** a run dated after this log entry |

One surprise in that first answer, not a bug: Sherehe's reply says `access-control-allow-headers: Content-Type, Authorization, X-API-Key`, so a browser may send the key to Sherehe, while ours does not allow it to Kazi (row 7 below). It also lists `X-Data-Stale` and `X-Data-As-Of` as headers a browser may read, which are Sherehe's own saved-data signals; Kazi does not pass them on.

If it fails, use the debugging ladder: can we reach it at all, what status comes back, then compare the body with their contract.

## 3. How we built while waiting

The handout says to build against a small stand-in that returns the example responses from the partner's contract, and to switch the address once they are live. That is `helpers/shereheStub.ts` (`npx tsx helpers/shereheStub.ts`, port 4000). It answers K1 to K5 from Sherehe's draft contract, checks our key, and can be told to fail on purpose (down, slow, wrong shapes). The automated tests (`__tests__/eventWork.test.js`, 94 tests) and `npm run verify` (37 checks for Endpoints 22 to 25) use it.

Switching to Sherehe's real API means setting `SHEREHE_API_URL` and `SHEREHE_API_KEY` in Render's settings and in `.env`. No code changes.

## 4. Bugs and surprises

One row per bug or surprise, whoever's code it was in.

| # | What broke (symptom) | Root cause | Fix | Whose code, and who fixed it |
|---|---|---|---|---|
| 1 | Practice drill, stand-in (first seen 27 October 2026, seen again 28 October): we stopped the stand-in and reloaded Event work, and **the same open roles were still shown**, as if Sherehe were up | Not a bug: our server keeps Sherehe's event and role lists for 5 minutes (`clients/fetcher.ts`), so a reload within 5 minutes is answered from that copy. Asking for a county not seen yet (Mombasa) called Sherehe and showed "Open roles are not available" at once | None needed. Lesson for the live demo: after stopping Sherehe, pick another county (or wait 5 minutes) before saying the page shows the failure. Before saying "the partner is down", curl it and see | Ours (by design) |
| 2 | 27 October 2026, while one of us was adding API keys on a separate Week 9 branch: with the keys only in `.env`, the server started saying `API keys: none set`, so every API call would have answered 401 | Next.js reads `.env` only once it has started, which is after our server had already read its settings | Solovea found and fixed the same root cause the same day (`bootstrapEnv.ts` now loads `.env` with Next's own loader before anything reads a setting; commit 69b1fed on `uat`), and her Week 9 work on `uat` replaced that separate branch. Checked again on 28 October 2026 on this branch: with `API_KEYS` only in `.env`, the server says `API access: API keys required: 2 loaded (website, team); rate limit on`, a call with no key gets 401 and a call with a key from `.env` gets 200 | Ours; fixed by Solovea |
| 3 | Surprise for Ujuzi, our downstream: once keys are switched on at the live address, every call to us needs `X-API-Key`, and that header is **not** allowed in a browser's cross-site request, on purpose | A key in a web page can be read by everyone who opens it, so a partner must call us from its own server (`CONTRACT_DEVIATIONS.md`, Week 9: the CORS headers are unchanged) | Ujuzi calls us from its own server (its team confirmed this on 5 November 2026), so nothing has to move. See also row 7 | Ours (a decision), to agree with Ujuzi |
| 4 | A job could end up with **two accepted applicants** (found by our team on the old ring's website; the same code came across to the new ring) | A job has one place, but nothing enforced it: Reopen job was allowed on a filled job, and accepting checked only that the request was waiting | On this branch: reopening a filled job answers 409, accepting a second applicant answers 409, a new request for a filled job is told it is filled, and a unique index in PostgreSQL makes sure (`CONTRACT_DEVIATIONS.md`, "A job has one place"). Seen working in a browser on 28 October 2026 with keys switched on (`evidence/week10/one_place_job_filled_no_reopen.png`, notes in `evidence/week10/browser_check.txt`) | Ours, fixed by us |
| 5 | Surprise: Sherehe's contract is still a draft (0.1.0) and three questions about it are open (`CONTRACT_QUESTIONS.md`) | Their contract is not final | **To fill in:** their answers, and any change Event work needs | Theirs (contract) |
| 6 | 27 to 28 October 2026, local ring with the real Sherehe (not a stand-in): offering for a role added at Sherehe in the last 5 minutes sometimes failed, and a burst of offers made Sherehe answer **429** | Our code, and Sherehe's limit, both. Re-reading Sherehe's lists for a role missing from our 5-minute copy cost one call for the events plus one for each upcoming event (about 36), and we allowed three re-reads in a row, over Sherehe's 100 calls a minute. Before that, a first throttle of ours (one re-read per 15 seconds) answered a wrong **404** "no such role" for a role that did exist | Ours: re-reads are limited to 2 in a row and then 1 a minute, a refused re-read answers our own 502 and never a false 404 (`clients/fetcher.ts`). Sherehe's: its partner limit was raised from 100 to 300 a minute, and it added `include=roles` so the same re-read is one call, which Kazi now uses. Their log showed the 429s at the time | Both; fixed by each in its own code |
| 7 | 5 November 2026, Ujuzi's team asked a browser-style preflight of our API (`OPTIONS /api/jobs` with `Origin`, asking for `x-api-key`): the answer allows `Content-Type, Authorization` but **not** `X-API-Key`, so a web page calling Kazi directly with the key would be blocked by CORS | By design, and unclear in the contract: Endpoints 1 to 21 keep today's CORS headers exactly, and Week 9 deliberately left them alone, so keys are for server-to-server calls. No document said so in one place | No code change. The sentence "keys are for systems that call from their own server" is now in the API key description in `openapi.yaml` (1.4.0) and in `CONTRACT_DEVIATIONS.md`. Ujuzi calls from its server, so it is not affected. Note Sherehe's own answer does allow `X-API-Key` (section 2) | Ours (contract wording); found by Ujuzi, fixed by us |
| 8 | Our log has a Node warning, `MaxListenersExceededWarning: 11 statusChanged listeners`, when Ujuzi follows many applications | Each follower of Endpoint 6 adds two listeners to one shared emitter and the code removes them when the socket closes, so it is not a leak. Ujuzi opens one WebSocket per pending application and had 14 pending in its ring database on 5 November, above Node's default limit of 10. Ujuzi has not yet confirmed a live count at the moment of the warning | **Not fixed.** It is noise, not a fault; raising the limit on that emitter is a small change we have not made | Ours (a warning), cause suggested by Ujuzi's data |
| 9 | 10 November 2026, found while drilling Week 11: our stand-in Sherehe could not be switched out of `error` or `down` by its own `/__mode/` switch (the switch was handled after the failure modes), and a `slow` stand-in made the switch itself wait 10 seconds. The first run of the drill was wrong because of it | Order of checks in `helpers/shereheStub.ts` | The switch is now answered first, whatever mode the stand-in is in, and a test switches it back from every bad mode. The first run was thrown away and the drill rerun; the figures in `RESILIENCE_NOTES.md` are from the rerun | Ours (a test tool), fixed by us |
| 10 | 10 November 2026, Week 12: Ujuzi sent 60 requests to Kazi with its own key (15:01:46 to 15:02:28 UTC, paced under our limit). Tested on purpose: no key, a missing job id, an unknown path | Nothing wrong: Kazi's request log held the same 60 requests with the same statuses (ujuzi: 200 x35, 404 x17; none: 401 x8), no 429 | None needed. Recorded as tested, as expected | Both |
| 11 | 10 November 2026, Week 12: we sent 120 requests to Sherehe's test copy with our own key (16:04:24 to 16:05:01 UTC, under its limit). Tested on purpose: an unknown event id, an unknown county, no key, an unknown path | Nothing wrong: Sherehe's log held the same 109 keyed lines with the same statuses (200 x47, 400 x19, 404 x43), no 429, no 5xx. Surprise, shared by both logs: calls without a valid key are all labelled `none`, so our 11 no-key calls could not be told apart from Sherehe's own 21 in the same window | None needed (it is by design: no addresses or keys in a log). Noted so that a 401 reported later is looked for by time and request | Both |

## 5. What we tested on purpose

All of these ran on 28 October 2026 against our **stand-in**, not the real Sherehe (`npm run verify`, 82 of 82 checks passed, `VERIFICATION.md`). In every case our server stayed up and Endpoints 1 to 21 kept answering.

| Test | What our app answered |
|---|---|
| Open roles on upcoming events; filtered by county in any letter case; a county with no events | 200 each, with our own field names |
| Sherehe down, while an employer lists roles | 502 with our own message; nothing of Sherehe's reply passed on |
| Sherehe down, while an employer offers workers | 502, and nothing is kept on our side |
| Sherehe down, while an employer withdraws an offer | 502, and the offer stays |
| Sherehe down, while an employer lists their own offers | 200: this reads only our database |
| A role that filled up at Sherehe after it was listed | 409 |
| The organiser accepted an offer just before the employer withdrew it | 409 |
| After our poller asked Sherehe and the offer was accepted | 200, the offer shows `accepted` with the job it opened. That the job then appears in Endpoints 1 and 2 is checked in `__tests__/eventWork.test.js` |

The same cases, and more (wrong key, slow answers, wrong shapes), run on every `npm test` (`__tests__/eventWork.test.js`, `shereheClient.test.js`, `offerPoller.test.js`, `fetcher.test.js`). On 28 October 2026 `npm test` passed 671 tests with 1 skipped (the one that needs PostgreSQL), and all 672 passed against a local PostgreSQL database.

## 6. Failure drill in the browser (Part D)

**Practice run, 28 October 2026, against the stand-in**, in Chromium, on this branch with API keys switched on, logged in as the demo employer. Screenshots are in `evidence/week10/`; the run's own notes are in `evidence/week10/browser_check.txt`.

1. With the stand-in running, Event work listed the open roles on the Wanjiku and Otieno wedding (`practice_1_sherehe_standin_up.png`).
2. We stopped the stand-in and reloaded. The same roles were still shown, from our 5-minute copy (`practice_2a_sherehe_stopped_but_cached_roles_still_shown.png`; bug and surprise 1). We picked Mombasa, which had not been asked for yet: the page showed "Open roles are not available" with a Try again button (`practice_2_sherehe_stopped.png`), and the job listings still loaded (`practice_2b_jobs_still_listed_while_sherehe_is_down.png`). The server log said why: `[sherehe] a request to Sherehe: network: ECONNREFUSED`.
3. We started the stand-in again and pressed Try again. The Mombasa roles (Coast Tech Summit) appeared, with no change to our code or settings (`practice_3_sherehe_back.png`).

**Real partner drill, 10 November 2026.** The same three steps, against Sherehe's own test copy (port 4101, started by Sherehe's team for this; the ring's Sherehe was not touched), through a private copy of Kazi built from this branch (port 4102, keys on). The partner stopped only on our word, and restarted only on our word.

| Time (UTC) | Step | What Kazi answered |
|---|---|---|
| 14:50:52 | Live read, all counties | 200 in 0.027 s, 10 openings, no `X-Data-Saved-At` header |
| 14:56:18 | Sherehe stopped the copy (confirmed by them, and by us: nothing listening) | |
| 14:56:25 | Same read, 5 minutes after the last good one | **200 in 0.63 s**, the same 10 openings, `X-Data-Saved-At: 2026-11-10T14:50:52.293Z` |
| 14:56:26 | A county never read before (Kisumu) | **502 in 0.61 s** with our own message, nothing saved to show |
| 14:56:26 | `GET /api/jobs?status=active` | 200: Endpoints 1 to 21 do not notice |
| 14:56:38 | Sherehe started the copy again (no code change) | |
| 14:56:44 | Same read, no change on our side | **200 in 0.019 s**, no header: live again. Kisumu: 200 in 0.004 s |

The log said why, in two retry lines for each read: `[sherehe] attempt 1 of 3 failed (network: ECONNREFUSED) for /api/events, retrying in 200 ms` and `attempt 2 of 3 ... retrying in 400 ms`, then `[sherehe] a request to Sherehe: network: ECONNREFUSED` for the read that had nothing saved. The earlier drill against our own stand-in, with figures for slow, flaky and always-failing, is in `RESILIENCE_NOTES.md`. The Event work page's banner was not looked at in a browser.

## 7. Being a good provider to Ujuzi (Part E)

* Once keys are switched on at the live address, every call needs a key. Ujuzi gets its own key, by direct message to one named person, never in a repository or a channel. Its calls are counted separately from everyone else's, 100 a minute by default (`README.md`, "API keys and rate limits").
* Our server answers a refused call (401 or 429) before any handler runs, and does not write it to the log today. So when Ujuzi reports a 401 or 429, we ask for the time and the request, and check the key and the limit settings on our side.
* One change on this branch is visible to Ujuzi: a request for a job that is open but already has an accepted applicant answers `409` with a message saying the job is filled (before, the same `409` was only for closed jobs). Nothing else Ujuzi uses changes: same paths, fields and status codes.
* Under requirement R4, Endpoints 1 to 9 stay open for Ujuzi unless both sub-teams agree. Solovea recorded the agreement of the person who runs all three systems on 27 October 2026 (`CONTRACT_DEVIATIONS.md`, Week 9). **To fill in:** the date Ujuzi's sub-team confirmed, the date it received its key, and the date it confirmed its calls work. Keys must not be switched on at the live address before that.

Bugs Ujuzi reports, in the same format as section 4:

| # | What broke (symptom) | Root cause | Fix | Whose code, and who fixed it |
|---|---|---|---|---|
| P1 | Ujuzi's preflight of our CORS answer (5 November 2026): `X-API-Key` is not in `Access-Control-Allow-Headers` | By design: keys are server-to-server | Contract wording clarified, no code change (row 7 in section 4) | Ours; found by Ujuzi |
| P2 | **To fill in:** every other problem Ujuzi reports, including any that turn out to be in our code | | | |

Ujuzi's own failure drill against us, **10 November 2026**: we stopped Kazi (the ring's copy, port 4002) at 14:33:16 UTC on Ujuzi's word and started it again at 14:34:02 UTC on Ujuzi's word, changing nothing in between. Ujuzi reported what it saw while we were down: saved jobs with its flag for two courses, a clear message for a course it had never read, its other routes still answering 200, and its own log saying `kazi GET /api/jobs failed: ECONNREFUSED` with 2 retries. **To fill in** (Ujuzi's side): that live data returned after the restart. A first attempt on 5 November 2026 was never finished from Ujuzi's side (its windows restarted before it said "start") and was repeated from the top; nothing was lost.

## 8. Demo script (Part F)

1. **Live data:** with `SHEREHE_API_URL` and `SHEREHE_API_KEY` set to Sherehe's real address and our key, run `npm start`. The startup line `Event work (Sherehe): https://...` shows the address (never the key). Log in as an employer, open Dashboard, then Event work: the open roles come from Sherehe.
2. **Partner down:** Sherehe stops their server (or we set `SHEREHE_API_URL=http://localhost:4999` and restart ours). Pick a county not shown yet, or wait 5 minutes (our copy of their lists lasts that long). The page shows "Open roles are not available", the job listings still work, and the log shows `[sherehe] ... ECONNREFUSED`.
3. **Partner back:** they start their server again (or we put the real address back and restart). Press Try again: the roles return.

Before the demo, curl their address once to be sure it is really up, and stop any stand-in still running on port 4000.

## 9. Messages ready to send

**To Sherehe**, in the handout's bug report format:

> **What I did:** prepared to call `GET /api/events?status=upcoming` on your API for the Week 10 integration, using your draft contract (version 0.1.0).
> **What I expected:** your live address, and an API key issued to Kazi Connect, sent in `X-API-Key`, as Week 9 describes.
> **What I got:** neither yet, so we have built and tested against a stand-in made from your contract's examples. Switching to you needs only your address and our key in our settings.
> **Questions:** please send the address, and the key privately to (our contact) by direct message. Is your contract still 0.1.0, or is there a newer one? Our three questions about it are in our `CONTRACT_QUESTIONS.md`.
> **When:** (time), from (machine).

**To Ujuzi** (the key itself goes separately, by direct message to one person, never in this message):

> Kazi Connect can now require an API key (Week 9). Once we switch it on at our live address, every call to us needs your key in the `X-API-Key` header; without it you get `401 {"message":"Missing or invalid API key"}`. Your key will come to (your contact) by direct message. Each consumer may send 100 requests a minute; past that you get `429` with a `Retry-After` header saying how many seconds to wait. Please call us from your server, not from a browser: the key must not be in a web page, and browsers are not allowed to send it to us. One more change: a request for a job that is open but already has an accepted applicant now answers `409` with a message saying the job is filled. No path or field you use has changed. We will not switch keys on until you confirm you are ready. If you see any 4xx from us, send us the request and the time, and we will check it on our side.
