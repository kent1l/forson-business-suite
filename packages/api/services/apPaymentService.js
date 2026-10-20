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
 *
 * Active pending cheques (ISSUED, HELD_FOR_RELEASE, DEPOSITED, BOUNCED, STALE)
 * reserve bill balance so two issued cheques cannot promise the same payable.
 * `excludePaymentId` excludes the retiring payment when revalidating a replacement.
 */
async function resolveAllocations(client, {
  supplierId,
  amount,
  allocations,
  settledOn,
  excludePaymentId = null,
  checkSettledDateAgainstBill = true,
}) {
  const requested = Array.isArray(allocations) ? allocations.filter((a) => a && a.bill_id != null) : null;

  const billIds = requested?.length
    ? requested.map((a) => Number(a.bill_id)).sort((a, b) => a - b)
    : null;

  // Lock supplier first, then bills in deterministic bill_id order to prevent deadlocks,
  // then order by due_date/bill_date for allocation priority.
  await client.query(`SELECT supplier_id FROM supplier WHERE supplier_id = $1 FOR UPDATE`, [supplierId]);

  const { rows: lockedBills } = await client.query(
    `SELECT bill_id, bill_number, supplier_document_no, bill_date, due_date, total_amount, amount_paid, status
       FROM supplier_bill
      WHERE supplier_id = $1
        AND status != 'Void'
        AND ($2::int[] IS NULL OR bill_id = ANY($2::int[]))
        AND ($2::int[] IS NOT NULL OR status != 'Paid')
      ORDER BY bill_id ASC
      FOR UPDATE`,
    [supplierId, billIds]
  );

  if (billIds) {
    const found = new Set(lockedBills.map((b) => b.bill_id));
    const missing = billIds.filter((id) => !found.has(id));
    if (missing.length) {
      throw badRequest(
        `Bill(s) not found, voided, or not owned by this supplier: ${missing.join(', ')}`,
        'BILL_INVALID_OR_OWNERSHIP_CHANGED'
      );
    }
  }

  // Compute active scheduled amounts per bill (excluding CLEARED, which is already in amount_paid,
  // and excluding VOID, REPLACED, DELETED, plus any excludePaymentId being replaced).
  const targetBillIds = lockedBills.map((b) => b.bill_id);
  const scheduledMap = new Map();
  if (targetBillIds.length > 0) {
    const { rows: schedRows } = await client.query(
      `SELECT apa.bill_id, COALESCE(SUM(apa.amount_allocated), 0) AS scheduled_amount
         FROM ap_payment_allocation apa
         JOIN ap_payment ap ON ap.payment_id = apa.payment_id
         LEFT JOIN cheque_records cr ON cr.id = ap.cheque_record_id
        WHERE apa.bill_id = ANY($1::int[])
          AND ($2::int IS NULL OR ap.payment_id <> $2::int)
          AND ap.pdc_status IN ('ISSUED', 'HELD_FOR_RELEASE', 'DEPOSITED', 'BOUNCED', 'STALE')
          AND (cr.id IS NULL OR cr.status NOT IN ('VOID', 'REPLACED', 'DELETED'))
        GROUP BY apa.bill_id`,
      [targetBillIds, excludePaymentId]
    );
    for (const r of schedRows) {
      scheduledMap.set(Number(r.bill_id), Number(r.scheduled_amount) || 0);
    }
  }

  const bills = [...lockedBills].sort((a, b) => {
    const dA = a.due_date ? new Date(a.due_date).getTime() : Infinity;
    const dB = b.due_date ? new Date(b.due_date).getTime() : Infinity;
    if (dA !== dB) return dA - dB;
    const bA = a.bill_date ? new Date(a.bill_date).getTime() : 0;
    const bB = b.bill_date ? new Date(b.bill_date).getTime() : 0;
    if (bA !== bB) return bA - bB;
    return a.bill_id - b.bill_id;
  });

  if (checkSettledDateAgainstBill && settledOn) {
    const premature = bills.filter((b) => b.bill_date > settledOn);
    if (premature.length) {
      const refs = premature.map((b) => b.supplier_document_no || b.bill_number || `#${b.bill_id}`).join(', ');
      throw badRequest(`This payment is dated before the bill date of: ${refs}`, 'PAYMENT_BEFORE_BILL_DATE');
    }
  }

  const outstandingOf = (bill) => Math.max(0, Number(bill.total_amount) - Number(bill.amount_paid));
  const scheduledOf = (bill) => scheduledMap.get(bill.bill_id) || 0;
  const availableOf = (bill) => Math.max(0, outstandingOf(bill) - scheduledOf(bill));
  const resolved = [];

  if (requested?.length) {
    const byId = new Map(bills.map((b) => [b.bill_id, b]));
    let total = 0;
    for (const entry of requested) {
      const bill = byId.get(Number(entry.bill_id));
      const applied = Number(entry.amount ?? entry.amount_allocated);
      if (!Number.isFinite(applied) || applied <= 0) {
        throw badRequest(`Invalid amount allocated to bill ${bill.supplier_document_no || bill.bill_number || bill.bill_id}`, 'INVALID_ALLOCATION_AMOUNT');
      }
      const outstanding = outstandingOf(bill);
      const scheduled = scheduledOf(bill);
      const available = availableOf(bill);
      if (applied - available > 0.005) {
        const detail = scheduled > 0.005
          ? `only ${available.toFixed(2)} is available (${outstanding.toFixed(2)} outstanding, ${scheduled.toFixed(2)} already scheduled by active cheques)`
          : `only ${outstanding.toFixed(2)} is outstanding`;
        throw badRequest(
          `Cannot allocate ${applied.toFixed(2)} to bill ${bill.supplier_document_no || bill.bill_number || bill.bill_id}; ${detail}`,
          'ALLOCATION_EXCEEDS_AVAILABLE'
        );
      }
      total += applied;
      resolved.push({ billId: bill.bill_id, billNumber: bill.bill_number, amount: Number(applied.toFixed(2)) });
    }
    if (Math.abs(total - amount) > 0.005) {
      throw badRequest(
        `Allocations total ${total.toFixed(2)} but the payment is ${amount.toFixed(2)}. `
        + 'Every peso of a payment must be applied to a bill.',
        'ALLOCATION_SUM_MISMATCH'
      );
    }
    return resolved;
  }

  let remaining = amount;
  for (const bill of bills) {
    if (remaining <= 0.005) break;
    const avail = availableOf(bill);
    const applied = Math.min(avail, remaining);
    if (applied <= 0.005) continue;
    resolved.push({ billId: bill.bill_id, billNumber: bill.bill_number, amount: Number(applied.toFixed(2)) });
    remaining -= applied;
  }

  if (remaining > 0.005) {
    const payable = amount - remaining;
    throw badRequest(
      `Payment of ${amount.toFixed(2)} exceeds this supplier's available unscheduled balance of ${payable.toFixed(2)}. `
      + 'Record a bill for the difference first, or lower the amount.',
      'PAYMENT_EXCEEDS_AVAILABLE_BALANCE'
    );
  }
  return resolved;
}

/**
 * Cross-supplier register of every payment made to suppliers, newest first.
 * `channel` narrows to 'direct' (cash/transfer/e-wallet, no instrument) or
 * 'cheque' (backed by a cheque_records row whose lifecycle the Treasury desk
 * owns); anything else returns both.
 * By default, REPLACED/VOID/DELETED attempts are excluded unless `includeHistory`
 * or `includeDeleted` is set (or a specific `paymentId` is requested).
 */
async function listPayments(db, {
  supplierId = null,
  paymentId = null,
  channel = 'all',
  includeHistory = false,
  includeDeleted = false,
  limit = 100,
} = {}) {
  const chequeOnly = channel === 'cheque' ? true : channel === 'direct' ? false : null;
  const { rows } = await db.query(
    `SELECT ap.payment_id, ap.supplier_id, s.supplier_name, ap.payment_date, ap.amount,
            ap.reference_number, ap.notes, ap.pdc_status, ap.cheque_record_id,
            ap.bank_account_id, ba.account_name AS bank_account_name,
            ba.bank_name,
            pm.code AS method_code, pm.name AS method_name,
            e.first_name || ' ' || e.last_name AS recorded_by_name,
            cr.cheque_number, cr.cheque_date, cr.status AS cheque_status,
            cr.replaces_cheque_id, cr.replaced_by_cheque_id,
            prev_cr.cheque_number AS replaces_cheque_number,
            next_cr.cheque_number AS replaced_by_cheque_number,
            ap.void_reason, ap.deleted_reason, ap.deleted_at,
            COALESCE(alloc.applied, 0) AS applied_amount,
            COALESCE(alloc.bills, '[]'::json) AS bills
       FROM ap_payment ap
       JOIN supplier s ON s.supplier_id = ap.supplier_id
       LEFT JOIN payment_methods pm ON pm.method_id = ap.method_id
       LEFT JOIN bank_account ba ON ba.bank_account_id = ap.bank_account_id
       LEFT JOIN employee e ON e.employee_id = ap.created_by
       LEFT JOIN cheque_records cr ON cr.id = ap.cheque_record_id
       LEFT JOIN cheque_records prev_cr ON prev_cr.id = cr.replaces_cheque_id
       LEFT JOIN cheque_records next_cr ON next_cr.id = cr.replaced_by_cheque_id
       LEFT JOIN LATERAL (
         SELECT SUM(a.amount_allocated) AS applied,
                json_agg(json_build_object(
                  'bill_id', sb.bill_id, 'bill_number', sb.bill_number, 'supplier_document_no', sb.supplier_document_no, 'amount', a.amount_allocated
                ) ORDER BY sb.bill_id) AS bills
           FROM ap_payment_allocation a
           JOIN supplier_bill sb ON sb.bill_id = a.bill_id
          WHERE a.payment_id = ap.payment_id
       ) alloc ON true
      WHERE ($1::int IS NULL OR ap.supplier_id = $1::int)
        AND ($2::boolean IS NULL
             OR ($2::boolean AND ap.cheque_record_id IS NOT NULL)
             OR (NOT $2::boolean AND ap.cheque_record_id IS NULL))
        AND ($3::int IS NULL OR ap.payment_id = $3::int)
        AND (
          $3::int IS NOT NULL
          OR (
            ($5::boolean OR ap.pdc_status NOT IN ('REPLACED', 'VOID'))
            AND ($6::boolean OR ap.pdc_status <> 'DELETED')
          )
        )
      ORDER BY ap.payment_date DESC, ap.payment_id DESC
      LIMIT $4`,
    [
      supplierId,
      chequeOnly,
      paymentId,
      Math.min(Number(limit) || 100, 500),
      Boolean(includeHistory),
      Boolean(includeDeleted),
    ]
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
