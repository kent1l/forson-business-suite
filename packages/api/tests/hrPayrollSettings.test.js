const request = require('supertest');
const express = require('express');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

jest.mock('../db', () => {
    const queryFn = jest.fn();
    const clientQueryFn = jest.fn();
    const releaseFn = jest.fn();
    return {
        query: queryFn,
        getClient: jest.fn(async () => ({ query: clientQueryFn, release: releaseFn })),
        __client: { query: clientQueryFn, release: releaseFn },
    };
});

let mockGrantedPermissions = null;
let mockCurrentUser = { employee_id: 1, username: 'testadmin', permission_level_id: 10 };

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = mockCurrentUser;
        next();
    },
    hasPermission: (keyOrKeys) => (req, res, next) => {
        if (mockCurrentUser.permission_level_id === 10) return next();
        if (mockGrantedPermissions === null) return next();
        const needed = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
        if (needed.some((k) => mockGrantedPermissions.includes(k))) return next();
        return res.status(403).json({ message: 'Forbidden' });
    },
    isAdmin: (req, res, next) => {
        if (Number(mockCurrentUser.permission_level_id) !== 10) {
            return res.status(403).json({ message: 'Admin only' });
        }
        next();
    },
}));

const db = require('../db');
const payrollRoutes = require('../routes/payrollRoutes');

const app = express();
app.use(express.json());
app.use('/api/payroll', payrollRoutes);

describe('Payroll Settings API', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGrantedPermissions = ['payroll:config'];
        mockCurrentUser = { employee_id: 2, username: 'payroll_officer', permission_level_id: 3 };
    });

    describe('GET /api/payroll/settings', () => {
        it('returns payroll settings', async () => {
            db.query.mockResolvedValueOnce({
                rows: [
                    { setting_key: 'PAYROLL_STATUTORY_SCHEDULE', setting_value: 'SPLIT_HALF' },
                    { setting_key: 'PAYROLL_WORKING_DAYS_PER_YEAR', setting_value: '313' },
                ],
            });

            const res = await request(app).get('/api/payroll/settings');
            expect(res.status).toBe(200);
            expect(res.body.PAYROLL_STATUTORY_SCHEDULE).toBe('SPLIT_HALF');
            expect(res.body.PAYROLL_WORKING_DAYS_PER_YEAR).toBe('313');
        });

        it('denies access if missing payroll:config permission', async () => {
            mockGrantedPermissions = ['payroll:view'];
            const res = await request(app).get('/api/payroll/settings');
            expect(res.status).toBe(403);
        });
    });

    describe('PUT /api/payroll/settings', () => {
        it('rejects invalid statutory schedule value', async () => {
            const res = await request(app)
                .put('/api/payroll/settings')
                .send({ PAYROLL_STATUTORY_SCHEDULE: 'INVALID_SCHEDULE' });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/SPLIT_HALF or SECOND_CUTOFF/);
        });

        it('updates statutory schedule successfully', async () => {
            db.__client.query.mockImplementation(async (sql) => {
                if (sql.includes('SELECT setting_key, setting_value FROM settings')) {
                    return {
                        rows: [
                            { setting_key: 'PAYROLL_STATUTORY_SCHEDULE', setting_value: 'SECOND_CUTOFF' },
                        ],
                    };
                }
                return { rows: [] };
            });

            const res = await request(app)
                .put('/api/payroll/settings')
                .send({ PAYROLL_STATUTORY_SCHEDULE: 'SECOND_CUTOFF' });

            expect(res.status).toBe(200);
            expect(res.body.PAYROLL_STATUTORY_SCHEDULE).toBe('SECOND_CUTOFF');
        });
    });
});
