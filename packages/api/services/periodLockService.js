/**
 * Accounting period locks.
 *
 * A locked period cannot be written to by anyone, including an admin, until it
 * is explicitly reopened — a separate, audited action. This is deliberately not
 * a `hasPermission('...:override')` check on the write itself: that would let a
 * permitted user's edit silently bypass a close with no distinct trace that the
 * period was ever touched. Reopen, edit, reclose is the standard shape in real
 * bookkeeping systems, and it is the shape enforced here.
 *
 * `module` defaults to 'expenses' (the only caller today) but the table and this
 * service are not hardcoded to it, so AR/AP/payroll can lock their own periods
 * against the same table later.
 */
const db = require('./../db');

/** First day of the Manila calendar month containing `date`, as a plain date. */
function periodMonthOf(date) {
    const d = typeof date === 'string' ? new Date(`${date}T00:00:00+08:00`) : new Date(date);
    const manila = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
    return `${manila.getFullYear()}-${String(manila.getMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Throws a 423 (Locked) if `date` falls in a locked period. Call before writing
 * anything dated into that period — creating, editing, voiding, or moving a date
 * into it.
 */
async function assertPeriodOpen(date, { module = 'expenses' } = {}) {
    const periodMonth = periodMonthOf(date);
    const { rows } = await db.query(
        `SELECT lock_id FROM period_lock WHERE module = $1 AND period_month = $2 AND is_locked = true`,
        [module, periodMonth]
    );
    if (rows.length > 0) {
        const label = new Date(`${periodMonth}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        const err = new Error(`${label} is locked. Reopen the period before making changes to it.`);
        err.statusCode = 423;
        err.periodMonth = periodMonth;
        throw err;
    }
}

async function listLocks({ module = 'expenses', months = 12 } = {}) {
    const { rows } = await db.query(
        `SELECT pl.lock_id, pl.module, TO_CHAR(pl.period_month, 'YYYY-MM-DD') AS period_month,
                pl.is_locked, pl.locked_at, pl.unlocked_at, pl.unlock_reason,
                json_build_object('employee_id', le.employee_id, 'first_name', le.first_name, 'last_name', le.last_name) AS locked_by,
                CASE WHEN ue.employee_id IS NOT NULL
                     THEN json_build_object('employee_id', ue.employee_id, 'first_name', ue.first_name, 'last_name', ue.last_name)
                     ELSE NULL END AS unlocked_by
         FROM period_lock pl
         LEFT JOIN employee le ON le.employee_id = pl.locked_by
         LEFT JOIN employee ue ON ue.employee_id = pl.unlocked_by
         WHERE pl.module = $1
         ORDER BY pl.period_month DESC
         LIMIT $2`,
        [module, months]
    );
    return rows;
}

/** True whenever the given month is locked, even if there is no explicit row yet
 * — used by the UI to offer "Lock" for any of the last several months at once. */
async function listRecentMonths({ module = 'expenses', months = 12 } = {}) {
    const { rows } = await db.query(
        `WITH recent AS (
             SELECT date_trunc('month', now() AT TIME ZONE 'Asia/Manila')::date - (n || ' months')::interval AS period_month
             FROM generate_series(0, $2 - 1) AS n
         )
         SELECT TO_CHAR(r.period_month, 'YYYY-MM-DD') AS period_month,
                COALESCE(pl.is_locked, false) AS is_locked,
                pl.lock_id
         FROM recent r
         LEFT JOIN period_lock pl ON pl.module = $1 AND pl.period_month = r.period_month::date
         ORDER BY r.period_month DESC`,
        [module, months]
    );
    return rows;
}

async function lockPeriod({ periodMonth, employeeId, module = 'expenses' }) {
    const monthStart = periodMonthOf(`${periodMonth}-01`);
    const { rows } = await db.query(
        `INSERT INTO period_lock (module, period_month, is_locked, locked_by, locked_at)
         VALUES ($1, $2, true, $3, NOW())
         ON CONFLICT (module, period_month)
         DO UPDATE SET is_locked = true, locked_by = $3, locked_at = NOW(),
                        unlocked_by = NULL, unlocked_at = NULL, unlock_reason = NULL
         RETURNING lock_id`,
        [module, monthStart, employeeId]
    );
    await db.query(
        `INSERT INTO period_lock_log (module, period_month, action, employee_id)
         VALUES ($1, $2, 'lock', $3)`,
        [module, monthStart, employeeId]
    );
    return rows[0];
}

async function unlockPeriod({ periodMonth, reason, employeeId, module = 'expenses' }) {
    if (!reason || !String(reason).trim()) {
        const err = new Error('A reason is required to reopen a locked period.');
        err.statusCode = 400;
        throw err;
    }
    const monthStart = periodMonthOf(`${periodMonth}-01`);
    const { rows } = await db.query(
        `UPDATE period_lock
            SET is_locked = false, unlocked_by = $3, unlocked_at = NOW(), unlock_reason = $4
          WHERE module = $1 AND period_month = $2 AND is_locked = true
          RETURNING lock_id`,
        [module, monthStart, employeeId, String(reason).trim()]
    );
    if (rows.length === 0) {
        const err = new Error('This period is not currently locked.');
        err.statusCode = 409;
        throw err;
    }
    await db.query(
        `INSERT INTO period_lock_log (module, period_month, action, reason, employee_id)
         VALUES ($1, $2, 'unlock', $3, $4)`,
        [module, monthStart, String(reason).trim(), employeeId]
    );
    return rows[0];
}

module.exports = {
    periodMonthOf,
    assertPeriodOpen,
    listLocks,
    listRecentMonths,
    lockPeriod,
    unlockPeriod
};
