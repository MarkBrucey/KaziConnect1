# Kazi Connect API: Partner Test Results, Week 7

Our ring: **Shamba Direct (Team 14)** is upstream of us, and **SettleIn (Team 1)** is downstream. We sent our contract to SettleIn so they could test our API, and we received Shamba Direct's contract so we could test theirs. Only contracts were exchanged, never test files.

## 1. What SettleIn's tests found in our API

**What we shared:** our contract only, `openapi.yaml` version 1.1.0, downloadable from the live API at https://kaziconnect1-1xmu.onrender.com/openapi.yaml, plus the running address https://kaziconnect1-1xmu.onrender.com and Swagger UI at `/docs`. We did not share our test files.

**What they did:** SettleIn wrote their tests from our contract alone and ran them against our live API.

**Result: nothing failed. SettleIn reported that all of their tests passed.**

**What we fixed:** nothing needed fixing, because no test failed.

**Ambiguities or misunderstandings raised:** none.

This matches our own checks. Our own suite of 63 automated tests passes in full (evidence/week7/1_own_tests_63_passed.png), and the same live deployment SettleIn tested creates, re-fetches, rejects bad input and deletes correctly (evidence/week7/2 to 5).

## 2. What our tests found in Shamba Direct's API

Our tests were in `partner-tests/shambaDirect.partner.js` (since removed; it stays in the git history): 21 tests written only from Shamba Direct's contract (a copy was in `partner-tests/shamba_openapi.yaml`, also removed). They cover every endpoint: field names and types, county filters, an empty result, 404 for IDs that do not exist, a non-integer ID, enquiry validation (400) and an enquiry for a listing that does not exist (404). Run them with `npm run test:partner`.

### Found in their contract before running any tests

We checked their `openapi.yaml` with an OpenAPI validator. It fails with 3 errors (evidence/week7/6_shamba_direct_contract_validation.png).

| # | Finding | Classification |
|---|---|---|
| 1 | `/enquires` is written outside `paths`, so the POST endpoint is not part of the contract at all and does not appear in Swagger UI. | Contract error: move it under `paths`. |
| 2 | Both headquarters schemas are invalid. The example `Ngong Road,Kiatumu plaza` is unquoted, and YAML reads the comma as a separator, creating an extra invalid key. | Contract error: put the example in quotes. |
| 3 | The path is spelled `/enquires`, not `/enquiries`. We cannot tell which one the server actually uses. | Contract ambiguity: confirm the real path. |
| 4 | `GET /farmers/{farmer_id}/rating` returns a list, even though it is for one farmer. A consumer could reasonably expect one object. | Contract ambiguity: confirm list or object. |
| 5 | `GET /listings` says it is "filtered by county", but does not say whether `county` is required, what happens when it is left out, or whether matching ignores upper and lower case. The examples mix `Kirinyaga` and `nairobi`. | Contract ambiguity. |
| 6 | No response lists its required fields, the 400 and 404 responses have no body shape, and nothing says what a non-integer ID returns. | Contract ambiguity. |
| 7 | `/listings` says it returns "active" listings, but a listing has no status field, so a consumer cannot check it. | Contract ambiguity. |

### Running our tests against Shamba Direct's live API

At the time of submission, Shamba Direct had not shared the address of a running API, so our 21 tests have not yet been executed against their real server. They are ready to run with one command as soon as the address is available, and the results will be added here, with each failure classified as a real bug, a contract ambiguity or a misunderstanding.

## Update after Week 7

Since this exchange, the contract has moved from version 1.1.0 to 1.2.1 (every change is in `CONTRACT_DEVIATIONS.md`). Endpoints 1 to 9 keep the same paths, methods, inputs and status codes, but every Job now also carries `area`, `duration` and `urgent`. Any SettleIn test that checks a Job has no extra fields needs those three added to its list, so SettleIn's tests should be re-run against the live API before they rely on version 1.2.1. Our own suite has grown from 63 to 156 tests, covering the accounts, employer tools and password reset added since.

# New ring (October 2026): Ujuzi and Sherehe

Our ring is now **Sherehe** upstream and **Ujuzi** downstream. As before, only contracts are exchanged, never test files.

## 1. What Ujuzi's tests found in our API

- What we shared: `openapi.yaml` version TODO and the live URL https://kaziconnect1-1xmu.onrender.com
- Result: TODO

| Failure | Classification (real bug / contract ambiguity / misunderstanding) | What we did |
|---|---|---|
| TODO | | |

## 2. What our tests found in Sherehe's API

Our tests are in `partner-tests/sherehe.partner.js` (36 tests), written only from Sherehe's contract (frozen copy: `partner-tests/sherehe_openapi.yaml`, a draft, version 0.1.0). They replace the Shamba Direct tests. Run them with `SHEREHE_URL=... SHEREHE_API_KEY=... npm run test:partner`.

**Dry run, not a result for Sherehe.** On 21 October 2026 the tests were run against our own local stand-in for Sherehe (`helpers/shereheStub.ts`, built from the same contract): 35 passed and 1 was skipped (the "role is full" test needs `FULL_ROLE_ID`, a role with no free slot). This shows the tests themselves work. It says nothing about the real Sherehe, which has not been tested yet.

- Sherehe's live URL used: TODO
- Result: TODO

| Failure | Classification | Raised with Sherehe / outcome |
|---|---|---|
| TODO | | |
