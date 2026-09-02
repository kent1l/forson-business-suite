const request = require('supertest');
const express = require('express');

jest.mock('../db', () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    return { query, getClient: jest.fn().mockResolvedValue(client), __client: client };
});

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => { req.user = { employee_id: 10 }; next(); },
    hasPermission: () => (req, res, next) => next(),
}));

const db = require('../db');

/**
 * Route-level behaviour of the withholding endpoints. The arithmetic itself is
 * covered by withholdingTaxService.test.js; what matters here is that the routes
 * refuse to compute withholding from anything the caller supplies, and that a
 * certificate can never be made to cover the same withheld peso twice.
 */
describe('withholding routes', () => {
    let app;

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api', require('../routes/withholdingRoutes'));
    });

    beforeEach(() => {
        jest.clearAllMocks();
        db.query.mockResolvedValue({ rows: [] });
        db.__client.query.mockResolvedValue({ rows: [] });
    });

    describe('POST /withholding/preview', () => {
        test('returns not-applicable for a customer who is not a withholding agent', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ customer_id: 3, is_withholding_agent: false, customer_type: 'PRIVATE' }] });

            const res = await request(app)
                .post('/api/withholding/preview')
                .send({ customer_id: 3, lines: [{ part_id: 1, quantity: 1, sale_price: 100 }] });

            expect(res.status).toBe(200);
            expect(res.body.applicable).toBe(false);
            expect(res.body.total_withheld).toBe(0);
        });

        test('rejects a request with no lines rather than reporting zero withholding', async () => {
            const res = await request(app)
                .post('/api/withholding/preview')
                .send({ customer_id: 3, lines: [] });

            expect(res.status).toBe(400);
        });

        test('404s on an unknown customer', async () => {
            db.query.mockResolvedValueOnce({ rows: [] });

            const res = await request(app)
                .post('/api/withholding/preview')
                .send({ customer_id: 999, lines: [{ part_id: 1, quantity: 1, sale_price: 100 }] });

            expect(res.status).toBe(404);
        });

        test('computes the base from the part and rate tables, never from a client-sent base', async () => {
            db.query
                // customer
                .mockResolvedValueOnce({ rows: [{ customer_id: 3, is_withholding_agent: true, customer_type: 'PRIVATE' }] })
                // parts
                .mockResolvedValueOnce({ rows: [{ part_id: 1, tax_rate_id: 1, is_tax_inclusive_price: false, is_service: false }] })
                // calculateInvoiceTax: selected rate, all rates, rate names
                .mockResolvedValueOnce({ rows: [{ rate_percentage: '0.12' }] })
                .mockResolvedValueOnce({ rows: [{ tax_rate_id: 1, rate_percentage: '0.12' }] })
                .mockResolvedValueOnce({ rows: [{ tax_rate_id: 1, rate_name: 'VAT' }] })
                // withholding config
                .mockResolvedValueOnce({ rows: [] });

            const res = await request(app)
                .post('/api/withholding/preview')
                .send({
                    customer_id: 3,
                    tax_rate_id: 1,
                    // A client claiming an absurd base must have no effect.
                    lines: [{ part_id: 1, quantity: 1, sale_price: 10000, tax_base: 999999 }],
                });

            expect(res.status).toBe(200);
            expect(res.body.applicable).toBe(true);
            expect(res.body.total_withheld).toBe(100.00);   // 1% of 10,000, not of 999,999
            expect(res.body.invoice_total).toBe(11200.00);
            expect(res.body.net_due).toBe(11100.00);
            expect(res.body.ceiling).toBe(112.00);
        });
    });

    describe('POST /withholding/certificates', () => {
        test('rejects a certificate type that is not a real BIR form', async () => {
            const res = await request(app)
                .post('/api/withholding/certificates')
                .send({ customer_id: 3, certificate_type: '1701' });

            expect(res.status).toBe(400);
            expect(db.getClient).not.toHaveBeenCalled();
        });

        test('requires a customer', async () => {
            const res = await request(app)
                .post('/api/withholding/certificates')
                .send({ certificate_type: '2307' });

            expect(res.status).toBe(400);
        });

        test('refuses to attach a line already covered by another certificate', async () => {
            db.__client.query
                .mockResolvedValueOnce({ rows: [] })                                   // BEGIN
                .mockResolvedValueOnce({ rows: [{ certificate_id: 77, customer_id: 3 }] }) // INSERT
                .mockResolvedValueOnce({ rows: [                                       // SELECT ... FOR UPDATE
                    { wt_line_id: 5, customer_id: 3, certificate_id: 42 },
                ] });

            const res = await request(app)
                .post('/api/withholding/certificates')
                .send({ customer_id: 3, certificate_type: '2307', line_ids: [5] });

            expect(res.status).toBe(500);
            expect(res.body.message).toMatch(/already covered by another certificate/);
            const statements = db.__client.query.mock.calls.map(c => c[0]);
            expect(statements).toContain('ROLLBACK');
        });

        test('refuses to attach a line belonging to a different customer', async () => {
            db.__client.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ certificate_id: 77, customer_id: 3 }] })
                .mockResolvedValueOnce({ rows: [{ wt_line_id: 5, customer_id: 99, certificate_id: null }] });

            const res = await request(app)
                .post('/api/withholding/certificates')
                .send({ customer_id: 3, certificate_type: '2307', line_ids: [5] });

            expect(res.status).toBe(500);
            expect(res.body.message).toMatch(/different customer/);
        });

        test('returns 409 when the certificate number is already on file for the customer', async () => {
            const duplicate = Object.assign(new Error('duplicate key'), { code: '23505' });
            db.__client.query
                .mockResolvedValueOnce({ rows: [] })
                .mockRejectedValueOnce(duplicate);

            const res = await request(app)
                .post('/api/withholding/certificates')
                .send({ customer_id: 3, certificate_type: '2307', certificate_no: 'ABC-1' });

            expect(res.status).toBe(409);
        });
    });

    describe('GET /withholding/register', () => {
        test('requires an explicit period', async () => {
            const res = await request(app).get('/api/withholding/register');
            expect(res.status).toBe(400);
        });

        test('periodises on when the tax was withheld, not on the invoice date', async () => {
            await request(app).get('/api/withholding/register?date_from=2026-01-01&date_to=2026-03-31');

            const sql = db.query.mock.calls[0][0];
            expect(sql).toContain("(wtl.created_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2");
            expect(sql).not.toContain('i.invoice_date BETWEEN');
        });

        test('groups by ATC code, the granularity the BIR alphalist works at', async () => {
            await request(app).get('/api/withholding/register?date_from=2026-01-01&date_to=2026-03-31');

            const sql = db.query.mock.calls[0][0];
            expect(sql).toContain('wtl.atc_code');
            expect(sql).toMatch(/GROUP BY[\s\S]*wtl\.atc_code/);
        });

        test('excludes cancelled certificates from the substantiated figures', async () => {
            await request(app).get('/api/withholding/register?date_from=2026-01-01&date_to=2026-03-31');

            const sql = db.query.mock.calls[0][0];
            expect(sql).toContain("wtc.status <> 'CANCELLED'");
        });

        test('emits CSV with quotes doubled so a comma in a registered name cannot shift columns', async () => {
            db.query.mockResolvedValueOnce({ rows: [{
                payor_tin: '123-456-789-000',
                payor_name: 'ACME Corp., Inc. "Manila"',
                customer_type: 'PRIVATE',
                atc_code: 'WC158',
                withholding_type: 'EWT_GOODS',
                treatment: 'INCOME_TAX_CREDITABLE',
                rate: 0.01,
                tax_base: 10000,
                tax_withheld: 100,
                invoice_count: 2,
                substantiated_withheld: 60,
                certificate_nos: 'C-1; C-2',
            }] });

            const res = await request(app)
                .get('/api/withholding/register?date_from=2026-01-01&date_to=2026-03-31&format=csv');

            expect(res.headers['content-type']).toMatch(/text\/csv/);
            const [, dataRow] = res.text.split('\n');
            expect(dataRow).toContain('"ACME Corp., Inc. ""Manila"""');
            // Unsubstantiated is derived, not stored: 100 withheld less 60 proven.
            expect(dataRow).toContain('40.00');
        });
    });
});
