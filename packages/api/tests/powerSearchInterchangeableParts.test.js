const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../meilisearch', () => ({ meiliClient: { index: jest.fn() } }));
jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => next(),
    hasPermission: () => (req, res, next) => next(),
}));

const db = require('../db');
const router = require('../routes/powerSearchRoutes');
const app = express();
app.use('/', router);

beforeEach(() => jest.clearAllMocks());

test('interchangeable lookup normalizes case and punctuation in PostgreSQL', async () => {
    db.query.mockImplementation((sql) => {
        if (/information_schema\.columns/i.test(sql)) return Promise.resolve({ rowCount: 1, rows: [{}] });
        return Promise.resolve({ rows: [{
            part_id: 9,
            internal_sku: 'ALT-9',
            display_name: 'Alternate filter',
            matching_part_numbers: ['AB-123'],
            stock_on_hand: '4',
        }] });
    });

    const res = await request(app).get('/power-search/interchangeable-parts?part_ids=2,2,not-an-id');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const [sql, params] = db.query.mock.calls.find(([query]) => /WITH searched_numbers/i.test(query));
    expect(sql).toContain("REGEXP_REPLACE(LOWER(pn.part_number), '[^a-z0-9]', '', 'g')");
    expect(sql).toContain('pn.part_id <> ALL($1::int[])');
    expect(params).toEqual([[2]]);
});

test('interchangeable lookup rejects an empty part-id list without querying', async () => {
    const res = await request(app).get('/power-search/interchangeable-parts?part_ids=nope');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
});
