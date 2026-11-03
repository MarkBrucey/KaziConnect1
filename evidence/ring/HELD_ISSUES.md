# Held issues: errors that wait on parts of the ring that are not built yet

Sherehe, Kazi Connect and Ujuzi are being built by three sub-teams at the same time. While a part is
missing, a call to it fails, and that failure says nothing about whether the code that made the call is
right. So an error from a call between two systems is **put on hold here first, not fixed**, until the
system it depends on is complete. Then each held item is re-checked, and what is left is a genuine error.

Nothing in this file is invented. Every row records something a command printed, with the command and the
date, and a row is only closed by running the command again.

## How an error is sorted

`npm run ring:status` gives every check one verdict:

| Verdict | Means | What to do |
|---|---|---|
| `ok` | The reply is what the contract promises | Nothing |
| `not-built` | The contract names this path, but the system answers 404, 405 or 501 | **Hold.** Not our fault, and not theirs yet: it is not there |
| `not-configured` | No address yet, or it is still a `TODO` placeholder | **Hold.** Waiting for the team to deploy and share it |
| `unreachable` | No answer: no such address, refused, timed out, or Render says no service lives there | **Hold** until it is deployed; after that it is a genuine error |
| `pending-deploy` | Kazi Connect's live site is on an older contract than this checkout | **Hold.** Wait for `uat` to be merged into `main` and deployed |
| `key-problem` | The system refuses our API key | **Hold** until the key is issued (Week 9); after that it is a genuine error |
| `manual` | Cannot be seen from outside | A person asks the other team and records the answer |
| `genuine-error` | The system answered with a 5xx: it is there and it failed | **Fix** (ours) or **report** (theirs) |
| `drift` | It answered, but not as its contract says (wrong status, wrong shape, or the contract changed) | **Fix** or **raise it with the other team**; check which side is right |

The rule that matters: a 404 or "no such address" is a **missing part**; a 5xx or a wrong shape is a
**genuine error**.

## Where the ring stands

Last checked: **2026-10-21**, with `npm run ring:status`.

| ID | What was observed | System | Verdict | Waiting for | Recheck with | Status |
|---|---|---|---|---|---|---|
| H-1 | Sherehe's address is the placeholder `https://sherehe-TODO.onrender.com`, so the partner tests and the live read in `npm run ring:check` cannot run | Sherehe | `not-configured` | Sherehe's sub-team to deploy and share the address (requirement R3) | `npm run ring:status`, then `npm run test:partner` | Held |
| H-2 | Ujuzi's address is the placeholder `https://ujuzi-TODO.onrender.com` | Ujuzi | `not-configured` | Ujuzi's sub-team to deploy and share the address | `npm run ring:status` | Held |
| H-3 | The live Kazi Connect site is up and on contract **1.2.1**; Endpoint 1 answers correctly (9 active jobs, all matching the contract). Endpoints 22 to 25 answer 404 there | Kazi Connect | `pending-deploy` | Humans: tell Ujuzi (requirement R8), merge `uat` into `main`, let Render deploy | `npm run ring:status` | Held. **Not an error**: expected until the merge |
| H-4 | Ujuzi has not yet re-run its tests against Kazi 1.3.0. This cannot be seen from outside | Ujuzi | `manual` | H-2 and H-3, then Ujuzi's sub-team to run its partner tests and report | Ask Ujuzi; record the result in `PARTNER_TEST_RESULTS.md` | Held |
| H-5 | Sherehe's API key (`X-API-Key`) has not been issued to Kazi Connect (Week 9, requirement R4) | Sherehe | `not-configured` | Sherehe's sub-team to issue the key; the humans set `SHEREHE_API_KEY` in Render and in `.env` | `npm run ring:status` | Held |
| H-6 | The Sherehe contract Kazi built against is a **draft** (version 0.1.0). Sherehe's own starter notes that its website endpoints are still to be added before the real handoff | Sherehe | not yet observable | The final handoff from Sherehe | `npm run ring:status` reports `drift` on the contract line when their published version differs; then refresh `partner-tests/sherehe_openapi.yaml`, run `npm run types` and `npm run typecheck` | Held |

## Keeping watch

The checks can be left running. This prints the full report once, then prints again only when something
changes, and stops by itself (exit code 0) when all three systems are ready:

```bash
npm run ring:status -- --watch --until-ready --interval 600 --log .ring-status.log
```

It reads `.env` again on every cycle, so when a team shares an address, paste it into `.env` (`SHEREHE_API_URL`,
`SHEREHE_API_KEY`, `UJUZI_URL`) and the next cycle uses it. `.ring-status.log` records the state of each system
every cycle. Add `--write` to also make one offer at Sherehe and withdraw it again (K3 and K5).

"Ready" means: Kazi Connect's live site is on this checkout's contract version, Sherehe answers every
endpoint Kazi consumes as its contract says, and Ujuzi is reachable and publishing its contract.

## When the ring is ready

1. Run `npm run ring:status` and read every verdict.
2. Run the checks that were waiting: `npm run test:partner` (Sherehe, with the real key) and `npm run ring:check`.
3. For every failure, go back to the table above: a `not-built` that is still `not-built` is still the other
   team's to finish; a `genuine-error` or `drift` is a real fault. Move each one to the list below, with who
   owns the fix.
4. Record Sherehe's results in `PARTNER_TEST_RESULTS.md` and Ujuzi's results on Kazi in the same file.

## Errors found once the ring was ready

_None yet: the ring is not ready, so nothing has been classified. Add a row here for each failure, with the
command, the date, what it printed, the verdict, and who fixes it._

| ID | Command and date | What it printed | Verdict | Owner of the fix | Status |
|---|---|---|---|---|---|
