const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../middleware/authMiddleware', () => ({
    protect: (_req, _res, next) => next(),
    hasPermission: () => (_req, _res, next) => next(),
}));

const db = require('../db');
const cycleCountRouter = require('../routes/cycleCountRoutes');

const app = express();
app.use(express.json());
app.use('/', cycleCountRouter);

beforeEach(() => jest.clearAllMocks());

test('workload employees are limited to cycle-count executors and expose saved auto-assignment selection', async () => {
    db.query
        .mockResolvedValueOnce({ rows: [{ setting_value: '[7]' }] })
        .mockResolvedValueOnce({ rows: [{
            employee_id: 7,
            employee_name: 'Count Staff',
            auto_assign_enabled: true,
            active_batches: 0,
            pending_items: 0,
        }] });

    const res = await request(app).get('/inventory/cycle-count/employees');

    expect(res.status).toBe(200);
    expect(res.body[0].auto_assign_enabled).toBe(true);
    const [sql, params] = db.query.mock.calls[1];
    expect(sql).toContain("p.permission_key = 'cycle_count:execute'");
    expect(sql).not.toContain('e.permission_level_id = 10');
    expect(params).toEqual([[7]]);
});

test('saving automatic assignees rejects employees without cycle-count permission', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
        .put('/inventory/cycle-count/auto-assign-employees')
        .send({ employee_ids: [7] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cycle-count execution permission/i);
    expect(db.query).toHaveBeenCalledTimes(1);
});

test('saving automatic assignees persists only validated cycle-count executors', async () => {
    db.query
        .mockResolvedValueOnce({ rows: [{ employee_id: 7 }] })
        .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
        .put('/inventory/cycle-count/auto-assign-employees')
        .send({ employee_ids: [7] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ employee_ids: [7] });
    const [sql, params] = db.query.mock.calls[1];
    expect(sql).toContain('INSERT INTO settings');
    expect(params).toEqual(['[7]']);
});
