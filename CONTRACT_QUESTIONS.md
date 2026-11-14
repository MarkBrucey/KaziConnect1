# Contract Questions: Shamba Direct's API (Week 4)

Three questions about the contract we received from our upstream ring partner, Shamba Direct (Team 14).

1. The path is currently defined as /enquires instead of the standard plural spelling /enquiries or the singular /enquiry. Is this intentional, or should it be corrected to match standard API naming conventions?

2. The endpoint GET /farmers/{farmer_id}/rating is designed to return the rating for one specific farmer, yet its success response schema is defined as an array of objects instead of a single standalone object. Should this be changed to return an object directly?

3. In the /headquarters responses, the county example value is lowercase "nairobi", while the listing examples use capitalized "Kirinyaga". Additionally, the address example has a missing space after the comma ("Ngong Road,Kiatumu plaza"). Should the API enforce strict capitalization formats (e.g., PascalCase) for query parameters and responses?

# Contract Questions: Sherehe's API (new ring, October 2026)

Three questions about the contract we received from our new upstream partner, Sherehe. Each points at a specific field or endpoint.

> Written against Sherehe's draft contract (version 0.1.0). Re-checked on 14 November 2026 against Sherehe's `main`: the contract is still version 0.1.0. Question 2 is answered by the contract itself; questions 1 and 3 are answered by Sherehe's code and by running the ring, not by the contract text. Each answer is under its question.

1. **`POST /api/offers`, field `workersOffered`, and `Role.filled`.** Can we offer fewer workers than the open slots (`headcount - filled`)? If the organiser accepts a partial offer, does `filled` go up by `workersOffered`, and can a second offer then cover the rest?

   **Answer (Sherehe's code, 14 November 2026):** yes to all three. `workersOffered` can be any whole number from 1 to the open slots; anything else is a `400` saying how many are open. Accepting adds `workersOffered` to `filled`, so a second offer can cover the rest. If the role has filled up in between, accepting answers `409` ("Role ... has N open places, fewer than the M offered").

2. **`DELETE /api/offers/{offerId}`.** A withdrawn offer is deleted, so `GET` then answers 404. How do we tell "withdrawn" from "never existed" if our poller misses the moment? Would Sherehe consider a `withdrawn` status instead of deletion?

   **Answer (Sherehe's contract):** no. Sherehe kept deletion: `DELETE` answers `204` ("Withdrawn; the offer no longer exists"), and from then on `GET` answers the same `404` as for an offer that never existed. Our side copes like this: Kazi Connect only withdraws through its own Endpoint 25 and deletes its copy when Sherehe answers `204` or `404`. If the poller finds a `404` for an offer Kazi still holds as pending, it logs it and leaves the offer pending rather than guessing.

3. **`GET /api/events`, parameter `status`.** It is required, but its only allowed value is `upcoming`. Will more values be added (for example `completed`), and what does a request without `status` answer: 400 with a message, or all events?

   **Answer (Sherehe's code, 14 November 2026):** `400` with a message. No `status` gives "status is required; use status=upcoming", and any other value gives "status must be upcoming; only upcoming events can still be staffed". Events carry `upcoming`, `completed` or `cancelled`, but only `upcoming` can be listed; no other value has been announced.
