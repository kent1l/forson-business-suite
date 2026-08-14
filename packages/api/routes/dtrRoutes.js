const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const { parsePaginationQuery, paginatedResponse } = require('../helpers/pagination');
const dtrService = require('../services/hr/dtrService');
const timePunchService = require('../services/hr/timePunchService');

const router = express.Router();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const DTR_SELECT_FIELDS = `
    d.dtr_id, d.employee_id,
    TO_CHAR(d.work_date, 'YYYY-MM-DD') AS work_date,
    d.day_type, d.day_fraction, d.is_rest_day,
    d.holiday_id, h.holiday_name, h.holiday_type,
    d.leave_id,
    d.scheduled_time_in, d.scheduled_time_out, d.time_in, d.time_out,
    d.break_minutes, d.hours_worked, d.overtime_hours, d.night_diff_hours,
    d.late_minutes, d.undertime_minutes,
    d.source, d.remarks, d.locked_by_run_id,
    (d.locked_by_run_id IS NOT NULL) AS is_locked,
    e.employee_code,
    TRIM(CONCAT_WS(' ', e.first_name, e.last_name)) AS employee_name,
    dep.department_name
`;

const DTR_JOINS = `
    FROM daily_time_record d
    JOIN employee e ON d.employee_id = e.employee_id
    LEFT JOIN department dep ON e.department_id = dep.department_id
    LEFT JOIN holiday h ON d.holiday_id = h.holiday_id
`;

// GET /dtr - browse records, filtered by employee, department and date range.
router.get('/', protect, hasPermission('dtr:view'), async (req, res) => {
    const { employee_id, department, from, to, day_type } = req.query;
    const { paginated, page, pageSize, offset, limit } = parsePaginationQuery(req.query);

    if ((from && !ISO_DATE.test(from)) || (to && !ISO_DATE.test(to))) {
        return res.status(400).json({ message: 'Dates must be in YYYY-MM-DD format' });
    }

    const conditions = [];
    const params = [];
    let idx = 1;

    if (employee_id) { conditions.push(`d.employee_id = $${idx++}`); params.push(Number(employee_id)); }
    if (department) { conditions.push(`e.department_id = $${idx++}`); params.push(Number(department)); }
    if (from) { conditions.push(`d.work_date >= $${idx++}`); params.push(from); }
    if (to) { conditions.push(`d.work_date <= $${idx++}`); params.push(to); }
    if (day_type) { conditions.push(`d.day_type = $${idx++}`); params.push(day_type); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const base = `SELECT ${DTR_SELECT_FIELDS} ${DTR_JOINS} ${where}
                  ORDER BY d.work_date DESC, e.last_name, e.first_name`;

    try {
        if (!paginated) {
            const { rows } = await db.query(base, params);
            return res.json(rows);
        }
        const countRes = await db.query(`SELECT COUNT(*)::int AS total ${DTR_JOINS} ${where}`, params);
        const { rows } = await db.query(`${base} LIMIT $${idx} OFFSET $${idx + 1}`, [...params, limit, offset]);
        res.json(paginatedResponse({ data: rows, page, pageSize, total: countRes.rows[0]?.total || 0 }));
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// --- Self-service reads ---------------------------------------------------
// Everything else in this file is gated on `dtr:view`, which means "see the
// whole company's attendance". These are the narrow version: same data, always
// scoped to the caller, so they can be granted to every employee.

// GET /dtr/me - the caller's own timesheet for a date range.
router.get('/me', protect, hasPermission(['dtr:view_own', 'dtr:view']), async (req, res) => {
    const { from, to } = req.query;
    if ((from && !ISO_DATE.test(from)) || (to && !ISO_DATE.test(to))) {
        return res.status(400).json({ message: 'Dates must be in YYYY-MM-DD format' });
    }

    const params = [req.user.employee_id];
    const conditions = ['d.employee_id = $1'];
    let idx = 2;
    if (from) { conditions.push(`d.work_date >= $${idx++}`); params.push(from); }
    if (to) { conditions.push(`d.work_date <= $${idx++}`); params.push(to); }

    try {
        const { rows } = await db.query(
            `SELECT ${DTR_SELECT_FIELDS} ${DTR_JOINS}
             WHERE ${conditions.join(' AND ')}
             ORDER BY d.work_date DESC`,
            params
        );
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET /dtr/me/summary - the caller's own period totals.
router.get('/me/summary', protect, hasPermission(['dtr:view_own', 'dtr:view']), async (req, res) => {
    const { from, to } = req.query;
    if (!ISO_DATE.test(from || '') || !ISO_DATE.test(to || '')) {
        return res.status(400).json({ message: 'from and to are required in YYYY-MM-DD format' });
    }
    try {
        const summaries = await dtrService.summarizePeriodBulk(db, {
            employeeIds: [req.user.employee_id], periodStart: from, periodEnd: to,
        });
        res.json(summaries.get(req.user.employee_id) || {
            days_paid: 0, days_worked: 0, days_absent: 0, days_on_leave: 0,
            days_holiday: 0, hours_worked: 0, overtime_hours: 0,
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET /dtr/me/punches - the caller's own raw taps, so a disputed day can be
// checked against what the terminal or phone actually recorded.
router.get('/me/punches', protect, hasPermission(['dtr:view_own', 'dtr:view']), async (req, res) => {
    const { from, to } = req.query;
    if (!ISO_DATE.test(from || '') || !ISO_DATE.test(to || '')) {
        return res.status(400).json({ message: 'from and to are required in YYYY-MM-DD format' });
    }
    try {
        const { rows } = await db.query(
            `SELECT punch_id, punch_at, direction, source, notes,
                    TO_CHAR(punch_date, 'YYYY-MM-DD') AS punch_date
             FROM time_punch
             WHERE employee_id = $1 AND punch_date BETWEEN $2 AND $3
             ORDER BY punch_at DESC`,
            [req.user.employee_id, from, to]
        );
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET /dtr/summary - period totals per employee, the shape payroll will consume.
router.get('/summary', protect, hasPermission('dtr:view'), async (req, res) => {
    const { from, to, department } = req.query;
    if (!ISO_DATE.test(from || '') || !ISO_DATE.test(to || '')) {
        return res.status(400).json({ message: 'from and to are required in YYYY-MM-DD format' });
    }
    try {
        const empParams = [];
        let empWhere = 'WHERE e.is_active = TRUE AND e.is_payroll_eligible = TRUE';
        if (department) { empWhere += ' AND e.department_id = $1'; empParams.push(Number(department)); }

        const { rows: employees } = await db.query(
            `SELECT e.employee_id, e.employee_code,
                    TRIM(CONCAT_WS(' ', e.first_name, e.last_name)) AS employee_name,
                    dep.department_name
             FROM employee e
             LEFT JOIN department dep ON e.department_id = dep.department_id
             ${empWhere}
             ORDER BY e.last_name, e.first_name`,
            empParams
        );

        const ids = employees.map((e) => e.employee_id);
        const summaries = ids.length
            ? await dtrService.summarizePeriodBulk(db, { employeeIds: ids, periodStart: from, periodEnd: to })
            : new Map();

        res.json(employees.map((e) => ({
            ...e,
            ...(summaries.get(e.employee_id) || {
                days_paid: 0, days_worked: 0, days_absent: 0, days_on_leave: 0,
                days_holiday: 0, hours_worked: 0, overtime_hours: 0,
            }),
        })));
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// POST /dtr/generate - fill a date range from each employee's schedule.
// Existing rows are never overwritten, so this is safe to re-run.
router.post('/generate', protect, hasPermission('dtr:generate'), async (req, res) => {
    const { from, to, employee_ids, department } = req.body;
    if (!ISO_DATE.test(from || '') || !ISO_DATE.test(to || '')) {
        return res.status(400).json({ message: 'from and to are required in YYYY-MM-DD format' });
    }
    if (from > to) {
        return res.status(400).json({ message: 'from must be on or before to' });
    }

    try {
        const lookaheadRes = await db.query(
            "SELECT setting_value FROM settings WHERE setting_key = 'DTR_AUTOGEN_LOOKAHEAD_DAYS'"
        );
        const lookahead = Number(lookaheadRes.rows[0]?.setting_value) || 31;
        const spanDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
        if (spanDays > lookahead) {
            return res.status(400).json({
                message: `Date range spans ${spanDays} days, which exceeds the ${lookahead}-day generation limit.`,
            });
        }

        let ids = Array.isArray(employee_ids) ? employee_ids.map(Number).filter(Number.isFinite) : null;
        if (!ids || ids.length === 0) {
            const params = [];
            let where = 'WHERE is_active = TRUE AND is_payroll_eligible = TRUE';
            if (department) { where += ' AND department_id = $1'; params.push(Number(department)); }
            const { rows } = await db.query(`SELECT employee_id FROM employee ${where}`, params);
            ids = rows.map((r) => r.employee_id);
        }

        const result = await dtrService.generateForPeriod(db, {
            employeeIds: ids,
            periodStart: from,
            periodEnd: to,
            createdBy: req.user.employee_id,
        });
        res.status(201).json(result);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// PUT /dtr/:id - correct one day.
router.put('/:id', protect, hasPermission('dtr:edit'), async (req, res) => {
    try {
        const updated = await dtrService.updateEntry(db, {
            dtrId: req.params.id,
            changes: req.body,
            modifiedBy: req.user.employee_id,
            reason: req.body.reason,
        });
        // Re-select through the shared projection rather than returning the raw
        // updated row. `RETURNING *` hands back work_date as a DATE, which
        // serialises to a UTC timestamp ("2026-08-13T16:00:00.000Z" for the 14th
        // in Manila) — a different shape from the TO_CHAR'd string every read
        // endpoint returns, and a day off once a client keys anything by date.
        const { rows } = await db.query(
            `SELECT ${DTR_SELECT_FIELDS} ${DTR_JOINS} WHERE d.dtr_id = $1`,
            [updated.dtr_id]
        );
        res.json(rows[0]);
    } catch (err) {
        if (err.code === 'DTR_NOT_FOUND') return res.status(404).json({ message: err.message });
        if (err.code === 'DTR_LOCKED') return res.status(409).json({ message: err.message });
        if (err.code === 'DTR_NO_CHANGES') return res.status(400).json({ message: err.message });
        if (err.code === '23514') return res.status(400).json({ message: 'Invalid day type or value.' });
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET /dtr/:id/history - who changed what on this day.
router.get('/:id/history', protect, hasPermission('dtr:view'), async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT l.log_id, l.field_name, l.old_value, l.new_value, l.reason, l.changed_at,
                    TRIM(CONCAT_WS(' ', e.first_name, e.last_name)) AS changed_by_name
             FROM dtr_change_log l
             LEFT JOIN employee e ON l.changed_by = e.employee_id
             WHERE l.dtr_id = $1
             ORDER BY l.changed_at DESC`,
            [req.params.id]
        );
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// --- Time capture (phase 7) ---------------------------------------------
// Punches are recorded raw and the DTR day is derived from them, so a disputed
// day can be re-derived rather than argued about.

router.get('/punch/state', protect, hasPermission('dtr:punch'), async (req, res) => {
    try {
        res.json(await timePunchService.getPunchState(db, { employeeId: req.user.employee_id }));
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_MAX_BACKDATE_MINUTES = 720;

/** How far a client may backdate an offline punch before it is flagged. */
const getMaxBackdateMinutes = async () => {
    const { rows } = await db.query(
        `SELECT setting_value FROM settings WHERE setting_key = 'DTR_PUNCH_MAX_BACKDATE_MINUTES'`
    );
    const parsed = Number(rows[0]?.setting_value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BACKDATE_MINUTES;
};

/**
 * Clock in or out. Always for the caller — never an employee id from the body.
 *
 * A mobile client may supply `punch_at` so a punch captured while the shop LAN
 * was unreachable records the time it was TAKEN rather than the time it synced.
 * That is payroll-material, so it is bounded: never in the future, and anything
 * older than the configured window is still stored (losing a real clock-in is
 * worse than accepting a late one) but flagged for HR review rather than taken
 * at face value.
 */
router.post('/punch', protect, hasPermission('dtr:punch'), async (req, res) => {
    const { direction, latitude, longitude, punch_at, client_punch_id, device_id } = req.body;
    if (!['IN', 'OUT'].includes(direction)) {
        return res.status(400).json({ message: "direction must be 'IN' or 'OUT'" });
    }
    if (client_punch_id && !UUID_RE.test(client_punch_id)) {
        return res.status(400).json({ message: 'client_punch_id must be a UUID' });
    }

    const employeeId = req.user.employee_id;
    const isMobile = req.body.source === 'Mobile';
    let punchAt = null;
    let source = isMobile ? 'Mobile' : 'Web';
    let notes = null;

    if (punch_at !== undefined && punch_at !== null) {
        const parsed = new Date(punch_at);
        if (Number.isNaN(parsed.getTime())) {
            return res.status(400).json({ message: 'punch_at must be a valid ISO timestamp' });
        }
        const driftMinutes = (Date.now() - parsed.getTime()) / 60000;
        // A phone clock running slightly fast is normal; a punch genuinely in
        // the future is not, and would let someone pre-record a clock-out.
        if (driftMinutes < -5) {
            return res.status(400).json({ message: 'punch_at cannot be in the future' });
        }
        punchAt = parsed.toISOString();
        if (driftMinutes > 1) {
            source = 'Mobile-Offline';
            const maxBackdate = await getMaxBackdateMinutes();
            if (driftMinutes > maxBackdate) {
                notes = `Captured offline ${Math.round(driftMinutes)} minutes before sync, `
                      + `beyond the ${maxBackdate}-minute window. Needs HR review.`;
            } else {
                notes = `Captured offline ${Math.round(driftMinutes)} minutes before sync.`;
            }
        }
    }

    try {
        const punch = await timePunchService.recordPunch(db, {
            employeeId,
            punchAt,
            direction,
            source,
            ipAddress: req.ip,
            latitude,
            longitude,
            actorId: employeeId,
            deviceId: device_id || null,
            clientPunchId: client_punch_id || null,
            notes,
        });

        if (punch) return res.status(201).json(punch);

        // Nothing inserted: some unique key caught it. If the caller gave a
        // client id, this is an offline flush retry — hand back the row it
        // created the first time so the retry is a success, not an error.
        if (client_punch_id) {
            const existing = await timePunchService.findPunchByClientId(db, {
                employeeId, clientPunchId: client_punch_id,
            });
            if (existing) return res.status(200).json(existing);
        }
        return res.status(409).json({ message: 'That punch was already recorded.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

router.get('/punches', protect, hasPermission('dtr:view'), async (req, res) => {
    const { employee_id, from, to } = req.query;
    if (!ISO_DATE.test(from || '') || !ISO_DATE.test(to || '')) {
        return res.status(400).json({ message: 'from and to are required in YYYY-MM-DD format' });
    }
    try {
        const params = [from, to];
        let where = 'WHERE t.punch_date BETWEEN $1 AND $2';
        if (employee_id) { where += ' AND t.employee_id = $3'; params.push(Number(employee_id)); }

        const { rows } = await db.query(
            `SELECT t.punch_id, t.employee_id, t.punch_at, t.direction, t.source, t.device_id,
                    TO_CHAR(t.punch_date, 'YYYY-MM-DD') AS punch_date,
                    TRIM(CONCAT_WS(' ', e.first_name, e.last_name)) AS employee_name
             FROM time_punch t
             JOIN employee e ON t.employee_id = e.employee_id
             ${where}
             ORDER BY t.punch_at DESC`,
            params
        );
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

/** Imports a biometric export. Unmatched ids are reported, never dropped quietly. */
router.post('/punches/import', protect, hasPermission('dtr:import'), async (req, res) => {
    const { csv } = req.body;
    if (!csv || typeof csv !== 'string') {
        return res.status(400).json({ message: 'csv content is required' });
    }
    const client = await db.getClient();
    try {
        const { rows: parsedRows, errors } = timePunchService.parsePunchCsv(csv);
        if (parsedRows.length === 0) {
            return res.status(400).json({ message: 'No usable rows were found.', errors });
        }
        await client.query('BEGIN');
        const result = await timePunchService.importPunches(client, {
            parsedRows, actorId: req.user.employee_id,
        });
        await client.query('COMMIT');
        res.status(201).json({ ...result, parse_errors: errors });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});

/** Rebuilds DTR days from recorded punches. Manual corrections are preserved. */
router.post('/punches/derive', protect, hasPermission('dtr:edit'), async (req, res) => {
    const { from, to, employee_ids } = req.body;
    if (!ISO_DATE.test(from || '') || !ISO_DATE.test(to || '')) {
        return res.status(400).json({ message: 'from and to are required in YYYY-MM-DD format' });
    }
    const client = await db.getClient();
    try {
        let ids = Array.isArray(employee_ids) ? employee_ids.map(Number).filter(Number.isFinite) : null;
        if (!ids || ids.length === 0) {
            const { rows } = await db.query(
                'SELECT employee_id FROM employee WHERE is_active AND is_payroll_eligible'
            );
            ids = rows.map((r) => r.employee_id);
        }
        await client.query('BEGIN');
        const result = await timePunchService.deriveDtrFromPunches(client, {
            employeeIds: ids, dateFrom: from, dateTo: to, actorId: req.user.employee_id,
        });
        await client.query('COMMIT');
        res.json(result);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});

module.exports = router;
