// The mapping step between what the database gives us and what the contract
// promises. Every response goes through one of these functions, so the field
// names, the types and the set of fields always match openapi.yaml exactly.

// Database row -> Job schema
function toJob(row) {
  return {
    id: String(row._id),                 // _id        -> id
    title: row.job_title,                // job_title  -> title
    category: row.job_category,          // job_category -> category
    county: row.county_name,             // county_name  -> county
    status: row.listing_status,          // listing_status -> status
    payRange: {
      min: Number(row.pay_min),          // "15000.00" (string) -> 15000 (number)
      max: Number(row.pay_max),
    },
    // created_by and internal_notes are internal columns and are left out on purpose.
  };
}

// Database row -> JobStatus schema (Endpoint 4: the lightweight availability check)
function toJobStatus(row) {
  return {
    jobId: String(row._id),              // _id -> jobId
    status: row.listing_status,          // listing_status -> status
  };
}

// Database row -> ApplicationStatus schema
function toApplicationStatus(row) {
  return {
    applicationId: String(row._id),      // _id -> applicationId
    status: row.application_status,      // application_status -> status
    // student_id, job_ref, updated_at and reviewer_notes are not in the contract.
  };
}

// Dates leave the API as ISO 8601 strings like 2027-01-15T09:00:00Z,
// never as raw Date objects or timestamps.
function toIsoDateTime(date) {
  return date.toISOString().replace(/\.000Z$/, 'Z');
}

// Database row -> Application schema (Week 6: returned by POST and PUT)
function toApplication(row) {
  return {
    applicationId: String(row._id),               // _id           -> applicationId
    jobId: row.job_ref,                           // job_ref       -> jobId
    studentId: row.student_id,                    // student_id    -> studentId
    preferredDate: toIsoDateTime(row.preferred_at), // preferred_at (Date) -> preferredDate (string)
    note: row.student_note,                       // student_note  -> note
    status: row.application_status,               // application_status -> status
    // updated_at and reviewer_notes are internal and are left out on purpose.
  };
}

module.exports = { toJob, toJobStatus, toApplicationStatus, toApplication, toIsoDateTime };
