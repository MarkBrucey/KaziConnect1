The path is currently defined as /enquires instead of the standard plural spelling /enquiries or the singular /enquiry. Is this intentional, or should it be corrected to match standard API naming conventions?


The endpoint GET /farmers/{farmer_id}/rating is designed to return the rating for one specific farmer, yet its success response schema is defined as an array of objects instead of a single standalone object. Should this be changed to return an object directly?


In the /headquarters responses, the county example value is lowercase "nairobi", while the listing examples use capitalized "Kirinyaga". Additionally, the address example has a missing space after the comma ("Ngong Road,Kiatumu plaza"). Should the API enforce strict capitalization formats (e.g., PascalCase) for query parameters and responses?
