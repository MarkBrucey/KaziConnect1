# Contract Questions: Shamba Direct's API (Week 4)

Three questions about the contract we received from our upstream ring partner, Shamba Direct (Team 14).

1. The path is currently defined as /enquires instead of the standard plural spelling /enquiries or the singular /enquiry. Is this intentional, or should it be corrected to match standard API naming conventions?

2. The endpoint GET /farmers/{farmer_id}/rating is designed to return the rating for one specific farmer, yet its success response schema is defined as an array of objects instead of a single standalone object. Should this be changed to return an object directly?

3. In the /headquarters responses, the county example value is lowercase "nairobi", while the listing examples use capitalized "Kirinyaga". Additionally, the address example has a missing space after the comma ("Ngong Road,Kiatumu plaza"). Should the API enforce strict capitalization formats (e.g., PascalCase) for query parameters and responses?

# Contract Questions: Sherehe's API (new ring, October 2026)

Three questions about the contract we received from our new upstream partner, Sherehe. Each points at a specific field or endpoint.

> DRAFT, written against Sherehe's draft contract (version 0.1.0). Re-check them against the contract Sherehe actually hands off; replace any it already answers.

1. **`POST /api/offers`, field `workersOffered`, and `Role.filled`.** Can we offer fewer workers than the open slots (`headcount - filled`)? If the organiser accepts a partial offer, does `filled` go up by `workersOffered`, and can a second offer then cover the rest?

2. **`DELETE /api/offers/{offerId}`.** A withdrawn offer is deleted, so `GET` then answers 404. How do we tell "withdrawn" from "never existed" if our poller misses the moment? Would Sherehe consider a `withdrawn` status instead of deletion?

3. **`GET /api/events`, parameter `status`.** It is required, but its only allowed value is `upcoming`. Will more values be added (for example `completed`), and what does a request without `status` answer: 400 with a message, or all events?
