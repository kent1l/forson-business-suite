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

module.exports = router;
