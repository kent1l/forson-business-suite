// Integration tests for the AR payment date-change path (customer_payment and
// invoice_payment kinds) of transactionDateService.js. Runs against a real
// database — see tests/paperlessUniquenessIntegration.test.js for the same
// pattern (fixtures created in beforeAll, cleaned up in afterAll). This is
// intentionally NOT a db.query-mocking unit test: every bug found on this
// feature so far (a timezone mismatch, a Postgres function-overload
// ambiguity, a stock-negativity false positive, a time-of-day-destroying
// date assignment) was a real-data/real-SQL bug that a mocked-query test
// would not have caught.

const db = require('../db');
const svc = require('../services/transactionDateService');

// ar_ledger is a permanent, append-only audit trail: its immutability
// trigger blocks DELETE unconditionally (by design — see
// 20260816_01_add_entry_date_to_ledgers.sql), and customer/invoice/payment
// rows it references can therefore never be deleted afterwards either (FK
// RESTRICT). A fresh, uniquely-suffixed fixture per test run would leak one
// permanently-orphaned customer/employee/invoice every time this file runs.
// So this suite uses a FIXED, well-known fixture identity and finds-or-creates
// it — re-running the suite reuses the same handful of rows forever instead
// of accumulating new ones.
const FIXTURE_USERNAME = 'test_txndate_fixture';
const FIXTURE_CUSTOMER_EMAIL = 'txndate.fixture@test.local';
const FIXTURE_INVOICE_NUMBER = 'INV-TXNDATE-FIXTURE';

describe('transactionDateService — AR payment date changes', () => {
    let testCustomerId;
    let testEmployeeId;
    let testInvoiceId;
    let customerPaymentId;
    let invoicePaymentId;

    beforeAll(async () => {
        const plRes = await db.query(`SELECT permission_level_id FROM permission_level LIMIT 1`);
        const permLevelId = plRes.rows[0].permission_level_id;

        let empRes = await db.query(`SELECT employee_id FROM employee WHERE username = $1`, [FIXTURE_USERNAME]);
        if (empRes.rows.length === 0) {
            empRes = await db.query(`
                INSERT INTO employee (first_name, last_name, permission_level_id, username, password_hash, password_salt)
                VALUES ('Test', 'TxnDate', $1, $2, 'hash', 'salt')
                RETURNING employee_id
            `, [permLevelId, FIXTURE_USERNAME]);
        }
        testEmployeeId = empRes.rows[0].employee_id;

        let custRes = await db.query(`SELECT customer_id FROM customer WHERE email = $1`, [FIXTURE_CUSTOMER_EMAIL]);
        if (custRes.rows.length === 0) {
            custRes = await db.query(`
                INSERT INTO customer (company_name, first_name, last_name, email, phone, credit_limit)
                VALUES ('Txn Date Test Corp (fixture)', 'Pat', 'Doe', $1, '09170003333', 50000.00)
                RETURNING customer_id
            `, [FIXTURE_CUSTOMER_EMAIL]);
        }
        testCustomerId = custRes.rows[0].customer_id;

        // Invoice dated a few days before "today" so payments can legally predate/postdate it in tests.
        let invRes = await db.query(`SELECT invoice_id FROM invoice WHERE invoice_number = $1`, [FIXTURE_INVOICE_NUMBER]);
        if (invRes.rows.length === 0) {
            invRes = await db.query(`
                INSERT INTO invoice (invoice_number, customer_id, employee_id, total_amount, subtotal_ex_tax, tax_total, amount_paid, status, invoice_date)
                VALUES ($1, $2, $3, 1000.00, 1000.00, 0, 0, 'Partially Paid', now() - interval '10 days')
                RETURNING invoice_id
            `, [FIXTURE_INVOICE_NUMBER, testCustomerId, testEmployeeId]);
        }
        testInvoiceId = invRes.rows[0].invoice_id;

        // A customer_payment (legacy/on-account AR receipt). Reused across
        // runs like everything else above; its date gets moved by the tests
        // themselves, which is fine since they only assert relative to
        // whatever "before" they captured at the start of that run.
        let cpRes = await db.query(
            `SELECT payment_id FROM customer_payment WHERE customer_id = $1 AND employee_id = $2 AND amount = 400.00`,
            [testCustomerId, testEmployeeId]
        );
        if (cpRes.rows.length === 0) {
            cpRes = await db.query(`
                INSERT INTO customer_payment (customer_id, employee_id, amount, method_id, payment_date)
                VALUES ($1, $2, 400.00, 1, now() - interval '2 days')
                RETURNING payment_id
            `, [testCustomerId, testEmployeeId]);
            customerPaymentId = cpRes.rows[0].payment_id;

            await db.query(`
                INSERT INTO invoice_payment_allocation (invoice_id, payment_id, amount_allocated)
                VALUES ($1, $2, 400.00)
            `, [testInvoiceId, customerPaymentId]);

            await db.query(
                `SELECT append_ar_ledger_entry($1, NULL, $2, NULL, 'PAYMENT_SETTLED'::ar_ledger_entry_type, -400.00, 'cash', NULL, 'test fixture', $3, 'customer_payment')`,
                [testCustomerId, customerPaymentId, testEmployeeId]
            );
        } else {
            customerPaymentId = cpRes.rows[0].payment_id;
            const arCp = await db.query(
                `SELECT ledger_id FROM ar_ledger WHERE payment_id = $1 AND payment_source = 'customer_payment'`,
                [customerPaymentId]
            );
            if (arCp.rows.length === 0) {
                await db.query(
                    `SELECT append_ar_ledger_entry($1, NULL, $2, NULL, 'PAYMENT_SETTLED'::ar_ledger_entry_type, -400.00, 'cash', NULL, 'test fixture', $3, 'customer_payment')`,
                    [testCustomerId, customerPaymentId, testEmployeeId]
                );
            }
        }

        // A settled invoice_payments (POS split payment) row.
        let ipRes = await db.query(
            `SELECT payment_id FROM invoice_payments WHERE invoice_id = $1 AND amount_paid = 300.00 AND payment_status = 'settled'`,
            [testInvoiceId]
        );
        if (ipRes.rows.length === 0) {
            ipRes = await db.query(`
                INSERT INTO invoice_payments (invoice_id, method_id, amount_paid, payment_status, created_by, settled_at, created_at)
                VALUES ($1, 1, 300.00, 'settled', $2, now() - interval '1 day', now() - interval '1 day')
                RETURNING payment_id
            `, [testInvoiceId, testEmployeeId]);
            invoicePaymentId = ipRes.rows[0].payment_id;

            await db.query(
                `SELECT append_ar_ledger_entry($1, $2, $3, NULL, 'PAYMENT_SETTLED'::ar_ledger_entry_type, -300.00, 'cash', NULL, 'test fixture', $4, 'invoice_payments')`,
                [testCustomerId, testInvoiceId, invoicePaymentId, testEmployeeId]
            );
        } else {
            invoicePaymentId = ipRes.rows[0].payment_id;
            const arIp = await db.query(
                `SELECT ledger_id FROM ar_ledger WHERE payment_id = $1 AND payment_source = 'invoice_payments'`,
                [invoicePaymentId]
            );
            if (arIp.rows.length === 0) {
                await db.query(
                    `SELECT append_ar_ledger_entry($1, $2, $3, NULL, 'PAYMENT_SETTLED'::ar_ledger_entry_type, -300.00, 'cash', NULL, 'test fixture', $4, 'invoice_payments')`,
                    [testCustomerId, testInvoiceId, invoicePaymentId, testEmployeeId]
                );
            }
        }
    });

    afterAll(async () => {
        // customer/employee/invoice/customer_payment/invoice_payments/ar_ledger
        // are all permanent by design once ar_ledger references them (see the
        // comment above) — nothing to delete there. Only the audit log this
        // suite itself writes on every run is worth bounding, so it doesn't
        // grow forever across repeated test runs.
        await db.query(
            `DELETE FROM transaction_date_change_log WHERE transaction_id IN ($1, $2)`,
            [customerPaymentId, invoicePaymentId]
        ).catch(() => {});
    });

    async function withClient(fn) {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            const result = await fn(client);
            await client.query('ROLLBACK');
            return result;
        } finally {
            client.release();
        }
    }

    async function withCommittedClient(fn) {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            const result = await fn(client);
            await client.query('COMMIT');
            return result;
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    describe('customer_payment kind', () => {
        test('previews cleanly for a same-month, in-order date move', async () => {
            const preview = await withClient((client) =>
                svc.preview(client, 'customer_payment', customerPaymentId, new Date().toISOString().slice(0, 10), false)
            );
            expect(preview.can_apply).toBe(true);
            expect(preview.blocking_conflicts).toEqual([]);
            expect(preview.cascade_preview.map((s) => `${s.table}.${s.column}`)).toEqual(
                expect.arrayContaining(['ar_ledger.entry_date', 'customer_payment.payment_date'])
            );
        });

        test('blocks a date before the invoice it settles', async () => {
            const preview = await withClient((client) =>
                svc.preview(client, 'customer_payment', customerPaymentId, '2000-01-01', true)
            );
            expect(preview.can_apply).toBe(false);
            expect(preview.blocking_conflicts.some((c) => /before the invoice/.test(c))).toBe(true);
        });

        test('rejects a future date', async () => {
            const preview = await withClient((client) =>
                svc.preview(client, 'customer_payment', customerPaymentId, '2099-01-01', true)
            );
            expect(preview.can_apply).toBe(false);
            expect(preview.blocking_conflicts).toContain('New date cannot be in the future.');
        });

        test('apply() rejects a reason shorter than 10 characters', async () => {
            await expect(withCommittedClient((client) =>
                svc.apply(client, {
                    kind: 'customer_payment', id: customerPaymentId, newDate: new Date().toISOString().slice(0, 10),
                    reason: 'short', employeeId: testEmployeeId, requesterHasUnrestricted: true,
                })
            )).rejects.toThrow(/at least 10 characters/);
        });

        test('apply() moves the payment date, the ar_ledger entry, preserves time-of-day, and writes an audit log row', async () => {
            const { rows: before } = await db.query('SELECT payment_date FROM customer_payment WHERE payment_id = $1', [customerPaymentId]);
            const originalTimeOfDay = new Date(before[0].payment_date).toISOString().slice(11);

            const result = await withCommittedClient((client) =>
                svc.apply(client, {
                    kind: 'customer_payment', id: customerPaymentId, newDate: new Date().toISOString().slice(0, 10),
                    reason: 'Customer actually paid on the correct date, entered a day late', employeeId: testEmployeeId,
                    requesterHasUnrestricted: true,
                })
            );

            expect(result.cascade_summary.find((s) => s.table === 'customer_payment').row_count).toBe(1);
            expect(result.cascade_summary.find((s) => s.table === 'ar_ledger').row_count).toBe(1);

            const { rows: after } = await db.query('SELECT payment_date FROM customer_payment WHERE payment_id = $1', [customerPaymentId]);
            expect(new Date(after[0].payment_date).toISOString().slice(11)).toBe(originalTimeOfDay);

            const { rows: ledger } = await db.query(
                `SELECT entry_date FROM ar_ledger WHERE payment_id = $1 AND payment_source = 'customer_payment'`,
                [customerPaymentId]
            );
            expect(new Date(ledger[0].entry_date).toISOString().slice(0, 10)).toBe(new Date(after[0].payment_date).toISOString().slice(0, 10));

            const { rows: log } = await db.query(
                `SELECT reason, transaction_kind FROM transaction_date_change_log WHERE transaction_kind = 'customer_payment' AND transaction_id = $1`,
                [customerPaymentId]
            );
            expect(log.length).toBeGreaterThan(0);
            expect(log[log.length - 1].reason).toMatch(/paid on the correct date/);
        });
    });

    describe('invoice_payment kind (POS split payments)', () => {
        test('blocks a non-settled payment via guardState', async () => {
            const { rows } = await db.query(`
                INSERT INTO invoice_payments (invoice_id, method_id, amount_paid, payment_status, created_by)
                VALUES ($1, 1, 50.00, 'on_account', $2) RETURNING payment_id
            `, [testInvoiceId, testEmployeeId]);
            const unsettledId = rows[0].payment_id;

            const preview = await withClient((client) =>
                svc.preview(client, 'invoice_payment', unsettledId, new Date().toISOString().slice(0, 10), true)
            );
            expect(preview.can_apply).toBe(false);
            expect(preview.blocking_conflicts.some((c) => /settled/.test(c))).toBe(true);

            await db.query('DELETE FROM invoice_payments WHERE payment_id = $1', [unsettledId]);
        });

        test('apply() moves settled_at but leaves created_at untouched (audit trail stays intact)', async () => {
            const { rows: before } = await db.query(
                'SELECT created_at, settled_at FROM invoice_payments WHERE payment_id = $1', [invoicePaymentId]
            );

            // Fixtures are reused across runs (see the top-of-file comment on
            // ar_ledger immutability), so a fixed "move to today" target
            // would be a same-day no-op on a second run within the same day.
            // Toggle between two candidate dates to guarantee this run
            // actually changes something, regardless of what a prior run left.
            //
            // This MUST compare Manila calendar days, not UTC ones: the
            // service (shiftPreservingTimeOfDay in transactionDateService.js)
            // decides "did the day actually change" using the Manila
            // calendar day, and Manila is UTC+8, so any instant between
            // 16:00-23:59 UTC is already tomorrow in Manila. A UTC-based
            // .toISOString().slice(0,10) comparison here disagreed with the
            // service near that boundary, picked a "different" date that was
            // actually the same Manila day, and made this assertion flaky
            // depending on what UTC hour the test happened to run in.
            const manilaDateStr = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
            const todayStr = manilaDateStr(new Date());
            const currentDateStr = manilaDateStr(before[0].settled_at);
            const targetDate = currentDateStr === todayStr
                ? manilaDateStr(new Date(Date.now() - 24 * 60 * 60 * 1000))
                : todayStr;

            await withCommittedClient((client) =>
                svc.apply(client, {
                    kind: 'invoice_payment', id: invoicePaymentId, newDate: targetDate,
                    reason: 'Correcting the settlement date for this split payment', employeeId: testEmployeeId,
                    requesterHasUnrestricted: true,
                })
            );

            const { rows: after } = await db.query(
                'SELECT created_at, settled_at FROM invoice_payments WHERE payment_id = $1', [invoicePaymentId]
            );
            expect(after[0].created_at.toISOString()).toBe(before[0].created_at.toISOString());
            expect(after[0].settled_at.toISOString()).not.toBe(before[0].settled_at.toISOString());

            const { rows: ledger } = await db.query(
                `SELECT entry_date FROM ar_ledger WHERE payment_id = $1 AND payment_source = 'invoice_payments'`,
                [invoicePaymentId]
            );
            expect(new Date(ledger[0].entry_date).toISOString().slice(0, 10)).toBe(new Date(after[0].settled_at).toISOString().slice(0, 10));
        });
    });

    describe('month-boundary permission gate', () => {
        test('blocks a cross-month change without the unrestricted permission, allows it with', async () => {
            // Built from Manila calendar parts (not JS's local-timezone
            // getMonth/setMonth, which in a CI container may not be Manila at
            // all) so this reliably lands a full Manila month behind "now",
            // matching how the service itself decides month boundaries.
            const manilaParts = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
            }).formatToParts(new Date()).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
            const lastMonthDate = new Date(Date.UTC(Number(manilaParts.year), Number(manilaParts.month) - 1, 1));
            lastMonthDate.setUTCMonth(lastMonthDate.getUTCMonth() - 1);
            const lastMonthStr = lastMonthDate.toISOString().slice(0, 10);

            const withoutPerm = await withClient((client) =>
                svc.preview(client, 'customer_payment', customerPaymentId, lastMonthStr, false)
            );
            expect(withoutPerm.crosses_month_boundary).toBe(true);
            expect(withoutPerm.can_apply).toBe(false);

            const withPerm = await withClient((client) =>
                svc.preview(client, 'customer_payment', customerPaymentId, lastMonthStr, true)
            );
            expect(withPerm.crosses_month_boundary).toBe(true);
            // may still be blocked by the invoice-precedes-payment conflict depending on
            // fixture dates, so only assert the permission gate itself isn't what's blocking it
            expect(withPerm.blocking_conflicts.some((c) => /unrestricted/.test(c))).toBe(false);
        });
    });
});
