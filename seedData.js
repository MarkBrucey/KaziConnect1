// Kazi Connect sample data, used by both the in-memory store and the database.
//
// Rows are shaped the way a real database hands data back, NOT the way
// openapi.yaml promises it: snake_case names, an _id key, money as text, and
// internal columns that must never leave the server. mappers.js turns these
// rows into the exact shapes in the contract.

const { hashPasswordSync } = require('./auth');

// Demo accounts, so anyone can try the employer and student sides.
const DEMO_PASSWORD = 'KaziDemo2026';

const SEED_USERS = [
  { _id: 'usr_1001', full_name: 'Demo Employer', email: 'employer@kaziconnect.demo', role: 'employer' },
  { _id: 'usr_1002', full_name: 'Demo Student', email: 'student@kaziconnect.demo', role: 'student' },
];

const SEED_JOBS = [
  { _id: 'job_12345', job_title: 'Campus Housing Assistant', job_category: 'accommodation', county_name: 'Nairobi', area_name: 'Parklands', duration_text: 'Part time, 3 months', is_urgent: true, listing_status: 'active', pay_min: '15000.00', pay_max: '22000.00', employer_id: 'usr_1001', created_by: 'admin_3', internal_notes: 'Verified landlord partner' },
  { _id: 'job_12346', job_title: 'Hostel Front Desk Attendant', job_category: 'accommodation', county_name: 'Nairobi', area_name: 'Kilimani', duration_text: 'Evening shifts', is_urgent: false, listing_status: 'active', pay_min: '12000.00', pay_max: '18000.00', employer_id: 'usr_1001', created_by: 'admin_1', internal_notes: '' },
  { _id: 'job_12347', job_title: 'Student Residence Cleaner', job_category: 'accommodation', county_name: 'Kiambu', area_name: 'Ruaka', duration_text: 'Weekends only', is_urgent: false, listing_status: 'active', pay_min: '9000.00', pay_max: '12000.00', employer_id: 'usr_1001', created_by: 'admin_2', internal_notes: 'Weekend shifts only' },
  { _id: 'job_12348', job_title: 'Cafeteria Server', job_category: 'catering', county_name: 'Nairobi', area_name: 'Westlands', duration_text: 'Lunch hours', is_urgent: true, listing_status: 'active', pay_min: '10000.00', pay_max: '14000.00', employer_id: 'usr_1001', created_by: 'admin_1', internal_notes: '' },
  { _id: 'job_12349', job_title: 'Maths Tutor, First Years', job_category: 'tutoring', county_name: 'Nairobi', area_name: 'South B', duration_text: '2 evenings a week', is_urgent: false, listing_status: 'active', pay_min: '20000.00', pay_max: '30000.00', employer_id: 'usr_1001', created_by: 'admin_3', internal_notes: 'Needs transcript check' },
  { _id: 'job_12350', job_title: 'Bedsitter Caretaker', job_category: 'accommodation', county_name: 'Nairobi', area_name: 'Kasarani', duration_text: 'Ongoing', is_urgent: false, listing_status: 'closed', pay_min: '8000.00', pay_max: '10000.00', employer_id: 'usr_1001', created_by: 'admin_2', internal_notes: 'Filled in August' },
  { _id: 'job_12351', job_title: 'Library Shelving Assistant', job_category: 'campus', county_name: 'Mombasa', area_name: 'Nyali', duration_text: 'About 4 hours a day', is_urgent: false, listing_status: 'active', pay_min: '9500.50', pay_max: '11000.00', employer_id: 'usr_1001', created_by: 'admin_4', internal_notes: '' },
  { _id: 'job_12352', job_title: 'Delivery Rider, Student Meals', job_category: 'catering', county_name: 'Kiambu', area_name: 'Thika Road', duration_text: 'Lunch hours', is_urgent: false, listing_status: 'closed', pay_min: '11000.00', pay_max: '16000.00', employer_id: 'usr_1001', created_by: 'admin_4', internal_notes: 'Paused by partner' },
];

const SEED_APPLICATIONS = [
  { _id: 'app_1001', student_id: 'stu_0042', job_ref: 'job_12345', application_status: 'pending', preferred_at: '2027-01-15T09:00:00Z', student_note: 'Available after 2pm on weekdays', created_at: '2026-09-20T09:15:00Z', updated_at: '2026-09-20T09:15:00Z', reviewer_notes: '' },
  { _id: 'app_1002', student_id: 'stu_0107', job_ref: 'job_12348', application_status: 'accepted', preferred_at: '2026-10-12T07:30:00Z', student_note: '', created_at: '2026-09-17T10:00:00Z', updated_at: '2026-09-18T14:02:00Z', reviewer_notes: 'Start Monday' },
  { _id: 'app_1003', student_id: 'stu_0042', job_ref: 'job_12350', application_status: 'filled', preferred_at: '2026-10-20T13:00:00Z', student_note: 'Can start any weekday', created_at: '2026-09-14T08:00:00Z', updated_at: '2026-09-15T11:40:00Z', reviewer_notes: 'Job went to another worker' },
  { _id: 'app_1004', student_id: 'stu_0231', job_ref: 'job_12347', application_status: 'pending', preferred_at: '2027-02-01T08:00:00Z', student_note: 'Weekends only', created_at: '2026-09-12T08:30:00Z', updated_at: '2026-09-12T08:30:00Z', reviewer_notes: '' },
];

// Numbers the next new rows will get.
const FIRST_IDS = { job: 12353, application: 1005, user: 1003 };

// Password hashes are made once, when the server starts.
const seedUsers = () => SEED_USERS.map((u) => ({ ...u, password_hash: hashPasswordSync(DEMO_PASSWORD), created_at: '2026-09-01T00:00:00Z' }));

module.exports = { SEED_USERS, SEED_JOBS, SEED_APPLICATIONS, FIRST_IDS, DEMO_PASSWORD, seedUsers };
