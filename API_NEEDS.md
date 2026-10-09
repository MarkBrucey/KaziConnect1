# API Needs Statements — Kazi Connect(Team 15)

Format: *"[Consumer] needs to [verb] [resource] in order to [reason]."*

## Our needs from Shamba Direct (Team 14) — upstream

1. Kazi Connect needs to read active produce listings and market locations from Shamba Direct in order to surface nearby casual-labor gigs (loading, portering, market assistance) around active trade points.
2. Kazi Connect needs to read depot/headquarters county data from Shamba Direct in order to rank job listings by proximity to active produce markets.
3. Kazi Connect needs to read farmer/vendor ratings from Shamba Direct in order to cross-verify trust scores for users listed as sellers on Shamba Direct and workers on FundiLink.

## SettleIn's needs from us (Team 1) — downstream

1. Team 1 (SettleIn) needs to read active FundiLink job listings in order to help students find nearby casual services and skilled workers.
2. Team 1 (SettleIn) needs to read job locations and categories in order to show relevant service options around a student's accommodation area.
3. Team 1 (SettleIn) needs to read worker/application status information in order to display whether a requested service is available or already engaged.
4. Team 1 (SettleIn) needs to read job pay ranges and categories in order to show students an estimated part-time earnings widget alongside accommodation listings.
5. Team 1 (SettleIn) needs to read application status updates in order to notify students in real time when a service request is accepted or already filled.
6. Team 1 (SettleIn) needs to create a service application on behalf of a student in order to let them formally request a job/service listing.
7. Team 1 (SettleIn) needs to update an existing application on behalf of a student in order to let them change details (e.g., reschedule) before it's accepted.
8. Team 1 (SettleIn) needs to cancel a pending application on behalf of a student in order to let them withdraw a request they no longer want.

Working both ends of the ring at once surprised us: the same modeling question came up twice. Shamba Direct's "status" field tells us whether a market listing is open or closed, but SettleIn needed our status field to answer a different question — is this service still available to request? We initially copied Shamba Direct's status vocabulary straight into our /jobs/{jobId} endpoint, and it wasn't until peer review that we noticed it didn't actually answer what SettleIn needed. That forced us to separate three things we'd been treating as one: how Shamba Direct represents status, how we store it internally, and what SettleIn reads. The real lesson — consuming and providing an API aren't independent problems. A naming or semantic choice upstream quietly leaks downstream unless you're deliberate about the translation layer in between.


The FundiLink website's own needs (added after Week 7)
Kazi Connect also serves our own FundiLink website. These statements cover what the website needs that SettleIn does not.
F1. The FundiLink website needs students and employers to create an account and log in, in order that job postings and applications belong to a real person.
F2. The FundiLink website needs employers to post jobs with a title, kind of work, county, estate, duration, urgency and pay, and to see the jobs they have posted, in order that work reaches students without an agency.
F3. The FundiLink website needs employers to see who applied for their job and accept one applicant, in order that every applicant hears the result straight away.
F4. The FundiLink website needs employers to close or reopen a job posting, in order that a filled job stops taking applications.
F5. The FundiLink website needs a logged in student to see all their applications in one place, in order to follow and manage them.
F6. The FundiLink website needs people who forget their password to reset it through a link sent to their email, in order not to lose their account.
