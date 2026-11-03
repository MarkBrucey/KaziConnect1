# API Needs Statements: Kazi Connect (Team 15)

Format: *"[Consumer] needs to [verb] [resource] in order to [reason]."*

> DRAFT for the new ring (October 2026). Rewrite K1 to K5 and U1 to U6 with what Sherehe and Ujuzi actually say in the interviews, then delete this note. The statements for Shamba Direct and SettleIn are kept below as history.

## Our needs from Sherehe, upstream

| # | Statement | Freshness | Volume | Auth |
|---|---|---|---|---|
| K1 | Kazi Connect needs to read upcoming events in a county, with date and venue area, in order to show students where event work is coming up. | Within the hour | Every Event work page load | Sherehe partner key |
| K2 | Kazi Connect needs to read an event's open staffing roles, with category, headcount, shift times and pay per shift, in order to post matching jobs with accurate pay ranges. | Within the hour | Per event opened | Sherehe partner key |
| K3 | Kazi Connect needs to create a staffing offer on a role in order to tell the organiser that Kazi students can fill it. | Immediate | A few per day | Sherehe partner key |
| K4 | Kazi Connect needs to read a staffing offer's status in order to open the job to students only once the organiser accepts. | Within minutes | Polled every few minutes per pending offer | Sherehe partner key |
| K5 | Kazi Connect needs to withdraw a pending staffing offer in order to stop offering a role Kazi can no longer fill. | Immediate | Rare | Sherehe partner key |

## Ujuzi's needs from us, downstream

Ujuzi replaces SettleIn and uses the same Endpoints 1 to 9. The last column maps each need to SettleIn's old statement numbers, which the README and evidence still use.

| # | Statement | Endpoints | Freshness | Auth | Was |
|---|---|---|---|---|---|
| U1 | Ujuzi needs to read active Kazi jobs in order to show graduates live demand on each course page. | 1 | Within the hour | None | Statement 1 |
| U2 | Ujuzi needs to read active jobs filtered by a course's category and the graduate's county in order to list "jobs for this skill near you". | 2 | Within the hour | None | Statement 2 |
| U3 | Ujuzi needs to read a job's details, pay range and availability in order to show expected earnings before a graduate applies. | 3, 4 | Real time for status | None | Statements 3, 4 |
| U4 | Ujuzi needs to create an application on a graduate's behalf in order to let them apply straight from their course dashboard. | 7 | Immediate | None | Statement 6 |
| U5 | Ujuzi needs to read and subscribe to an application's status in order to tell the graduate the moment they are accepted or the job is filled. | 5, 6 | Real time | None | Statement 5 |
| U6 | Ujuzi needs to reschedule or withdraw a pending application in order to let graduates change their start date or cancel. | 8, 9 | Immediate | None | Statements 7, 8 |

## Check against the audit

K1 to K5 map to a new audit item, "Event work: see Sherehe staffing roles and offer workers" (TEAM_CHARTER.md, update of October 2026). U1 to U6 map to the existing Jobs and Applications items, exactly as SettleIn's statements did. Gaps flagged: TODO after the interviews.

## Reflection on the new ring

TODO after the interviews: one honest paragraph. Likely material: Kazi expected organisers' phone numbers from Sherehe, which Sherehe will not share, and a pay range where Sherehe stores one pay per shift; Ujuzi expected employer names on jobs and a way to list one student's applications without a Kazi login, and neither exists.

## The Kazi Connect website's own needs (added after Week 7)

Kazi Connect also serves our own website. These statements cover what the website needs that SettleIn does not. (Kazi Connect was called FundiLink when the statements above were written, so "FundiLink" in them means Kazi Connect.)

W1. The Kazi Connect website needs students and employers to create an account and log in, in order that job postings and applications belong to a real person.

W2. The Kazi Connect website needs employers to post jobs with a title, kind of work, county, estate, duration, urgency and pay, and to see the jobs they have posted, in order that work reaches students without an agency.

W3. The Kazi Connect website needs employers to see who applied for their job and accept one applicant, in order that every applicant hears the result straight away.

W4. The Kazi Connect website needs employers to close or reopen a job posting, in order that a filled job stops taking applications.

W5. The Kazi Connect website needs a logged in student to see all their applications in one place, in order to follow and manage them.

W6. The Kazi Connect website needs people who forget their password to reset it through a link sent to their email, in order not to lose their account.

W7. The Kazi Connect website needs employers to see staffing roles on upcoming Sherehe events and offer Kazi workers for them, in order that event work reaches students without an agency (served by K1 to K5).

## History: the first ring (Weeks 2 to 8)

Kept as written, with its reflection, because Weeks 2 to 8 were graded on it.

### Our needs from Shamba Direct (Team 14), upstream

1. Kazi Connect needs to read active produce listings and market locations from Shamba Direct in order to surface nearby casual-labor gigs (loading, portering, market assistance) around active trade points.
2. Kazi Connect needs to read depot/headquarters county data from Shamba Direct in order to rank job listings by proximity to active produce markets.
3. Kazi Connect needs to read farmer/vendor ratings from Shamba Direct in order to cross-verify trust scores for users listed as sellers on Shamba Direct and workers on FundiLink.

### SettleIn's needs from us (Team 1), downstream

1. Team 1 (SettleIn) needs to read active FundiLink job listings in order to help students find nearby casual services and skilled workers.
2. Team 1 (SettleIn) needs to read job locations and categories in order to show relevant service options around a student's accommodation area.
3. Team 1 (SettleIn) needs to read worker/application status information in order to display whether a requested service is available or already engaged.
4. Team 1 (SettleIn) needs to read job pay ranges and categories in order to show students an estimated part-time earnings widget alongside accommodation listings.
5. Team 1 (SettleIn) needs to read application status updates in order to notify students in real time when a service request is accepted or already filled.
6. Team 1 (SettleIn) needs to create a service application on behalf of a student in order to let them formally request a job/service listing.
7. Team 1 (SettleIn) needs to update an existing application on behalf of a student in order to let them change details (e.g., reschedule) before it's accepted.
8. Team 1 (SettleIn) needs to cancel a pending application on behalf of a student in order to let them withdraw a request they no longer want.

Working both ends of the ring at once surprised us: the same modeling question came up twice. Shamba Direct's "status" field tells us whether a market listing is open or closed, but SettleIn needed our status field to answer a different question: is this service still available to request? We initially copied Shamba Direct's status vocabulary straight into our /jobs/{jobId} endpoint, and it wasn't until peer review that we noticed it didn't actually answer what SettleIn needed. That forced us to separate three things we'd been treating as one: how Shamba Direct represents status, how we store it internally, and what SettleIn reads. The real lesson: consuming and providing an API aren't independent problems. A naming or semantic choice upstream quietly leaks downstream unless you're deliberate about the translation layer in between.

