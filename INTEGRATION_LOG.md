# Integration Log: Week 10 (new ring)

Kazi Connect calling the live API of our upstream partner, **Sherehe** (events), while our downstream partner, **Ujuzi** (skills training), calls ours. The ring: Sherehe -> Kazi Connect -> Ujuzi -> Sherehe.

**The feature:** **Event work** on the employer dashboard (Endpoints 22 to 25, need W7). An employer sees the open staffing roles on upcoming Sherehe events and offers Kazi Connect workers for one; when the organiser accepts, a job opens for that employer and appears in the listings Ujuzi reads. That is our need from Sherehe, K1 to K5 in `API_NEEDS.md`. The browser asks only our server; only our server calls Sherehe (`clients/shereheClient.ts`), sending the key Sherehe issues to us in `X-API-Key`. The key lives in `SHEREHE_API_KEY` (Render's settings, or `.env`), never in git, the browser or the log.

**Honesty rule for this log:** every entry says whether it happened against **Sherehe's real API** or against our **stand-in** (`helpers/shereheStub.ts`), which answers from the examples in Sherehe's draft contract. Nothing here is invented. Lines marked **To fill in** wait for something that has not happened yet.

## 1. Preflight (Part A)

Checked on 28 October 2026 at 05:27 UTC with `npm run ring:status` and `npm run ring:check` (real runs; the output is quoted in section 2).

| What the first call needs | Status |
|---|---|
| Sherehe's base address, and confirmation it is running | **Not shared yet.** `.env.example` still holds the placeholder `https://sherehe-TODO.onrender.com`, and `ring:status` reports Sherehe as `NOT-CONFIGURED` (held issue H-1 in `evidence/ring/HELD_ISSUES.md`). **To fill in:** the address, and whether it is on Render (reachable from our server) or on a laptop (same network only) |
| Our key from Sherehe | **Not issued yet** (held issue H-5). **To fill in:** the date it arrived, and who on our side received it (by direct message, never in a channel) |
| The header name for the key | `X-API-Key`, from Sherehe's draft contract (`partner-tests/sherehe_openapi.yaml`, version 0.1.0). **To fill in:** confirmation from their final contract or README |
| Their contract and README, open in a tab | We hold their **draft** contract, version 0.1.0. Our three open questions about it are in `CONTRACT_QUESTIONS.md`. **To fill in:** the version they finally hand off |
| A live channel, and a contact on each side | **To fill in:** our contact, their contact, and the channel |
| Our check in slot | **To fill in** |

## 2. The first call, outside our app (Part B)

**Not made yet: there is no address and no key.** This is what our own tools say today (real output, 28 October 2026, shortened to the lines that matter):

```text
$ npm run ring:check
Cannot run the ring check: SHEREHE_API_URL (still empty or a TODO placeholder) and SHEREHE_API_KEY not set. Sherehe has not been deployed or has not issued a key yet: this is a part not set up, not a failure.

$ npm run ring:status
Kazi Connect (live): OLDER-CONTRACT   https://kaziconnect1-1xmu.onrender.com
  - pending-deploy live contract [200]: live is on 1.2.1 but this checkout is 1.3.0
  - ok             Endpoint 1 [200]: 8 active job(s), all matching the contract
  - pending-deploy Endpoint 22 exists [404]: not deployed yet
Sherehe (upstream): NOT-CONFIGURED
Ujuzi (downstream): NOT-CONFIGURED
```

When the address and key arrive, put them in `.env` (`SHEREHE_API_URL`, `SHEREHE_API_KEY`) and make this call in a terminal **before** opening our app. It is K1, the first thing Event work needs:

```text
curl -i -H "X-API-Key: $SHEREHE_API_KEY" "$SHEREHE_API_URL/api/events?status=upcoming"
```

Then record the result here whether it worked or not:

| | Result |
|---|---|
| When, and from which machine | **To fill in** |
| Status code (200 expected; 401 means the key or the header name is wrong) | **To fill in** |
| Body (first event only) | **To fill in** |
| `id`, `name`, `county`, `area`, `startsAt`, `status` present, with the types in their contract | **To fill in** |
| Same call without the key (should be 401: shows their key check works) | **To fill in** |
| `GET /api/events/{eventId}/roles` for that event (K2) | **To fill in** |
| `npm run test:partner` (our tests of Sherehe, written from their contract alone) | **To fill in.** So far run only against our stand-in: 35 passed, 1 skipped (`PARTNER_TEST_RESULTS.md`) |
| `npm run ring:check` | **To fill in** |

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
| 3 | Surprise for Ujuzi, our downstream: once keys are switched on at the live address, every call to us needs `X-API-Key`, and that header is **not** allowed in a browser's cross-site request, on purpose | A key in a web page can be read by everyone who opens it, so a partner must call us from its own server (`CONTRACT_DEVIATIONS.md`, Week 9: the CORS headers are unchanged) | **To fill in:** whether Ujuzi calls us from its server or from the browser today. If from the browser, that call has to move to their server before keys are switched on at the live address. Raised in the message in section 9 | Ours (a decision), to agree with Ujuzi |
| 4 | A job could end up with **two accepted applicants** (found by our team on the old ring's website; the same code came across to the new ring) | A job has one place, but nothing enforced it: Reopen job was allowed on a filled job, and accepting checked only that the request was waiting | On this branch: reopening a filled job answers 409, accepting a second applicant answers 409, a new request for a filled job is told it is filled, and a unique index in PostgreSQL makes sure (`CONTRACT_DEVIATIONS.md`, "A job has one place"). Seen working in a browser on 28 October 2026 with keys switched on (`evidence/week10/one_place_job_filled_no_reopen.png`, notes in `evidence/week10/browser_check.txt`) | Ours, fixed by us |
| 5 | Surprise: Sherehe's contract is still a draft (0.1.0) and three questions about it are open (`CONTRACT_QUESTIONS.md`) | Their contract is not final | **To fill in:** their answers, and any change Event work needs | Theirs (contract) |
| 6 | **To fill in:** anything the first real call shows | | | |

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

**To fill in:** the same three steps with Sherehe's real server: date, what the page showed at each step, and the log line from step 2.

## 7. Being a good provider to Ujuzi (Part E)

* Once keys are switched on at the live address, every call needs a key. Ujuzi gets its own key, by direct message to one named person, never in a repository or a channel. Its calls are counted separately from everyone else's, 100 a minute by default (`README.md`, "API keys and rate limits").
* Our server answers a refused call (401 or 429) before any handler runs, and does not write it to the log today. So when Ujuzi reports a 401 or 429, we ask for the time and the request, and check the key and the limit settings on our side.
* One change on this branch is visible to Ujuzi: a request for a job that is open but already has an accepted applicant answers `409` with a message saying the job is filled (before, the same `409` was only for closed jobs). Nothing else Ujuzi uses changes: same paths, fields and status codes.
* Under requirement R4, Endpoints 1 to 9 stay open for Ujuzi unless both sub-teams agree. Solovea recorded the agreement of the person who runs all three systems on 27 October 2026 (`CONTRACT_DEVIATIONS.md`, Week 9). **To fill in:** the date Ujuzi's sub-team confirmed, the date it received its key, and the date it confirmed its calls work. Keys must not be switched on at the live address before that.

Bugs Ujuzi reports, in the same format as section 4:

| # | What broke (symptom) | Root cause | Fix | Whose code, and who fixed it |
|---|---|---|---|---|
| P1 | **To fill in:** every problem Ujuzi reports, including any that turn out to be in our code | | | |

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
