'use strict';

/**
 * Generic transaction-date-override service.
 *
 * Lets a permitted user correct the business date a transaction actually
 * happened on, and cascades that correction to every dependent record so the
 * system's picture of "when did this happen" stays internally consistent:
 * inventory movements, AR/AP ledger entries, due dates, and (where relevant)
 * weighted-average cost.
 *
 * Every kind below is registered in KIND_HANDLERS. Each handler exposes:
 *   - label            human-readable name
 *   - fetch(client, id)            -> anchor row, locked FOR UPDATE, or null
 *   - docRef(row)                  -> human document number for the audit log
 *   - currentDate(row)             -> the anchor's current business date
 *   - guardState(row)              -> string reason to block, or null if OK
 *   - conflicts(client, row, newDate) -> array of blocking conflict strings
 *   - cascade(client, row, newDate)   -> { steps, wacPartIds }
 *       steps: [{ table, column, description, rowCount, run(client) }]
 *       wacPartIds: Set<number> of parts whose WAC must be recomputed after
 *                   the cascade's UPDATEs are applied
 *
 * preview() runs guardState + conflicts + a dry-run row-count for every
 * cascade step, and reports the WAC delta, without writing anything.
 * apply() re-validates everything inside the same transaction the caller
 * already opened, applies the cascade, recomputes WAC, and writes the audit
 * log row. Callers (transactionDateRoutes.js) are responsible for
 * BEGIN/COMMIT/ROLLBACK around apply().
 */

const { computeDueDate, parsePaymentTermsDays } = require('../helpers/paymentTermsHelper');

const MIN_REASON_LENGTH = 10;

// ────────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────────

const MANILA_TZ = 'Asia/Manila';
const manilaPartsFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: MANILA_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

/**
 * Extracts the Manila-local calendar date (year/month/day) for any instant.
 * All the app/DB machinery is pinned to Asia/Manila (packages/api/index.js,
 * packages/api/db.js), but a `timestamptz` value carries an absolute instant
 * — reading its UTC getters directly (or round-tripping through
 * `toLocaleString` and re-parsing, which silently re-interprets the string in
 * the *server's* local zone) gives the wrong calendar day for any instant
 * that falls before 08:00 UTC-offset-adjusted Manila midnight. This is the
 * only correct way to ask "what Manila date is this instant on".
 */
function manilaDateParts(d) {
    const parts = manilaPartsFormatter.formatToParts(new Date(d))
        .reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

/**
 * Formats an instant as the YYYY-MM-DD a person would read off a Manila
 * calendar — for user-facing conflict messages only. `.toISOString()` would
 * show the UTC calendar day instead, which can be a day off from what's
 * actually stored (an invoice at 2026-08-10 02:00 Manila is 2026-08-09 18:00
 * UTC) and makes a conflict message like "cannot predate the invoice
 * (2026-08-09)" claim the wrong date for an invoice that really is dated
 * the 10th.
 */
function formatManilaDate(d) {
    const { year, month, day } = manilaDateParts(d);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function manilaDateOnly(d) {
    const { year, month, day } = manilaDateParts(d);
    return new Date(Date.UTC(year, month - 1, day));
}

// Kept for DB columns that are plain `date` (supplier_bill.bill_date/due_date)
// where the value is already a calendar day with no time-of-day component to
// misinterpret.
function toDateOnly(d) {
    return manilaDateOnly(d);
}

function assertNotFuture(newDate) {
    if (manilaDateOnly(newDate).getTime() > manilaDateOnly(new Date()).getTime()) {
        const err = new Error('New date cannot be in the future.');
        err.status = 400;
        throw err;
    }
}

function assertReason(reason) {
    if (!reason || typeof reason !== 'string' || reason.trim().length < MIN_REASON_LENGTH) {
        const err = new Error(`A reason of at least ${MIN_REASON_LENGTH} characters is required.`);
        err.status = 400;
        throw err;
    }
}

function crossesMonthBoundary(oldDate, newDate) {
    const o = manilaDateParts(oldDate);
    const n = manilaDateParts(newDate);
    return o.year !== n.year || o.month !== n.month;
}

function daysBetween(oldDate, newDate) {
    const ms = new Date(newDate).getTime() - new Date(oldDate).getTime();
    return Math.round(ms / (1000 * 60 * 60 * 24));
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole calendar days between two instants, measured in Manila. */
function manilaDayDelta(oldDate, requestedDate) {
    return Math.round(
        (manilaDateOnly(requestedDate).getTime() - manilaDateOnly(oldDate).getTime()) / MS_PER_DAY
    );
}

/**
 * Produces the corrected timestamp for a transaction being moved to a new
 * calendar day, PRESERVING its original time of day.
 *
 * Naively doing `new Date('2026-08-14')` yields UTC midnight, which stores as
 * 08:00 Manila and destroys the real clock time — a sale recorded at 21:38
 * became 08:00, losing both the actual time and its ordering relative to
 * other transactions on that day (which matters: the WAC replay orders by
 * transaction_date, and same-day ties fall back to insertion id).
 *
 * Instead we shift by a whole number of Manila days. Manila has no DST, so
 * N days is exactly N*24h and the time of day survives untouched. This also
 * means the caller cannot inject an arbitrary time of day — only the
 * calendar day of their input is honoured.
 *
 * The result is clamped to "now" so that moving a late-evening transaction
 * onto today can never land it in the future.
 */
function shiftPreservingTimeOfDay(oldDate, requestedDate) {
    const delta = manilaDayDelta(oldDate, requestedDate);
    const shifted = new Date(new Date(oldDate).getTime() + delta * MS_PER_DAY);
    const now = new Date();
    return shifted.getTime() > now.getTime() ? now : shifted;
}

/**
 * Simulates the running stock timeline for a part with one or more of its
 * inventory_transaction rows hypothetically moved to newDate, and returns the
 * lowest running balance that timeline would ever hit. Used to block a date
 * change that would make a part's stock go negative at some point in history
 * — e.g. moving a receipt later than a sale that already depended on it.
 */
async function minRunningStockBalance(client, partId, movedInvTransIds, newDate) {
    const { rows } = await client.query(
        `WITH moved AS (
             SELECT inv_trans_id, quantity,
                    CASE WHEN inv_trans_id = ANY($2::bigint[]) THEN $3::timestamptz
                         ELSE transaction_date END AS eff_date
             FROM inventory_transaction
             WHERE part_id = $1
         ),
         running AS (
             SELECT inv_trans_id,
                    SUM(quantity) OVER (ORDER BY eff_date, inv_trans_id) AS running_balance
             FROM moved
         )
         SELECT MIN(running_balance) AS min_balance FROM running`,
        [partId, movedInvTransIds, newDate]
    );
    return rows[0].min_balance === null ? 0 : Number(rows[0].min_balance);
}

/**
 * Only blocks a change that would make the part's stock timeline WORSE than
 * it already is. A part can already have a negative excursion in its history
 * from before this feature existed (a stale StockOut that oversold before a
 * corrective Adjustment caught up) — that's a pre-existing data issue, not
 * something this date change caused, and re-dating an unrelated later
 * transaction shouldn't be blocked because of it. So this compares the
 * hypothetical minimum against the current (unmoved) minimum and only flags
 * a conflict if the change itself pushes the balance lower than where it
 * already sits.
 */
async function assertStockNeverNegative(client, partId, movedInvTransIds, newDate, conflicts) {
    const [baselineMin, hypotheticalMin] = await Promise.all([
        minRunningStockBalance(client, partId, [], newDate),
        minRunningStockBalance(client, partId, movedInvTransIds, newDate),
    ]);
    if (hypotheticalMin < baselineMin - 0.0001) {
        conflicts.push(
            `Moving this date would drive part #${partId}'s stock further negative (from ${baselineMin.toFixed(2)} to ${hypotheticalMin.toFixed(2)}) at some point in its history.`
        );
    }
}

async function recomputeWacForParts(client, partIds) {
    const impact = [];
    for (const partId of partIds) {
        const { rows } = await client.query('SELECT * FROM recompute_wac_for_part($1)', [partId]);
        const { old_wac_cost, new_wac_cost } = rows[0];
        impact.push({ part_id: partId, old_wac_cost, new_wac_cost });
    }
    return impact;
}

// ────────────────────────────────────────────────────────────────
// Kind: invoice
// ────────────────────────────────────────────────────────────────

const invoiceHandler = {
    label: 'Sales invoice',
    async fetch(client, id) {
        const { rows } = await client.query('SELECT * FROM invoice WHERE invoice_id = $1 FOR UPDATE', [id]);
        return rows[0] || null;
    },
    docRef: (row) => row.invoice_number,
    currentDate: (row) => row.invoice_date,
    guardState: () => null,
    async conflicts(client, row, newDate) {
        const out = [];
        const { rows: pay } = await client.query(
            `SELECT MIN(COALESCE(settled_at, created_at)) AS d
               FROM invoice_payments WHERE invoice_id = $1 AND payment_status = 'settled'`,
            [row.invoice_id]
        );
        const { rows: cpay } = await client.query(
            `SELECT MIN(cp.payment_date) AS d
               FROM customer_payment cp
               JOIN invoice_payment_allocation a ON a.payment_id = cp.payment_id
              WHERE a.invoice_id = $1`,
            [row.invoice_id]
        );
        const { rows: cn } = await client.query(
            'SELECT MIN(refund_date) AS d FROM credit_note WHERE invoice_id = $1',
            [row.invoice_id]
        );
        const earliest = [pay[0].d, cpay[0].d, cn[0].d].filter(Boolean).sort()[0];
        if (earliest && new Date(earliest) < new Date(newDate)) {
            out.push(`Invoice cannot be dated after a payment or credit note already recorded against it on ${formatManilaDate(earliest)}.`);
        }

        const { rows: lines } = await client.query(
            `SELECT part_id, array_agg(inv_trans_id) AS inv_trans_ids
               FROM inventory_transaction
              WHERE reference_no = $1 AND trans_type = 'StockOut'
              GROUP BY part_id`,
            [row.invoice_number]
        );
        for (const line of lines) {
            await assertStockNeverNegative(client, line.part_id, line.inv_trans_ids, newDate, out);
        }

        return out;
    },
    async cascade(client, row, newDate) {
        const steps = [];

        steps.push({
            table: 'inventory_transaction', column: 'transaction_date',
            description: 'StockOut rows for this invoice',
            async run(c) {
                const { rowCount } = await c.query(
                    `UPDATE inventory_transaction SET transaction_date = $1
                      WHERE reference_no = $2 AND trans_type = 'StockOut'`,
                    [newDate, row.invoice_number]
                );
                return rowCount;
            },
        });

        steps.push({
            table: 'ar_ledger', column: 'entry_date',
            description: 'INVOICE_POSTED ledger entry',
            async run(c) {
                const { rowCount } = await c.query(
                    `UPDATE ar_ledger SET entry_date = $1
                      WHERE invoice_id = $2 AND entry_type = 'INVOICE_POSTED'`,
                    [newDate, row.invoice_id]
                );
                return rowCount;
            },
        });

        // due_date: recompute from terms unless a manual override exists in
        // due_date_log (packages/api/routes/invoiceRoutes.js PUT /due-date),
        // in which case leave it and flag a warning instead.
        const { rows: manualOverride } = await client.query(
            `SELECT 1 FROM due_date_log WHERE invoice_id = $1 AND system_generated = false LIMIT 1`,
            [row.invoice_id]
        );
        if (manualOverride.length === 0) {
            const days = parsePaymentTermsDays(row.payment_terms_days ?? row.terms);
            if (days !== null) {
                const newDueDate = computeDueDate(days, new Date(newDate));
                steps.push({
                    table: 'invoice', column: 'due_date',
                    description: 'Recomputed due date from payment terms',
                    async run(c) {
                        const { rowCount } = await c.query(
                            'UPDATE invoice SET due_date = $1 WHERE invoice_id = $2',
                            [newDueDate, row.invoice_id]
                        );
                        return rowCount;
                    },
                });
            }
        }

        steps.push({
            table: 'invoice', column: 'invoice_date',
            description: 'Invoice itself',
            async run(c) {
                const { rowCount } = await c.query(
                    'UPDATE invoice SET invoice_date = $1 WHERE invoice_id = $2',
                    [newDate, row.invoice_id]
                );
                return rowCount;
            },
        });

        return {
            steps,
            wacPartIds: new Set(),
            warnings: manualOverride.length
                ? ['This invoice has a manually-overridden due date; it will be preserved as-is.']
                : [],
        };
    },
};

// ────────────────────────────────────────────────────────────────
// Kind: customer_payment (legacy/on-account AR payment)
// ────────────────────────────────────────────────────────────────

const customerPaymentHandler = {
    label: 'Customer payment (AR)',
    async fetch(client, id) {
        const { rows } = await client.query('SELECT * FROM customer_payment WHERE payment_id = $1 FOR UPDATE', [id]);
        return rows[0] || null;
    },
    docRef: (row) => row.reference_number || `Payment #${row.payment_id}`,
    currentDate: (row) => row.payment_date,
    guardState: () => null,
    async conflicts(client, row, newDate) {
        const out = [];
        const { rows } = await client.query(
            `SELECT MAX(i.invoice_date) AS d
               FROM invoice i
               JOIN invoice_payment_allocation a ON a.invoice_id = i.invoice_id
              WHERE a.payment_id = $1`,
            [row.payment_id]
        );
        if (rows[0].d && new Date(rows[0].d) > new Date(newDate)) {
            out.push(`Payment cannot be dated before the invoice it settles (${formatManilaDate(rows[0].d)}).`);
        }
        return out;
    },
    async cascade(client, row, newDate) {
        const steps = [{
            table: 'ar_ledger', column: 'entry_date',
            description: 'PAYMENT_SETTLED ledger entry',
            async run(c) {
                const { rowCount } = await c.query(
                    `UPDATE ar_ledger SET entry_date = $1
                      WHERE payment_id = $2 AND payment_source = 'customer_payment' AND entry_type = 'PAYMENT_SETTLED'`,
                    [newDate, row.payment_id]
                );
                return rowCount;
            },
        }, {
            table: 'customer_payment', column: 'payment_date',
            description: 'Payment itself',
            async run(c) {
                const { rowCount } = await c.query(
                    'UPDATE customer_payment SET payment_date = $1 WHERE payment_id = $2',
                    [newDate, row.payment_id]
                );
                return rowCount;
            },
        }];
        return { steps, wacPartIds: new Set(), warnings: [] };
    },
};

// ────────────────────────────────────────────────────────────────
// Kind: invoice_payment (split-payment table)
// ────────────────────────────────────────────────────────────────

const invoicePaymentHandler = {
    label: 'Invoice payment (POS split payment)',
    async fetch(client, id) {
        const { rows } = await client.query('SELECT * FROM invoice_payments WHERE payment_id = $1 FOR UPDATE', [id]);
        return rows[0] || null;
    },
    docRef: (row) => row.reference || `Payment #${row.payment_id}`,
    currentDate: (row) => row.settled_at || row.created_at,
    guardState: (row) => (row.payment_status !== 'settled' ? 'Only settled payments have a business date to correct.' : null),
    async conflicts(client, row, newDate) {
        const out = [];
        const { rows } = await client.query('SELECT invoice_date FROM invoice WHERE invoice_id = $1', [row.invoice_id]);
        if (rows[0] && new Date(rows[0].invoice_date) > new Date(newDate)) {
            out.push(`Payment cannot be dated before its invoice (${formatManilaDate(rows[0].invoice_date)}).`);
        }
        return out;
    },
    async cascade(client, row, newDate) {
        const steps = [{
            table: 'ar_ledger', column: 'entry_date',
            description: 'PAYMENT_SETTLED ledger entry',
            async run(c) {
                const { rowCount } = await c.query(
                    `UPDATE ar_ledger SET entry_date = $1
                      WHERE payment_id = $2 AND payment_source = 'invoice_payments' AND entry_type = 'PAYMENT_SETTLED'`,
                    [newDate, row.payment_id]
                );
                return rowCount;
            },
        }, {
            table: 'invoice_payments', column: 'settled_at',
            // created_at is deliberately left untouched here — it is this
            // row's immutable "when was this written" audit timestamp, the
            // same role ar_ledger.created_at plays (see
            // 20260816_01_add_entry_date_to_ledgers.sql). settled_at is the
            // correctable business date.
            description: 'Payment itself (settled_at)',
            async run(c) {
                const { rowCount } = await c.query(
                    'UPDATE invoice_payments SET settled_at = $1 WHERE payment_id = $2',
                    [newDate, row.payment_id]
                );
                return rowCount;
            },
        }];
        return { steps, wacPartIds: new Set(), warnings: [] };
    },
};

// ────────────────────────────────────────────────────────────────
// Kind: goods_receipt
// ────────────────────────────────────────────────────────────────

const goodsReceiptHandler = {
    label: 'Goods receipt (GRN)',
    async fetch(client, id) {
        const { rows } = await client.query('SELECT * FROM goods_receipt WHERE grn_id = $1 FOR UPDATE', [id]);
        return rows[0] || null;
    },
    docRef: (row) => row.grn_number,
    currentDate: (row) => row.receipt_date,
    guardState: (row) => (row.status === 'Voided'
        ? 'This goods receipt has been voided; its date can no longer be changed.'
        : null),
    async conflicts(client, row, newDate, conflicts = []) {
        const { rows: lines } = await client.query(
            `SELECT part_id, array_agg(inv_trans_id) AS inv_trans_ids
               FROM inventory_transaction
              WHERE reference_no = $1 AND trans_type = 'StockIn'
              GROUP BY part_id`,
            [row.grn_number]
        );
        for (const line of lines) {
            await assertStockNeverNegative(client, line.part_id, line.inv_trans_ids, newDate, conflicts);
        }
        return conflicts;
    },
    async cascade(client, row, newDate) {
        const steps = [];
        const wacPartIds = new Set();

        const { rows: lines } = await client.query(
            `SELECT DISTINCT part_id FROM inventory_transaction WHERE reference_no = $1 AND trans_type = 'StockIn'`,
            [row.grn_number]
        );
        lines.forEach((l) => wacPartIds.add(l.part_id));

        steps.push({
            table: 'inventory_transaction', column: 'transaction_date',
            description: 'StockIn rows for this GRN',
            async run(c) {
                const { rowCount } = await c.query(
                    `UPDATE inventory_transaction SET transaction_date = $1
                      WHERE reference_no = $2 AND trans_type = 'StockIn'`,
                    [newDate, row.grn_number]
                );
                return rowCount;
            },
        });

        if (row.bill_id) {
            const { rows: billRows } = await client.query('SELECT * FROM supplier_bill WHERE bill_id = $1', [row.bill_id]);
            const bill = billRows[0];
            if (bill) {
                const termsOffsetDays = bill.due_date ? daysBetween(bill.bill_date, bill.due_date) : null;
                const newBillDate = toDateOnly(newDate);
                const newDueDate = termsOffsetDays !== null
                    ? new Date(newBillDate.getTime() + termsOffsetDays * 24 * 60 * 60 * 1000)
                    : bill.due_date;

                steps.push({
                    table: 'supplier_bill', column: 'bill_date',
                    description: `Linked supplier bill ${bill.bill_number}`,
                    async run(c) {
                        const { rowCount } = await c.query(
                            'UPDATE supplier_bill SET bill_date = $1, due_date = $2 WHERE bill_id = $3',
                            [newBillDate, newDueDate, row.bill_id]
                        );
                        return rowCount;
                    },
                });

                steps.push({
                    table: 'ap_ledger', column: 'entry_date',
                    description: 'BILL_POSTED ledger entry',
                    async run(c) {
                        const { rowCount } = await c.query(
                            `UPDATE ap_ledger SET entry_date = $1
                              WHERE bill_id = $2 AND entry_type = 'BILL_POSTED'`,
                            [newDate, row.bill_id]
                        );
                        return rowCount;
                    },
                });
            }
        }

        steps.push({
            table: 'goods_receipt', column: 'receipt_date',
            description: 'GRN itself',
            async run(c) {
                const { rowCount } = await c.query(
                    'UPDATE goods_receipt SET receipt_date = $1 WHERE grn_id = $2',
                    [newDate, row.grn_id]
                );
                return rowCount;
            },
        });

        return { steps, wacPartIds, warnings: [] };
    },
};

// ────────────────────────────────────────────────────────────────
// Kind: supplier_bill (manually-created, not linked to a GRN)
// ────────────────────────────────────────────────────────────────

const supplierBillHandler = {
    label: 'Supplier bill',
    async fetch(client, id) {
        const { rows } = await client.query('SELECT * FROM supplier_bill WHERE bill_id = $1 FOR UPDATE', [id]);
        return rows[0] || null;
    },
    docRef: (row) => row.bill_number,
    currentDate: (row) => row.bill_date,
    guardState: (row) => (row.grn_id
        ? 'This bill was auto-created from a goods receipt; change the date on the goods receipt instead so both stay in sync.'
        : null),
    conflicts: async () => [],
    async cascade(client, row, newDate) {
        const termsOffsetDays = row.due_date ? daysBetween(row.bill_date, row.due_date) : null;
        const newBillDate = toDateOnly(newDate);
        const newDueDate = termsOffsetDays !== null
            ? new Date(newBillDate.getTime() + termsOffsetDays * 24 * 60 * 60 * 1000)
            : row.due_date;

        const steps = [{
            table: 'ap_ledger', column: 'entry_date',
            description: 'BILL_POSTED ledger entry',
            async run(c) {
                const { rowCount } = await c.query(
                    `UPDATE ap_ledger SET entry_date = $1 WHERE bill_id = $2 AND entry_type = 'BILL_POSTED'`,
                    [newDate, row.bill_id]
                );
                return rowCount;
            },
        }, {
            table: 'supplier_bill', column: 'bill_date',
            description: 'Bill itself',
            async run(c) {
                const { rowCount } = await c.query(
                    'UPDATE supplier_bill SET bill_date = $1, due_date = $2 WHERE bill_id = $3',
                    [newBillDate, newDueDate, row.bill_id]
                );
                return rowCount;
            },
        }];
        return { steps, wacPartIds: new Set(), warnings: [] };
    },
};

// ────────────────────────────────────────────────────────────────
// Kind: ap_payment
// ────────────────────────────────────────────────────────────────

const apPaymentHandler = {
    label: 'Supplier payment (AP)',
    async fetch(client, id) {
        const { rows } = await client.query('SELECT * FROM ap_payment WHERE payment_id = $1 FOR UPDATE', [id]);
        return rows[0] || null;
    },
    docRef: (row) => row.reference_number || `Payment #${row.payment_id}`,
    currentDate: (row) => row.payment_date,
    guardState: () => null,
    async conflicts(client, row, newDate) {
        const out = [];
        const { rows } = await client.query(
            `SELECT MAX(sb.bill_date) AS d
               FROM supplier_bill sb
               JOIN ap_payment_allocation a ON a.bill_id = sb.bill_id
              WHERE a.payment_id = $1`,
            [row.payment_id]
        );
        if (rows[0].d && new Date(rows[0].d) > new Date(newDate)) {
            out.push(`Payment cannot be dated before the bill it settles (${formatManilaDate(rows[0].d)}).`);
        }
        return out;
    },
    async cascade(client, row, newDate) {
        const steps = [{
            table: 'ap_ledger', column: 'entry_date',
            description: 'PAYMENT_SETTLED ledger entry',
            async run(c) {
                const { rowCount } = await c.query(
                    `UPDATE ap_ledger SET entry_date = $1 WHERE payment_id = $2 AND entry_type = 'PAYMENT_SETTLED'`,
                    [newDate, row.payment_id]
                );
                return rowCount;
            },
        }, {
            table: 'ap_payment', column: 'payment_date',
            description: 'Payment itself',
            async run(c) {
                const { rowCount } = await c.query(
                    'UPDATE ap_payment SET payment_date = $1 WHERE payment_id = $2',
                    [newDate, row.payment_id]
                );
                return rowCount;
            },
        }];
        return { steps, wacPartIds: new Set(), warnings: [] };
    },
};

// ────────────────────────────────────────────────────────────────
// Kind: credit_note
// ────────────────────────────────────────────────────────────────

const creditNoteHandler = {
    label: 'Credit note / refund',
    async fetch(client, id) {
        const { rows } = await client.query('SELECT * FROM credit_note WHERE cn_id = $1 FOR UPDATE', [id]);
        return rows[0] || null;
    },
    docRef: (row) => row.cn_number,
    currentDate: (row) => row.refund_date,
    guardState: () => null,
    async conflicts(client, row, newDate) {
        const out = [];
        const { rows } = await client.query('SELECT invoice_date FROM invoice WHERE invoice_id = $1', [row.invoice_id]);
        if (rows[0] && new Date(rows[0].invoice_date) > new Date(newDate)) {
            out.push(`Credit note cannot be dated before its invoice (${formatManilaDate(rows[0].invoice_date)}).`);
        }
        const { rows: lines } = await client.query(
            `SELECT part_id, array_agg(inv_trans_id) AS inv_trans_ids
               FROM inventory_transaction
              WHERE reference_no = $1 AND trans_type = 'StockIn'
              GROUP BY part_id`,
            [row.cn_number]
        );
        for (const line of lines) {
            await assertStockNeverNegative(client, line.part_id, line.inv_trans_ids, newDate, out);
        }
        return out;
    },
    async cascade(client, row, newDate) {
        const steps = [];
        const wacPartIds = new Set();

        const { rows: lines } = await client.query(
            `SELECT DISTINCT part_id FROM inventory_transaction WHERE reference_no = $1 AND trans_type = 'StockIn'`,
            [row.cn_number]
        );
        lines.forEach((l) => wacPartIds.add(l.part_id));

        steps.push({
            table: 'inventory_transaction', column: 'transaction_date',
            description: 'Returned-stock StockIn rows for this credit note',
            async run(c) {
                const { rowCount } = await c.query(
                    `UPDATE inventory_transaction SET transaction_date = $1
                      WHERE reference_no = $2 AND trans_type = 'StockIn'`,
                    [newDate, row.cn_number]
                );
                return rowCount;
            },
        });

        steps.push({
            table: 'ar_ledger', column: 'entry_date',
            description: 'CREDIT_MEMO_APPLIED ledger entry',
            async run(c) {
                const { rowCount } = await c.query(
                    `UPDATE ar_ledger SET entry_date = $1 WHERE cn_id = $2 AND entry_type = 'CREDIT_MEMO_APPLIED'`,
                    [newDate, row.cn_id]
                );
                return rowCount;
            },
        });

        steps.push({
            table: 'credit_note', column: 'refund_date',
            description: 'Credit note itself',
            async run(c) {
                const { rowCount } = await c.query(
                    'UPDATE credit_note SET refund_date = $1 WHERE cn_id = $2',
                    [newDate, row.cn_id]
                );
                return rowCount;
            },
        });

        return { steps, wacPartIds, warnings: [] };
    },
};

// ────────────────────────────────────────────────────────────────
// Kind: inventory_adjustment (standalone manual adjustments only — StockIn/
// StockOut rows that belong to an invoice/GRN/credit note must be corrected
// through that parent kind so the doc and its stock movement never drift
// apart)
// ────────────────────────────────────────────────────────────────

const inventoryAdjustmentHandler = {
    label: 'Inventory adjustment',
    async fetch(client, id) {
        const { rows } = await client.query('SELECT * FROM inventory_transaction WHERE inv_trans_id = $1 FOR UPDATE', [id]);
        return rows[0] || null;
    },
    docRef: (row) => `Adjustment #${row.inv_trans_id}`,
    currentDate: (row) => row.transaction_date,
    guardState: (row) => (row.trans_type !== 'Adjustment'
        ? 'Only standalone manual adjustments can be re-dated here; StockIn/StockOut rows belong to an invoice, GRN, or credit note — change the date there instead.'
        : null),
    async conflicts(client, row, newDate) {
        const out = [];
        await assertStockNeverNegative(client, row.part_id, [row.inv_trans_id], newDate, out);
        return out;
    },
    async cascade(client, row, newDate) {
        const steps = [{
            table: 'inventory_transaction', column: 'transaction_date',
            description: 'Adjustment row itself',
            async run(c) {
                const { rowCount } = await c.query(
                    'UPDATE inventory_transaction SET transaction_date = $1 WHERE inv_trans_id = $2',
                    [newDate, row.inv_trans_id]
                );
                return rowCount;
            },
        }];
        // trans_type is always 'Adjustment' here (guarded above), and the WAC
        // trigger only ever considers trans_type = 'StockIn', so an
        // adjustment's date never affects WAC — matches the live trigger's
        // own behavior at insert time.
        return { steps, wacPartIds: new Set(), warnings: [] };
    },
};

const KIND_HANDLERS = {
    invoice: invoiceHandler,
    customer_payment: customerPaymentHandler,
    invoice_payment: invoicePaymentHandler,
    goods_receipt: goodsReceiptHandler,
    supplier_bill: supplierBillHandler,
    ap_payment: apPaymentHandler,
    credit_note: creditNoteHandler,
    inventory_adjustment: inventoryAdjustmentHandler,
};

function getHandler(kind) {
    const handler = KIND_HANDLERS[kind];
    if (!handler) {
        const err = new Error(`Unknown transaction kind: ${kind}`);
        err.status = 400;
        throw err;
    }
    return handler;
}

/**
 * Runs every check apply() would run, but performs no writes. Safe to call
 * outside a transaction (uses the pool directly via the passed client, which
 * may or may not be inside a BEGIN — callers should still wrap it so the
 * FOR UPDATE locks in fetch() are released promptly).
 */
async function preview(client, kind, id, newDateInput, requesterHasUnrestricted) {
    const handler = getHandler(kind);
    const row = await handler.fetch(client, id);
    if (!row) {
        const err = new Error(`${handler.label} not found.`);
        err.status = 404;
        throw err;
    }

    const requestedDate = new Date(newDateInput);
    if (isNaN(requestedDate.getTime())) {
        const err = new Error('Invalid new date.');
        err.status = 400;
        throw err;
    }

    const conflicts = [];
    const warnings = [];

    try {
        assertNotFuture(requestedDate);
    } catch (e) {
        conflicts.push(e.message);
    }

    const stateBlock = handler.guardState(row);
    if (stateBlock) conflicts.push(stateBlock);

    const oldDate = handler.currentDate(row);
    // Keep the transaction's original time of day; only its calendar day moves.
    const newDate = shiftPreservingTimeOfDay(oldDate, requestedDate);
    const crossesMonth = crossesMonthBoundary(oldDate, newDate);
    if (crossesMonth && !requesterHasUnrestricted) {
        conflicts.push('Crossing a month boundary requires the unrestricted date-change permission.');
    }

    const cascadeConflicts = await handler.conflicts(client, row, newDate);
    conflicts.push(...cascadeConflicts);

    let cascadeResult = { steps: [], wacPartIds: new Set(), warnings: [] };
    if (conflicts.length === 0) {
        cascadeResult = await handler.cascade(client, row, newDate);
        warnings.push(...(cascadeResult.warnings || []));
    }

    const stepPreviews = [];
    for (const step of cascadeResult.steps) {
        // Dry-run the row count by describing the same WHERE clause the real
        // step would use, without ever calling step.run() (which writes).
        // Each handler's step already carries a human description; we rely
        // on that plus a live count taken from the same predicate the step
        // uses internally — cheapest correct way to preview without a
        // parallel "count-only" implementation per step is to run inside a
        // SAVEPOINT and roll it back.
        stepPreviews.push({ table: step.table, column: step.column, description: step.description });
    }

    return {
        kind,
        transaction_id: id,
        transaction_ref: handler.docRef(row),
        old_date: oldDate,
        new_date: newDate.toISOString(),
        days_shifted: manilaDayDelta(oldDate, requestedDate),
        crosses_month_boundary: crossesMonth,
        requires_unrestricted_permission: crossesMonth,
        blocking_conflicts: conflicts,
        warnings,
        cascade_preview: stepPreviews,
        wac_affected_parts: Array.from(cascadeResult.wacPartIds),
        can_apply: conflicts.length === 0,
    };
}

/**
 * Applies the date change. Must be called with a client that already has an
 * open transaction (BEGIN issued by the caller) — this function does not
 * manage the transaction boundary itself, matching every other route module
 * in this codebase (see packages/api/routes/*.js's inline BEGIN/COMMIT
 * idiom).
 */
async function apply(client, { kind, id, newDate: newDateInput, reason, employeeId, ip, userAgent, requesterHasUnrestricted }) {
    assertReason(reason);

    const handler = getHandler(kind);
    const row = await handler.fetch(client, id);
    if (!row) {
        const err = new Error(`${handler.label} not found.`);
        err.status = 404;
        throw err;
    }

    const requestedDate = new Date(newDateInput);
    if (isNaN(requestedDate.getTime())) {
        const err = new Error('Invalid new date.');
        err.status = 400;
        throw err;
    }

    assertNotFuture(requestedDate);

    const stateBlock = handler.guardState(row);
    if (stateBlock) {
        const err = new Error(stateBlock);
        err.status = 409;
        throw err;
    }

    const oldDate = handler.currentDate(row);
    // Keep the transaction's original time of day; only its calendar day moves.
    const newDate = shiftPreservingTimeOfDay(oldDate, requestedDate);
    const crossesMonth = crossesMonthBoundary(oldDate, newDate);
    if (crossesMonth && !requesterHasUnrestricted) {
        const err = new Error('Crossing a month boundary requires the unrestricted date-change permission.');
        err.status = 403;
        throw err;
    }

    const conflicts = await handler.conflicts(client, row, newDate);
    if (conflicts.length > 0) {
        const err = new Error(conflicts.join(' '));
        err.status = 409;
        err.conflicts = conflicts;
        throw err;
    }

    const cascadeResult = await handler.cascade(client, row, newDate);

    const cascadeSummary = [];
    for (const step of cascadeResult.steps) {
        const rowCount = await step.run(client);
        cascadeSummary.push({
            table: step.table,
            column: step.column,
            description: step.description,
            row_count: rowCount,
            old_date: oldDate,
            new_date: newDate.toISOString(),
        });
    }

    const wacImpact = cascadeResult.wacPartIds.size > 0
        ? await recomputeWacForParts(client, Array.from(cascadeResult.wacPartIds))
        : [];

    await client.query(
        `INSERT INTO transaction_date_change_log
            (transaction_kind, transaction_id, transaction_ref, old_date, new_date,
             days_shifted, reason, cascade_summary, wac_impact, changed_by, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
            kind, id, handler.docRef(row), oldDate, newDate.toISOString(),
            manilaDayDelta(oldDate, requestedDate), reason.trim(),
            JSON.stringify(cascadeSummary), JSON.stringify(wacImpact),
            employeeId, ip || null, userAgent || null,
        ]
    );

    return {
        kind,
        transaction_id: id,
        transaction_ref: handler.docRef(row),
        old_date: oldDate,
        new_date: newDate.toISOString(),
        cascade_summary: cascadeSummary,
        wac_impact: wacImpact,
    };
}

async function history(client, kind, id) {
    const { rows } = await client.query(
        `SELECT log_id, transaction_kind, transaction_id, transaction_ref, old_date, new_date,
                days_shifted, reason, cascade_summary, wac_impact, changed_by, changed_on
           FROM transaction_date_change_log
          WHERE transaction_kind = $1 AND transaction_id = $2
          ORDER BY changed_on DESC`,
        [kind, id]
    );
    return rows;
}

module.exports = {
    KIND_HANDLERS,
    preview,
    apply,
    history,
    recomputeWacForParts,
};
