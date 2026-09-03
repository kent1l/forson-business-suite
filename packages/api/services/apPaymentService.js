'use strict';

const apLedgerService = require('./apLedgerService');

function badRequest(message, code) {
  const err = new Error(message);
  err.status = 400;
  if (code) err.code = code;
  return err;
}

/**
 * A cheque is not settled by handing it over — it still has to be deposited and
 * can clear, bounce, go stale, or be replaced. Payments made with one therefore
 * take the outbound cheque issuance path (apPdcService.issueOutboundCheque), so
 * a cheque_records row exists as the physical instrument of record.
 *
 * The predicate matches the one issueOutboundCheque uses to find the cheque
 * payment method, so the two can never disagree about what counts as a cheque.
 */
function isChequeMethod(method) {
  if (!method) return false;
  return method.type === 'cheque' || ['cheque', 'pdc'].includes(method.code);
}

/**
 * Methods usable for an outbound AP disbursement. Distinct from the POS/AR
 * `enabled` flag — see 20260820_02_ap_direct_payment_methods.sql.
 *
 * `requires_cheque_instrument` tells the caller which rows settle through the
 * cheque lifecycle rather than immediately, so the payment form can ask for the
 * bank account, cheque number and cheque date those need.
 *
 * Cheque rows are withheld from callers who cannot issue an outbound cheque:
 * issuing one is an `ap-pdc:manage` action, deliberately kept separate from
 * `ap:manage` (see 20260813_03_seed_ap_monitoring_permissions_and_settings.sql),
 * so offering the option to someone the issue endpoint will reject is a dead end.
 */
async function getApPaymentMethods(db, { canIssueCheques = true } = {}) {
  const { rows } = await db.query(
    `SELECT method_id, code, name, type, config
       FROM payment_methods
      WHERE ap_enabled = true AND enabled = true
      ORDER BY sort_order, name`
  );
  return rows
    .filter((m) => canIssueCheques || !isChequeMethod(m))
    .map((m) => ({ ...m, requires_cheque_instrument: isChequeMethod(m) }));
}

/**
 * Record a supplier payment settled outside the cheque lifecycle — cash, bank
 * transfer, e-wallet. The row is written as pdc_status 'CLEARED' because the
 * money has already moved; there is no instrument left to clear.
 *
 * `settlementDate` is the date the money actually left, which is not
 * necessarily today: the common case is a payment made days ago that nobody got
 * around to recording. It may not be in the future (we cannot assert money moved
 * that hasn't) and may not predate the bills it settles. Correcting it after the
 * fact goes through transactionDateService (kind 'ap_payment'), which requires
 * the transaction:change_date permission and a written reason.
 *
 * @param {import('pg').PoolClient} client — caller MUST have issued BEGIN
 */
async function recordDirectPayment(client, {
  supplierId,
  methodId,
  amount,
  settlementDate = null,
  referenceNumber = null,
  bankAccountId = null,
  notes = null,
  allocations = null,
  userId = null,
  overridePaymentHold = false,
}) {
  const parsedAmount = Number(amount);
  if (!supplierId) throw badRequest('supplierId is required');
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw badRequest('A positive payment amount is required');
  }

  const { rows: [method] } = await client.query(
    `SELECT method_id, code, name, type, config FROM payment_methods
      WHERE method_id = $1 AND ap_enabled = true AND enabled = true`,
    [methodId]
  );
  if (!method) {
    throw badRequest('That payment method is not available for supplier payments');
  }
  // A cheque handed to a supplier has not settled anything yet. Recording it
  // here would create a CLEARED payment with no instrument to deposit, clear or
  // bounce, so it must go through apPdcService.issueOutboundCheque instead.
  if (isChequeMethod(method)) {
    throw badRequest(
      'Cheque payments must be issued as an outbound cheque so the instrument can be cleared or bounced later.',
      'CHEQUE_REQUIRES_ISSUANCE'
    );
  }

  const config = method.config || {};
  const trimmedReference = typeof referenceNumber === 'string' ? referenceNumber.trim() : null;
  if (config.requires_reference && !trimmedReference) {
    const label = config.reference_label || 'Reference number';
    throw badRequest(`${label} is required for ${method.name} payments`);
  }

  // Resolve the settlement date in the database's timezone (pinned to
  // Asia/Manila) rather than the Node process's, so "today" means the same day
  // here as it does in every SQL comparison below.
  const { rows: [dates] } = await client.query(
    `SELECT COALESCE($1::date, CURRENT_DATE) AS settled_on, CURRENT_DATE AS today`,
    [settlementDate || null]
  );
  if (dates.settled_on > dates.today) {
    throw badRequest('Settlement date cannot be in the future');
  }

  const { rows: [supplier] } = await client.query(
    `SELECT supplier_id, payment_hold, payment_hold_reason FROM supplier WHERE supplier_id = $1`,
    [supplierId]
  );
  if (!supplier) throw badRequest(`Supplier #${supplierId} not found`);
  if (supplier.payment_hold && !overridePaymentHold) {
    const err = new Error(
      `Supplier is on payment hold${supplier.payment_hold_reason ? ': ' + supplier.payment_hold_reason : ''}. `
      + 'Pass override_payment_hold=true with ap:manage permission to proceed anyway.'
    );
    err.code = 'PAYMENT_HOLD_BLOCKED';
    err.status = 409;
    throw err;
  }

  const resolvedAllocations = await resolveAllocations(client, {
    supplierId, amount: parsedAmount, allocations, settledOn: dates.settled_on,
  });

  const { rows: [payment] } = await client.query(
    `INSERT INTO ap_payment
       (supplier_id, employee_id, payment_date, amount, method_id, reference_number,
        notes, pdc_status, bank_account_id, created_by)
     VALUES ($1, $2, $3::date, $4, $5, $6, $7, 'CLEARED', $8, $9)
     RETURNING payment_id, payment_date`,
    [supplierId, userId, dates.settled_on, parsedAmount, method.method_id,
     trimmedReference, notes || null, bankAccountId || null, userId]
  );

  // Inserting allocations fires update_supplier_bill_balance_after_payment,
  // which recomputes each bill's amount_paid/status from every CLEARED payment
  // allocated to it — so the bill rows are not updated here.
  for (const alloc of resolvedAllocations) {
    await client.query(
      `INSERT INTO ap_payment_allocation (payment_id, bill_id, amount_allocated) VALUES ($1, $2, $3)`,
      [payment.payment_id, alloc.billId, alloc.amount]
    );
  }

  // The ap_ledger safety-net trigger only fires when an ap_payment *transitions*
  // into CLEARED on UPDATE. This row is born CLEARED, so nothing would ever post
  // the settlement entry unless we do it here.
  await apLedgerService.appendEntry(client, {
    supplierId,
    paymentId: payment.payment_id,
    entryType: 'PAYMENT_SETTLED',
    amount: -parsedAmount,
    paymentChannel: method.code,
    referenceNo: trimmedReference,
    notes: notes || `${method.name} payment to supplier`,
    createdBy: userId,
    entryDate: dates.settled_on,
  });

  return {
    paymentId: payment.payment_id,
    settlementDate: dates.settled_on,
    method: method.code,
    amount: parsedAmount,
    allocations: resolvedAllocations,
  };
}

/**
 * Turns the caller's requested allocations into validated {billId, amount} pairs.
 * When none are supplied, applies the payment oldest-due-first across the
 * supplier's open bills. Locks each bill FOR UPDATE so two concurrent payments
 * cannot both allocate against the same remaining balance.
 */
async function resolveAllocations(client, { supplierId, amount, allocations, settledOn }) {
  const requested = Array.isArray(allocations) ? allocations.filter((a) => a && a.bill_id != null) : null;

  const billIds = requested?.length
    ? requested.map((a) => Number(a.bill_id))
    : null;

  // A voided bill is not a liability any more, so it must never absorb a payment
  // — neither by auto-allocation nor by being named explicitly.
  const { rows: bills } = await client.query(
    `SELECT bill_id, bill_number, bill_date, total_amount, amount_paid
       FROM supplier_bill
      WHERE supplier_id = $1
        AND status != 'Void'
        AND ($2::int[] IS NULL OR bill_id = ANY($2::int[]))
        AND ($2::int[] IS NOT NULL OR status != 'Paid')
      ORDER BY due_date NULLS LAST, bill_date, bill_id
      FOR UPDATE`,
    [supplierId, billIds]
  );

  if (billIds) {
    const found = new Set(bills.map((b) => b.bill_id));
    const missing = billIds.filter((id) => !found.has(id));
    if (missing.length) {
      throw badRequest(`Bill(s) not found, voided, or not owned by this supplier: ${missing.join(', ')}`);
    }
  }

  // A payment cannot settle a liability that did not exist yet on the day the
  // money moved — that would produce a negative running balance in the ledger.
  // `settledOn` must be a Date, not a date string: bill_date comes back from pg as
  // a Date, and a Date-vs-string comparison is silently always false. Callers get
  // one by casting through the database (see recordDirectPayment).
  const premature = bills.filter((b) => b.bill_date > settledOn);
  if (premature.length) {
    const refs = premature.map((b) => b.bill_number || `#${b.bill_id}`).join(', ');
    throw badRequest(`This payment is dated before the bill date of: ${refs}`);
  }

  const outstandingOf = (bill) => Number(bill.total_amount) - Number(bill.amount_paid);
  const resolved = [];

  if (requested?.length) {
    const byId = new Map(bills.map((b) => [b.bill_id, b]));
    let total = 0;
    for (const entry of requested) {
      const bill = byId.get(Number(entry.bill_id));
      const applied = Number(entry.amount);
      if (!Number.isFinite(applied) || applied <= 0) {
        throw badRequest(`Invalid amount allocated to bill ${bill.bill_number || bill.bill_id}`);
      }
      const outstanding = outstandingOf(bill);
      if (applied - outstanding > 0.005) {
        throw badRequest(
          `Cannot allocate ${applied.toFixed(2)} to bill ${bill.bill_number || bill.bill_id}; only ${outstanding.toFixed(2)} is outstanding`
        );
      }
      total += applied;
      resolved.push({ billId: bill.bill_id, billNumber: bill.bill_number, amount: applied });
    }
    if (Math.abs(total - amount) > 0.005) {
      throw badRequest(
        `Allocations total ${total.toFixed(2)} but the payment is ${amount.toFixed(2)}. `
        + 'Every peso of a payment must be applied to a bill.'
      );
    }
    return resolved;
  }

  let remaining = amount;
  for (const bill of bills) {
    if (remaining <= 0.005) break;
    const applied = Math.min(outstandingOf(bill), remaining);
    if (applied <= 0) continue;
    resolved.push({ billId: bill.bill_id, billNumber: bill.bill_number, amount: Number(applied.toFixed(2)) });
    remaining -= applied;
  }

  // Anything left over would post to ap_ledger as a settlement with no bill
  // behind it, silently turning a typo into a supplier prepayment and driving
  // the balance negative. Supplier advances are not a supported concept here,
  // so refuse rather than absorb it.
  if (remaining > 0.005) {
    const payable = amount - remaining;
    throw badRequest(
      `Payment of ${amount.toFixed(2)} exceeds this supplier's total outstanding balance of ${payable.toFixed(2)}. `
      + 'Record a bill for the difference first, or lower the amount.'
    );
  }
  return resolved;
}

/**
 * Cross-supplier register of every payment made to suppliers, newest first.
 * `channel` narrows to 'direct' (cash/transfer/e-wallet, no instrument) or
 * 'cheque' (backed by a cheque_records row whose lifecycle the Treasury desk
 * owns); anything else returns both.
 */
async function listPayments(db, { supplierId = null, channel = 'all', limit = 100 } = {}) {
  const chequeOnly = channel === 'cheque' ? true : channel === 'direct' ? false : null;
  const { rows } = await db.query(
    `SELECT ap.payment_id, ap.supplier_id, s.supplier_name, ap.payment_date, ap.amount,
            ap.reference_number, ap.notes, ap.pdc_status, ap.cheque_record_id,
            ap.bank_account_id, ba.account_name AS bank_account_name,
            pm.code AS method_code, pm.name AS method_name,
            e.first_name || ' ' || e.last_name AS recorded_by_name,
            COALESCE(alloc.applied, 0) AS applied_amount,
            COALESCE(alloc.bills, '[]'::json) AS bills
       FROM ap_payment ap
       JOIN supplier s ON s.supplier_id = ap.supplier_id
       LEFT JOIN payment_methods pm ON pm.method_id = ap.method_id
       LEFT JOIN bank_account ba ON ba.bank_account_id = ap.bank_account_id
       LEFT JOIN employee e ON e.employee_id = ap.created_by
       LEFT JOIN LATERAL (
         SELECT SUM(a.amount_allocated) AS applied,
                json_agg(json_build_object(
                  'bill_id', sb.bill_id, 'bill_number', sb.bill_number, 'amount', a.amount_allocated
                ) ORDER BY sb.bill_id) AS bills
           FROM ap_payment_allocation a
           JOIN supplier_bill sb ON sb.bill_id = a.bill_id
          WHERE a.payment_id = ap.payment_id
       ) alloc ON true
      WHERE ($1::int IS NULL OR ap.supplier_id = $1::int)
        AND ($2::boolean IS NULL
             OR ($2::boolean AND ap.cheque_record_id IS NOT NULL)
             OR (NOT $2::boolean AND ap.cheque_record_id IS NULL))
      ORDER BY ap.payment_date DESC, ap.payment_id DESC
      LIMIT $3`,
    [supplierId, chequeOnly, Math.min(Number(limit) || 100, 500)]
  );
  return rows;
}

module.exports = {
  getApPaymentMethods,
  isChequeMethod,
  recordDirectPayment,
  resolveAllocations,
  listPayments,
};
