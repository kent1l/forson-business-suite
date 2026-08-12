'use strict';

const cron = require('node-cron');
const db = require('../db');

let currentCronJob = null;

/**
 * Scheduled counterpart to scripts/reconcileArBalances.js — that script is
 * manual-only (`npm run reconcile:ar`), so drift between the three AR balance
 * sources (invoice trigger columns, invoice_with_balance view, ar_ledger) or
 * between ap_ledger and its own trigger-maintained columns could previously
 * accumulate in production for weeks with nobody noticing. This runs the same
 * read-only comparison on a schedule and logs a structured alert when it finds
 * drift, so a regression surfaces automatically instead of requiring someone
 * to remember to run the script.
 *
 * Deliberately read-only, same as the manual script: ar_ledger/ap_ledger are
 * immutable, so this never attempts to correct anything, only report it.
 */
async function runLedgerReconciliationScan() {
    console.log('[LedgerReconciliation] Starting scheduled AR/AP balance reconciliation scan...');
    try {
        const { rows: arRows } = await db.query(`
            SELECT
                c.customer_id,
                c.company_name,
                c.first_name,
                c.last_name,
                COALESCE(trig.trigger_balance, 0)::numeric(14,2) AS trigger_balance,
                COALESCE(view.view_balance, 0)::numeric(14,2) AS view_balance,
                COALESCE(led.ledger_balance, 0)::numeric(14,2) AS ledger_balance
            FROM customer c
            LEFT JOIN (
                SELECT customer_id, SUM(total_amount - amount_paid) AS trigger_balance
                FROM invoice
                WHERE status NOT IN ('Fully Refunded', 'Cancelled')
                GROUP BY customer_id
            ) trig ON trig.customer_id = c.customer_id
            LEFT JOIN (
                SELECT customer_id, SUM(balance_due) AS view_balance
                FROM invoice_with_balance
                GROUP BY customer_id
            ) view ON view.customer_id = c.customer_id
            LEFT JOIN vw_customer_ar_balance led ON led.customer_id = c.customer_id
            WHERE COALESCE(trig.trigger_balance, 0) <> 0
               OR COALESCE(view.view_balance, 0) <> 0
               OR COALESCE(led.ledger_balance, 0) <> 0
        `);

        const threshold = 0.01;
        const arDrift = arRows.filter((r) => {
            const trigger = parseFloat(r.trigger_balance);
            const view = parseFloat(r.view_balance);
            const ledger = parseFloat(r.ledger_balance);
            return Math.abs(view - ledger) > threshold || Math.abs(trigger - ledger) > threshold;
        });

        const { rows: apRows } = await db.query(`
            SELECT
                s.supplier_id,
                s.supplier_name,
                COALESCE(led.ledger_balance, 0)::numeric(14,2) AS ledger_balance,
                COALESCE(bill.trigger_balance, 0)::numeric(14,2) AS trigger_balance
            FROM supplier s
            LEFT JOIN (
                SELECT supplier_id, SUM(total_amount - amount_paid) AS trigger_balance
                FROM supplier_bill
                WHERE status NOT IN ('Cancelled')
                GROUP BY supplier_id
            ) bill ON bill.supplier_id = s.supplier_id
            LEFT JOIN vw_supplier_ap_balance led ON led.supplier_id = s.supplier_id
            WHERE COALESCE(bill.trigger_balance, 0) <> 0
               OR COALESCE(led.ledger_balance, 0) <> 0
        `).catch((err) => {
            // ap_ledger/supplier_bill schema is new (2026-08-12); tolerate absence
            // gracefully rather than failing the whole scan if it's ever rolled back.
            console.warn('[LedgerReconciliation] AP reconciliation query failed (schema may be unavailable):', err.message);
            return { rows: [] };
        });

        const apDrift = apRows.filter((r) => Math.abs(parseFloat(r.trigger_balance) - parseFloat(r.ledger_balance)) > threshold);

        if (arDrift.length > 0) {
            console.error(`[LedgerReconciliation] ALERT: ${arDrift.length} customer(s) with AR balance drift beyond ${threshold}:`,
                JSON.stringify(arDrift.map((d) => ({
                    customer_id: d.customer_id,
                    name: d.company_name || `${d.first_name || ''} ${d.last_name || ''}`.trim(),
                    trigger_balance: d.trigger_balance,
                    view_balance: d.view_balance,
                    ledger_balance: d.ledger_balance,
                }))));
        } else {
            console.log('[LedgerReconciliation] AR: no drift detected.');
        }

        if (apDrift.length > 0) {
            console.error(`[LedgerReconciliation] ALERT: ${apDrift.length} supplier(s) with AP balance drift beyond ${threshold}:`,
                JSON.stringify(apDrift.map((d) => ({
                    supplier_id: d.supplier_id,
                    name: d.supplier_name,
                    trigger_balance: d.trigger_balance,
                    ledger_balance: d.ledger_balance,
                }))));
        } else {
            console.log('[LedgerReconciliation] AP: no drift detected.');
        }

        return { arDrifted: arDrift.length, apDrifted: apDrift.length };
    } catch (err) {
        console.error('[LedgerReconciliation] Error running reconciliation scan:', err.message);
    }
}

async function startLedgerReconciliationEngine() {
    try {
        const { rows } = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'LEDGER_RECONCILIATION_SCHEDULE'");
        const schedule = (rows.length > 0 && rows[0].setting_value) ? rows[0].setting_value : '0 * * * *';

        console.log(`[LedgerReconciliation] Scheduling cron job with pattern: ${schedule}`);

        if (currentCronJob) currentCronJob.stop();
        currentCronJob = cron.schedule(schedule, () => { runLedgerReconciliationScan(); });
    } catch (err) {
        console.error('[LedgerReconciliation] Failed to start engine:', err.message);
    }
}

module.exports = { startLedgerReconciliationEngine, runLedgerReconciliationScan };
