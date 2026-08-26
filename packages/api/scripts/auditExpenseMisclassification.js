/**
 * Expense misclassification detection report.
 *
 * The `expense` module records operating costs only — its category list
 * (database/migrations/20260723_02_expense_module.sql) is opex-only. Cash-outs
 * that are really inventory purchases, fixed assets, payments against an already
 * recorded supplier bill, or owner's drawings belong in other modules
 * (goods_receipt, accounts payable) or in no expense at all. Nothing enforces
 * that boundary, so this script looks for rows that appear to have crossed it.
 *
 * A liability-payment hit is the most serious: the same cash-out is then counted
 * twice, once through AP and once as an expense.
 *
 * This script is read-only: it reports suspected misclassifications, it does not
 * void, recategorize or otherwise correct them. Every hit is a heuristic and
 * needs a human to confirm before anything is changed.
 *
 * Usage: node scripts/auditExpenseMisclassification.js [--threshold=0.4] [--capex-min=20000] [--json]
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
const threshold = thresholdArg ? parseFloat(thresholdArg.split('=')[1]) : 0.4;
const capexMinArg = args.find((a) => a.startsWith('--capex-min='));
const capexMin = capexMinArg ? parseFloat(capexMinArg.split('=')[1]) : 20000;

// Payee-to-supplier name similarity above which the two are treated as the same
// vendor. Staff spell vendor names inconsistently, so an exact match would miss
// most real hits. Compared on names stripped of generic trade words (see
// SUPPLIER_NOISE_WORDS): raw trigram similarity scores "AG TRADING" against
// "AUTANA TRADING" at 0.53 purely for the shared word, which is a false match.
const NAME_SIMILARITY = 0.4;
// How far apart an expense and a candidate bill/receipt may be and still plausibly
// describe the same transaction.
const DATE_WINDOW_DAYS = 30;
// Fraction of the outstanding bill amount an expense may differ by and still be
// considered the same payment.
const AMOUNT_TOLERANCE = 0.02;

// Trade words shared by most vendor names here. Left in, they dominate the
// trigram score and make unrelated vendors look like the same business.
const SUPPLIER_NOISE_WORDS =
  '\\m(trading|corp|corporation|inc|incorporated|company|co|enterprises|enterprise|'
  + 'supply|supplies|auto|parts|spare|motors|motor|center|centre|shop|store|marketing|'
  + 'industrial|sales|hardware|general|merchandise|ltd)\\M';

const normalizeName = (expr) =>
  `TRIM(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(${expr}), '${SUPPLIER_NOISE_WORDS}', ' ', 'g'), '\\s+', ' ', 'g'))`;

const QUERY = `
  WITH supplier_norm AS (
    SELECT s.supplier_id, s.supplier_name, ${normalizeName('s.supplier_name')} AS core
    FROM supplier s
  ),
  expense_rows AS (
    SELECT
      e.expense_id,
      TO_CHAR(e.expense_date, 'YYYY-MM-DD') AS expense_date,
      e.expense_date AS expense_date_raw,
      e.amount,
      e.payee,
      e.reference_no,
      e.notes,
      c.category_name,
      ${normalizeName('e.payee')} AS payee_core,
      LOWER(COALESCE(e.notes, '') || ' ' || COALESCE(e.payee, '')) AS haystack
    FROM expense e
    JOIN expense_category c ON e.category_id = c.category_id
    WHERE e.is_void = false
      AND e.payroll_run_id IS NULL
  ),
  -- An expense whose reference number is a real bill or AP payment reference is
  -- almost certainly that same payment entered a second time.
  ref_match AS (
    SELECT
      er.expense_id,
      'liability_payment'::text AS suspected_type,
      0.95::numeric AS confidence,
      COALESCE('Bill ' || sb.bill_number, 'AP payment ref ' || ap.reference_number) AS evidence
    FROM expense_rows er
    LEFT JOIN supplier_bill sb
      ON er.reference_no IS NOT NULL
     AND TRIM(er.reference_no) <> ''
     AND LOWER(TRIM(sb.bill_number)) = LOWER(TRIM(er.reference_no))
    LEFT JOIN ap_payment ap
      ON er.reference_no IS NOT NULL
     AND TRIM(er.reference_no) <> ''
     AND LOWER(TRIM(ap.reference_number)) = LOWER(TRIM(er.reference_no))
    WHERE sb.bill_id IS NOT NULL OR ap.payment_id IS NOT NULL
  ),
  -- Same vendor, similar amount, around the same date as a bill that was still
  -- open: looks like settling that bill rather than a new operating cost.
  bill_match AS (
    SELECT DISTINCT ON (er.expense_id)
      er.expense_id,
      'liability_payment'::text AS suspected_type,
      0.75::numeric AS confidence,
      'Open bill ' || sb.bill_number || ' (' || s.supplier_name || ', outstanding '
        || ROUND(sb.total_amount - sb.amount_paid, 2) || ')' AS evidence
    FROM expense_rows er
    JOIN supplier_norm s
      ON er.payee_core <> ''
     AND similarity(er.payee_core, s.core) >= $1
    JOIN supplier_bill sb
      ON sb.supplier_id = s.supplier_id
     AND sb.status IN ('Unpaid', 'Partially Paid')
     AND sb.bill_date BETWEEN er.expense_date_raw - ($2 || ' days')::interval
                          AND er.expense_date_raw + ($2 || ' days')::interval
     AND ABS(er.amount - (sb.total_amount - sb.amount_paid))
           <= GREATEST((sb.total_amount - sb.amount_paid) * $3, 1)
    ORDER BY er.expense_id, similarity(er.payee_core, s.core) DESC
  ),
  -- A vendor this store actually receives stock from, paid around the time of a
  -- real delivery, filed under a catch-all category: likely a stock purchase.
  inventory_match AS (
    SELECT DISTINCT ON (er.expense_id)
      er.expense_id,
      'inventory_purchase'::text AS suspected_type,
      0.5::numeric AS confidence,
      'Goods receipt ' || gr.grn_number || ' from ' || s.supplier_name
        || ' on ' || TO_CHAR(gr.receipt_date, 'YYYY-MM-DD') AS evidence
    FROM expense_rows er
    JOIN supplier_norm s
      ON er.payee_core <> ''
     AND similarity(er.payee_core, s.core) >= $1
    JOIN goods_receipt gr
      ON gr.supplier_id = s.supplier_id
     AND gr.receipt_date BETWEEN er.expense_date_raw - ($2 || ' days')::interval
                             AND er.expense_date_raw + ($2 || ' days')::interval
    WHERE er.category_name IN ('Office Supplies', 'Miscellaneous', 'Repairs & Maintenance')
    ORDER BY er.expense_id, similarity(er.payee_core, s.core) DESC
  ),
  -- Keyword heuristics. Weakest evidence: wording only, no corroborating record.
  capex_match AS (
    SELECT
      er.expense_id,
      'fixed_asset'::text AS suspected_type,
      0.35::numeric AS confidence,
      'Capex wording with amount ' || ROUND(er.amount, 2) AS evidence
    FROM expense_rows er
    WHERE er.amount > $4
      AND er.haystack ~ '(equipment|machine|compressor|welding|vehicle|motorcycle|truck|computer|laptop|printer|furniture|shelving|renovation|construction|aircon|air.?con|generator|jack|lifter)'
  ),
  drawing_match AS (
    SELECT
      er.expense_id,
      'owner_drawing'::text AS suspected_type,
      0.35::numeric AS confidence,
      'Personal-withdrawal wording' AS evidence
    FROM expense_rows er
    WHERE er.category_name = 'Miscellaneous'
      AND er.haystack ~ '(owner|personal|drawing|withdraw|sarili|kaugalingon|pang.?personal)'
  ),
  all_hits AS (
    SELECT * FROM ref_match
    UNION ALL SELECT * FROM bill_match
    UNION ALL SELECT * FROM inventory_match
    UNION ALL SELECT * FROM capex_match
    UNION ALL SELECT * FROM drawing_match
  ),
  -- One row per expense: the strongest signal wins, so a reference-number match
  -- is not diluted by a weaker keyword hit on the same row.
  best_hit AS (
    SELECT DISTINCT ON (expense_id)
      expense_id, suspected_type, confidence, evidence
    FROM all_hits
    ORDER BY expense_id, confidence DESC
  )
  SELECT
    er.expense_id,
    er.expense_date,
    er.payee,
    er.amount,
    er.category_name,
    er.reference_no,
    b.suspected_type,
    b.confidence,
    b.evidence
  FROM best_hit b
  JOIN expense_rows er ON er.expense_id = b.expense_id
  WHERE b.confidence >= $5
  ORDER BY b.confidence DESC, er.expense_date DESC;
`;

const TOTAL_QUERY = `
  SELECT COUNT(*)::integer AS total
  FROM expense
  WHERE is_void = false AND payroll_run_id IS NULL
`;

(async function run() {
  try {
    const [{ rows }, totalRes] = await Promise.all([
      db.query(QUERY, [NAME_SIMILARITY, DATE_WINDOW_DAYS, AMOUNT_TOLERANCE, capexMin, threshold]),
      db.query(TOTAL_QUERY),
    ]);

    const totalChecked = totalRes.rows[0]?.total || 0;
    const flagged = rows.map((r) => ({
      expense_id: r.expense_id,
      expense_date: r.expense_date,
      payee: r.payee,
      amount: parseFloat(r.amount),
      category: r.category_name,
      reference_no: r.reference_no,
      suspected_type: r.suspected_type,
      confidence: parseFloat(r.confidence),
      evidence: r.evidence,
    }));

    if (jsonOutput) {
      console.log(JSON.stringify({
        checked_at: new Date().toISOString(),
        threshold,
        capex_min: capexMin,
        expenses_checked: totalChecked,
        expenses_flagged: flagged.length,
        flagged,
      }, null, 2));
    } else {
      const byType = flagged.reduce((acc, f) => {
        acc[f.suspected_type] = (acc[f.suspected_type] || 0) + 1;
        return acc;
      }, {});

      console.log(`Expense misclassification audit — ${new Date().toISOString()}`);
      console.log(`Threshold: ${threshold} | Capex minimum: ${capexMin}`);
      console.log(`Expenses checked: ${totalChecked}`);
      console.log(`Expenses flagged: ${flagged.length}`);
      for (const [type, count] of Object.entries(byType)) {
        console.log(`  ${type}: ${count}`);
      }
      if (flagged.length > 0) {
        console.log('');
        console.log('expense_id | date | payee | amount | category | suspected_type | confidence | evidence');
        for (const f of flagged) {
          console.log(
            `${f.expense_id} | ${f.expense_date} | ${f.payee || '-'} | ${f.amount} | ${f.category} | ${f.suspected_type} | ${f.confidence} | ${f.evidence}`
          );
        }
        console.log('');
        console.log('Every row above is a heuristic. Confirm against the source records before changing anything.');
      }
    }

    process.exitCode = flagged.length > 0 ? 1 : 0;
  } catch (err) {
    console.error('Expense misclassification audit failed:', err && err.stack ? err.stack : err);
    process.exitCode = 2;
  } finally {
    process.exit();
  }
})();
