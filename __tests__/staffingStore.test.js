// Event work, data layer: the staffing_offers functions every store must have, and the
// internal jobs.source_role_id column. These run against whichever store db.js picks:
// memory by default, PostgreSQL when DATABASE_URL is set.

const db = require('../db');
const { toJob } = require('../mappers');

const DRAFT = {
  title: 'Waiters, Wanjiku and Otieno wedding', category: 'catering', county: 'Nairobi', area: 'Westlands',
  duration: 'One shift, 5 Dec 2026, about 10 hours', urgent: false, payMin: 1500, payMax: 1500,
};
const offer = (over = {}) => ({
  employerId: 'usr_1001', shereheOfferId: 'ofr_4001', roleId: 'rol_3001',
  eventName: 'Wanjiku and Otieno wedding', workersOffered: 6, jobDraft: DRAFT, ...over,
});

afterAll(async () => { if (db.close) await db.close(); });
beforeEach(async () => { await db.reset(); });

describe('createStaffingOffer', () => {
  it('stores a pending offer with the next sof_ id, no job yet, and the job draft kept', async () => {
    const row = await db.createStaffingOffer(offer());

    expect(row._id).toBe('sof_1001');
    expect(row).toMatchObject({
      employer_id: 'usr_1001', sherehe_offer_id: 'ofr_4001', role_id: 'rol_3001',
      event_name: 'Wanjiku and Otieno wedding', workers_offered: 6, status: 'pending', job_id: null,
    });
    expect(row.job_draft).toEqual(DRAFT);
    expect(row.created_at).toBeInstanceOf(Date);
  });

  it('refuses a second pending offer on the same role, and stores nothing', async () => {
    await db.createStaffingOffer(offer());

    const second = await db.createStaffingOffer(offer({ employerId: 'usr_1002', shereheOfferId: 'ofr_4002' }));

    expect(second).toBeNull();
    expect(await db.findPendingStaffingOffers()).toHaveLength(1);
  });

  it('allows an offer on a different role, and a new one once the earlier one was declined', async () => {
    const first = await db.createStaffingOffer(offer());
    const other = await db.createStaffingOffer(offer({ shereheOfferId: 'ofr_4002', roleId: 'rol_3003' }));
    await db.declineStaffingOffer(first._id);

    const again = await db.createStaffingOffer(offer({ shereheOfferId: 'ofr_4003' }));

    expect(other._id).toBe('sof_1002');
    expect(again._id).toBe('sof_1003');
  });
});

describe('reading staffing offers', () => {
  it('finds one by id, or null', async () => {
    const row = await db.createStaffingOffer(offer());

    expect((await db.findStaffingOfferById(row._id)).role_id).toBe('rol_3001');
    expect(await db.findStaffingOfferById('sof_9999')).toBeNull();
  });

  it('finds the pending offer for a role, and not a finished one', async () => {
    const row = await db.createStaffingOffer(offer());
    expect((await db.findPendingStaffingOffer('rol_3001'))._id).toBe(row._id);

    await db.declineStaffingOffer(row._id);

    expect(await db.findPendingStaffingOffer('rol_3001')).toBeNull();
  });

  it("lists one employer's offers newest first, and nobody else's", async () => {
    await db.createStaffingOffer(offer());
    await db.createStaffingOffer(offer({ shereheOfferId: 'ofr_4002', roleId: 'rol_3003' }));
    await db.createStaffingOffer(offer({ employerId: 'usr_1002', shereheOfferId: 'ofr_4003', roleId: 'rol_3004' }));

    const mine = await db.findStaffingOffersByEmployer('usr_1001');

    expect(mine.map((o) => o._id)).toEqual(['sof_1002', 'sof_1001']);
  });

  it('lists only pending offers for the poller, oldest first', async () => {
    const a = await db.createStaffingOffer(offer());
    await db.createStaffingOffer(offer({ shereheOfferId: 'ofr_4002', roleId: 'rol_3003' }));
    await db.createStaffingOffer(offer({ shereheOfferId: 'ofr_4003', roleId: 'rol_3004' }));
    await db.declineStaffingOffer(a._id);

    const pending = await db.findPendingStaffingOffers();

    expect(pending.map((o) => o._id)).toEqual(['sof_1002', 'sof_1003']);
  });
});

describe('deleteStaffingOffer', () => {
  it('removes a pending offer for good', async () => {
    const row = await db.createStaffingOffer(offer());

    const removed = await db.deleteStaffingOffer(row._id);

    expect(removed._id).toBe(row._id);
    expect(await db.findStaffingOfferById(row._id)).toBeNull();
  });

  it('leaves an accepted or declined offer alone, and returns null', async () => {
    const accepted = await db.createStaffingOffer(offer());
    const declined = await db.createStaffingOffer(offer({ shereheOfferId: 'ofr_4002', roleId: 'rol_3003' }));
    await db.acceptStaffingOffer(accepted._id);
    await db.declineStaffingOffer(declined._id);

    expect(await db.deleteStaffingOffer(accepted._id)).toBeNull();
    expect(await db.deleteStaffingOffer(declined._id)).toBeNull();
    expect(await db.findStaffingOfferById(accepted._id)).not.toBeNull();
  });
});

describe('declineStaffingOffer', () => {
  it('marks a pending offer declined, once', async () => {
    const row = await db.createStaffingOffer(offer());

    expect((await db.declineStaffingOffer(row._id)).status).toBe('declined');
    expect(await db.declineStaffingOffer(row._id)).toBeNull();
    expect(await db.declineStaffingOffer('sof_9999')).toBeNull();
  });
});

describe('acceptStaffingOffer', () => {
  it("marks the offer accepted and opens an active job for the offer's employer from the draft", async () => {
    const row = await db.createStaffingOffer(offer());

    const done = await db.acceptStaffingOffer(row._id);

    expect(done.offer.status).toBe('accepted');
    expect(done.offer.job_id).toBe(done.job._id);
    expect(done.job).toMatchObject({
      job_title: 'Waiters, Wanjiku and Otieno wedding', job_category: 'catering', county_name: 'Nairobi',
      area_name: 'Westlands', duration_text: 'One shift, 5 Dec 2026, about 10 hours', is_urgent: false,
      listing_status: 'active', employer_id: 'usr_1001', source_role_id: 'rol_3001',
    });
    expect(Number(done.job.pay_min)).toBe(1500);
    expect(Number(done.job.pay_max)).toBe(1500);
    expect((await db.findStaffingOfferById(row._id)).job_id).toBe(done.job._id);
  });

  it('makes only one job however many times it is called', async () => {
    const row = await db.createStaffingOffer(offer());
    const before = (await db.findJobs({ status: 'active' })).length;

    const results = await Promise.all([db.acceptStaffingOffer(row._id), db.acceptStaffingOffer(row._id)]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await db.findJobs({ status: 'active' })).length).toBe(before + 1);
  });

  it('does nothing for an offer that is not pending', async () => {
    const row = await db.createStaffingOffer(offer());
    await db.declineStaffingOffer(row._id);

    expect(await db.acceptStaffingOffer(row._id)).toBeNull();
    expect(await db.acceptStaffingOffer('sof_9999')).toBeNull();
  });
});

describe('jobs.source_role_id', () => {
  it('is kept on the stored job but never appears in the Job the API sends', async () => {
    const row = await db.createStaffingOffer(offer());
    const { job } = await db.acceptStaffingOffer(row._id);

    expect((await db.findJobById(job._id)).source_role_id).toBe('rol_3001');
    expect(Object.keys(toJob(job)).sort()).toEqual(['area', 'category', 'county', 'duration', 'id', 'payRange', 'status', 'title', 'urgent']);
  });

  it('is empty for an ordinary job', async () => {
    const job = await db.createJob({ employerId: 'usr_1001', title: 'Fix sink', category: 'plumbing', county: 'Nairobi', area: 'Westlands', duration: '2 hours', urgent: false, payMin: 1500, payMax: 1500 });

    expect(job.source_role_id ?? null).toBeNull();
  });
});
