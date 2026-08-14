const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const { parsePaginationQuery, paginatedResponse } = require('../helpers/pagination');
const payrollRunService = require('../services/hr/payrollRunService');
const payrollPostingService = require('../services/hr/payrollPostingService');
const statutoryAdmin = require('../services/hr/statutoryAdminService');
const reports = require('../services/hr/payrollReportService');
const { generatePayslipPdf } = require('../helpers/pdf/payslipPdf');

const router = express.Router();

// Mirrors the payroll_run.run_type CHECK constraint. JOB_ORDER pays
// contract-of-service workers and is excluded from the statutory reports.
const RUN_TYPES = ['REGULAR', 'THIRTEENTH_MONTH', 'FINAL_PAY', 'SPECIAL', 'JOB_ORDER'];

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
    VERSION_NOT_FOUND: 404,
    VERSION_IN_USE: 409,
    INVALID_EFFECTIVE_DATE: 400,
    INVALID_BRACKET_PARAMS: 400,
    // Also thrown by payrollReportService for a bad agency; without this entry
    // a caller's typo surfaced as a 500.
    INVALID_REPORT_PARAMS: 400,
};

const handleError = (err, res) => {
    const status = ERROR_STATUS[err.code];
    if (status) return res.status(status).json({ message: err.message });

    // The partial unique index that keeps one live run per period per scope.
    // Without this it surfaces as an unexplained 500 when someone creates a run
    // that already exists.
    if (err.code === '23505' && /uq_payroll_run_live_period/.test(err.message || '')) {
        return res.status(409).json({
            message: 'A payroll run already exists for this period. Void it first if you need to redo it.',
        });
    }
    // Triggers raise check_violation for the state-machine, payslip
    // immutability and adjustment guards; those are conflicts, not crashes.
    if (err.code === '23514') {
        return res.status(409).json({ message: err.message });
    }

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
    const runType = RUN_TYPES.includes(req.query.run_type) ? req.query.run_type : 'REGULAR';
    try {
        const { rows } = await db.query(
            `SELECT p.pay_period_id, p.period_year, p.period_month, p.period_seq,
                    TO_CHAR(p.period_start, 'YYYY-MM-DD') AS period_start,
                    TO_CHAR(p.period_end, 'YYYY-MM-DD') AS period_end,
                    TO_CHAR(p.pay_date, 'YYYY-MM-DD') AS pay_date,
                    p.is_closed,
                    r.run_id, r.run_no, r.status AS run_status
             FROM pay_period p
             -- Joined on run_type as well as period: a cutoff can legitimately
             -- hold one REGULAR run and one JOB_ORDER run at the same time, so
             -- joining on the period alone both hid periods from the "new run"
             -- picker and fanned out a duplicate row per live run.
             LEFT JOIN payroll_run r ON r.pay_period_id = p.pay_period_id
                                    AND r.status <> 'Voided'
                                    AND r.run_type = $2
             WHERE p.period_year = $1
             ORDER BY p.period_month, p.period_seq`,
            [year, runType]
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
    if (run_type && !RUN_TYPES.includes(run_type)) {
        const err = new Error(`run_type must be one of: ${RUN_TYPES.join(', ')}`);
        err.code = 'INVALID_REPORT_PARAMS';
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

// --- Payslip PDFs --------------------------------------------------------

/** Loads payslips plus their lines and the company name, ready for rendering. */
const loadPayslipsForPdf = async (whereSql, params) => {
    const { rows: payslips } = await db.query(
        `SELECT p.*, TO_CHAR(r.period_start, 'YYYY-MM-DD') AS period_start,
                TO_CHAR(r.period_end, 'YYYY-MM-DD') AS period_end,
                TO_CHAR(r.pay_date, 'YYYY-MM-DD') AS pay_date
         FROM payroll_payslip p
         JOIN payroll_run r ON p.run_id = r.run_id
         ${whereSql}
         ORDER BY p.department_name NULLS LAST, p.employee_name`,
        params
    );
    if (payslips.length === 0) return null;

    const ids = payslips.map((p) => p.payslip_id);
    const { rows: lines } = await db.query(
        `SELECT payslip_id, line_type, component_code, description, quantity, rate, amount, sort_order
         FROM payroll_payslip_line WHERE payslip_id = ANY($1::bigint[])
         ORDER BY sort_order, line_id`,
        [ids]
    );
    const linesByPayslip = new Map();
    for (const line of lines) {
        const key = String(line.payslip_id);
        if (!linesByPayslip.has(key)) linesByPayslip.set(key, []);
        linesByPayslip.get(key).push(line);
    }

    const { rows: settingRows } = await db.query(
        "SELECT setting_value FROM settings WHERE setting_key = 'COMPANY_NAME'"
    );

    return {
        payslips,
        linesByPayslip,
        company: { name: settingRows[0]?.setting_value || 'Company' },
        periodLabel: `${payslips[0].period_start} to ${payslips[0].period_end}`,
        payDate: payslips[0].pay_date,
    };
};

const sendPdf = (res, buffer, filename) => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(buffer);
};

// Whole run, laid out N-up. `per_page` accepts 2-6; 4 is the default.
// because full page width keeps the earnings/deductions columns readable.
router.get('/runs/:id/payslips.pdf', protect, hasPermission('payroll:view'), async (req, res) => {
    try {
        const data = await loadPayslipsForPdf('WHERE p.run_id = $1', [req.params.id]);
        if (!data) return res.status(404).json({ message: 'This run has no payslips to print.' });

        const pdf = await generatePayslipPdf({ ...data, perPage: Number(req.query.per_page) || 4 });
        sendPdf(res, pdf, `payslips-run-${req.params.id}.pdf`);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: 'Failed to generate payslip PDF' });
    }
});

router.get('/payslips/:id/pdf', protect, hasPermission('payroll:view'), async (req, res) => {
    try {
        const data = await loadPayslipsForPdf('WHERE p.payslip_id = $1', [req.params.id]);
        if (!data) return res.status(404).json({ message: 'Payslip not found' });
        // A single payslip still prints in the 3-up frame so a reprint matches
        // what the employee originally received.
        const pdf = await generatePayslipPdf({ ...data, perPage: Number(req.query.per_page) || 4 });
        sendPdf(res, pdf, `payslip-${req.params.id}.pdf`);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: 'Failed to generate payslip PDF' });
    }
});

/** An employee's own payslip. Scoped to their id, never a supplied one. */
router.get('/me/payslips/:id/pdf', protect, hasPermission('payslip:view_own'), async (req, res) => {
    try {
        const data = await loadPayslipsForPdf(
            `WHERE p.payslip_id = $1 AND p.employee_id = $2
               AND r.status IN ('Approved', 'Paid', 'Posted')`,
            [req.params.id, req.user.employee_id]
        );
        if (!data) return res.status(404).json({ message: 'Payslip not found' });
        const pdf = await generatePayslipPdf({ ...data, perPage: 4 });
        sendPdf(res, pdf, `payslip-${req.params.id}.pdf`);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: 'Failed to generate payslip PDF' });
    }
});

// --- Reports -------------------------------------------------------------

router.get('/reports/register/:runId', protect, hasPermission('payroll:view'), async (req, res) => {
    try {
        res.json(await reports.payrollRegister(db, { runId: req.params.runId }));
    } catch (err) { handleError(err, res); }
});

router.get('/reports/contributions', protect, hasPermission('payroll:view'), async (req, res) => {
    const { agency, year, month } = req.query;
    if (!year || !month) return res.status(400).json({ message: 'year and month are required' });
    try {
        res.json(await reports.contributionSchedule(db, {
            agency, year: Number(year), month: Number(month),
        }));
    } catch (err) { handleError(err, res); }
});

router.get('/reports/withholding-tax', protect, hasPermission('payroll:view'), async (req, res) => {
    if (!req.query.year) return res.status(400).json({ message: 'year is required' });
    try {
        res.json(await reports.withholdingTaxReport(db, {
            year: Number(req.query.year),
            month: req.query.month ? Number(req.query.month) : null,
        }));
    } catch (err) { handleError(err, res); }
});

router.get('/reports/thirteenth-month', protect, hasPermission('payroll:view'), async (req, res) => {
    if (!req.query.year) return res.status(400).json({ message: 'year is required' });
    try {
        res.json(await reports.thirteenthMonthReport(db, { year: Number(req.query.year) }));
    } catch (err) { handleError(err, res); }
});

// --- Run-scoped adjustments ---------------------------------------------
// These are INPUTS to the computation, not edits to a payslip, so they survive
// any number of recomputes. The database freezes them once the run leaves
// Computed, matching the payslip immutability boundary.

router.get('/runs/:id/adjustments', protect, hasPermission('payroll:view'), async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT a.adjustment_id, a.employee_id, a.component_code, a.adjustment_type,
                    a.amount, a.reason, a.created_at,
                    pc.component_name, pc.component_type,
                    TRIM(CONCAT_WS(' ', e.first_name, e.last_name)) AS employee_name,
                    TRIM(CONCAT_WS(' ', c.first_name, c.last_name)) AS created_by_name
             FROM payroll_run_adjustment a
             JOIN pay_component pc ON pc.component_code = a.component_code
             JOIN employee e ON a.employee_id = e.employee_id
             LEFT JOIN employee c ON a.created_by = c.employee_id
             WHERE a.run_id = $1
             ORDER BY e.last_name, a.created_at`,
            [req.params.id]
        );
        res.json(rows);
    } catch (err) { handleError(err, res); }
});

router.post('/runs/:id/adjustments', protect, hasPermission('payroll:override'), async (req, res) => {
    const { employee_id, component_code, adjustment_type = 'ADD', amount, reason } = req.body;

    if (!employee_id || !component_code) {
        return res.status(400).json({ message: 'employee_id and component_code are required' });
    }
    if (!reason || !String(reason).trim()) {
        return res.status(400).json({ message: 'A reason is required for every adjustment.' });
    }
    const value = Number(amount);
    if (!Number.isFinite(value)) {
        return res.status(400).json({ message: 'amount must be a number' });
    }

    try {
        const { rows } = await db.query(
            `INSERT INTO payroll_run_adjustment
                (run_id, employee_id, component_code, adjustment_type, amount, reason, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             RETURNING adjustment_id, employee_id, component_code, adjustment_type, amount, reason`,
            [req.params.id, employee_id, component_code, adjustment_type, value,
                String(reason).trim(), req.user.employee_id]
        );
        // The adjustment only reaches the payslip on the next compute.
        res.status(201).json({ ...rows[0], note: 'Recompute the run to apply this adjustment.' });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ message: 'An override for that component already exists on this run.' });
        }
        if (err.code === '23514') {
            return res.status(409).json({ message: err.message.replace(/^.*?ERROR:\s*/, '') });
        }
        if (err.code === '23503') return res.status(404).json({ message: 'Run, employee or component not found' });
        handleError(err, res);
    }
});

router.delete('/runs/:id/adjustments/:adjustmentId', protect, hasPermission('payroll:override'), async (req, res) => {
    try {
        const { rows } = await db.query(
            'DELETE FROM payroll_run_adjustment WHERE adjustment_id = $1 AND run_id = $2 RETURNING adjustment_id',
            [req.params.adjustmentId, req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ message: 'Adjustment not found' });
        res.json({ adjustment_id: Number(req.params.adjustmentId), deleted: true });
    } catch (err) {
        if (err.code === '23514') {
            return res.status(409).json({ message: 'This run is no longer editable, so its adjustments are frozen.' });
        }
        handleError(err, res);
    }
});

// --- Editing statutory schedules ----------------------------------------
// An unused schedule is edited in place; one that has already paid somebody is
// frozen and must be superseded. The database enforces this independently.

router.post('/statutory-versions', protect, hasPermission('payroll:config'), withTransaction(async (req, client) => {
    const { agency, version_label, effective_from, source_reference } = req.body;
    if (!['SSS', 'PHILHEALTH', 'PAGIBIG', 'BIR_WTAX'].includes(agency)) {
        throw Object.assign(new Error('agency must be one of SSS, PHILHEALTH, PAGIBIG, BIR_WTAX'), { code: 'INVALID_BRACKET_PARAMS' });
    }
    if (!version_label || !/^\d{4}-\d{2}-\d{2}$/.test(effective_from || '')) {
        throw Object.assign(new Error('version_label and a YYYY-MM-DD effective_from are required'), { code: 'INVALID_EFFECTIVE_DATE' });
    }
    return statutoryAdmin.createVersion(client, {
        agency, versionLabel: version_label, effectiveFrom: effective_from,
        sourceReference: source_reference, createdBy: req.user.employee_id,
    });
}));

router.put('/statutory-versions/:id', protect, hasPermission('payroll:config'), withTransaction(
    (req, client) => statutoryAdmin.updateVersion(client, {
        versionId: req.params.id,
        versionLabel: req.body.version_label,
        effectiveFrom: req.body.effective_from,
        effectiveTo: req.body.effective_to,
        sourceReference: req.body.source_reference,
    })
));

router.put('/statutory-versions/:id/brackets', protect, hasPermission('payroll:config'), withTransaction(
    (req, client) => statutoryAdmin.replaceBrackets(client, {
        versionId: req.params.id, payload: req.body,
    })
));

/** Preview a generated SSS table without saving, so rates can be sanity-checked first. */
router.post('/statutory-versions/preview-sss', protect, hasPermission('payroll:config'), async (req, res) => {
    try {
        res.json({ brackets: statutoryAdmin.generateSssBrackets(req.body || {}) });
    } catch (err) { handleError(err, res); }
});

router.post('/statutory-versions/:id/supersede', protect, hasPermission('payroll:config'), withTransaction(
    (req, client) => statutoryAdmin.supersedeVersion(client, {
        versionId: req.params.id,
        effectiveFrom: req.body.effective_from,
        versionLabel: req.body.version_label,
        sourceReference: req.body.source_reference,
        createdBy: req.user.employee_id,
    })
));

module.exports = router;
