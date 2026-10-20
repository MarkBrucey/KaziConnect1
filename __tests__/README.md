Automated tests for the Kazi Connect API: 366 tests in 11 files. Run them with: npm test

The first 156 tests, in 5 files, cover Endpoints 1 to 21, one file per area. They are unchanged:
- jobs.test.js (21): Endpoints 1 to 4
- applications.test.js (42): Endpoints 5 to 9
- accounts.test.js (35): Endpoints 10 to 13 and 19
- employer.test.js (39): Endpoints 14 to 18
- passwordReset.test.js (19): Endpoints 20 and 21

The other 210 tests, in 6 files, cover Event work (Endpoints 22 to 25, website need W7). Sherehe is a local stand-in, helpers/shereheStub.js, so none of them needs the real Sherehe or its key:
- eventWork.test.js (86): Endpoints 22 to 25, every status code, and that Endpoints 1 to 21 keep working while Sherehe is down
- offerPoller.test.js (34): the job that opens when the organiser accepts an offer
- shereheClient.test.js (50): the only module that talks to Sherehe, and the mappers
- fetcher.test.js (20): timeouts, the 5-minute cache, and how failures are handled
- staffingStore.test.js (15): the staffing offer functions of the data store
- eventWorkPage.test.js (5): checks on the Event work page in index.html

They run on the in-memory store by default. With DATABASE_URL set they run on that PostgreSQL database, and they empty it first, so never point DATABASE_URL at data you want to keep.

The partner tests in partner-tests/ are separate and run with npm run test:partner.
