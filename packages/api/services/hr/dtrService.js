'use strict';

/**
 * Daily time record service.
 *
 * Owns generation, correction and period summarisation of DTR rows. It never
 * touches money — the payroll engine (phase 4) reads summarizePeriodBulk and
 * applies rates itself.
 *
 * Generation is deliberately non-destructive: it fills gaps from the employee's
 * schedule and leaves anything a human has already touched (source = 'Manual')
 * or that payroll has locked exactly as it is. HR then edits only the
 * exceptions, which is the whole point of auto-generating the common case.
 *
 * Every function takes an `executor` (the db module or a transaction client) as
 * its first argument, following the apLedgerService convention, so callers
 * control transaction boundaries.
 */

// Day types that consume a scheduled working day but pay nothing.
const ZERO_PAY_DAY_TYPES = new Set(['Absent', 'Rest Day', 'Holiday']);

/** Days a given day_type contributes to "days paid", before leave adjustments. */
const dayFractionFor = (dayType) => {
    if (dayType === 'Half Day') return 0.5;
    if (ZERO_PAY_DAY_TYPES.has(dayType)) return 0;
    return 1;
};

/** Hours between two 'HH:MM[:SS]' times, less an unpaid break. Never negative. */
const hoursBetween = (timeIn, timeOut, breakMinutes = 0) => {
    if (!timeIn || !timeOut) return 0;
    const toMinutes = (t) => {
        const [h, m] = String(t).split(':').map(Number);
        return (h * 60) + (m || 0);
    };
    // An overnight shift ends "before" it starts on the clock, so wrap it.
    let span = toMinutes(timeOut) - toMinutes(timeIn);
    if (span < 0) span += 24 * 60;
    const net = span - breakMinutes;
    return net > 0 ? Math.round((net / 60) * 100) / 100 : 0;
};

/** Inclusive list of 'YYYY-MM-DD' strings. Built in UTC to avoid DST/TZ drift. */
const eachDate = (from, to) => {
    const out = [];
    const cursor = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    while (cursor <= end) {
        out.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return out;
};

/** 0 = Sunday, matching both Postgres EXTRACT(DOW) and work_schedule_day. */
const dayOfWeek = (isoDate) => new Date(`${isoDate}T00:00:00Z`).getUTCDay();

/**
 * Resolves the schedule rows for a set of employees.
 * @returns {Promise<Map<number, Map<number, object>>>} employeeId -> dow -> day row
 */
const loadSchedules = async (executor, employeeIds) => {
    const { rows } = await executor.query(
        `SELECT e.employee_id, wsd.day_of_week, wsd.is_rest_day,
                wsd.time_in, wsd.time_out, wsd.break_minutes, wsd.expected_hours
         FROM employee e
         JOIN work_schedule_day wsd ON wsd.schedule_id = e.work_schedule_id
         WHERE e.employee_id = ANY($1::int[])`,
        [employeeIds]
    );
    const byEmployee = new Map();
    for (const row of rows) {
        if (!byEmployee.has(row.employee_id)) byEmployee.set(row.employee_id, new Map());
        byEmployee.get(row.employee_id).set(row.day_of_week, row);
    }
    return byEmployee;
};

/** @returns {Promise<Map<string, object>>} 'YYYY-MM-DD' -> holiday row */
const loadHolidays = async (executor, from, to) => {
    const { rows } = await executor.query(
        `SELECT holiday_id, TO_CHAR(holiday_date, 'YYYY-MM-DD') AS holiday_date,
                holiday_name, holiday_type
         FROM holiday
         WHERE holiday_date BETWEEN $1 AND $2`,
        [from, to]
    );
    return new Map(rows.map((r) => [r.holiday_date, r]));
};

/**
 * Approved leave in the window, as employeeId -> 'YYYY-MM-DD' -> leave row.
 * Only approved leave lands on the DTR; pending requests must not pre-empt it.
 */
const loadApprovedLeave = async (executor, employeeIds, from, to) => {
    const { rows } = await executor.query(
        `SELECT lr.leave_id, lr.employee_id, lr.day_fraction, lt.is_paid, lt.leave_name,
                TO_CHAR(lr.date_from, 'YYYY-MM-DD') AS date_from,
                TO_CHAR(lr.date_to, 'YYYY-MM-DD') AS date_to
         FROM leave_request lr
         JOIN leave_type lt ON lt.leave_type_id = lr.leave_type_id
         WHERE lr.employee_id = ANY($1::int[])
           AND lr.status = 'Approved'
           AND lr.date_from <= $3 AND lr.date_to >= $2`,
        [employeeIds, from, to]
    );
    const byEmployee = new Map();
    for (const row of rows) {
        if (!byEmployee.has(row.employee_id)) byEmployee.set(row.employee_id, new Map());
        const target = byEmployee.get(row.employee_id);
        for (const date of eachDate(row.date_from, row.date_to)) target.set(date, row);
    }
    return byEmployee;
};

/**
 * Decides what a single employee-day looks like, given the schedule, the
 * holiday calendar and any approved leave. Pure — no I/O — so the precedence
 * rules are unit-testable on their own.
 *
 * Precedence: leave beats holiday beats rest day beats an ordinary work day.
 * Leave wins because an employee who filed leave over a holiday should not
 * silently burn the leave credit... but the credit is already consumed at
 * approval time, so the DTR simply reflects it.
 */
const resolveDay = ({ isoDate, scheduleDay, holiday, leave }) => {
    const base = {
        work_date: isoDate,
        holiday_id: holiday ? holiday.holiday_id : null,
        leave_id: null,
        is_rest_day: Boolean(scheduleDay?.is_rest_day),
        scheduled_time_in: scheduleDay?.time_in || null,
        scheduled_time_out: scheduleDay?.time_out || null,
        time_in: null,
        time_out: null,
        break_minutes: scheduleDay?.break_minutes ?? 60,
        hours_worked: 0,
        source: 'Auto Schedule',
        remarks: null,
    };

    if (leave) {
        return {
            ...base,
            day_type: 'On Leave',
            // Unpaid leave still marks the day as leave, but pays nothing.
            day_fraction: leave.is_paid ? Number(leave.day_fraction) : 0,
            leave_id: leave.leave_id,
            remarks: leave.leave_name,
        };
    }

    if (holiday) {
        // Holiday premiums are a payroll concern; the DTR only records that the
        // day was a holiday and was not worked.
        return {
            ...base,
            day_type: 'Holiday',
            day_fraction: 0,
            remarks: holiday.holiday_name,
        };
    }

    if (!scheduleDay || scheduleDay.is_rest_day) {
        return { ...base, day_type: 'Rest Day', day_fraction: 0, is_rest_day: true };
    }

    // The ordinary case: present for the full scheduled shift. Punch columns are
    // filled from the schedule so a future time-capture integration replaces
    // values rather than adding columns.
    return {
        ...base,
        day_type: 'Present',
        day_fraction: 1,
        time_in: scheduleDay.time_in,
        time_out: scheduleDay.time_out,
        hours_worked: hoursBetween(scheduleDay.time_in, scheduleDay.time_out, scheduleDay.break_minutes),
    };
};

/**
 * Creates missing DTR rows for a set of employees over a date range.
 *
 * Existing rows are never overwritten: ON CONFLICT DO NOTHING means a manual
 * correction or a payroll-locked day survives a re-run untouched. Re-running
 * generation is therefore always safe.
 *
 * @returns {Promise<{created: number, skipped: number, employees: number, days: number}>}
 */
const generateForPeriod = async (executor, { employeeIds, periodStart, periodEnd, createdBy }) => {
    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
        return { created: 0, skipped: 0, employees: 0, days: 0 };
    }

    const dates = eachDate(periodStart, periodEnd);
    const [schedules, holidays, leaves] = await Promise.all([
        loadSchedules(executor, employeeIds),
        loadHolidays(executor, periodStart, periodEnd),
        loadApprovedLeave(executor, employeeIds, periodStart, periodEnd),
    ]);

    const candidates = [];
    for (const employeeId of employeeIds) {
        const schedule = schedules.get(employeeId);
        // No schedule attached means we cannot say what the employee owed; skip
        // rather than invent a default that payroll would later pay against.
        if (!schedule) continue;
        for (const isoDate of dates) {
            candidates.push({
                employee_id: employeeId,
                ...resolveDay({
                    isoDate,
                    scheduleDay: schedule.get(dayOfWeek(isoDate)),
                    holiday: holidays.get(isoDate),
                    leave: leaves.get(employeeId)?.get(isoDate),
                }),
            });
        }
    }

    if (candidates.length === 0) {
        return { created: 0, skipped: 0, employees: 0, days: dates.length };
    }

    // One multi-row INSERT rather than a query per day: a 30-employee fortnight
    // is 450 rows, which must not become 450 round trips.
    const columns = [
        'employee_id', 'work_date', 'day_type', 'day_fraction', 'is_rest_day',
        'holiday_id', 'leave_id', 'scheduled_time_in', 'scheduled_time_out',
        'time_in', 'time_out', 'break_minutes', 'hours_worked', 'source', 'remarks',
    ];
    const params = [];
    const tuples = candidates.map((row, i) => {
        const offset = i * (columns.length + 1);
        params.push(...columns.map((c) => row[c]), createdBy);
        return `(${columns.map((_, j) => `$${offset + j + 1}`).join(', ')}, $${offset + columns.length + 1})`;
    });

    const { rows: inserted } = await executor.query(
        `INSERT INTO daily_time_record (${columns.join(', ')}, created_by)
         VALUES ${tuples.join(', ')}
         ON CONFLICT (employee_id, work_date) DO NOTHING
         RETURNING dtr_id`,
        params
    );

    return {
        created: inserted.length,
        skipped: candidates.length - inserted.length,
        employees: new Set(candidates.map((c) => c.employee_id)).size,
        days: dates.length,
    };
};

/** Fields a caller may correct on an existing DTR row. */
const EDITABLE_FIELDS = [
    'day_type', 'day_fraction', 'time_in', 'time_out', 'break_minutes',
    'hours_worked', 'overtime_hours', 'night_diff_hours',
    'late_minutes', 'undertime_minutes', 'remarks',
];

/**
 * Applies a manual correction, writing one dtr_change_log row per changed field.
 * Marks the row as 'Manual' so a later generation run leaves it alone.
 *
 * Throws with `code = 'DTR_LOCKED'` if payroll has already consumed the day.
 */
const updateEntry = async (executor, { dtrId, changes, modifiedBy, reason }) => {
    const { rows: existingRows } = await executor.query(
        'SELECT * FROM daily_time_record WHERE dtr_id = $1', [dtrId]
    );
    const existing = existingRows[0];
    if (!existing) {
        const err = new Error('Daily time record not found');
        err.code = 'DTR_NOT_FOUND';
        throw err;
    }
    if (existing.locked_by_run_id !== null) {
        const err = new Error('This day is locked by a payroll run and cannot be edited.');
        err.code = 'DTR_LOCKED';
        throw err;
    }

    const applied = {};
    for (const field of EDITABLE_FIELDS) {
        if (changes[field] === undefined) continue;
        applied[field] = changes[field] === '' ? null : changes[field];
    }

    // Changing the day type without an explicit fraction should move the
    // fraction with it, otherwise an "Absent" day would keep paying 1.0.
    if (applied.day_type !== undefined && applied.day_fraction === undefined) {
        applied.day_fraction = dayFractionFor(applied.day_type);
    }

    if (Object.keys(applied).length === 0) {
        const err = new Error('No updatable fields were provided');
        err.code = 'DTR_NO_CHANGES';
        throw err;
    }

    const names = Object.keys(applied);
    const assignments = names.map((n, i) => `${n} = $${i + 1}`);
    const params = names.map((n) => applied[n]);
    params.push(modifiedBy, dtrId);

    const { rows } = await executor.query(
        `UPDATE daily_time_record
         SET ${assignments.join(', ')}, source = 'Manual',
             modified_by = $${params.length - 1}, updated_at = now()
         WHERE dtr_id = $${params.length}
         RETURNING *`,
        params
    );

    for (const field of names) {
        const before = existing[field];
        const after = applied[field];
        if (String(before ?? '') === String(after ?? '')) continue;
        await executor.query(
            `INSERT INTO dtr_change_log
                (dtr_id, employee_id, work_date, field_name, old_value, new_value, reason, changed_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [dtrId, existing.employee_id, existing.work_date, field,
                before === null ? null : String(before),
                after === null ? null : String(after),
                reason || null, modifiedBy]
        );
    }

    return rows[0];
};

/**
 * Aggregates a period into the shape the payroll engine needs, for many
 * employees in a single query. Deliberately one grouped aggregate rather than a
 * per-employee loop — this is payroll's hot path.
 *
 * @returns {Promise<Map<number, object>>} employeeId -> totals
 */
const summarizePeriodBulk = async (executor, { employeeIds, periodStart, periodEnd }) => {
    const { rows } = await executor.query(
        `SELECT employee_id,
                COALESCE(SUM(day_fraction), 0)::numeric(8,3)                      AS days_paid,
                COUNT(*) FILTER (WHERE day_type IN ('Present','Half Day'))::int   AS days_worked,
                COUNT(*) FILTER (WHERE day_type = 'Absent')::int                  AS days_absent,
                COUNT(*) FILTER (WHERE day_type = 'On Leave')::int                AS days_on_leave,
                COUNT(*) FILTER (WHERE day_type = 'Holiday')::int                 AS days_holiday,
                COUNT(*) FILTER (WHERE day_type = 'Holiday Worked')::int          AS days_holiday_worked,
                COUNT(*) FILTER (WHERE day_type = 'Rest Day Worked')::int         AS days_rest_day_worked,
                COALESCE(SUM(hours_worked), 0)::numeric(8,2)                      AS hours_worked,
                COALESCE(SUM(overtime_hours), 0)::numeric(8,2)                    AS overtime_hours,
                COALESCE(SUM(night_diff_hours), 0)::numeric(8,2)                  AS night_diff_hours,
                COALESCE(SUM(late_minutes), 0)::int                               AS late_minutes,
                COALESCE(SUM(undertime_minutes), 0)::int                          AS undertime_minutes
         FROM daily_time_record
         WHERE employee_id = ANY($1::int[]) AND work_date BETWEEN $2 AND $3
         GROUP BY employee_id`,
        [employeeIds, periodStart, periodEnd]
    );
    return new Map(rows.map((r) => [r.employee_id, r]));
};

const summarizePeriod = async (executor, { employeeId, periodStart, periodEnd }) => {
    const map = await summarizePeriodBulk(executor, { employeeIds: [employeeId], periodStart, periodEnd });
    return map.get(employeeId) || null;
};

/**
 * Stamps approved leave onto the DTR. Called when a leave request is approved.
 * Existing unlocked rows are updated in place; missing days are inserted.
 * Payroll-locked days are left alone and reported back so the caller can warn.
 *
 * @returns {Promise<{applied: number, locked: string[]}>}
 */
const applyLeaveToDtr = async (executor, { leaveRequest, actorId }) => {
    const dates = eachDate(leaveRequest.date_from, leaveRequest.date_to);
    const fraction = leaveRequest.is_paid ? Number(leaveRequest.day_fraction) : 0;

    const { rows: lockedRows } = await executor.query(
        `SELECT TO_CHAR(work_date, 'YYYY-MM-DD') AS work_date
         FROM daily_time_record
         WHERE employee_id = $1 AND work_date = ANY($2::date[]) AND locked_by_run_id IS NOT NULL`,
        [leaveRequest.employee_id, dates]
    );
    const locked = new Set(lockedRows.map((r) => r.work_date));
    const writable = dates.filter((d) => !locked.has(d));
    if (writable.length === 0) return { applied: 0, locked: [...locked] };

    // Rest days and holidays inside a leave span are not converted: an employee
    // does not spend leave on a day they were never scheduled to work.
    const { rowCount } = await executor.query(
        `INSERT INTO daily_time_record
            (employee_id, work_date, day_type, day_fraction, leave_id, remarks, source, created_by)
         SELECT $1, d::date, 'On Leave', $3, $4, $5, 'Manual', $6
         FROM UNNEST($2::date[]) AS d
         ON CONFLICT (employee_id, work_date) DO UPDATE
         SET day_type = 'On Leave',
             day_fraction = EXCLUDED.day_fraction,
             leave_id = EXCLUDED.leave_id,
             remarks = EXCLUDED.remarks,
             source = 'Manual',
             modified_by = EXCLUDED.created_by,
             updated_at = now()
         WHERE daily_time_record.day_type NOT IN ('Rest Day', 'Holiday')`,
        [leaveRequest.employee_id, writable, fraction, leaveRequest.leave_id,
            leaveRequest.leave_name || 'Approved leave', actorId]
    );

    return { applied: rowCount, locked: [...locked] };
};

/**
 * Reverts DTR days back to their scheduled state when leave is cancelled after
 * approval. Days payroll has locked are left alone.
 */
const removeLeaveFromDtr = async (executor, { leaveId }) => {
    const { rowCount } = await executor.query(
        `UPDATE daily_time_record
         SET day_type = CASE WHEN is_rest_day THEN 'Rest Day' ELSE 'Present' END,
             day_fraction = CASE WHEN is_rest_day THEN 0 ELSE 1 END,
             leave_id = NULL,
             remarks = NULL,
             updated_at = now()
         WHERE leave_id = $1 AND locked_by_run_id IS NULL`,
        [leaveId]
    );
    return { reverted: rowCount };
};

/**
 * Counts the working days a leave span actually consumes, skipping rest days
 * and holidays. Used at request time so the balance reflects real days off.
 */
const countLeaveWorkingDays = async (executor, { employeeId, dateFrom, dateTo, dayFraction = 1 }) => {
    const dates = eachDate(dateFrom, dateTo);
    const [schedules, holidays] = await Promise.all([
        loadSchedules(executor, [employeeId]),
        loadHolidays(executor, dateFrom, dateTo),
    ]);
    const schedule = schedules.get(employeeId);
    if (!schedule) return 0;

    let days = 0;
    for (const isoDate of dates) {
        if (holidays.has(isoDate)) continue;
        const scheduleDay = schedule.get(dayOfWeek(isoDate));
        if (!scheduleDay || scheduleDay.is_rest_day) continue;
        days += Number(dayFraction);
    }
    return Math.round(days * 100) / 100;
};

module.exports = {
    generateForPeriod,
    updateEntry,
    summarizePeriod,
    summarizePeriodBulk,
    applyLeaveToDtr,
    removeLeaveFromDtr,
    countLeaveWorkingDays,
    // Exported for unit tests and reuse by the payroll engine.
    _internal: { eachDate, dayOfWeek, hoursBetween, resolveDay, dayFractionFor },
};
