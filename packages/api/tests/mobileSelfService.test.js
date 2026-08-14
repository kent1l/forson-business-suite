/**
 * Employee self-service endpoints added for the mobile app.
 *
 * Two things are load-bearing here and are what these tests actually guard:
 *
 *  - Scoping. Every `/me` route must derive the employee from the token and
 *    never from the request, or a permission granted to all seven roles turns
 *    into a way to read anyone's attendance and pay.
 *  - Offline punch handling. A punch captured with no network records the time
 *    it was TAKEN, and that timestamp feeds payroll, so the bounds on it and
 *    the retry behaviour both need to hold.
 */

const request = require('supertest');
const express = require('express');

jest.setTimeout(10000);

jest.mock('../db', () => ({ query: jest.fn(), getClient: jest.fn() }));

// A mutable caller, so a test can change who is asking and what they may do.
const testUser = { employee_id: 42, username: 'staff', permission_level_id: 1, permissions: [] };

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => { req.user = { ...testUser }; next(); },
    hasPermission: () => (req, res, next) => next(),
    // The real implementation, minus the admin bypass plumbing that `protect`
    // would have set up — ownership logic is exactly what we are testing.
    userHasPermission: (req, required) => {
        const list = Array.isArray(required) ? required : [required];
        if (Number(req.user?.permission_level_id) === 10) return true;
        return list.some((p) => (req.user?.permissions || []).includes(p));
    },
}));

const db = require('../db');
const dtrRouter = require('../routes/dtrRoutes');
const leaveRouter = require('../routes/leaveRoutes');
const payrollRouter = require('../routes/payrollRoutes');

const app = express();
app.use(express.json());
app.use('/dtr', dtrRouter);
app.use('/leave', leaveRouter);
app.use('/payroll', payrollRouter);

const resetUser = () => {
    testUser.employee_id = 42;
    testUser.permission_level_id = 1;
    testUser.permissions = [];
};

beforeEach(() => {
    jest.clearAllMocks();
    resetUser();
});

describe('POST /dtr/punch', () => {
    const okInsert = (over = {}) => ({
        rows: [{
            punch_id: 1, punch_date: '2026-08-14', punch_at: new Date().toISOString(),
            direction: 'IN', source: 'Mobile', client_punch_id: null, notes: null, ...over,
        }],
    });

    test('rejects a direction other than IN or OUT', async () => {
        const res = await request(app).post('/dtr/punch').send({ direction: 'SIDEWAYS' });
        expect(res.statusCode).toBe(400);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('rejects a client_punch_id that is not a UUID', async () => {
        const res = await request(app)
            .post('/dtr/punch').send({ direction: 'IN', client_punch_id: 'not-a-uuid' });
        expect(res.statusCode).toBe(400);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('rejects a punch_at in the future', async () => {
        const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        const res = await request(app).post('/dtr/punch').send({ direction: 'IN', punch_at: future });
        expect(res.statusCode).toBe(400);
        expect(res.body.message).toMatch(/future/i);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('tolerates small forward clock skew rather than rejecting a real punch', async () => {
        const skewed = new Date(Date.now() + 2 * 60 * 1000).toISOString();
        db.query.mockResolvedValueOnce(okInsert());
        const res = await request(app).post('/dtr/punch').send({ direction: 'IN', punch_at: skewed });
        expect(res.statusCode).toBe(201);
    });

    test('records the capture time, not the sync time, for an offline punch', async () => {
        const capturedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
        db.query
            .mockResolvedValueOnce({ rows: [{ setting_value: '720' }] })  // backdate window
            .mockResolvedValueOnce(okInsert({ source: 'Mobile-Offline' }));

        const res = await request(app).post('/dtr/punch')
            .send({ direction: 'IN', source: 'Mobile', punch_at: capturedAt });

        expect(res.statusCode).toBe(201);
        const insertParams = db.query.mock.calls[1][1];
        expect(insertParams[1]).toBe(capturedAt);          // punch_at is the captured time
        expect(insertParams[3]).toBe('Mobile-Offline');    // and it is marked as such
    });

    test('refuses a punch backdated beyond the configured window', async () => {
        const longAgo = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
        db.query.mockResolvedValueOnce({ rows: [{ setting_value: '720' }] });

        const res = await request(app).post('/dtr/punch')
            .send({ direction: 'IN', source: 'Mobile', punch_at: longAgo });

        // Rejected, not merely annotated. `dtr:punch` is held by every role, so
        // an unbounded backdate would let anyone write attendance onto a day
        // they did not work, and the derivation turns that into paid hours. A
        // note in a column nothing reads is not a control.
        expect(res.statusCode).toBe(400);
        expect(res.body.code).toBe('PUNCH_TOO_OLD');
        expect(db.query.mock.calls.some((c) => /INSERT INTO time_punch/i.test(c[0]))).toBe(false);
    });

    test('still accepts an offline punch inside the window, marked as such', async () => {
        const withinWindow = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
        db.query
            .mockResolvedValueOnce({ rows: [{ setting_value: '720' }] })
            .mockResolvedValueOnce(okInsert({ source: 'Mobile-Offline' }));

        const res = await request(app).post('/dtr/punch')
            .send({ direction: 'IN', source: 'Mobile', punch_at: withinWindow });

        expect(res.statusCode).toBe(201);
        expect(db.query.mock.calls[1][1][3]).toBe('Mobile-Offline');
        // The capture context is still recorded, so a supervisor reviewing a
        // disputed day can see the punch came from a phone's clock.
        expect(db.query.mock.calls[1][1][10]).toMatch(/captured offline/i);
    });

    test('a retried offline flush resolves to the punch it already created', async () => {
        const clientId = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
        db.query
            .mockResolvedValueOnce({ rows: [] })  // insert hit a unique key, nothing returned
            .mockResolvedValueOnce(okInsert({ client_punch_id: clientId }));  // lookup by client id

        const res = await request(app).post('/dtr/punch')
            .send({ direction: 'IN', client_punch_id: clientId });

        // 200, not 409: the queue did its job, and the app can show the punch.
        expect(res.statusCode).toBe(200);
        expect(res.body.client_punch_id).toBe(clientId);
    });

    test('still reports a genuine duplicate when there is no client id to reconcile', async () => {
        db.query.mockResolvedValueOnce({ rows: [] });
        const res = await request(app).post('/dtr/punch').send({ direction: 'IN' });
        expect(res.statusCode).toBe(409);
    });

    test('never takes an employee_id from the request body', async () => {
        db.query.mockResolvedValueOnce(okInsert());
        await request(app).post('/dtr/punch').send({ direction: 'IN', employee_id: 999 });
        expect(db.query.mock.calls[0][1][0]).toBe(42);
    });
});

describe('DTR self-service reads', () => {
    test('GET /dtr/me scopes to the caller and ignores a supplied employee_id', async () => {
        db.query.mockResolvedValueOnce({ rows: [] });
        await request(app).get('/dtr/me?employee_id=999&from=2026-08-01&to=2026-08-15');
        expect(db.query.mock.calls[0][1][0]).toBe(42);
    });

    test('GET /dtr/me/punches requires a date range', async () => {
        const res = await request(app).get('/dtr/me/punches');
        expect(res.statusCode).toBe(400);
    });

    test('GET /dtr/me/punches scopes to the caller', async () => {
        db.query.mockResolvedValueOnce({ rows: [] });
        await request(app).get('/dtr/me/punches?from=2026-08-01&to=2026-08-15');
        expect(db.query.mock.calls[0][1][0]).toBe(42);
    });

    test('/dtr/me is not shadowed by the /:id routes', async () => {
        db.query.mockResolvedValueOnce({ rows: [] });
        const res = await request(app).get('/dtr/me');
        expect(res.statusCode).toBe(200);
    });
});

describe('Leave ownership', () => {
    test('an ordinary employee files for themselves even if they send another id', async () => {
        db.query.mockResolvedValue({ rows: [{ leave_id: 7 }] });
        await request(app).post('/leave/requests').send({
            employee_id: 999, leave_type_id: 1, date_from: '2026-09-01', date_to: '2026-09-01',
        });
        // countLeaveWorkingDays runs first; the INSERT is what matters.
        const insertCall = db.query.mock.calls.find((c) => /INSERT INTO leave_request/i.test(c[0]));
        expect(insertCall).toBeDefined();
        expect(insertCall[1][0]).toBe(42);
    });

    test('an HR user with leave:manage may file on someone else behalf', async () => {
        testUser.permissions = ['leave:request', 'leave:manage'];
        db.query.mockResolvedValue({ rows: [{ leave_id: 8 }] });
        await request(app).post('/leave/requests').send({
            employee_id: 999, leave_type_id: 1, date_from: '2026-09-01', date_to: '2026-09-01',
        });
        const insertCall = db.query.mock.calls.find((c) => /INSERT INTO leave_request/i.test(c[0]));
        expect(insertCall[1][0]).toBe(999);
    });

    test('cancelling someone else request is refused', async () => {
        const client = {
            query: jest.fn()
                .mockResolvedValueOnce({})  // BEGIN
                .mockResolvedValueOnce({ rows: [{ leave_id: 5, status: 'Pending', employee_id: 999 }] })
                .mockResolvedValue({}),
            release: jest.fn(),
        };
        db.getClient.mockResolvedValueOnce(client);

        const res = await request(app).post('/leave/requests/5/cancel').send({});

        expect(res.statusCode).toBe(403);
        expect(client.query).toHaveBeenCalledWith('ROLLBACK');
        // The refusal must happen before anything is written.
        expect(client.query.mock.calls.some((c) => /UPDATE leave_request/i.test(c[0]))).toBe(false);
    });

    test('cancelling your own request is allowed', async () => {
        const client = {
            query: jest.fn()
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({ rows: [{ leave_id: 5, status: 'Pending', employee_id: 42 }] })
                .mockResolvedValue({ rows: [] }),
            release: jest.fn(),
        };
        db.getClient.mockResolvedValueOnce(client);

        const res = await request(app).post('/leave/requests/5/cancel').send({});

        expect(res.statusCode).toBe(200);
        expect(client.query.mock.calls.some((c) => /UPDATE leave_request/i.test(c[0]))).toBe(true);
    });

    test('GET /leave/me/requests scopes to the caller', async () => {
        db.query.mockResolvedValueOnce({ rows: [] });
        await request(app).get('/leave/me/requests');
        expect(db.query.mock.calls[0][1][0]).toBe(42);
    });

    test('GET /leave/me/balances scopes to the caller', async () => {
        db.query.mockResolvedValueOnce({ rows: [] });
        const res = await request(app).get('/leave/me/balances');
        expect(res.body.employee_id).toBe(42);
        expect(db.query.mock.calls[0][1][0]).toBe(42);
    });
});

describe('GET /payroll/me/payslips/:id', () => {
    test('authorises on employee_id, not just the payslip id', async () => {
        db.query.mockResolvedValueOnce({ rows: [] });
        const res = await request(app).get('/payroll/me/payslips/123');

        expect(res.statusCode).toBe(404);
        const [sql, params] = db.query.mock.calls[0];
        expect(params).toEqual(['123', 42]);
        expect(sql).toMatch(/p\.employee_id = \$2/);
    });

    test('does not expose a payslip from a run still being computed', async () => {
        db.query.mockResolvedValueOnce({ rows: [] });
        await request(app).get('/payroll/me/payslips/123');
        expect(db.query.mock.calls[0][0]).toMatch(/r\.status IN \('Approved', 'Paid', 'Posted'\)/);
    });

    test('returns the payslip with its lines when it belongs to the caller', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ payslip_id: 123, net_pay: '1000.00' }] })
            .mockResolvedValueOnce({ rows: [{ description: 'Basic Pay', amount: '1000.00' }] });

        const res = await request(app).get('/payroll/me/payslips/123');

        expect(res.statusCode).toBe(200);
        expect(res.body.lines).toHaveLength(1);
    });
});
