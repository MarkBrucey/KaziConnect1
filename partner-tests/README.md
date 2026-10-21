# Partner tests

Week 7 partner tests, now against our new upstream, Sherehe, written only from Sherehe's contract (`sherehe_openapi.yaml`, a frozen copy of the file Sherehe handed off). They replace the Shamba Direct tests, which have been deleted (they stay in the git history).

Run them against Sherehe's live server:

```bash
SHEREHE_URL=https://sherehe-TODO.onrender.com SHEREHE_API_KEY=... npm run test:partner
```

To check the tests themselves before using the real Sherehe, run them against the local stand-in (it is built from the same contract, so this proves the tests, not Sherehe). In one terminal run `npx tsx helpers/shereheStub.ts`, then in another:

```bash
SHEREHE_URL=http://127.0.0.1:4000 SHEREHE_API_KEY=stub-partner-key npm run test:partner
```

Every offer a test creates must be withdrawn before the test ends. Record every failure in `PARTNER_TEST_RESULTS.md`, classified as a real bug, a contract ambiguity or a misunderstanding.
