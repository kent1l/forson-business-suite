const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const { parsePaginationQuery, paginatedResponse } = require('../helpers/pagination');
const payrollRunService = require('../services/hr/payrollRunService');
const payrollPostingService = require('../services/hr/payrollPostingService');

const router = express.Router();

// Maps service-level error codes onto HTTP responses in one place.
const ERROR_STATUS = {
    RUN_NOT_FOUND: 404,
    PERIOD_NOT_FOUND: 404,
    INVALID_TRANSITION: 409,
    NOTHING_TO_COMPUTE: 422,
    NO_EMPLOYEES: 422,
    STATUTORY_VERSION_MISSING: 422,
    POSTING_NOT_CONFIGURED: 422,
    VOID_REASON_REQUIRED: 400,
};

const handleError = (err, res) => {
    const status = ERROR_STATUS[err.code];
    if (status) return res.status(status).json({ message: err.message });
    console.error(err.message);
    return res.status(500).send('Server Error');
};

/** Wraps a handler in a transaction, since every lifecycle step is multi-write. */
const withTransaction = (handler) => async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const result = await handler(req, client);
        await client.query('COMMIT');
        res.json(result);
    } catch (err) {
        await client.query('ROLLBACK');
        handleError(err, res);
    } finally {
        client.release();
    }
};

// --- Pay periods ---------------------------------------------------------

router.get('/periods', protect, hasPermission('payroll:view'), async (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    try {
        const { rows } = await db.query(
            `SELECT p.pay_period_id, p.period_year, p.period_month, p.period_seq,
                    TO_CHAR(p.period_start, 'YYYY-MM-DD') AS period_start,
                    TO_CHAR(p.period_end, 'YYYY-MM-DD') AS period_end,
                    TO_CHAR(p.pay_date, 'YYYY-MM-DD') AS pay_date,
                    p.is_closed,
                    r.run_id, r.run_no, r.status AS run_status
             FROM pay_period p
             LEFT JOIN payroll_run r ON r.pay_period_id = p.pay_period_id AND r.status <> 'Voided'
             WHERE p.period_year = $1
             ORDER BY p.period_month, p.period_seq`,
            [year]
        );
        res.json(rows);
    } catch (err) { handleError(err, res); }
});

// --- Runs ----------------------------------------------------------------

router.get('/runs', protect, hasPermission('payroll:view'), async (req, res) => {
    const { paginated, page, pageSize, offset, limit } = parsePaginationQuery(req.query);
    const conditions = [];
    const params = [];
    let idx = 1;
    if (req.query.status) { conditions.push(`r.status = $${idx++}`); params.push(req.query.status); }
    if (req.query.year) { conditions.push(`EXTRACT(YEAR FROM r.period_start) = $${idx++}`); params.push(Number(req.query.year)); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const base = `
        SELECT r.run_id, r.run_no, r.run_type, r.status,
               TO_CHAR(r.period_start, 'YYYY-MM-DD') AS period_start,
               TO_CHAR(r.period_end, 'YYYY-MM-DD') AS period_end,
               TO_CHAR(r.pay_date, 'YYYY-MM-DD') AS pay_date,
               r.employee_count, r.total_gross, r.total_deductions, r.total_net, r.total_employer_contrib,
               d.department_name, r.void_reason,
               TRIM(CONCAT_WS(' ', c.first_name, c.last_name)) AS created_by_name
        FROM payroll_run r
        LEFT JOIN department d ON r.department_id = d.department_id
        LEFT JOIN employee c ON r.created_by = c.employee_id
        ${where}
        ORDER BY r.period_start DESC, r.run_id DESC`;

    try {
        if (!paginated) {
            const { rows } = await db.query(base, params);
            return res.json(rows);
        }
        const countRes = await db.query(`SELECT COUNT(*)::int AS total FROM payroll_run r ${where}`, params);
        const { rows } = await db.query(`${base} LIMIT $${idx} OFFSET $${idx + 1}`, [...params, limit, offset]);
        res.json(paginatedResponse({ data: rows, page, pageSize, total: countRes.rows[0]?.total || 0 }));
    } catch (err) { handleError(err, res); }
});

router.get('/runs/:id', protect, hasPermission('payroll:view'), async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT r.*, d.department_name,
                    TO_CHAR(r.period_start, 'YYYY-MM-DD') AS period_start,
                    TO_CHAR(r.period_end, 'YYYY-MM-DD') AS period_end,
                    TO_CHAR(r.pay_date, 'YYYY-MM-DD') AS pay_date
             FROM payroll_run r
             LEFT JOIN department d ON r.department_id = d.department_id
             WHERE r.run_id = $1`,
            [req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ message: 'Payroll run not found' });
        res.json(rows[0]);
    } catch (err) { handleError(err, res); }
});

router.post('/runs', protect, hasPermission('payroll:compute'), withTransaction(async (req, client) => {
    const { pay_period_id, run_type, department_id, notes } = req.body;
    if (!pay_period_id) {
        const err = new Error('pay_period_id is required');
        err.code = 'PERIOD_NOT_FOUND';
        throw err;
    }
    return payrollRunService.createRun(client, {
        payPeriodId: pay_period_id,
        runType: run_type || 'REGULAR',
        departmentId: department_id || null,
        createdBy: req.user.employee_id,
        notes,
    });
}));

router.post('/runs/:id/compute', protect, hasPermission('payroll:compute'), withTransaction(
    (req, client) => payrollRunService.computeRun(client, {
        runId: req.params.id, computedBy: req.user.employee_id,
    })
));

router.post('/runs/:id/revert', protect, hasPermission('payroll:compute'), withTransaction(
    (req, client) => payrollRunService.revertToDraft(client, {
        runId: req.params.id, userId: req.user.employee_id,
    })
));

router.post('/runs/:id/approve', protect, hasPermission('payroll:approve'), withTransaction(
    (req, client) => payrollRunService.approveRun(client, {
        runId: req.params.id, approvedBy: req.user.employee_id,
    })
));

router.post('/runs/:id/mark-paid', protect, hasPermission('payroll:post'), withTransaction(
    (req, client) => payrollRunService.markPaid(client, {
        runId: req.params.id, paidBy: req.user.employee_id,
    })
));

router.post('/runs/:id/post', protect, hasPermission('payroll:post'), withTransaction(
    (req, client) => payrollPostingService.postRunToExpense(client, {
        runId: req.params.id, postedBy: req.user.employee_id,
    })
));

router.post('/runs/:id/void', protect, hasPermission('payroll:void'), withTransaction(
    (req, client) => payrollRunService.voidRun(client, {
        runId: req.params.id, userId: req.user.employee_id, reason: req.body.reason,
    })
));

// --- Payslips ------------------------------------------------------------

router.get('/runs/:id/payslips', protect, hasPermission('payroll:view'), async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT payslip_id, employee_id, payslip_no, employee_code, employee_name,
                    position_title, department_name, daily_rate,
                    days_worked, days_paid, days_absent, days_on_leave, overtime_hours,
                    basic_pay, overtime_pay, night_diff_pay, gross_pay,
                    sss_ee, sss_mpf_ee, philhealth_ee, pagibig_ee, withholding_tax,
                    loans_total, total_deductions, net_pay, total_employer_contrib
             FROM payroll_payslip WHERE run_id = $1
             ORDER BY employee_name`,
            [req.params.id]
        );
        res.json(rows);
    } catch (err) { handleError(err, res); }
});

router.get('/payslips/:id', protect, hasPermission('payroll:view'), async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM payroll_payslip WHERE payslip_id = $1', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Payslip not found' });
        const { rows: lines } = await db.query(
            `SELECT line_type, component_code, description, quantity, rate, amount, is_taxable, sort_order
             FROM payroll_payslip_line WHERE payslip_id = $1 ORDER BY sort_order, line_id`,
            [req.params.id]
        );
        res.json({ ...rows[0], lines });
    } catch (err) { handleError(err, res); }
});

/**
 * An employee's own payslips. Scoped to req.user.employee_id and never to a
 * caller-supplied id, so this cannot be turned into a way to read someone
 * else's pay.
 */
router.get('/me/payslips', protect, hasPermission('payslip:view_own'), async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT p.payslip_id, p.payslip_no, p.gross_pay, p.total_deductions, p.net_pay,
                    p.days_paid, TO_CHAR(r.period_start, 'YYYY-MM-DD') AS period_start,
                    TO_CHAR(r.period_end, 'YYYY-MM-DD') AS period_end,
                    TO_CHAR(r.pay_date, 'YYYY-MM-DD') AS pay_date, r.status
             FROM payroll_payslip p
             JOIN payroll_run r ON p.run_id = r.run_id
             WHERE p.employee_id = $1 AND r.status IN ('Approved', 'Paid', 'Posted')
             ORDER BY r.period_start DESC`,
            [req.user.employee_id]
        );
        res.json(rows);
    } catch (err) { handleError(err, res); }
});

// --- Statutory configuration --------------------------------------------

router.get('/statutory-versions', protect, hasPermission('payroll:config'), async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT v.version_id, v.agency, v.version_label,
                    TO_CHAR(v.effective_from, 'YYYY-MM-DD') AS effective_from,
                    TO_CHAR(v.effective_to, 'YYYY-MM-DD') AS effective_to,
                    v.source_reference, v.is_active,
                    EXISTS (
                        SELECT 1 FROM payroll_run r
                        WHERE r.status NOT IN ('Draft', 'Voided')
                          AND v.version_id IN (r.sss_version_id, r.philhealth_version_id,
                                               r.pagibig_version_id, r.bir_version_id)
                    ) AS in_use
             FROM statutory_table_version v
             ORDER BY v.agency, v.effective_from DESC`
        );
        res.json(rows);
    } catch (err) { handleError(err, res); }
});

router.get('/statutory-versions/:id/brackets', protect, hasPermission('payroll:config'), async (req, res) => {
    try {
        const { rows: versionRows } = await db.query(
            'SELECT agency FROM statutory_table_version WHERE version_id = $1', [req.params.id]
        );
        if (versionRows.length === 0) return res.status(404).json({ message: 'Statutory version not found' });
        const agency = versionRows[0].agency;

        let data;
        if (agency === 'SSS') {
            ({ rows: data } = await db.query(
                `SELECT range_from, range_to, msc, ee_amount, er_amount, ec_amount, mpf_ee, mpf_er
                 FROM sss_contribution_bracket WHERE version_id = $1 ORDER BY range_from`,
                [req.params.id]
            ));
        } else if (agency === 'PHILHEALTH') {
            ({ rows: data } = await db.query('SELECT * FROM philhealth_config WHERE version_id = $1', [req.params.id]));
        } else if (agency === 'PAGIBIG') {
            ({ rows: data } = await db.query('SELECT * FROM pagibig_config WHERE version_id = $1', [req.params.id]));
        } else {
            ({ rows: data } = await db.query(
                `SELECT payroll_frequency, bracket_seq, lower_bound, upper_bound, base_tax, rate_percent, excess_over
                 FROM bir_withholding_bracket WHERE version_id = $1
                 ORDER BY payroll_frequency, bracket_seq`,
                [req.params.id]
            ));
        }
        res.json({ agency, brackets: data });
    } catch (err) { handleError(err, res); }
});

module.exports = router;
