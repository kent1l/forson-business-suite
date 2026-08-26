const request = require('supertest');
const express = require('express');

// Mock DB
jest.mock('../db', () => {
    const queryFn = jest.fn();
    const clientQueryFn = jest.fn();
    const releaseFn = jest.fn();
    return {
        query: queryFn,
        getClient: jest.fn(async () => ({ query: clientQueryFn, release: releaseFn })),
        __client: { query: clientQueryFn, release: releaseFn }
    };
});

// Mock Auth Middleware
jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = req.user || { employee_id: 1, username: 'testadmin', permission_level_id: 10 };
        next();
    },
    hasPermission: () => (req, res, next) => next(),
    isAdmin: (req, res, next) => next()
}));

// Mock category vector service — the routes fire this off in the background
// (not awaited) after a category create/update; left unmocked it runs its real
// implementation against the same mocked `db.query`, consuming mock values meant
// for unrelated tests at unpredictable times.
jest.mock('../services/expenseCategoryVectorService', () => ({
    refreshDefinitionEmbeddings: jest.fn().mockResolvedValue(0)
}));

// Mock AI Parser service
jest.mock('../services/expenseAIParser', () => ({
    parseExpenseText: jest.fn().mockImplementation(async (text) => {
        if (!text || text.length < 3) {
            const err = new Error('Text too short for AI parsing');
            err.statusCode = 400;
            throw err;
        }
        return {
            parsed: {
                amount: 2500,
                category_id: 2,
                category_name: 'Utilities',
                payee: 'Meralco',
                payment_method_id: 1,
                payment_method_text: 'Cash',
                expense_date: '2026-07-23',
                reference_no: null,
                notes: 'electricity',
                confidence: { overall: 0.95, category: 0.98, amount: 1, date: 0.9, payment_method: 0.95 }
            },
            provider: 'google'
        };
    })
}));

const db = require('../db');
const expenseCategoryRouter = require('../routes/expenseCategoryRoutes');
const expenseRouter = require('../routes/expenseRoutes');

const app = express();
app.use(express.json());
app.use('/api', expenseCategoryRouter);
app.use('/api', expenseRouter);

describe('Expense Recording Module Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /api/expense-categories', () => {
        test('should return list of active expense categories', async () => {
            db.query.mockResolvedValueOnce({
                rows: [
                    { category_id: 1, category_name: 'Rent', sort_order: 1, is_active: true },
                    { category_id: 2, category_name: 'Utilities', sort_order: 2, is_active: true }
                ]
            });

            const res = await request(app).get('/api/expense-categories');
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(2);
            expect(res.body[0].category_name).toBe('Rent');
        });
    });

    describe('POST /api/expense-categories', () => {
        test('should create new category when valid', async () => {
            db.query.mockResolvedValueOnce({ rows: [] }); // check duplicate
            db.query.mockResolvedValueOnce({
                rows: [{ category_id: 10, category_name: 'Marketing', sort_order: 9, is_active: true }]
            }); // insert

            const res = await request(app)
                .post('/api/expense-categories')
                .send({ category_name: 'Marketing', description: 'Ads & flyers', sort_order: 9 });

            expect(res.status).toBe(201);
            expect(res.body.category_name).toBe('Marketing');
        });

        test('should reject duplicate category name (case-insensitive)', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ category_id: 1 }] });

            const res = await request(app)
                .post('/api/expense-categories')
                .send({ category_name: 'RENT' });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/already exists/i);
        });
    });

    describe('GET /api/expenses', () => {
        test('should return paginated expense records', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ total: 1 }] }); // count
            db.query.mockResolvedValueOnce({
                rows: [{
                    expense_id: 1,
                    expense_date: '2026-07-23',
                    amount: '2500.00',
                    payee: 'Meralco',
                    category: { category_id: 2, category_name: 'Utilities' }
                }]
            }); // query

            const res = await request(app).get('/api/expenses?page=1&limit=25');
            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.pagination.totalItems).toBe(1);
        });
    });

    describe('POST /api/expenses', () => {
        test('should create a new expense record', async () => {
            db.query.mockResolvedValueOnce({ rows: [] }); // period lock check (open)
            db.query.mockResolvedValueOnce({ rows: [{ category_id: 2 }] }); // check category
            db.query.mockResolvedValueOnce({ rows: [{ method_id: 1, name: 'Cash' }] }); // check payment method
            db.query.mockResolvedValueOnce({ rows: [{ expense_id: 100 }] }); // insert
            db.query.mockResolvedValueOnce({
                rows: [{
                    expense_id: 100,
                    expense_date: '2026-07-23',
                    amount: 1500,
                    payee: 'Store Landlord',
                    category: { category_id: 2, category_name: 'Utilities' }
                }]
            }); // fetch joined

            const res = await request(app)
                .post('/api/expenses')
                .send({
                    expense_date: '2026-07-23',
                    category_id: 2,
                    amount: 1500,
                    payee: 'Store Landlord',
                    payment_method_id: 1
                });

            expect(res.status).toBe(201);
            expect(res.body.expense_id).toBe(100);
        });

        test('should reject invalid amount', async () => {
            const res = await request(app)
                .post('/api/expenses')
                .send({
                    expense_date: '2026-07-23',
                    category_id: 2,
                    amount: -50
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/greater than 0/i);
        });
    });

    describe('PUT /api/expenses/:id/void', () => {
        test('should void active expense record with reason', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ is_void: false, expense_date: '2026-07-23' }] }); // check existing
            db.query.mockResolvedValueOnce({ rows: [] }); // period lock check (open)
            db.query.mockResolvedValueOnce({ rows: [] }); // update void
            db.query.mockResolvedValueOnce({
                rows: [{ expense_id: 1, is_void: true, void_reason: 'Entered in error' }]
            }); // fetch

            const res = await request(app)
                .put('/api/expenses/1/void')
                .send({ void_reason: 'Entered in error' });

            expect(res.status).toBe(200);
            expect(res.body.is_void).toBe(true);
        });

        test('should reject voiding without valid reason', async () => {
            const res = await request(app)
                .put('/api/expenses/1/void')
                .send({ void_reason: 'no' });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/minimum 5 characters/i);
        });
    });

    describe('PUT /api/expense-categories/reorder', () => {
        test('should run all updates on a single pooled client inside one transaction', async () => {
            const client = db.__client;
            client.query.mockResolvedValue({ rows: [] });

            const res = await request(app)
                .put('/api/expense-categories/reorder')
                .send({ items: [{ category_id: 1, sort_order: 2 }, { category_id: 2, sort_order: 1 }] });

            expect(res.status).toBe(200);
            expect(db.getClient).toHaveBeenCalled();

            // BEGIN/COMMIT and both UPDATEs must go through the SAME client, not the pool.
            const statements = client.query.mock.calls.map(c => c[0]);
            expect(statements[0]).toBe('BEGIN');
            expect(statements[statements.length - 1]).toBe('COMMIT');
            expect(statements.filter(s => /UPDATE expense_category/.test(s))).toHaveLength(2);
            expect(client.release).toHaveBeenCalled();
        });

        test('should roll back on the same client when an update fails', async () => {
            const client = db.__client;
            client.query
                .mockResolvedValueOnce({ rows: [] })            // BEGIN
                .mockRejectedValueOnce(new Error('db exploded')); // first UPDATE

            const res = await request(app)
                .put('/api/expense-categories/reorder')
                .send({ items: [{ category_id: 1, sort_order: 2 }] });

            expect(res.status).toBe(500);
            expect(client.query).toHaveBeenCalledWith('ROLLBACK');
            expect(client.release).toHaveBeenCalled();
        });
    });

    describe('PUT /api/expenses/:id validation parity with POST', () => {
        const validBody = {
            expense_date: '2026-07-23',
            category_id: 2,
            amount: 1500
        };

        test('should reject an amount above the maximum limit', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ is_void: false }] }); // existing lookup

            const res = await request(app)
                .put('/api/expenses/1')
                .send({ ...validBody, amount: 100000000 });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/maximum limit/i);
        });

        test('should reject a date more than 365 days in the future', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ is_void: false }] });

            const res = await request(app)
                .put('/api/expenses/1')
                .send({ ...validBody, expense_date: '2099-01-01' });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/365 days/i);
        });

        test('should reject an inactive or invalid category', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ is_void: false, expense_date: validBody.expense_date }] }); // existing lookup
            db.query.mockResolvedValueOnce({ rows: [] });                   // period lock check (open)
            db.query.mockResolvedValueOnce({ rows: [] });                   // category lookup misses

            const res = await request(app).put('/api/expenses/1').send(validBody);

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/invalid or inactive/i);
        });
    });

    describe('Payment method validation', () => {
        test('POST should reject a disabled or unknown payment method instead of silently using Cash', async () => {
            db.query.mockResolvedValueOnce({ rows: [] }); // period lock check (open)
            db.query.mockResolvedValueOnce({ rows: [{ category_id: 2 }] }); // category ok
            db.query.mockResolvedValueOnce({ rows: [] });                   // payment method misses

            const res = await request(app)
                .post('/api/expenses')
                .send({ expense_date: '2026-07-23', category_id: 2, amount: 1500, payment_method_id: 99 });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/payment method is invalid or disabled/i);
        });

        test('PUT should reject switching to a disabled payment method', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ is_void: false, payment_method_id: 1, expense_date: '2026-07-23' }] });
            db.query.mockResolvedValueOnce({ rows: [] }); // period lock check (open)
            db.query.mockResolvedValueOnce({ rows: [{ category_id: 2 }] }); // category ok
            db.query.mockResolvedValueOnce({ rows: [] });                   // payment method misses

            const res = await request(app)
                .put('/api/expenses/1')
                .send({ expense_date: '2026-07-23', category_id: 2, amount: 1500, payment_method_id: 99 });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/payment method is invalid or disabled/i);
        });

        test('PUT should still allow editing a record whose original method was later disabled', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ is_void: false, payment_method_id: 7, expense_date: '2026-07-23' }] });
            db.query.mockResolvedValueOnce({ rows: [] }); // period lock check (open)
            db.query.mockResolvedValueOnce({ rows: [{ category_id: 2 }] });          // category ok
            db.query.mockResolvedValueOnce({ rows: [{ method_id: 7, name: 'Cheque' }] }); // grandfathered
            db.query.mockResolvedValueOnce({ rows: [] });                            // update
            db.query.mockResolvedValueOnce({ rows: [{ expense_id: 1, amount: 1500 }] }); // fetch

            const res = await request(app)
                .put('/api/expenses/1')
                .send({ expense_date: '2026-07-23', category_id: 2, amount: 1500, payment_method_id: 7 });

            expect(res.status).toBe(200);
            // The grandfather clause must be scoped to the record's own current method.
            const pmCall = db.query.mock.calls.find(c => /FROM payment_methods/.test(c[0]));
            expect(pmCall[1]).toEqual([7, true]);
        });
    });

    describe('Expense summary endpoints', () => {
        test('by-category should coerce SUM strings to numbers for the dashboard', async () => {
            db.query.mockResolvedValueOnce({
                rows: [
                    { category_id: 1, category_name: 'Rent', total_amount: '25000.00', count: 2 },
                    { category_id: 2, category_name: 'Utilities', total_amount: '4500.50', count: 3 }
                ]
            });

            const res = await request(app)
                .get('/api/expenses/summary/by-category')
                .query({ date_from: '2026-07-01', date_to: '2026-07-31' });

            expect(res.status).toBe(200);
            expect(res.body[0].total_amount).toBe(25000);
            expect(res.body[1].total_amount).toBe(4500.5);
            // Voided expenses must never reach the totals.
            expect(db.query.mock.calls[0][0]).toMatch(/e\.is_void = false/);
        });

        test('monthly should exclude voided expenses and return numeric totals', async () => {
            db.query.mockResolvedValueOnce({
                rows: [{ month_key: '2026-07', month_label: 'Jul 2026', year: 2026, month: 7, total_amount: '29500.50', count: 5 }]
            });

            const res = await request(app).get('/api/expenses/summary/monthly');

            expect(res.status).toBe(200);
            expect(res.body[0].total_amount).toBe(29500.5);
            expect(db.query.mock.calls[0][0]).toMatch(/is_void = false/);
        });
    });

    describe('GET /api/expenses/check-duplicate', () => {
        test('should flag an existing expense with the same date, amount, and payee', async () => {
            db.query.mockResolvedValueOnce({
                rows: [{ expense_id: 42, amount: '1500.00', payee: 'Meralco' }]
            });

            const res = await request(app)
                .get('/api/expenses/check-duplicate')
                .query({ expense_date: '2026-07-23', amount: 1500, payee: 'Meralco' });

            expect(res.status).toBe(200);
            expect(res.body.isDuplicate).toBe(true);
            expect(res.body.matches).toHaveLength(1);
        });

        test('should report no duplicate when nothing matches', async () => {
            db.query.mockResolvedValueOnce({ rows: [] });

            const res = await request(app)
                .get('/api/expenses/check-duplicate')
                .query({ expense_date: '2026-07-23', amount: 1500 });

            expect(res.status).toBe(200);
            expect(res.body.isDuplicate).toBe(false);
        });
    });

    describe('GET /api/expenses/payees', () => {
        test('should return distinct payee names ordered by usage', async () => {
            db.query.mockResolvedValueOnce({
                rows: [{ payee: 'Meralco', use_count: 12 }, { payee: 'Shell', use_count: 3 }]
            });

            const res = await request(app).get('/api/expenses/payees').query({ q: 'me' });

            expect(res.status).toBe(200);
            expect(res.body).toEqual(['Meralco', 'Shell']);
        });
    });

    describe('POST /api/expenses/parse', () => {
        test('should return structured parse response for natural language text', async () => {
            const res = await request(app)
                .post('/api/expenses/parse')
                .send({ text: 'paid 2500 for electricity to Meralco' });

            expect(res.status).toBe(200);
            expect(res.body.parsed.category_name).toBe('Utilities');
            expect(res.body.parsed.amount).toBe(2500);
        });
    });
});
