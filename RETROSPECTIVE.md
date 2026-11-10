# Retrospective: Kazi Connect

Mark Bruce Nyangena, Integration/QA Lead, Kazi Connect sub team. Written for Week 14, 11 November 2026.

## 1. The hardest part of the lifecycle: Integrate

For us, the hardest stage was Integrate, and the reason was not the code: the ring changed under us. In October our partners, Shamba Direct and SettleIn, left, and the new ring became Sherehe, then Kazi Connect, then Ujuzi, built by our own sub teams. In the same weeks Kazi Connect moved from Express to Next.js and TypeScript. So we were integrating against draft contracts (Sherehe's was 0.1.0, with three open questions in `CONTRACT_QUESTIONS.md`) on a new framework, while promising Ujuzi that Endpoints 1 to 21 would answer byte for byte as before.

What made it manageable was evidence: 151 real Express answers were recorded before the move, and `parityWithExpress.test.js` still replays them on every run. What kept it hard was outside the code. Sherehe's live address never reached our repository (`INTEGRATION_LOG.md` still says "Not shared yet"), and both services sleep on Render's free plan. On 10 November Kazi took 44 seconds to wake, and the first three Event work loads answered 502 after about 10 seconds each, because Sherehe was asleep too.

## 2. One real cross-team issue: the live site answered 500 on everything

On 3 November at 21:33, pull request #1 merged `uat`, the Next.js version, into `main`, and Render deployed it automatically. From then on, the live site answered an **empty `500`** to every page and every endpoint. That included `GET /api/jobs`, the call Ujuzi makes for its graduates, so our change broke our downstream partner overnight.

I found out the next morning, 4 November, while launching everyone's work. Reproducing it locally gave the cause: "Could not find a production build". Render's build command only installed packages and never ran `npm run build`. The Express version had never needed a build step, so nobody had thought to change it. I changed Render's Build command to `npm ci --include=dev && npm run build` and its Start command to `npm start`, and the live site answered again that morning. It was down for roughly twelve hours, most of them overnight.

The lesson was about process, not Next.js. `CLAUDE.md` even mentions deploying `uat` as a separate Render service before merging. We skipped that, so the first real build of the new version happened on the live service.

## 3. What I would design differently

**I would wrap every list in `{ data, count }` from Week 5.** In Week 13 I shipped `/api/v2/jobs` beside `/api/jobs` just to add a wrapper, proved the old version had not changed (a diff of `v1_before.json` and `v1_after.json`, 14 tests in `versions.test.ts`), and wrote Ujuzi a notice naming line 74 of their `lib/clients/kaziClient.ts`, which throws on the new shape. In Week 5 it would have cost nothing.

**I would switch API keys on from the first deploy.** On the live site keys are still off, so every caller in our Week 12 log is `"caller":"none"`. In Week 13 I could only say who still uses version 1 from a local drill, not from the live `/api/stats`.

**I would never merge into `main` without a staging deploy.** One more Render service built from `uat` would have caught the build command before Ujuzi did.

**What I would keep:** one file per partner. Every Sherehe call goes through `clients/shereheClient.ts` and `clients/fetcher.ts`, so in Week 11 I could add timeouts, retries and the saved list in one place. Its 5-minute cache confused me once (on 4 November my teammate's new Sherehe events took a few minutes to show), but it is also why a short Sherehe outage barely shows.

## 4. My contribution

I would rate my contribution **7 out of 10**.

What I owned:

* **The original API (Weeks 5 to 8):** Endpoints 1 to 21 on Express, the 156 tests, the contract check, the PostgreSQL deployment on Render and the published docs. These are my commits from 27 September to 13 October.
* **After the move to Next.js:**
  * I raised the problem that any visitor could apply using another student's account ID, and shipped the fix as version 1.3.1 (pull request #2, 4 November).
  * I merged `uat` into `main` (pull request #3).
  * I fixed the Render build after the outage.
  * I ran all three systems together on my own Windows computer, with every ring check passing.
* **This week's branch:** the Week 11 to 13 work (resilience, monitoring, version 2).

Where others carried me:

* Solovea did the move to Next.js and TypeScript, the Sherehe integration (Endpoints 22 to 25) and the Week 9 keys and rate limit. Her name is on 36 of the commits on `main`, and the Sherehe and Ujuzi repositories are on her GitHub account.
* I depended on her and on the Sherehe sub team for keys and for accepting offers. The offer `sof_1002` sat "pending" on 4 November, waiting for an organiser.

I should also be clear about how I worked. Much of the code and many of the documents in my pull requests were written with an AI coding assistant, Claude, which I directed, questioned, ran and checked before every push. I count the design decisions, the testing against our partners and the deployment as mine. I do not claim to have typed every line.

Why not higher: the move to Next.js happened without me, and I did not chase Sherehe's live address and contract answers early enough.
