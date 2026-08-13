const request = require('supertest');
const express = require('express');

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

let mockCurrentUser = { employee_id: 1, permission_level_id: 10 };

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => { req.user = mockCurrentUser; next(); },
    hasPermission: () => (req, res, next) => next(),
    isAdmin: (req, res, next) => next(),
}));

const db = require('../db');
const dtrService = require('../services/hr/dtrService');
const dtrRouter = require('../routes/dtrRoutes');
const leaveRouter = require('../routes/leaveRoutes');

const { eachDate, dayOfWeek, hoursBetween, resolveDay, dayFractionFor } = dtrService._internal;

const app = express();
app.use(express.json());
app.use('/api/dtr', dtrRouter);
app.use('/api/leave', leaveRouter);

beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks wipes call history but NOT the mockResolvedValueOnce queue,
    // so a test that queues more responses than it consumes would leak them into
    // the next one. Reset the query mocks explicitly. getClient is deliberately
    // left alone: its implementation comes from the module factory, and
    // resetting it would strip that away.
    db.query.mockReset();
    db.__client.query.mockReset();
    mockCurrentUser = { employee_id: 1, permission_level_id: 10 };
});

// --- Pure date/time helpers ---------------------------------------------

describe('date helpers', () => {
    it('builds an inclusive date range', () => {
        expect(eachDate('2026-08-01', '2026-08-04'))
            .toEqual(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04']);
    });

    it('handles a single-day range and a month boundary', () => {
        expect(eachDate('2026-08-31', '2026-08-31')).toEqual(['2026-08-31']);
        expect(eachDate('2026-02-27', '2026-03-01'))
            .toEqual(['2026-02-27', '2026-02-28', '2026-03-01']);
    });

    it('uses 0 = Sunday, matching Postgres EXTRACT(DOW)', () => {
        // 2026-08-02 is a Sunday, 2026-08-03 a Monday.
        expect(dayOfWeek('2026-08-02')).toBe(0);
        expect(dayOfWeek('2026-08-03')).toBe(1);
        expect(dayOfWeek('2026-08-08')).toBe(6);
    });

    it('computes worked hours net of the break', () => {
        expect(hoursBetween('07:00', '17:00', 60)).toBe(9);
        expect(hoursBetween('07:00', '15:00', 60)).toBe(7);
        expect(hoursBetween('07:00', '11:30', 0)).toBe(4.5);
    });

    it('wraps an overnight shift instead of returning a negative', () => {
        expect(hoursBetween('22:00', '06:00', 60)).toBe(7);
    });

    it('never returns negative hours when the break exceeds the shift', () => {
        expect(hoursBetween('07:00', '07:30', 60)).toBe(0);
    });

    it('returns zero when either end of the shift is missing', () => {
        expect(hoursBetween(null, '17:00', 60)).toBe(0);
        expect(hoursBetween('07:00', null, 60)).toBe(0);
    });
});

describe('dayFractionFor', () => {
    it('maps day types to what payroll should pay', () => {
        expect(dayFractionFor('Present')).toBe(1);
        expect(dayFractionFor('Half Day')).toBe(0.5);
        expect(dayFractionFor('Absent')).toBe(0);
        expect(dayFractionFor('Rest Day')).toBe(0);
        expect(dayFractionFor('Holiday')).toBe(0);
    });
});

// --- Day resolution precedence ------------------------------------------

describe('resolveDay precedence', () => {
    const workingDay = { day_of_week: 1, is_rest_day: false, time_in: '07:00', time_out: '17:00', break_minutes: 60 };

    it('produces an ordinary present day from the schedule', () => {
        const day = resolveDay({ isoDate: '2026-08-03', scheduleDay: workingDay });
        expect(day.day_type).toBe('Present');
        expect(day.day_fraction).toBe(1);
        // Punch columns are pre-filled from the schedule so real time capture
        // can later replace values without a schema change.
        expect(day.time_in).toBe('07:00');
        expect(day.time_out).toBe('17:00');
        expect(day.hours_worked).toBe(9);
    });

    it('marks a rest day when the schedule says so', () => {
        const day = resolveDay({ isoDate: '2026-08-02', scheduleDay: { is_rest_day: true } });
        expect(day.day_type).toBe('Rest Day');
        expect(day.day_fraction).toBe(0);
    });

    it('marks a rest day when the employee has no schedule row for that weekday', () => {
        const day = resolveDay({ isoDate: '2026-08-02', scheduleDay: undefined });
        expect(day.day_type).toBe('Rest Day');
        expect(day.day_fraction).toBe(0);
    });

    it('lets a holiday beat an ordinary working day', () => {
        const day = resolveDay({
            isoDate: '2026-12-25', scheduleDay: workingDay,
            holiday: { holiday_id: 9, holiday_name: 'Christmas Day', holiday_type: 'Regular' },
        });
        expect(day.day_type).toBe('Holiday');
        expect(day.day_fraction).toBe(0);
        expect(day.holiday_id).toBe(9);
    });

    it('lets leave beat a holiday', () => {
        const day = resolveDay({
            isoDate: '2026-12-25', scheduleDay: workingDay,
            holiday: { holiday_id: 9, holiday_name: 'Christmas Day' },
            leave: { leave_id: 5, is_paid: true, day_fraction: 1, leave_name: 'Vacation Leave' },
        });
        expect(day.day_type).toBe('On Leave');
        expect(day.leave_id).toBe(5);
    });

    it('pays nothing for unpaid leave but still records it as leave', () => {
        const day = resolveDay({
            isoDate: '2026-08-03', scheduleDay: workingDay,
            leave: { leave_id: 7, is_paid: false, day_fraction: 1, leave_name: 'Leave Without Pay' },
        });
        expect(day.day_type).toBe('On Leave');
        expect(day.day_fraction).toBe(0);
    });

    it('carries a half-day leave fraction through', () => {
        const day = resolveDay({
            isoDate: '2026-08-03', scheduleDay: workingDay,
            leave: { leave_id: 8, is_paid: true, day_fraction: 0.5, leave_name: 'Sick Leave' },
        });
        expect(day.day_fraction).toBe(0.5);
    });
});

// --- Generation ----------------------------------------------------------

describe('generateForPeriod', () => {
    const mockLoads = ({ scheduleRows = [], holidayRows = [], leaveRows = [], inserted = [] }) => {
        db.query
            .mockResolvedValueOnce({ rows: scheduleRows })   // loadSchedules
            .mockResolvedValueOnce({ rows: holidayRows })    // loadHolidays
            .mockResolvedValueOnce({ rows: leaveRows })      // loadApprovedLeave
            .mockResolvedValueOnce({ rows: inserted });      // INSERT ... RETURNING
    };

    it('inserts one row per employee-day and reports what was skipped', async () => {
        mockLoads({
            scheduleRows: [
                { employee_id: 3, day_of_week: 1, is_rest_day: false, time_in: '07:00', time_out: '17:00', break_minutes: 60 },
                { employee_id: 3, day_of_week: 2, is_rest_day: false, time_in: '07:00', time_out: '17:00', break_minutes: 60 },
            ],
            inserted: [{ dtr_id: 1 }], // only one of the two days was new
        });

        const result = await dtrService.generateForPeriod(db, {
            employeeIds: [3], periodStart: '2026-08-03', periodEnd: '2026-08-04', createdBy: 1,
        });

        expect(result).toEqual({ created: 1, skipped: 1, employees: 1, days: 2 });
        const [sql] = db.query.mock.calls[3];
        // Existing rows must survive a re-run untouched.
        expect(sql).toMatch(/ON CONFLICT \(employee_id, work_date\) DO NOTHING/);
    });

    it('skips employees with no schedule rather than inventing a default', async () => {
        mockLoads({ scheduleRows: [] });
        const result = await dtrService.generateForPeriod(db, {
            employeeIds: [99], periodStart: '2026-08-03', periodEnd: '2026-08-04', createdBy: 1,
        });
        expect(result.created).toBe(0);
        // Only the three loads ran; no INSERT was attempted.
        expect(db.query).toHaveBeenCalledTimes(3);
    });

    it('does nothing when given no employees', async () => {
        const result = await dtrService.generateForPeriod(db, {
            employeeIds: [], periodStart: '2026-08-01', periodEnd: '2026-08-15', createdBy: 1,
        });
        expect(result).toEqual({ created: 0, skipped: 0, employees: 0, days: 0 });
        expect(db.query).not.toHaveBeenCalled();
    });
});

// --- Corrections ---------------------------------------------------------

describe('updateEntry', () => {
    it('refuses to edit a day locked by payroll', async () => {
        db.query.mockResolvedValueOnce({ rows: [{ dtr_id: 1, employee_id: 3, locked_by_run_id: 777 }] });
        await expect(dtrService.updateEntry(db, { dtrId: 1, changes: { day_type: 'Absent' }, modifiedBy: 1 }))
            .rejects.toMatchObject({ code: 'DTR_LOCKED' });
    });

    it('moves day_fraction with day_type when the caller does not set it', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ dtr_id: 1, employee_id: 3, work_date: '2026-08-05', day_type: 'Present', day_fraction: '1.000', locked_by_run_id: null }] })
            .mockResolvedValueOnce({ rows: [{ dtr_id: 1, day_type: 'Half Day', day_fraction: '0.500' }] })
            .mockResolvedValue({ rows: [] });

        await dtrService.updateEntry(db, { dtrId: 1, changes: { day_type: 'Half Day' }, modifiedBy: 1 });

        const [, params] = db.query.mock.calls[1];
        expect(params).toContain(0.5);
    });

    it('respects an explicit day_fraction over the day_type default', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ dtr_id: 1, employee_id: 3, work_date: '2026-08-05', day_type: 'Present', locked_by_run_id: null }] })
            .mockResolvedValueOnce({ rows: [{ dtr_id: 1 }] })
            .mockResolvedValue({ rows: [] });

        await dtrService.updateEntry(db, {
            dtrId: 1, changes: { day_type: 'Absent', day_fraction: 0.25 }, modifiedBy: 1,
        });

        const [, params] = db.query.mock.calls[1];
        expect(params).toContain(0.25);
        expect(params).not.toContain(0);
    });

    it('flips source to Manual so later generation leaves the row alone', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ dtr_id: 1, employee_id: 3, work_date: '2026-08-05', remarks: null, locked_by_run_id: null }] })
            .mockResolvedValueOnce({ rows: [{ dtr_id: 1 }] })
            .mockResolvedValue({ rows: [] });

        await dtrService.updateEntry(db, { dtrId: 1, changes: { remarks: 'Left early' }, modifiedBy: 1 });

        const [sql] = db.query.mock.calls[1];
        expect(sql).toMatch(/source = 'Manual'/);
    });

    it('ignores fields that are not editable', async () => {
        db.query.mockResolvedValueOnce({ rows: [{ dtr_id: 1, employee_id: 3, locked_by_run_id: null }] });
        await expect(dtrService.updateEntry(db, {
            dtrId: 1, changes: { employee_id: 999, locked_by_run_id: null }, modifiedBy: 1,
        })).rejects.toMatchObject({ code: 'DTR_NO_CHANGES' });
    });

    it('writes a change-log row per changed field', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ dtr_id: 1, employee_id: 3, work_date: '2026-08-05', day_type: 'Present', day_fraction: '1.000', locked_by_run_id: null }] })
            .mockResolvedValueOnce({ rows: [{ dtr_id: 1 }] })
            .mockResolvedValue({ rows: [] });

        await dtrService.updateEntry(db, {
            dtrId: 1, changes: { day_type: 'Half Day' }, modifiedBy: 4, reason: 'Clinic',
        });

        const logCalls = db.query.mock.calls.filter((c) => /dtr_change_log/.test(c[0]));
        expect(logCalls.length).toBe(2); // day_type and the derived day_fraction
        expect(logCalls[0][1]).toContain('Clinic');
        expect(logCalls[0][1]).toContain(4);
    });
});

// --- Routes --------------------------------------------------------------

describe('POST /dtr/generate', () => {
    it('rejects a malformed date', async () => {
        const res = await request(app).post('/api/dtr/generate').send({ from: '08/01/2026', to: '2026-08-15' });
        expect(res.status).toBe(400);
    });

    it('rejects an inverted range', async () => {
        const res = await request(app).post('/api/dtr/generate').send({ from: '2026-08-15', to: '2026-08-01' });
        expect(res.status).toBe(400);
    });

    it('refuses a range longer than the configured lookahead', async () => {
        db.query.mockResolvedValueOnce({ rows: [{ setting_value: '31' }] });
        const res = await request(app).post('/api/dtr/generate').send({ from: '2026-01-01', to: '2026-12-31' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/exceeds the 31-day/);
    });
});

describe('GET /dtr/summary', () => {
    it('requires both dates', async () => {
        const res = await request(app).get('/api/dtr/summary?from=2026-08-01');
        expect(res.status).toBe(400);
    });

    it('returns zeroed totals for an employee with no records', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ employee_id: 3, employee_code: 'EMP-1', employee_name: 'Grace Pilar' }] })
            .mockResolvedValueOnce({ rows: [] }); // summarizePeriodBulk finds nothing

        const res = await request(app).get('/api/dtr/summary?from=2026-08-01&to=2026-08-15');

        expect(res.status).toBe(200);
        expect(res.body[0]).toMatchObject({ employee_id: 3, days_paid: 0, days_worked: 0 });
    });
});

describe('POST /leave/requests', () => {
    it('rejects date_to before date_from', async () => {
        const res = await request(app).post('/api/leave/requests')
            .send({ employee_id: 3, leave_type_id: 1, date_from: '2026-08-12', date_to: '2026-08-10' });
        expect(res.status).toBe(400);
        expect(db.query).not.toHaveBeenCalled();
    });

    it('rejects an out-of-range day_fraction', async () => {
        const res = await request(app).post('/api/leave/requests')
            .send({ employee_id: 3, leave_type_id: 1, date_from: '2026-08-10', date_to: '2026-08-10', day_fraction: 1.5 });
        expect(res.status).toBe(400);
    });

    it('translates the overlap exclusion constraint into a 409', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [] })  // loadSchedules
            .mockResolvedValueOnce({ rows: [] })  // loadHolidays
            .mockRejectedValueOnce(Object.assign(new Error('conflict'), { code: '23P01' }));

        const res = await request(app).post('/api/leave/requests')
            .send({ employee_id: 3, leave_type_id: 1, date_from: '2026-08-10', date_to: '2026-08-12' });

        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/already has a leave request/i);
    });
});

describe('countLeaveWorkingDays', () => {
    it('excludes rest days and holidays from the charged days', async () => {
        db.query
            .mockResolvedValueOnce({
                rows: [
                    // Sunday (0) is a rest day for this employee; Mon-Wed are working.
                    { employee_id: 3, day_of_week: 0, is_rest_day: true },
                    { employee_id: 3, day_of_week: 1, is_rest_day: false, time_in: '07:00', time_out: '17:00' },
                    { employee_id: 3, day_of_week: 2, is_rest_day: false, time_in: '07:00', time_out: '17:00' },
                    { employee_id: 3, day_of_week: 3, is_rest_day: false, time_in: '07:00', time_out: '17:00' },
                ],
            })
            .mockResolvedValueOnce({ rows: [{ holiday_date: '2026-08-05', holiday_name: 'Test Holiday' }] });

        // 2026-08-02 Sun (rest), 08-03 Mon, 08-04 Tue, 08-05 Wed (holiday) => 2 days.
        const days = await dtrService.countLeaveWorkingDays(db, {
            employeeId: 3, dateFrom: '2026-08-02', dateTo: '2026-08-05',
        });

        expect(days).toBe(2);
    });

    it('halves the charge for a half-day leave', async () => {
        db.query
            .mockResolvedValueOnce({
                rows: [
                    { employee_id: 3, day_of_week: 1, is_rest_day: false, time_in: '07:00', time_out: '17:00' },
                ],
            })
            .mockResolvedValueOnce({ rows: [] });

        const days = await dtrService.countLeaveWorkingDays(db, {
            employeeId: 3, dateFrom: '2026-08-03', dateTo: '2026-08-03', dayFraction: 0.5,
        });

        expect(days).toBe(0.5);
    });

    it('returns zero when the employee has no schedule', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });
        const days = await dtrService.countLeaveWorkingDays(db, {
            employeeId: 99, dateFrom: '2026-08-03', dateTo: '2026-08-05',
        });
        expect(days).toBe(0);
    });
});

describe('leave approval', () => {
    it('refuses to let an approver sign off their own request', async () => {
        mockCurrentUser = { employee_id: 3, permission_level_id: 10 };
        db.__client.query
            .mockResolvedValueOnce({})  // BEGIN
            .mockResolvedValueOnce({ rows: [{ leave_id: 1, employee_id: 3, status: 'Pending', date_from: '2026-08-10', date_to: '2026-08-12' }] })
            .mockResolvedValue({});

        const res = await request(app).post('/api/leave/requests/1/approve').send({});

        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/your own leave/i);
    });

    it('refuses to approve a request that is not pending', async () => {
        db.__client.query
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ rows: [{ leave_id: 1, employee_id: 3, status: 'Approved' }] })
            .mockResolvedValue({});

        const res = await request(app).post('/api/leave/requests/1/approve').send({});

        expect(res.status).toBe(409);
    });
});
