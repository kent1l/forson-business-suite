const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const { parsePaginationQuery, paginatedResponse } = require('../helpers/pagination');

const router = express.Router();

const GOV_ID_COLUMNS = [
    'sss_no', 'tin', 'philhealth_no', 'pagibig_mid_no',
    'bank_name', 'bank_account_name', 'bank_account_no',
];

// Every read or write of government IDs / bank details is logged. A permission
// check answers "may they?"; this answers "who did, and when?" — which is the
// question that matters under the Data Privacy Act (RA 10173).
const logSensitiveAccess = async (executor, employeeId, actorId, action) => {
    await executor.query(
        `INSERT INTO employee_sensitive_access_log (employee_id, accessed_by, action)
         VALUES ($1, $2, $3)`,
        [employeeId, actorId, action]
    );
};

// --- Departments ---------------------------------------------------------

router.get('/departments', protect, hasPermission('hr:view'), async (req, res) => {
    const { status = 'active' } = req.query;
    const where = status === 'active' ? 'WHERE d.is_active = TRUE'
        : status === 'inactive' ? 'WHERE d.is_active = FALSE'
            : '';
    try {
        const { rows } = await db.query(
            `SELECT d.department_id, d.department_name, d.description, d.cost_center_code,
                    d.head_employee_id, d.is_active, d.sort_order,
                    NULLIF(TRIM(CONCAT_WS(' ', h.first_name, h.last_name)), '') AS head_name,
                    (SELECT COUNT(*)::int FROM employee e
                      WHERE e.department_id = d.department_id AND e.is_active = TRUE) AS employee_count
             FROM department d
             LEFT JOIN employee h ON d.head_employee_id = h.employee_id
             ${where}
             ORDER BY d.sort_order, d.department_name`
        );
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

router.post('/departments', protect, hasPermission('hr:manage_departments'), async (req, res) => {
    const { department_name, description, cost_center_code, head_employee_id, sort_order } = req.body;
    if (!department_name || !department_name.trim()) {
        return res.status(400).json({ message: 'Department name is required' });
    }
    try {
        const { rows } = await db.query(
            `INSERT INTO department (department_name, description, cost_center_code, head_employee_id, sort_order, created_by)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [department_name.trim(), description || null, cost_center_code || null,
                head_employee_id || null, sort_order || 0, req.user.employee_id]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ message: 'A department with that name already exists.' });
        }
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

router.put('/departments/:id', protect, hasPermission('hr:manage_departments'), async (req, res) => {
    const { id } = req.params;
    const { department_name, description, cost_center_code, head_employee_id, sort_order, is_active } = req.body;
    if (!department_name || !department_name.trim()) {
        return res.status(400).json({ message: 'Department name is required' });
    }
    try {
        const { rows } = await db.query(
            `UPDATE department
             SET department_name = $1, description = $2, cost_center_code = $3,
                 head_employee_id = $4, sort_order = $5, is_active = $6,
                 modified_by = $7, updated_at = now()
             WHERE department_id = $8 RETURNING *`,
            [department_name.trim(), description || null, cost_center_code || null,
                head_employee_id || null, sort_order || 0, is_active !== false,
                req.user.employee_id, id]
        );
        if (rows.length === 0) return res.status(404).json({ message: 'Department not found' });
        res.json(rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ message: 'A department with that name already exists.' });
        }
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// --- Government IDs (sensitive) ------------------------------------------

router.get('/employees/:id/government-ids', protect, hasPermission('hr:view_sensitive'), async (req, res) => {
    const { id } = req.params;
    try {
        const { rows } = await db.query(
            `SELECT employee_id, ${GOV_ID_COLUMNS.join(', ')}, updated_at
             FROM employee_government_id WHERE employee_id = $1`,
            [id]
        );
        await logSensitiveAccess(db, id, req.user.employee_id, 'VIEW');
        // An employee with nothing on file yet is a valid state, not a 404 —
        // the row is created lazily on first save.
        res.json(rows[0] || { employee_id: Number(id) });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

router.put('/employees/:id/government-ids', protect, hasPermission('hr:view_sensitive'), async (req, res) => {
    const { id } = req.params;
    const values = GOV_ID_COLUMNS.map((c) => {
        const v = req.body[c];
        return (v === undefined || (typeof v === 'string' && v.trim() === '')) ? null : v;
    });

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const employeeExists = await client.query('SELECT 1 FROM employee WHERE employee_id = $1', [id]);
        if (employeeExists.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Employee not found' });
        }

        const assignments = GOV_ID_COLUMNS.map((c) => `${c} = EXCLUDED.${c}`).join(', ');
        const placeholders = GOV_ID_COLUMNS.map((_, i) => `$${i + 2}`).join(', ');
        const { rows } = await client.query(
            `INSERT INTO employee_government_id (employee_id, ${GOV_ID_COLUMNS.join(', ')}, created_by, modified_by)
             VALUES ($1, ${placeholders}, $${GOV_ID_COLUMNS.length + 2}, $${GOV_ID_COLUMNS.length + 2})
             ON CONFLICT (employee_id) DO UPDATE
             SET ${assignments}, modified_by = EXCLUDED.modified_by, updated_at = now()
             RETURNING employee_id, ${GOV_ID_COLUMNS.join(', ')}, updated_at`,
            [id, ...values, req.user.employee_id]
        );
        await logSensitiveAccess(client, id, req.user.employee_id, 'UPDATE');
        await client.query('COMMIT');
        res.json(rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23505') {
            return res.status(409).json({ message: 'That government ID is already recorded against another employee.' });
        }
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});

// --- Compensation --------------------------------------------------------

router.get('/employees/:id/compensation', protect, hasPermission('hr:manage_compensation'), async (req, res) => {
    const { id } = req.params;
    try {
        const { rows } = await db.query(
            `SELECT c.compensation_id, c.employee_id,
                    TO_CHAR(c.effective_date, 'YYYY-MM-DD') AS effective_date,
                    c.pay_basis, c.base_rate, c.days_per_year,
                    c.declared_monthly_basic, c.sss_msc_override, c.reason, c.notes,
                    TRIM(CONCAT_WS(' ', e.first_name, e.last_name)) AS created_by_name,
                    c.created_at
             FROM employee_compensation c
             LEFT JOIN employee e ON c.created_by = e.employee_id
             WHERE c.employee_id = $1
             ORDER BY c.effective_date DESC`,
            [id]
        );
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

router.post('/employees/:id/compensation', protect, hasPermission('hr:manage_compensation'), async (req, res) => {
    const { id } = req.params;
    const {
        effective_date, base_rate, pay_basis = 'daily', days_per_year = 313,
        declared_monthly_basic, sss_msc_override, reason, notes,
    } = req.body;

    if (!effective_date || !/^\d{4}-\d{2}-\d{2}$/.test(effective_date)) {
        return res.status(400).json({ message: 'A valid effective date (YYYY-MM-DD) is required' });
    }
    const rate = Number(base_rate);
    if (!Number.isFinite(rate) || rate < 0) {
        return res.status(400).json({ message: 'Base rate must be a non-negative number' });
    }

    try {
        const { rows } = await db.query(
            `INSERT INTO employee_compensation
                (employee_id, effective_date, pay_basis, base_rate, days_per_year,
                 declared_monthly_basic, sss_msc_override, reason, notes, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             -- effective_date must come back via TO_CHAR: a bare DATE is handed to
             -- the driver as a JS Date rendered in Asia/Manila, which shifts it a
             -- day earlier (2026-01-01 -> 2025-12-31T16:00Z).
             RETURNING compensation_id, employee_id,
                       TO_CHAR(effective_date, 'YYYY-MM-DD') AS effective_date,
                       pay_basis, base_rate, days_per_year,
                       declared_monthly_basic, sss_msc_override, reason, notes, created_at`,
            [id, effective_date, pay_basis, rate, days_per_year,
                declared_monthly_basic || null, sss_msc_override || null,
                reason || null, notes || null, req.user.employee_id]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ message: 'A compensation record already exists for that effective date.' });
        }
        if (err.code === '23503') {
            return res.status(404).json({ message: 'Employee not found' });
        }
        if (err.code === '23514') {
            return res.status(400).json({ message: 'Invalid pay basis or base rate.' });
        }
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Resolves the rate in force on a given date: the latest record whose
// effective_date is on or before it. This is what payroll will call so a run
// for a closed period is unaffected by a later raise.
router.get('/employees/:id/compensation/effective', protect, hasPermission('hr:manage_compensation'), async (req, res) => {
    const { id } = req.params;
    const asOf = req.query.as_of && /^\d{4}-\d{2}-\d{2}$/.test(req.query.as_of)
        ? req.query.as_of
        : new Date().toISOString().slice(0, 10);
    try {
        const { rows } = await db.query(
            `SELECT compensation_id, employee_id,
                    TO_CHAR(effective_date, 'YYYY-MM-DD') AS effective_date,
                    pay_basis, base_rate, days_per_year,
                    declared_monthly_basic, sss_msc_override
             FROM employee_compensation
             WHERE employee_id = $1 AND effective_date <= $2
             ORDER BY effective_date DESC
             LIMIT 1`,
            [id, asOf]
        );
        if (rows.length === 0) {
            return res.status(404).json({ message: 'No compensation on record as of that date' });
        }
        res.json(rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// --- Sensitive access audit ---------------------------------------------

router.get('/employees/:id/sensitive-access-log', protect, hasPermission('hr:view_sensitive'), async (req, res) => {
    const { id } = req.params;
    const { paginated, page, pageSize, offset, limit } = parsePaginationQuery(req.query);
    try {
        const base = `
            SELECT l.log_id, l.action, l.accessed_at, l.accessed_by,
                   TRIM(CONCAT_WS(' ', e.first_name, e.last_name)) AS accessed_by_name
            FROM employee_sensitive_access_log l
            LEFT JOIN employee e ON l.accessed_by = e.employee_id
            WHERE l.employee_id = $1
            ORDER BY l.accessed_at DESC`;
        if (!paginated) {
            const { rows } = await db.query(base, [id]);
            return res.json(rows);
        }
        const countRes = await db.query(
            'SELECT COUNT(*)::int AS total FROM employee_sensitive_access_log WHERE employee_id = $1', [id]);
        const { rows } = await db.query(`${base} LIMIT $2 OFFSET $3`, [id, limit, offset]);
        res.json(paginatedResponse({ data: rows, page, pageSize, total: countRes.rows[0]?.total || 0 }));
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// --- Recurring pay components (benefits and deductions) ------------------
// Assigning these is a compensation decision, so it sits behind the same
// Admin-only permission as pay rates.

router.get('/pay-components', protect, hasPermission('hr:view'), async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT component_code, component_name, component_type, is_taxable, is_statutory, is_system, sort_order
             FROM pay_component
             WHERE is_active
               -- is_assignable excludes everything the engine produces itself:
               -- basic pay, overtime, statutory contributions and loan codes.
               -- Offering BASIC here would let someone double-pay a salary.
               AND is_assignable = true
               AND component_type IN ('EARNING', 'DEDUCTION')
             ORDER BY component_type DESC, sort_order, component_name`
        );
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

router.get('/employees/:id/pay-components', protect, hasPermission('hr:manage_compensation'), async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT epc.epc_id, epc.component_code, epc.amount, epc.rate_percent, epc.frequency,
                    TO_CHAR(epc.effective_from, 'YYYY-MM-DD') AS effective_from,
                    TO_CHAR(epc.effective_to, 'YYYY-MM-DD') AS effective_to,
                    epc.is_active, epc.notes,
                    pc.component_name, pc.component_type, pc.is_taxable
             FROM employee_pay_component epc
             JOIN pay_component pc ON pc.component_code = epc.component_code
             WHERE epc.employee_id = $1
             ORDER BY pc.component_type DESC, epc.effective_from DESC`,
            [req.params.id]
        );
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

router.post('/employees/:id/pay-components', protect, hasPermission('hr:manage_compensation'), async (req, res) => {
    const { component_code, amount, rate_percent, frequency, effective_from, effective_to, notes } = req.body;

    if (!component_code) return res.status(400).json({ message: 'component_code is required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effective_from || '')) {
        return res.status(400).json({ message: 'effective_from is required in YYYY-MM-DD format' });
    }
    const hasAmount = amount !== undefined && amount !== null && amount !== '';
    const hasRate = rate_percent !== undefined && rate_percent !== null && rate_percent !== '';
    if (hasAmount === hasRate) {
        return res.status(400).json({ message: 'Provide either a fixed amount or a percentage of basic pay, not both.' });
    }

    try {
        const { rows } = await db.query(
            `INSERT INTO employee_pay_component
                (employee_id, component_code, amount, rate_percent, frequency, effective_from, effective_to, notes, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             RETURNING epc_id, component_code, amount, rate_percent, frequency,
                       TO_CHAR(effective_from, 'YYYY-MM-DD') AS effective_from,
                       TO_CHAR(effective_to, 'YYYY-MM-DD') AS effective_to`,
            [req.params.id, component_code, hasAmount ? Number(amount) : null,
                hasRate ? Number(rate_percent) : null, frequency || 'EVERY_CUTOFF',
                effective_from, effective_to || null, notes || null, req.user.employee_id]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        if (err.code === '23P01') {
            return res.status(409).json({ message: 'That component already applies to this employee over those dates.' });
        }
        if (err.code === '23503') return res.status(404).json({ message: 'Employee or component not found' });
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

router.delete('/employees/:id/pay-components/:epcId', protect, hasPermission('hr:manage_compensation'), async (req, res) => {
    try {
        // Deactivated rather than deleted: a component that has already been
        // paid on a payslip should remain explainable.
        const { rows } = await db.query(
            `UPDATE employee_pay_component
             SET is_active = false, modified_by = $1, updated_at = now()
             WHERE epc_id = $2 AND employee_id = $3
             RETURNING epc_id`,
            [req.user.employee_id, req.params.epcId, req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ message: 'Assignment not found' });
        res.json({ epc_id: Number(req.params.epcId), is_active: false });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// --- Standing statutory overrides ---------------------------------------

router.get('/employees/:id/statutory-overrides', protect, hasPermission('payroll:override'), async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT o.override_id, o.component_code, o.override_amount, o.reason,
                    TO_CHAR(o.effective_from, 'YYYY-MM-DD') AS effective_from,
                    TO_CHAR(o.effective_to, 'YYYY-MM-DD') AS effective_to,
                    o.is_active, pc.component_name,
                    TRIM(CONCAT_WS(' ', e.first_name, e.last_name)) AS created_by_name,
                    o.created_at
             FROM employee_statutory_override o
             JOIN pay_component pc ON pc.component_code = o.component_code
             LEFT JOIN employee e ON o.created_by = e.employee_id
             WHERE o.employee_id = $1
             ORDER BY o.effective_from DESC`,
            [req.params.id]
        );
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

router.post('/employees/:id/statutory-overrides', protect, hasPermission('payroll:override'), async (req, res) => {
    const { component_code, override_amount, reason, effective_from, effective_to } = req.body;

    if (!reason || !String(reason).trim()) {
        return res.status(400).json({ message: 'A reason is required when overriding a statutory amount.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effective_from || '')) {
        return res.status(400).json({ message: 'effective_from is required in YYYY-MM-DD format' });
    }
    const value = Number(override_amount);
    if (!Number.isFinite(value) || value < 0) {
        return res.status(400).json({ message: 'override_amount must be a non-negative number' });
    }

    try {
        const { rows } = await db.query(
            `INSERT INTO employee_statutory_override
                (employee_id, component_code, override_amount, reason, effective_from, effective_to, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             RETURNING override_id, component_code, override_amount, reason,
                       TO_CHAR(effective_from, 'YYYY-MM-DD') AS effective_from`,
            [req.params.id, component_code, value, String(reason).trim(),
                effective_from, effective_to || null, req.user.employee_id]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        if (err.code === '23P01') {
            return res.status(409).json({ message: 'An override for that contribution already covers those dates.' });
        }
        if (err.code === '23514') {
            return res.status(400).json({ message: 'Only SSS, WISP, PhilHealth, Pag-IBIG and withholding tax can be overridden.' });
        }
        if (err.code === '23503') return res.status(404).json({ message: 'Employee or component not found' });
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

router.delete('/employees/:id/statutory-overrides/:overrideId', protect, hasPermission('payroll:override'), async (req, res) => {
    try {
        const { rows } = await db.query(
            `UPDATE employee_statutory_override
             SET is_active = false, modified_by = $1, updated_at = now()
             WHERE override_id = $2 AND employee_id = $3 RETURNING override_id`,
            [req.user.employee_id, req.params.overrideId, req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ message: 'Override not found' });
        res.json({ override_id: Number(req.params.overrideId), is_active: false });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// --- Work schedules ------------------------------------------------------

router.get('/work-schedules', protect, hasPermission('hr:view'), async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT ws.schedule_id, ws.schedule_name, ws.description, ws.is_default, ws.is_active,
                    COALESCE(
                        JSON_AGG(
                            JSON_BUILD_OBJECT(
                                'day_of_week', wsd.day_of_week,
                                'is_rest_day', wsd.is_rest_day,
                                'time_in', wsd.time_in,
                                'time_out', wsd.time_out,
                                'break_minutes', wsd.break_minutes,
                                'expected_hours', wsd.expected_hours
                            ) ORDER BY wsd.day_of_week
                        ) FILTER (WHERE wsd.schedule_day_id IS NOT NULL), '[]'
                    ) AS days,
                    (SELECT COUNT(*)::int FROM employee e
                      WHERE e.work_schedule_id = ws.schedule_id AND e.is_active) AS employee_count
             FROM work_schedule ws
             LEFT JOIN work_schedule_day wsd ON wsd.schedule_id = ws.schedule_id
             GROUP BY ws.schedule_id
             ORDER BY ws.is_default DESC, ws.schedule_name`
        );
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Replaces the whole week in one transaction: a schedule is only coherent as a
// complete set of seven days, so partial updates are not offered.
router.put('/work-schedules/:id', protect, hasPermission('hr:manage_schedules'), async (req, res) => {
    const { schedule_name, description, is_active, days } = req.body;
    if (!schedule_name || !schedule_name.trim()) {
        return res.status(400).json({ message: 'Schedule name is required' });
    }
    if (!Array.isArray(days) || days.length !== 7) {
        return res.status(400).json({ message: 'Exactly seven day rows (Sunday to Saturday) are required' });
    }
    for (const day of days) {
        if (!day.is_rest_day && (!day.time_in || !day.time_out)) {
            return res.status(400).json({ message: 'A working day needs both a time in and a time out' });
        }
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(
            `UPDATE work_schedule
             SET schedule_name = $1, description = $2, is_active = $3, modified_by = $4, updated_at = now()
             WHERE schedule_id = $5 RETURNING schedule_id`,
            [schedule_name.trim(), description || null, is_active !== false, req.user.employee_id, req.params.id]
        );
        if (rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Work schedule not found' });
        }

        await client.query('DELETE FROM work_schedule_day WHERE schedule_id = $1', [req.params.id]);
        for (const day of days) {
            await client.query(
                `INSERT INTO work_schedule_day
                    (schedule_id, day_of_week, is_rest_day, time_in, time_out, break_minutes, expected_hours)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [req.params.id, day.day_of_week, Boolean(day.is_rest_day),
                    day.is_rest_day ? null : day.time_in,
                    day.is_rest_day ? null : day.time_out,
                    day.break_minutes ?? 60, day.expected_hours ?? 8]
            );
        }
        await client.query('COMMIT');
        res.json({ schedule_id: Number(req.params.id), days: days.length });
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23505') return res.status(409).json({ message: 'A schedule with that name already exists.' });
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});

// --- Holidays ------------------------------------------------------------

router.get('/holidays', protect, hasPermission('hr:view'), async (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    try {
        const { rows } = await db.query(
            `SELECT holiday_id, TO_CHAR(holiday_date, 'YYYY-MM-DD') AS holiday_date,
                    holiday_name, holiday_type, is_nationwide, locality, notes
             FROM holiday
             WHERE EXTRACT(YEAR FROM holiday_date) = $1
             ORDER BY holiday_date`,
            [year]
        );
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

router.post('/holidays', protect, hasPermission('hr:manage_schedules'), async (req, res) => {
    const { holiday_date, holiday_name, holiday_type, is_nationwide, locality, notes } = req.body;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(holiday_date || '')) {
        return res.status(400).json({ message: 'holiday_date is required in YYYY-MM-DD format' });
    }
    if (!holiday_name || !holiday_name.trim()) {
        return res.status(400).json({ message: 'holiday_name is required' });
    }
    try {
        const { rows } = await db.query(
            `INSERT INTO holiday (holiday_date, holiday_name, holiday_type, is_nationwide, locality, notes, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING holiday_id, TO_CHAR(holiday_date, 'YYYY-MM-DD') AS holiday_date,
                       holiday_name, holiday_type, is_nationwide, locality, notes`,
            [holiday_date, holiday_name.trim(), holiday_type || 'Regular',
                is_nationwide !== false, locality || null, notes || null, req.user.employee_id]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ message: 'That holiday is already on the calendar.' });
        if (err.code === '23514') return res.status(400).json({ message: 'Invalid holiday type.' });
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

router.delete('/holidays/:id', protect, hasPermission('hr:manage_schedules'), async (req, res) => {
    try {
        const { rows } = await db.query(
            'DELETE FROM holiday WHERE holiday_id = $1 RETURNING holiday_id', [req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ message: 'Holiday not found' });
        res.json({ holiday_id: Number(req.params.id), deleted: true });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
