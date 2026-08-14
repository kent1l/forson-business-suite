'use strict';

/**
 * Time capture: raw punches in, derived DTR days out.
 *
 * The raw taps are kept in `time_punch` and the DTR row is DERIVED from them.
 * A terminal produces several taps a day (in, lunch out, lunch in, out) and
 * duplicates are routine, so treating the first tap as "the" time-in and the
 * last as "the" time-out — while keeping every tap — means a disputed day can
 * be re-derived rather than argued about.
 *
 * Derived days are written with source 'Device' (or 'Web'/'Mobile'), which
 * leaves HR's manual corrections alone: dtrService only overwrites rows it
 * generated itself.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const toTime = (timestamp) => new Date(timestamp).toISOString().slice(11, 19);

const hoursBetween = (startIso, endIso, breakMinutes = 0) => {
    const ms = new Date(endIso) - new Date(startIso);
    if (!Number.isFinite(ms) || ms <= 0) return 0;
    const net = (ms / 60000) - breakMinutes;
    return net > 0 ? round2(net / 60) : 0;
};

const PUNCH_RETURNING = `punch_id, TO_CHAR(punch_date, 'YYYY-MM-DD') AS punch_date,
                         punch_at, direction, source, client_punch_id, notes`;

/**
 * Records one punch. The unique constraints make a repeated tap a no-op.
 *
 * `ON CONFLICT DO NOTHING` is deliberately untargeted: two different keys can
 * catch a duplicate. The original (employee_id, punch_at, direction) dedupe
 * catches a re-uploaded CSV, while client_punch_id catches a mobile client
 * flushing the same queued punch twice — which is the only one that survives
 * clock skew, since a retry from a phone need not reproduce the same punch_at.
 */
const recordPunch = async (executor, {
    employeeId, punchAt, direction, source = 'Web', deviceId, ipAddress,
    latitude, longitude, actorId, clientPunchId, notes,
}) => {
    const at = punchAt ? new Date(punchAt) : new Date();
    const { rows } = await executor.query(
        `INSERT INTO time_punch
            (employee_id, punch_at, punch_date, direction, source, device_id,
             ip_address, latitude, longitude, created_by, client_punch_id, notes)
         VALUES ($1, $2, ($2::timestamptz AT TIME ZONE 'Asia/Manila')::date,
                 $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT DO NOTHING
         RETURNING ${PUNCH_RETURNING}`,
        [employeeId, at.toISOString(), direction, source, deviceId || null,
            ipAddress || null, latitude || null, longitude || null, actorId || employeeId,
            clientPunchId || null, notes || null]
    );
    return rows[0] || null;
};

/**
 * The punch a given client id already produced, if any.
 *
 * Lets an offline flush retry resolve to the row it created the first time
 * rather than to a bare conflict, so the app can show the employee the punch
 * that actually landed instead of an error.
 */
const findPunchByClientId = async (executor, { employeeId, clientPunchId }) => {
    const { rows } = await executor.query(
        `SELECT ${PUNCH_RETURNING} FROM time_punch
         WHERE client_punch_id = $1 AND employee_id = $2`,
        [clientPunchId, employeeId]
    );
    return rows[0] || null;
};

/** The most recent punch today, so the UI knows whether to offer IN or OUT. */
const getPunchState = async (executor, { employeeId }) => {
    const { rows } = await executor.query(
        `SELECT direction, punch_at
         FROM time_punch
         WHERE employee_id = $1
           AND punch_date = (now() AT TIME ZONE 'Asia/Manila')::date
         ORDER BY punch_at DESC
         LIMIT 1`,
        [employeeId]
    );
    const last = rows[0];
    return {
        last_direction: last ? last.direction : null,
        last_punch_at: last ? last.punch_at : null,
        // Nothing yet today, or the last tap was an OUT: the next one is an IN.
        next_direction: !last || last.direction === 'OUT' ? 'IN' : 'OUT',
    };
};

/**
 * Derives DTR rows from the punches in a date range.
 *
 * A day with punches becomes Present (or Half Day below the configured
 * threshold); the derived hours come from first-IN to last-OUT less the
 * scheduled break. Days already locked by payroll, or corrected by hand, are
 * left untouched.
 *
 * @returns {Promise<{updated: number, skippedManual: number, skippedLocked: number, incomplete: string[]}>}
 */
const deriveDtrFromPunches = async (executor, { employeeIds, dateFrom, dateTo, actorId }) => {
    const { rows: punches } = await executor.query(
        `SELECT employee_id, TO_CHAR(punch_date, 'YYYY-MM-DD') AS punch_date,
                direction, punch_at, source
         FROM time_punch
         WHERE employee_id = ANY($1::int[]) AND punch_date BETWEEN $2 AND $3
         ORDER BY employee_id, punch_at`,
        [employeeIds, dateFrom, dateTo]
    );

    const { rows: settingRows } = await executor.query(
        `SELECT setting_key, setting_value FROM settings
         WHERE setting_key IN ('DTR_PUNCH_MIN_HALF_DAY_HOURS', 'DTR_PUNCH_GRACE_MINUTES')`
    );
    const settings = Object.fromEntries(settingRows.map((r) => [r.setting_key, Number(r.setting_value)]));
    const halfDayBelow = settings.DTR_PUNCH_MIN_HALF_DAY_HOURS || 4;
    const graceMinutes = settings.DTR_PUNCH_GRACE_MINUTES || 15;

    // Group into employee+date buckets.
    const buckets = new Map();
    for (const p of punches) {
        const key = `${p.employee_id}|${p.punch_date}`;
        if (!buckets.has(key)) buckets.set(key, { employee_id: p.employee_id, date: p.punch_date, ins: [], outs: [], source: p.source });
        buckets.get(key)[p.direction === 'IN' ? 'ins' : 'outs'].push(p.punch_at);
    }

    let updated = 0;
    let skippedManual = 0;
    let skippedLocked = 0;
    const incomplete = [];

    for (const bucket of buckets.values()) {
        const firstIn = bucket.ins[0];
        const lastOut = bucket.outs[bucket.outs.length - 1];

        // A day with an IN but no OUT cannot be scored. Reporting it is far more
        // useful than guessing a time-out.
        if (!firstIn || !lastOut) {
            incomplete.push(`${bucket.date} (employee ${bucket.employee_id}): ${firstIn ? 'no time-out' : 'no time-in'}`);
            continue;
        }

        const { rows: existingRows } = await executor.query(
            `SELECT dtr_id, source, locked_by_run_id, break_minutes, scheduled_time_in
             FROM daily_time_record WHERE employee_id = $1 AND work_date = $2`,
            [bucket.employee_id, bucket.date]
        );
        const existing = existingRows[0];

        if (existing?.locked_by_run_id) { skippedLocked += 1; continue; }
        // A human correction outranks a machine reading.
        if (existing?.source === 'Manual') { skippedManual += 1; continue; }

        const breakMinutes = existing?.break_minutes ?? 60;
        const hours = hoursBetween(firstIn, lastOut, breakMinutes);
        const dayType = hours > 0 && hours < halfDayBelow ? 'Half Day' : 'Present';
        const dayFraction = dayType === 'Half Day' ? 0.5 : 1;

        let lateMinutes = 0;
        if (existing?.scheduled_time_in) {
            const scheduled = new Date(`${bucket.date}T${existing.scheduled_time_in}Z`);
            const actual = new Date(`${bucket.date}T${toTime(firstIn)}Z`);
            const diff = Math.round((actual - scheduled) / 60000) - graceMinutes;
            if (diff > 0) lateMinutes = diff;
        }

        await executor.query(
            `INSERT INTO daily_time_record
                (employee_id, work_date, day_type, day_fraction, time_in, time_out,
                 break_minutes, hours_worked, late_minutes, source, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT (employee_id, work_date) DO UPDATE
             SET day_type = EXCLUDED.day_type,
                 day_fraction = EXCLUDED.day_fraction,
                 time_in = EXCLUDED.time_in,
                 time_out = EXCLUDED.time_out,
                 hours_worked = EXCLUDED.hours_worked,
                 late_minutes = EXCLUDED.late_minutes,
                 source = EXCLUDED.source,
                 modified_by = EXCLUDED.created_by,
                 updated_at = now()`,
            [bucket.employee_id, bucket.date, dayType, dayFraction,
                toTime(firstIn), toTime(lastOut), breakMinutes, hours, lateMinutes,
                bucket.source === 'Import' ? 'Import' : bucket.source, actorId]
        );
        updated += 1;
    }

    return { updated, skippedManual, skippedLocked, incomplete };
};

/**
 * Parses a biometric export.
 *
 * Expected columns: biometric_id, timestamp, direction. Terminals vary wildly,
 * so unmatched or malformed rows are reported rather than dropped silently —
 * a missing employee in a payroll import is exactly the thing that must not
 * pass unnoticed.
 */
const parsePunchCsv = (csvText) => {
    const lines = String(csvText).split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) return { rows: [], errors: ['The file is empty.'] };

    const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const idx = {
        biometric: header.findIndex((h) => ['biometric_id', 'device_id', 'user_id', 'id', 'employee_no'].includes(h)),
        timestamp: header.findIndex((h) => ['timestamp', 'datetime', 'punch_at', 'date_time', 'time'].includes(h)),
        direction: header.findIndex((h) => ['direction', 'status', 'type', 'in_out'].includes(h)),
    };

    if (idx.biometric === -1 || idx.timestamp === -1) {
        return {
            rows: [],
            errors: ['The file needs at least a biometric id column and a timestamp column. '
                + `Found: ${header.join(', ')}`],
        };
    }

    const rows = [];
    const errors = [];
    for (let i = 1; i < lines.length; i += 1) {
        const cells = lines[i].split(',').map((c) => c.trim());
        const biometricId = cells[idx.biometric];
        const rawTs = cells[idx.timestamp];
        if (!biometricId || !rawTs) { errors.push(`Row ${i + 1}: missing id or timestamp.`); continue; }

        const parsed = new Date(rawTs.replace(' ', 'T'));
        if (Number.isNaN(parsed.getTime())) { errors.push(`Row ${i + 1}: unreadable timestamp "${rawTs}".`); continue; }

        const rawDir = idx.direction === -1 ? '' : String(cells[idx.direction] || '').toUpperCase();
        // Terminals encode direction as I/O, IN/OUT, 0/1 or check-in/check-out.
        const direction = /^(I|IN|0|CHECK.?IN)$/.test(rawDir) ? 'IN'
            : /^(O|OUT|1|CHECK.?OUT)$/.test(rawDir) ? 'OUT'
                : null;

        rows.push({ biometricId, punchAt: parsed.toISOString(), direction, rowNumber: i + 1 });
    }

    return { rows, errors };
};

/**
 * Imports parsed punch rows, mapping biometric ids to employees.
 *
 * Rows whose direction the terminal did not record are inferred by alternating
 * within the day, which is how these devices are normally read.
 */
const importPunches = async (executor, { parsedRows, actorId }) => {
    const biometricIds = [...new Set(parsedRows.map((r) => r.biometricId))];
    const { rows: employees } = await executor.query(
        'SELECT employee_id, biometric_id FROM employee WHERE biometric_id = ANY($1::text[])',
        [biometricIds]
    );
    const byBiometric = new Map(employees.map((e) => [e.biometric_id, e.employee_id]));

    const unmatched = biometricIds.filter((b) => !byBiometric.has(b));
    const seenPerDay = new Map();
    let imported = 0;
    let duplicates = 0;

    for (const row of parsedRows.sort((a, b) => a.punchAt.localeCompare(b.punchAt))) {
        const employeeId = byBiometric.get(row.biometricId);
        if (!employeeId) continue;

        let direction = row.direction;
        if (!direction) {
            const dayKey = `${employeeId}|${row.punchAt.slice(0, 10)}`;
            const count = seenPerDay.get(dayKey) || 0;
            direction = count % 2 === 0 ? 'IN' : 'OUT';
            seenPerDay.set(dayKey, count + 1);
        }

        const result = await recordPunch(executor, {
            employeeId, punchAt: row.punchAt, direction, source: 'Import',
            deviceId: row.biometricId, actorId,
        });
        if (result) imported += 1; else duplicates += 1;
    }

    return {
        imported,
        duplicates,
        unmatched_biometric_ids: unmatched,
        matched_employees: byBiometric.size,
    };
};

module.exports = {
    recordPunch,
    findPunchByClientId,
    getPunchState,
    deriveDtrFromPunches,
    parsePunchCsv,
    importPunches,
    _internal: { hoursBetween, toTime },
};
