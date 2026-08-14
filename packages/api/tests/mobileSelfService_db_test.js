/**
 * Real-database checks for offline punch handling.
 *
 * The mocked route tests prove the handler's logic; they cannot prove that the
 * unique index actually stops a duplicate. Since the whole point of
 * client_punch_id is that a phone can retry a flush forever and still produce
 * exactly one row, that guarantee has to be checked against real Postgres.
 *
 * Excluded from the default jest run by testPathIgnorePatterns. Run with:
 *   docker compose -f docker-compose.dev.yml exec -T backend \
 *     node tests/mobileSelfService_db_test.js
 *
 * Everything happens inside a transaction that is always rolled back.
 */

const db = require('/usr/src/app/db');
const timePunchService = require('/usr/src/app/services/hr/timePunchService');

let passed = 0;
let failed = 0;

const check = (label, condition) => {
    if (condition) { passed += 1; console.log(`PASS  ${label}`); }
    else { failed += 1; console.error(`FAIL  ${label}`); }
};

const run = async () => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // A throwaway employee, so nothing here depends on seeded data.
        const { rows: [emp] } = await client.query(
            `INSERT INTO employee (first_name, last_name, is_active)
             VALUES ('Offline', 'PunchTest', TRUE) RETURNING employee_id`
        );
        const employeeId = emp.employee_id;
        const clientPunchId = '11111111-2222-3333-4444-555555555555';
        const capturedAt = new Date('2026-08-14T01:30:00Z').toISOString();

        // --- The core guarantee: a retried flush lands exactly one row -------
        const first = await timePunchService.recordPunch(client, {
            employeeId, punchAt: capturedAt, direction: 'IN',
            source: 'Mobile-Offline', clientPunchId, actorId: employeeId,
        });
        check('an offline punch is recorded', !!first);
        check('the stored source marks it as offline-captured', first.source === 'Mobile-Offline');

        // Same client id, but a DIFFERENT timestamp — which is exactly what a
        // retry looks like if the phone's clock moved. The old dedupe key would
        // have let this through as a second punch.
        const retry = await timePunchService.recordPunch(client, {
            employeeId, punchAt: new Date('2026-08-14T01:30:07Z').toISOString(),
            direction: 'IN', source: 'Mobile-Offline', clientPunchId, actorId: employeeId,
        });
        check('a retry with the same client id inserts nothing', retry === null);

        const { rows: countRows } = await client.query(
            'SELECT COUNT(*)::int AS n FROM time_punch WHERE client_punch_id = $1', [clientPunchId]
        );
        check('exactly one row exists for that client id', countRows[0].n === 1);

        // --- And the retry can be reconciled back to the original -----------
        const found = await timePunchService.findPunchByClientId(client, { employeeId, clientPunchId });
        check('the original punch is retrievable by client id', found && found.punch_id === first.punch_id);

        check('another employee cannot resolve that client id',
            (await timePunchService.findPunchByClientId(client, { employeeId: employeeId + 99999, clientPunchId })) === null);

        // --- punch_date is derived in Manila time, not UTC -------------------
        // 01:30Z is 09:30 the same day in Manila. A UTC-derived date would put
        // an early-morning punch on the wrong payroll day.
        check('punch_date is derived in Asia/Manila', first.punch_date === '2026-08-14');

        // --- The legacy dedupe still works for imports with no client id ----
        const importAt = new Date('2026-08-14T02:00:00Z').toISOString();
        const imp1 = await timePunchService.recordPunch(client, {
            employeeId, punchAt: importAt, direction: 'OUT', source: 'Import', actorId: employeeId,
        });
        const imp2 = await timePunchService.recordPunch(client, {
            employeeId, punchAt: importAt, direction: 'OUT', source: 'Import', actorId: employeeId,
        });
        check('a re-imported identical tap is still deduped', !!imp1 && imp2 === null);

        // --- 'Mobile-Offline' is a permitted source -------------------------
        let sourceAccepted = true;
        try {
            await client.query(
                `INSERT INTO time_punch (employee_id, punch_at, punch_date, direction, source)
                 VALUES ($1, now(), current_date, 'IN', 'Mobile-Offline')`, [employeeId]
            );
        } catch { sourceAccepted = false; }
        check("the source CHECK admits 'Mobile-Offline'", sourceAccepted);


        // --- An offline punch must survive DTR derivation ------------------
        // daily_time_record.source has its own CHECK constraint and does NOT
        // admit 'Mobile-Offline'. Writing the punch source straight through
        // aborted the whole derivation batch, which would have made the
        // offline-punch feature break HR's DTR run for the entire company.
        const workDate = '2026-08-13';
        await client.query(
            `INSERT INTO time_punch (employee_id, punch_at, punch_date, direction, source, client_punch_id)
             VALUES ($1, $2::timestamptz, $3::date, 'IN',  'Mobile-Offline', gen_random_uuid()),
                    ($1, $4::timestamptz, $3::date, 'OUT', 'Mobile-Offline', gen_random_uuid())`,
            [employeeId, `${workDate}T00:00:00Z`, workDate, `${workDate}T09:00:00Z`]
        );

        let derived = null;
        let deriveError = null;
        try {
            derived = await timePunchService.deriveDtrFromPunches(client, {
                employeeIds: [employeeId], dateFrom: workDate, dateTo: workDate, actorId: employeeId,
            });
        } catch (err) {
            deriveError = err;
        }
        check('deriving from an offline punch does not throw', deriveError === null);
        check('the offline day is actually derived', derived && derived.updated === 1);

        const { rows: dtrRows } = await client.query(
            `SELECT source, hours_worked FROM daily_time_record
             WHERE employee_id = $1 AND work_date = $2::date`,
            [employeeId, workDate]
        );
        check('a derived day exists', dtrRows.length === 1);
        check('it is stored with a source daily_time_record accepts',
            dtrRows.length === 1 && dtrRows[0].source === 'Mobile');
        check('the hours are computed from the punches',
            dtrRows.length === 1 && Number(dtrRows[0].hours_worked) === 8);

        await client.query('ROLLBACK');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('ERROR', err);
        failed += 1;
    } finally {
        client.release();
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
};

run();
