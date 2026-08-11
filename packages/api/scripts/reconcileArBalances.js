/**
 * AR balance drift-detection report.
 *
 * The system computes a customer's AR balance three independent ways that are
 * not enforced to stay in sync:
 *   1. invoice.amount_paid/status, maintained by the update_invoice_balance_after_payment()
 *      trigger (database/migrations/20260802_01_fix_ar_trigger_status.sql)
 *   2. invoice_with_balance.balance_due, a view recomputing balance from invoice
 *      columns (database/migrations/20250916_optimize_payment_terms_infrastructure.sql)
 *   3. vw_customer_ar_balance.ledger_balance, the append-only ar_ledger sum, treated
 *      as authoritative by packages/api/routes/arRoutes.js
 *
 * This script is read-only: it reports drift between the three per customer, it
 * does not correct it. ar_ledger is immutable (trg_ar_ledger_immutable), so any
 * future correction must be a new adjustment entry via append_ar_ledger_entry(),
 * never a direct update.
 *
 * Usage: node scripts/reconcileArBalances.js [--threshold=0.01] [--json]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

if (process.env.NODE_ENV !== 'production') {
  process.env.DB_HOST = process.env.DB_HOST || 'localhost';
}

const db = require('../db');

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const thresholdArg = args.find((a) => a.startsWith('--threshold='));
const threshold = thresholdArg ? parseFloat(thresholdArg.split('=')[1]) : 0.01;

const QUERY = `
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
  ORDER BY c.customer_id;
`;

(async function run() {
  try {
    const { rows } = await db.query(QUERY);

    const drifted = rows.filter((r) => {
      const trigger = parseFloat(r.trigger_balance);
      const view = parseFloat(r.view_balance);
      const ledger = parseFloat(r.ledger_balance);
      return (
        Math.abs(view - ledger) > threshold ||
        Math.abs(trigger - ledger) > threshold
      );
    }).map((r) => {
      const trigger = parseFloat(r.trigger_balance);
      const view = parseFloat(r.view_balance);
      const ledger = parseFloat(r.ledger_balance);
      const name = r.company_name || `${r.first_name || ''} ${r.last_name || ''}`.trim();
      return {
        customer_id: r.customer_id,
        name,
        trigger_balance: trigger,
        view_balance: view,
        ledger_balance: ledger,
        view_vs_ledger_delta: +(view - ledger).toFixed(2),
        trigger_vs_ledger_delta: +(trigger - ledger).toFixed(2),
      };
    });

    if (jsonOutput) {
      console.log(JSON.stringify({
        checked_at: new Date().toISOString(),
        threshold,
        customers_checked: rows.length,
        customers_drifted: drifted.length,
        drift: drifted,
      }, null, 2));
    } else {
      console.log(`AR balance reconciliation — ${new Date().toISOString()}`);
      console.log(`Threshold: ${threshold}`);
      console.log(`Customers checked: ${rows.length}`);
      console.log(`Customers with drift: ${drifted.length}`);
      if (drifted.length > 0) {
        console.log('');
        console.log('customer_id | name | trigger_balance | view_balance | ledger_balance | view-ledger | trigger-ledger');
        for (const d of drifted) {
          console.log(
            `${d.customer_id} | ${d.name} | ${d.trigger_balance} | ${d.view_balance} | ${d.ledger_balance} | ${d.view_vs_ledger_delta} | ${d.trigger_vs_ledger_delta}`
          );
        }
      }
    }

    process.exitCode = drifted.length > 0 ? 1 : 0;
  } catch (err) {
    console.error('AR reconciliation failed:', err && err.stack ? err.stack : err);
    process.exitCode = 2;
  } finally {
    process.exit();
  }
})();
