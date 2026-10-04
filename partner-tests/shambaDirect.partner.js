// Week 7, Part C: our tests against our upstream ring partner, Shamba Direct (Team 14).
//
// Written from Shamba Direct's openapi.yaml ONLY, the way a real consumer would,
// with no knowledge of how their code works. Every test runs against their real,
// running API.
//
// How to run (Windows Command Prompt, in this project folder):
//   set SHAMBA_URL=https://their-api-address
//   npm run test:partner
//
// Optional: if their real IDs differ from the examples in their contract, set
//   LISTING_ID, FARMER_ID, HQ_ID and BUYER_ID the same way before running.

const request = require('supertest');

const BASE = (process.env.SHAMBA_URL || '').replace(/\/+$/, '');
const LISTING_ID = Number(process.env.LISTING_ID || 1); // their contract's example id
const FARMER_ID = Number(process.env.FARMER_ID || 1);
const HQ_ID = Number(process.env.HQ_ID || 1);
const BUYER_ID = Number(process.env.BUYER_ID || 3);
const MISSING_ID = 999999; // an ID that should not exist

jest.setTimeout(90000); // free hosts can take up to a minute to wake up

const api = () => request(BASE);
const isInt = (v) => Number.isInteger(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string';
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// Shapes, taken field by field from Shamba Direct's contract
function expectListingSummary(x) {
  expect(isInt(x.id)).toBe(true);
  expect(isStr(x.name)).toBe(true);
  expect(isNum(x.price_per_kg)).toBe(true);
  expect(isInt(x.quantity_kg)).toBe(true);
  expect(isStr(x.category)).toBe(true);
  expect(isStr(x.county)).toBe(true);
}

function expectListingDetail(x) {
  expectListingSummary(x);
  expect(isInt(x.farmer_id)).toBe(true);
  expect(isStr(x.farmer_name)).toBe(true);
  expect(typeof x.farmer_verified).toBe('boolean');
  expect(isInt(x.views)).toBe(true);
}

function expectMarketPrice(x) {
  expect(isStr(x.crop_name)).toBe(true);
  expect(isNum(x.price_per_kg)).toBe(true);
  expect(isStr(x.county)).toBe(true);
}

function expectRating(x) {
  expect(isInt(x.farmer_id)).toBe(true);
  expect(isStr(x.farmer_name)).toBe(true);
  expect(isNum(x.rating)).toBe(true);
}

function expectHeadquarters(x) {
  expect(isInt(x.id)).toBe(true);
  expect(isStr(x.region_name)).toBe(true);
  expect(isStr(x.address)).toBe(true);
  expect(isStr(x.county)).toBe(true);
  expect(isNum(x.latitude)).toBe(true);
  expect(isNum(x.longitude)).toBe(true);
  expect(x.latitude).toBeGreaterThanOrEqual(-90);   // a real place on earth
  expect(x.latitude).toBeLessThanOrEqual(90);
  expect(x.longitude).toBeGreaterThanOrEqual(-180);
  expect(x.longitude).toBeLessThanOrEqual(180);
}

beforeAll(() => {
  if (!BASE) throw new Error('Set SHAMBA_URL to Shamba Direct\'s API address first, for example: set SHAMBA_URL=https://their-api.onrender.com');
});

describe('GET /listings', () => {
  it('returns a list of listings with the contract fields and types', async () => {
    const res = await api().get('/listings');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    res.body.forEach(expectListingSummary);
  });

  it('filters by county: every listing returned is in that county', async () => {
    const res = await api().get('/listings?county=Kirinyaga');

    expect(res.status).toBe(200);
    res.body.forEach((x) => expect(same(x.county, 'Kirinyaga')).toBe(true));
  });

  it('edge case: a county with no produce returns an empty list, not an error', async () => {
    const res = await api().get('/listings?county=NoSuchCounty');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('GET /listings/{listing_id}', () => {
  it('returns one listing with every contract field, including farmer details', async () => {
    const res = await api().get(`/listings/${LISTING_ID}`);

    expect(res.status).toBe(200);
    expectListingDetail(res.body);
    expect(res.body.id).toBe(LISTING_ID);
  });

  it('returns 404 for a listing that does not exist', async () => {
    const res = await api().get(`/listings/${MISSING_ID}`);

    expect(res.status).toBe(404);
  });

  it('edge case: a listing id that is not an integer is rejected with a 4xx, not a crash', async () => {
    const res = await api().get('/listings/abc');

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe('GET /market-prices', () => {
  it('returns prices with the contract fields and types', async () => {
    const res = await api().get('/market-prices');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    res.body.forEach(expectMarketPrice);
  });

  it('filters by county when a county is given', async () => {
    const res = await api().get('/market-prices?county=Kirinyaga');

    expect(res.status).toBe(200);
    res.body.forEach((x) => expect(same(x.county, 'Kirinyaga')).toBe(true));
  });
});

describe('GET /farmers/ratings', () => {
  it('returns farmer ratings with the contract fields and types', async () => {
    const res = await api().get('/farmers/ratings');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    res.body.forEach(expectRating);
  });
});

describe('GET /farmers/{farmer_id}/rating', () => {
  it('returns the rating for that farmer (the contract says a list)', async () => {
    const res = await api().get(`/farmers/${FARMER_ID}/rating`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    res.body.forEach((x) => {
      expectRating(x);
      expect(x.farmer_id).toBe(FARMER_ID);
    });
  });

  it('returns 404 for a farmer that does not exist', async () => {
    const res = await api().get(`/farmers/${MISSING_ID}/rating`);

    expect(res.status).toBe(404);
  });
});

describe('GET /headquarters', () => {
  it('returns hubs with the contract fields, types and real coordinates', async () => {
    const res = await api().get('/headquarters');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    res.body.forEach(expectHeadquarters);
  });

  it('filters by county when a county is given', async () => {
    const res = await api().get('/headquarters?county=nairobi');

    expect(res.status).toBe(200);
    res.body.forEach((x) => expect(same(x.county, 'nairobi')).toBe(true));
  });
});

describe('GET /headquarters/{id}', () => {
  it('returns one hub with the contract fields', async () => {
    const res = await api().get(`/headquarters/${HQ_ID}`);

    expect(res.status).toBe(200);
    expectHeadquarters(res.body);
    expect(res.body.id).toBe(HQ_ID);
  });

  it('returns 404 for a hub that does not exist', async () => {
    const res = await api().get(`/headquarters/${MISSING_ID}`);

    expect(res.status).toBe(404);
  });
});

describe('POST /enquires (path spelled as in their contract)', () => {
  const valid = () => ({ product_id: LISTING_ID, buyer_id: BUYER_ID, message: 'Kazi Connect partner test: interested in 200kg' });

  it('creates an enquiry: 201 with a message and a new integer id', async () => {
    const res = await api().post('/enquires').send(valid());

    expect(res.status).toBe(201);
    expect(isStr(res.body.message)).toBe(true);
    expect(isInt(res.body.id)).toBe(true);
  });

  it.each([
    ['product_id is missing', 'product_id'],
    ['buyer_id is missing', 'buyer_id'],
    ['message is missing', 'message'],
  ])('rejects the enquiry with 400 when %s', async (_name, field) => {
    const body = valid();
    delete body[field];

    const res = await api().post('/enquires').send(body);

    expect(res.status).toBe(400);
  });

  it('rejects the enquiry with 400 when product_id is not an integer', async () => {
    const res = await api().post('/enquires').send({ ...valid(), product_id: 'abc' });

    expect(res.status).toBe(400);
  });

  it('returns 404 when the listing does not exist', async () => {
    const res = await api().post('/enquires').send({ ...valid(), product_id: MISSING_ID });

    expect(res.status).toBe(404);
  });
});
