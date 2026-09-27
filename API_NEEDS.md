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
