const request = require('supertest');
const express = require('express');

// Mock db module
jest.mock('../db', () => {
    const queryFn = jest.fn();
    const client = {
        query: jest.fn(),
        release: jest.fn()
    };
    return {
        query: queryFn,
        getClient: jest.fn().mockResolvedValue(client)
    };
});

// Mock auth middleware
jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = req.user || { user_id: 1, employee_id: 1, username: 'testuser', permission_level_id: 10 };
        next();
    },
    hasPermission: () => (req, res, next) => next(),
    isAdmin: (req, res, next) => {
        if (req.user && req.user.permission_level_id === 10) {
            return next();
        }
        return res.status(403).json({ message: 'Forbidden: Admin access required.' });
    }
}));

const db = require('../db');
const paymentMethodRouter = require('../routes/paymentMethodRoutes');

const app = express();
app.use(express.json());
app.use('/api', paymentMethodRouter);

describe('Payment Method Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /api/payment-methods', () => {
        test('should return all payment methods with parsed settlement_type', async () => {
            const mockRows = [
                {
                    method_id: 1,
                    code: 'CASH',
                    name: 'Cash',
                    type: 'cash',
                    enabled: true,
                    sort_order: 1,
                    config: JSON.stringify({ settlement_type: 'instant' })
                },
                {
                    method_id: 2,
                    code: 'ON_ACCOUNT',
                    name: 'On Account',
                    type: 'credit',
                    enabled: true,
                    sort_order: 2,
                    config: JSON.stringify({ settlement_type: 'deferred' })
                }
            ];

            db.query.mockResolvedValueOnce({ rows: mockRows });

            const res = await request(app).get('/api/payment-methods');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(2);
            expect(res.body[0].code).toBe('CASH');
            expect(res.body[0].settlement_type).toBe('instant');
            expect(res.body[1].settlement_type).toBe('deferred');
        });

        test('should handle database errors gracefully', async () => {
            db.query.mockRejectedValueOnce(new Error('DB failure'));

            const res = await request(app).get('/api/payment-methods');

            expect(res.status).toBe(500);
            expect(res.body.message).toMatch(/Server error/i);
        });
    });

    describe('GET /api/payment-methods/enabled', () => {
        test('should fetch only enabled payment methods', async () => {
            const mockRows = [
                {
                    method_id: 1,
                    code: 'CASH',
                    name: 'Cash',
                    enabled: true,
                    config: { settlement_type: 'instant' }
                }
            ];

            db.query.mockResolvedValueOnce({ rows: mockRows });

            const res = await request(app).get('/api/payment-methods/enabled');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].enabled).toBe(true);
        });
    });

    describe('PUT /api/payment-methods/:id', () => {
        test('should return 400 if required fields are missing', async () => {
            const res = await request(app)
                .put('/api/payment-methods/1')
                .send({ name: 'Cash' });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/required/i);
        });

        test('should update payment method successfully', async () => {
            const client = await db.getClient();
            client.query
                .mockResolvedValueOnce({}) // BEGIN
                .mockResolvedValueOnce({ rows: [{ method_id: 1, enabled: true }] }) // SELECT existing
                .mockResolvedValueOnce({
                    rows: [{
                        method_id: 1,
                        code: 'CASH',
                        name: 'Cash',
                        type: 'cash',
                        enabled: true,
                        sort_order: 1,
                        config: { settlement_type: 'instant' }
                    }]
                }) // UPDATE
                .mockResolvedValueOnce({}); // COMMIT

            const res = await request(app)
                .put('/api/payment-methods/1')
                .send({
                    code: 'CASH',
                    name: 'Cash',
                    type: 'cash',
                    enabled: true,
                    sort_order: 1,
                    config: { settlement_type: 'instant' }
                });

            expect(res.status).toBe(200);
            expect(res.body.code).toBe('CASH');
            expect(client.query).toHaveBeenCalledWith('BEGIN');
            expect(client.query).toHaveBeenCalledWith('COMMIT');
        });
    });
});
