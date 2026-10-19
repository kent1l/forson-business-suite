'use strict';

const crypto = require('node:crypto');
const apLedgerService = require('./apLedgerService');
const apPaymentService = require('./apPaymentService');
const { computePdcMaturity } = require('./pdcService');
const periodLockService = require('./periodLockService');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIN_OPERATING_YEAR = 2000;
const MAX_OPERATING_YEAR = 2100;

function serviceError(status, code, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  Object.assign(err, extra);
  return err;
}

function validateAndNormalizeChequeNumber(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : String(raw || '').trim();
  if (!trimmed) {
    throw serviceError(400, 'CHEQUE_NUMBER_REQUIRED', 'Cheque number is required.');
  }
  if (trimmed.length > 50) {
    throw serviceError(400, 'CHEQUE_NUMBER_TOO_LONG', 'Cheque number must be at most 50 characters.');
  }
  if (/[\r\n\t]/.test(trimmed)) {
    throw serviceError(400, 'INVALID_CHEQUE_NUMBER', 'Cheque number contains invalid control characters.');
  }
  return trimmed;
}

function validateOperatingDate(dateVal, label = 'Cheque date') {
  if (!dateVal) {
    throw serviceError(400, 'DATE_REQUIRED', `${label} is required.`);
  }
  const str = typeof dateVal === 'string'
    ? dateVal.trim().slice(0, 10)
    : (dateVal instanceof Date && !Number.isNaN(dateVal.getTime())
      ? dateVal.toISOString().slice(0, 10)
      : String(dateVal).trim().slice(0, 10));
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw serviceError(400, 'INVALID_DATE_FORMAT', `${label} must be a valid YYYY-MM-DD date.`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    throw serviceError(400, 'INVALID_CALENDAR_DATE', `${label} (${str}) is not a valid calendar date.`);
  }
  if (year < MIN_OPERATING_YEAR || year > MAX_OPERATING_YEAR) {
    throw serviceError(
      400,
      'DATE_OUT_OF_OPERATING_RANGE',
      `${label} year (${match[1]}) is outside the supported operating range (${MIN_OPERATING_YEAR}–${MAX_OPERATING_YEAR}). Please verify and enter the full 4-digit year.`
    );
  }
  return str;
}

/**
 * Idempotency helper for replace/delete/void/verify/fail/redeposit mutations.
 */
async function beginLifecycleRequest(client, {
  requestId,
  actorId,
  action,
  targetType,
  targetId,
  payload,
}) {
  if (!requestId) return null;
  const trimmed = String(requestId).trim();
  if (!UUID_REGEX.test(trimmed)) {
    throw serviceError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be a valid UUID.');
  }
  const payloadHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ action, targetType, targetId: Number(targetId), payload }))
    .digest('hex');

  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`cheque_req:${trimmed}`]);

  const { rows } = await client.query(
    `SELECT actor_id, action, target_type, target_id, payload_hash, status_code, response
       FROM cheque_lifecycle_request
      WHERE request_id = $1`,
    [trimmed]
  );

  if (rows.length > 0) {
    const prev = rows[0];
    if (
      Number(prev.actor_id) !== Number(actorId) ||
      prev.action !== action ||
      prev.target_type !== targetType ||
      Number(prev.target_id) !== Number(targetId) ||
      prev.payload_hash !== payloadHash ||
      prev.status_code === 202
    ) {
      throw serviceError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This Idempotency-Key was already used with different parameters or by another user.'
      );
    }
    const replay = new Error('Idempotent request replay');
    replay.replay = { status: prev.status_code, body: prev.response };
    throw replay;
  }

  await client.query(
    `INSERT INTO cheque_lifecycle_request
       (request_id, actor_id, action, target_type, target_id, payload_hash, status_code, response)
     VALUES ($1, $2, $3, $4, $5, $6, 202, '{"pending":true}'::jsonb)`,
    [trimmed, actorId, action, targetType, Number(targetId), payloadHash]
  );

  return trimmed;
}

async function finishLifecycleRequest(client, requestId, statusCode, responseBody) {
  if (!requestId) return;
  await client.query(
    `UPDATE cheque_lifecycle_request
        SET status_code = $2, response = $3::jsonb
      WHERE request_id = $1`,
    [requestId, statusCode, JSON.stringify(responseBody)]
  );
}

/**
 * Read PDC_STALE_DAYS / PDC_MAX_BOUNCE_ATTEMPTS from the settings table.
 */
async function getPdcSettings(db) {
  const { rows } = await db.query(
    `SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('PDC_STALE_DAYS', 'PDC_MAX_BOUNCE_ATTEMPTS')`
  );
  const map = rows.reduce((acc, r) => { acc[r.setting_key] = r.setting_value; return acc; }, {});
  return {
    staleDays: parseInt(map.PDC_STALE_DAYS || '180', 10),
    maxBounceAttempts: parseInt(map.PDC_MAX_BOUNCE_ATTEMPTS || '2', 10),
  };
}

function resolveChequeTypeForAudit(cr) {
  if (cr?.ap_payment_id || cr?.purpose_type === 'SUPPLIER_PAYMENT') return 'OUTBOUND_SUPPLIER';
  if (cr?.expense_id || ['LOAN_PAYMENT', 'RENT', 'OTHER_EXPENSE'].includes(cr?.purpose_type)) return 'OUTBOUND_EXPENSE';
  return 'OUTBOUND_STANDALONE';
}

/**
 * Record a mandatory, transactional audit log entry in cheque_clearance_log for an outbound cheque.
 * Never swallows errors — if the audit insert fails, the enclosing transaction rolls back.
 */
async function logOutboundClearanceEvent(client, {
  chequeType = 'OUTBOUND_SUPPLIER',
  apPaymentId = null,
  expenseId = null,
  chequeRecordId = null,
  supplierId = null,
  bankAccountId = null,
  action,
  attemptNumber = 1,
  bounceReason = null,
  bounceFee = 0,
  notes = null,
  metadata = null,
  createdBy = null,
}) {
  await client.query(
    `INSERT INTO cheque_clearance_log (
      cheque_type, ap_payment_id, expense_id, cheque_record_id, supplier_id, bank_account_id,
      action, attempt_number, bounce_reason, bounce_fee, notes, metadata, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)`,
    [
      chequeType || 'OUTBOUND_SUPPLIER',
      apPaymentId,
      expenseId,
      chequeRecordId,
      supplierId,
      bankAccountId,
      action,
      attemptNumber,
      bounceReason,
      bounceFee,
      notes,
      metadata ? JSON.stringify(metadata) : null,
      createdBy,
    ]
  );
}

/**
 * Look up an existing non-DELETED cheque on the same bank account + cheque number
 * so duplicate-number errors can link directly to the conflicting record.
 */
async function findConflictingCheque(client, bankAccountId, chequeNumber, excludeChequeId = null) {
  if (!bankAccountId || !chequeNumber) return null;
  const { rows } = await client.query(
    `SELECT cr.id AS cheque_record_id, cr.cheque_number, cr.status, cr.is_deleted,
            cr.payee, cr.amount, TO_CHAR(cr.cheque_date, 'YYYY-MM-DD') AS cheque_date,
            cr.ap_payment_id, cr.expense_id, ba.account_name, ba.bank_name
       FROM cheque_records cr
       LEFT JOIN bank_account ba ON ba.bank_account_id = cr.bank_account_id
      WHERE cr.bank_account_id = $1
        AND cr.cheque_number = $2
        AND cr.status <> 'DELETED'
        AND ($3::int IS NULL OR cr.id <> $3::int)
      ORDER BY cr.id DESC
      LIMIT 1`,
    [bankAccountId, chequeNumber, excludeChequeId]
  );
  return rows[0] || null;
}

/**
 * Suggest the next available cheque number for a bank account:
 * - Uses the last real (non-DELETED, non-legacy-hidden) numeric cheque issued on that account as baseline.
 * - Falls back to any non-DELETED numeric cheque if all were hidden.
 * - Steps forward past any already-reserved (non-DELETED) numbers on that account.
 * - Preserves leading zeros.
 */
async function suggestNextChequeNumber(db, bankAccountId) {
  const { rows } = await db.query(
    `SELECT cheque_number, is_deleted
       FROM cheque_records
      WHERE bank_account_id = $1
        AND cheque_number IS NOT NULL
        AND status <> 'DELETED'
      ORDER BY is_deleted ASC, id DESC
      LIMIT 50`,
    [bankAccountId]
  );
  const baselineRow = rows.find((r) => /^[0-9]+$/.test(String(r.cheque_number || '').trim()));
  if (!baselineRow) return null;

  const last = String(baselineRow.cheque_number).trim();
  const width = last.length;
  let candidateBig = BigInt(last) + 1n;

  for (let i = 0; i < 200; i++) {
    const candidate = String(candidateBig).padStart(width, '0');
    const { rowCount } = await db.query(
      `SELECT 1 FROM cheque_records
        WHERE bank_account_id = $1
          AND cheque_number = $2
          AND status <> 'DELETED'
        LIMIT 1`,
      [bankAccountId, candidate]
    );
    if (rowCount === 0) {
      return candidate;
    }
    candidateBig += 1n;
  }
  return null;
}

/**
 * Issue a new outbound cheque.
 */
async function issueOutboundCheque(client, {
  bankAccountId,
  chequeNumber,
  chequeDate,
  purposeType,
  amount,
  payee,
  memo = null,
  templateId = null,
  supplierId = null,
  billIds = [],
  allocations = null,
  autoAllocate = false,
  methodId = null,
  expenseCategoryId = null,
  referenceNumber = null,
  employeeId = null,
  userId = null,
  overridePaymentHold = false,
}) {
  if (!['SUPPLIER_PAYMENT', 'LOAN_PAYMENT', 'RENT', 'OTHER_EXPENSE'].includes(purposeType)) {
    throw serviceError(400, 'INVALID_PURPOSE_TYPE', `Invalid purpose_type: ${purposeType}`);
  }

  const normalizedNumber = validateAndNormalizeChequeNumber(chequeNumber);
  const normalizedDate = validateOperatingDate(chequeDate, 'Cheque date');
  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw serviceError(400, 'INVALID_AMOUNT', 'A positive cheque amount is required.');
  }
  const trimmedPayee = typeof payee === 'string' ? payee.trim() : '';
  if (!trimmedPayee) {
    throw serviceError(400, 'PAYEE_REQUIRED', 'Payee is required.');
  }

  const { rows: [bankAcc] } = await client.query(
    `SELECT bank_account_id, account_name, bank_name, currency, is_active, default_cheque_template_id
       FROM bank_account
      WHERE bank_account_id = $1
      FOR UPDATE`,
    [bankAccountId]
  );
  if (!bankAcc) {
    throw serviceError(404, 'BANK_ACCOUNT_NOT_FOUND', 'Bank account not found.');
  }
  if (!bankAcc.is_active) {
    throw serviceError(409, 'BANK_ACCOUNT_INACTIVE', `Bank account "${bankAcc.account_name}" is inactive.`);
  }

  const conflict = await findConflictingCheque(client, bankAccountId, normalizedNumber);
  if (conflict) {
    throw serviceError(
      409,
      'CHEQUE_NUMBER_RESERVED',
      `Cheque #${normalizedNumber} is already recorded for ${bankAcc.account_name} (status: ${conflict.status}${conflict.is_deleted ? ', hidden' : ''}).`,
      { conflictingCheque: conflict }
    );
  }

  let apPaymentId = null;
  let expenseId = null;

  if (purposeType === 'SUPPLIER_PAYMENT') {
    if (!supplierId) throw serviceError(400, 'SUPPLIER_REQUIRED', 'supplierId is required for SUPPLIER_PAYMENT cheques');

    const { rows: [supplier] } = await client.query(
      `SELECT supplier_id, payment_hold, payment_hold_reason FROM supplier WHERE supplier_id = $1 FOR UPDATE`,
      [supplierId]
    );
    if (!supplier) {
      throw serviceError(404, 'SUPPLIER_NOT_FOUND', `Supplier #${supplierId} not found.`);
    }
    if (supplier.payment_hold && !overridePaymentHold) {
      throw serviceError(
        409,
        'PAYMENT_HOLD_BLOCKED',
        `Supplier is on payment hold${supplier.payment_hold_reason ? ': ' + supplier.payment_hold_reason : ''}. `
        + 'Pass override_payment_hold=true with ap:manage permission to proceed anyway.'
      );
    }

    const { rows: [payment] } = await client.query(
      `INSERT INTO ap_payment
         (supplier_id, employee_id, amount, method_id, reference_number, notes,
          pdc_status, cheque_date, bank_account_id, created_by)
       SELECT $1, $2, $3, pm.method_id, $4, $5, 'ISSUED', $6, $7, $8
       FROM payment_methods pm
       WHERE (pm.type = 'cheque' OR pm.code IN ('cheque', 'pdc'))
         AND ($9::int IS NULL OR pm.method_id = $9::int)
       LIMIT 1
       RETURNING payment_id`,
      [supplierId, employeeId || userId, parsedAmount, referenceNumber, memo, normalizedDate, bankAccountId, userId,
       methodId || null]
    );
    if (!payment) {
      throw serviceError(
        400,
        'INVALID_CHEQUE_METHOD',
        methodId
          ? 'That payment method is not a cheque method, so it cannot be used to issue a cheque'
          : 'No cheque-type payment method configured'
      );
    }
    apPaymentId = payment.payment_id;

    if (autoAllocate || Array.isArray(allocations)) {
      const { rows: [{ dated_on: datedOn }] } = await client.query(
        `SELECT COALESCE($1::date, CURRENT_DATE) AS dated_on`, [normalizedDate]
      );
      const resolved = await apPaymentService.resolveAllocations(client, {
        supplierId,
        amount: parsedAmount,
        allocations,
        settledOn: datedOn,
        excludePaymentId: apPaymentId,
      });
      for (const alloc of resolved) {
        await client.query(
          `INSERT INTO ap_payment_allocation (payment_id, bill_id, amount_allocated) VALUES ($1, $2, $3)`,
          [apPaymentId, alloc.billId, alloc.amount]
        );
      }
    } else if (Array.isArray(billIds) && billIds.length > 0) {
      const sortedBillIds = [...new Set(billIds.map(Number).filter(Boolean))].sort((a, b) => a - b);
      const { rows: bills } = await client.query(
        `SELECT bill_id, bill_number, supplier_id, status, total_amount, amount_paid
           FROM supplier_bill
          WHERE bill_id = ANY($1::int[])
          ORDER BY bill_id ASC
          FOR UPDATE`,
        [sortedBillIds]
      );
      if (bills.length !== sortedBillIds.length || bills.some((b) => Number(b.supplier_id) !== Number(supplierId) || b.status === 'Void')) {
        throw serviceError(
          400,
          'BILL_INVALID_OR_OWNERSHIP_CHANGED',
          'One or more selected bills were not found, voided, or belong to another supplier.'
        );
      }
      const { rows: schedRows } = await client.query(
        `SELECT apa.bill_id, COALESCE(SUM(apa.amount_allocated), 0) AS scheduled_amount
           FROM ap_payment_allocation apa
           JOIN ap_payment ap ON ap.payment_id = apa.payment_id
           LEFT JOIN cheque_records cr ON cr.id = ap.cheque_record_id
          WHERE apa.bill_id = ANY($1::int[])
            AND ap.payment_id <> $2
            AND ap.pdc_status IN ('ISSUED', 'HELD_FOR_RELEASE', 'DEPOSITED', 'BOUNCED', 'STALE')
            AND (cr.id IS NULL OR cr.status NOT IN ('VOID', 'REPLACED', 'DELETED'))
          GROUP BY apa.bill_id`,
        [sortedBillIds, apPaymentId]
      );
      const schedMap = new Map(schedRows.map((r) => [Number(r.bill_id), Number(r.scheduled_amount) || 0]));

      // Preserve caller's billIds order when spilling amount across bills
      const billById = new Map(bills.map((b) => [Number(b.bill_id), b]));
      let remainingAmount = parsedAmount;
      for (const rawId of billIds) {
        const bill = billById.get(Number(rawId));
        if (!bill || remainingAmount <= 0.005) continue;
        const outstanding = Math.max(0, parseFloat(bill.total_amount) - parseFloat(bill.amount_paid));
        const scheduled = schedMap.get(Number(bill.bill_id)) || 0;
        const available = Math.max(0, outstanding - scheduled);
        const allocate = Number(Math.min(available, remainingAmount).toFixed(2));
        if (allocate <= 0.005) continue;
        await client.query(
          `INSERT INTO ap_payment_allocation (payment_id, bill_id, amount_allocated) VALUES ($1, $2, $3)`,
          [apPaymentId, bill.bill_id, allocate]
        );
        remainingAmount = Number((remainingAmount - allocate).toFixed(2));
      }
      if (remainingAmount > 0.005) {
        throw serviceError(
          400,
          'ALLOCATION_EXCEEDS_AVAILABLE',
          `Cheque amount (${parsedAmount.toFixed(2)}) exceeds the available unscheduled balance on the selected bill(s) by ${remainingAmount.toFixed(2)}.`
        );
      }
    }
  } else {
    if (!expenseCategoryId) {
      throw serviceError(400, 'EXPENSE_CATEGORY_REQUIRED', 'expenseCategoryId is required for non-supplier outbound cheques');
    }
    await periodLockService.assertPeriodOpen(normalizedDate, { module: 'expenses', client });
    const { rows: [cat] } = await client.query(
      `SELECT category_id, is_active FROM expense_category WHERE category_id = $1`,
      [expenseCategoryId]
    );
    if (!cat || !cat.is_active) {
      throw serviceError(400, 'EXPENSE_CATEGORY_INACTIVE', 'Selected expense category is invalid or inactive.');
    }

    const { rows: [expense] } = await client.query(
      `INSERT INTO expense
         (expense_date, category_id, amount, payee, payment_method_text, reference_no, notes, created_by)
       VALUES ($1, $2, $3, $4, 'Cheque', $5, $6, $7)
       RETURNING expense_id`,
      [normalizedDate, expenseCategoryId, parsedAmount, trimmedPayee, referenceNumber || normalizedNumber, memo, userId]
    );
    expenseId = expense.expense_id;
  }

  const resolvedTemplateId = templateId || bankAcc.default_cheque_template_id || null;

  const { rows: [chequeRecord] } = await client.query(
    `INSERT INTO cheque_records
       (template_id, payee, amount, cheque_date, memo, bank_account_id, cheque_number,
        status, purpose_type, ap_payment_id, expense_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'ISSUED', $8, $9, $10)
     RETURNING id`,
    [resolvedTemplateId, trimmedPayee, parsedAmount, normalizedDate, memo, bankAccountId, normalizedNumber, purposeType, apPaymentId, expenseId]
  );

  if (apPaymentId) {
    await client.query(`UPDATE ap_payment SET cheque_record_id = $1 WHERE payment_id = $2`, [chequeRecord.id, apPaymentId]);
  }

  return { chequeRecordId: chequeRecord.id, apPaymentId, expenseId, templateId: resolvedTemplateId };
}

/**
 * Evaluate contextual eligibility for actions on a cheque or payment.
 * Returns structured action availability and reason codes so every UI surface
 * (Treasury, Print History, AP Payment Register) renders identical rules.
 */
async function evaluateChequeActionEligibility(db, { chequeRecordId = null, apPaymentId = null, staleDays = 180 } = {}) {
  let cr = null;
  let ap = null;

  if (chequeRecordId) {
    const { rows } = await db.query(
      `SELECT cr.*,
              TO_CHAR(cr.cheque_date, 'YYYY-MM-DD') AS cheque_date_str,
              ba.account_name AS bank_account_name,
              ba.bank_name,
              ba.currency AS bank_currency,
              ba.default_cheque_template_id,
              prev_cr.cheque_number AS replaces_cheque_number,
              next_cr.cheque_number AS replaced_by_cheque_number,
              EXISTS (
                SELECT 1 FROM cheque_clearance_log ccl
                 WHERE ccl.cheque_record_id = cr.id
                   AND ccl.action IN ('PRINTED', 'PDF_GENERATED')
              ) AS has_pdf_generated
         FROM cheque_records cr
         LEFT JOIN bank_account ba ON ba.bank_account_id = cr.bank_account_id
         LEFT JOIN cheque_records prev_cr ON prev_cr.id = cr.replaces_cheque_id
         LEFT JOIN cheque_records next_cr ON next_cr.id = cr.replaced_by_cheque_id
        WHERE cr.id = $1`,
      [chequeRecordId]
    );
    cr = rows[0] || null;
    if (cr?.ap_payment_id) {
      apPaymentId = cr.ap_payment_id;
    }
  }

  if (apPaymentId) {
    const { rows } = await db.query(
      `SELECT ap.*, s.supplier_name, s.payment_hold, s.payment_hold_reason,
              pm.name AS method_name, pm.code AS method_code, pm.type AS method_type
         FROM ap_payment ap
         LEFT JOIN supplier s ON s.supplier_id = ap.supplier_id
         LEFT JOIN payment_methods pm ON pm.method_id = ap.method_id
        WHERE ap.payment_id = $1`,
      [apPaymentId]
    );
    ap = rows[0] || null;
    if (ap?.cheque_record_id && !cr) {
      return evaluateChequeActionEligibility(db, { chequeRecordId: ap.cheque_record_id, apPaymentId: ap.payment_id, staleDays });
    }
  }

  if (!cr && !ap) {
    throw serviceError(404, 'RECORD_NOT_FOUND', 'Cheque or payment record not found.');
  }

  // Check external dependencies (remittance, cash custody, freight, ledger settlement)
  let hasRemittanceLink = false;
  let hasCashCustodyLink = false;
  let hasFreightLink = false;
  let hasUnreversedSettlement = false;
  let expenseRecord = null;
  let expensePeriodLocked = false;

  if (ap) {
    const { rows: [deps] } = await db.query(
      `SELECT
         EXISTS (
           SELECT 1 FROM loan_remittance r
            WHERE r.treasury_ap_payment_id = $1
              AND r.amount > COALESCE((
                SELECT SUM(c.amount)
                  FROM loan_remittance_correction c
                  JOIN loan_remittance_allocation a USING (remittance_allocation_id)
                 WHERE a.remittance_id = r.remittance_id
              ), 0)
         ) AS remittance_linked,
         EXISTS (SELECT 1 FROM cash_drawer_movement WHERE ap_payment_id = $1)
           OR EXISTS (SELECT 1 FROM cash_advance_event WHERE ap_payment_id = $1) AS cash_linked,
         EXISTS (SELECT 1 FROM goods_receipt_freight WHERE payment_id = $1) AS freight_linked,
         (
           SELECT COUNT(*) FILTER (WHERE entry_type = 'PAYMENT_SETTLED')
                - COUNT(*) FILTER (WHERE entry_type = 'PDC_BOUNCED_REVERSAL')
             FROM ap_ledger
            WHERE payment_id = $1
         ) > 0 AS settled_in_ledger`,
      [ap.payment_id]
    );
    hasRemittanceLink = Boolean(deps?.remittance_linked);
    hasCashCustodyLink = Boolean(deps?.cash_linked);
    hasFreightLink = Boolean(deps?.freight_linked);
    hasUnreversedSettlement = Boolean(deps?.settled_in_ledger);
  }

  if (cr?.expense_id) {
    const { rows: [exp] } = await db.query(
      `SELECT e.expense_id, TO_CHAR(e.expense_date, 'YYYY-MM-DD') AS expense_date,
              e.amount, e.payee, e.category_id, e.is_void, e.reference_no, e.notes,
              c.category_name,
              EXISTS (
                SELECT 1 FROM loan_remittance r
                 WHERE r.treasury_expense_id = e.expense_id
                   AND r.amount > COALESCE((
                     SELECT SUM(corr.amount)
                       FROM loan_remittance_correction corr
                       JOIN loan_remittance_allocation a USING (remittance_allocation_id)
                      WHERE a.remittance_id = r.remittance_id
                   ), 0)
              ) AS remittance_linked,
              EXISTS (SELECT 1 FROM cash_drawer_movement WHERE expense_id = e.expense_id)
                OR EXISTS (SELECT 1 FROM cash_advance_event WHERE expense_id = e.expense_id) AS cash_linked
         FROM expense e
         LEFT JOIN expense_category c ON c.category_id = e.category_id
        WHERE e.expense_id = $1`,
      [cr.expense_id]
    );
    expenseRecord = exp || null;
    if (exp) {
      hasRemittanceLink = hasRemittanceLink || Boolean(exp.remittance_linked);
      hasCashCustodyLink = hasCashCustodyLink || Boolean(exp.cash_linked);
      try {
        await periodLockService.assertPeriodOpen(exp.expense_date, { module: 'expenses', client: db });
      } catch (_lockErr) {
        expensePeriodLocked = true;
      }
    }
  }

  // Allocations summary
  let allocations = [];
  if (ap) {
    const { rows: allocRows } = await db.query(
      `SELECT apa.bill_id, sb.bill_number, apa.amount_allocated AS amount,
              sb.total_amount, sb.amount_paid, sb.status AS bill_status
         FROM ap_payment_allocation apa
         JOIN supplier_bill sb ON sb.bill_id = apa.bill_id
        WHERE apa.payment_id = $1
        ORDER BY sb.bill_id ASC`,
      [ap.payment_id]
    );
    allocations = allocRows;
  }

  // Build chain history
  const chain = [];
  if (cr) {
    const { rows: chainRows } = await db.query(
      `WITH RECURSIVE ancestors AS (
         SELECT id, cheque_number, bank_account_id, status, cheque_date, replaces_cheque_id, replaced_by_cheque_id, 0 AS depth
           FROM cheque_records WHERE id = $1
         UNION ALL
         SELECT p.id, p.cheque_number, p.bank_account_id, p.status, p.cheque_date, p.replaces_cheque_id, p.replaced_by_cheque_id, a.depth - 1
           FROM cheque_records p
           JOIN ancestors a ON p.id = a.replaces_cheque_id
          WHERE a.depth > -20
       ),
       descendants AS (
         SELECT id, cheque_number, bank_account_id, status, cheque_date, replaces_cheque_id, replaced_by_cheque_id, 0 AS depth
           FROM cheque_records WHERE id = $1
         UNION ALL
         SELECT c.id, c.cheque_number, c.bank_account_id, c.status, c.cheque_date, c.replaces_cheque_id, c.replaced_by_cheque_id, d.depth + 1
           FROM cheque_records c
           JOIN descendants d ON c.id = d.replaced_by_cheque_id
          WHERE d.depth < 20
       ),
       combined AS (
         SELECT * FROM ancestors
         UNION
         SELECT * FROM descendants
       )
       SELECT cb.id AS cheque_record_id, cb.cheque_number, cb.bank_account_id,
              ba.account_name AS bank_account_name, cb.status,
              TO_CHAR(cb.cheque_date, 'YYYY-MM-DD') AS cheque_date,
              cb.replaces_cheque_id, cb.replaced_by_cheque_id, cb.depth
         FROM combined cb
         LEFT JOIN bank_account ba ON ba.bank_account_id = cb.bank_account_id
        ORDER BY cb.depth ASC`,
      [cr.id]
    );
    chain.push(...chainRows);
  }

  // Standalone print-only record
  if (cr && !cr.ap_payment_id && !cr.expense_id && !cr.cheque_number) {
    return {
      kind: 'STANDALONE_PRINT',
      chequeRecordId: cr.id,
      status: cr.status,
      isDeleted: Boolean(cr.is_deleted),
      actions: {
        print: { allowed: !cr.is_deleted, code: cr.is_deleted ? 'RECORD_DELETED' : 'OK', reason: cr.is_deleted ? 'Print entry was removed.' : null },
        replace: { allowed: false, code: 'STANDALONE_PRINT_ONLY', reason: 'Standalone print records have no tracked bank account, cheque number, or financial payment to replace.' },
        void: { allowed: false, code: 'STANDALONE_PRINT_ONLY', reason: 'Standalone print records have no financial commitment to void.' },
        deletePayment: { allowed: false, code: 'STANDALONE_PRINT_ONLY', reason: 'Use "Remove print entry" to delete an unnumbered standalone print record.' },
        removePrintEntry: { allowed: !cr.is_deleted, code: cr.is_deleted ? 'ALREADY_REMOVED' : 'OK', reason: null },
      },
      chain,
      allocations: [],
    };
  }

  // Direct non-cheque AP payment
  if (!cr && ap) {
    const reasons = [];
    let code = 'DIRECT_SETTLED_PAYMENT';
    if (hasCashCustodyLink) {
      code = 'CASH_CUSTODY_LINKED';
      reasons.push('This payment is linked to a physical cash drawer movement or employee cash advance. Use Cash Drawer / Advance correction workflows.');
    }
    if (hasRemittanceLink) {
      code = 'REMITTANCE_LINKED';
      reasons.push('This payment is attributed to an agency loan remittance. Correct the remittance attribution before modifying its Treasury source.');
    }
    if (hasFreightLink) {
      code = 'FREIGHT_LINKED';
      reasons.push('This payment is linked to a Goods Receipt freight charge.');
    }
    if (hasUnreversedSettlement || ap.pdc_status === 'CLEARED') {
      reasons.push('This direct payment has already settled in the AP ledger and has no cheque number to release.');
    }
    return {
      kind: 'DIRECT_AP_PAYMENT',
      apPaymentId: ap.payment_id,
      status: ap.pdc_status,
      actions: {
        print: { allowed: false, code: 'NOT_A_CHEQUE', reason: 'Direct non-cheque payments do not have a printable cheque instrument.' },
        replace: { allowed: false, code: 'NOT_A_CHEQUE', reason: 'Only cheque instruments can be replaced.' },
        void: { allowed: false, code: 'NOT_A_CHEQUE', reason: 'Direct settled payments cannot be voided as an unissued cheque.' },
        deletePayment: { allowed: false, code, reason: reasons.join(' ') || 'Direct settled payments require an audited ledger reversal rather than cheque-number deletion.' },
      },
      chain: [],
      allocations,
    };
  }

  // Numbered financial cheque (AP or Expense)
  const withMaturity = computePdcMaturity({ ...cr, cheque_date: cr.cheque_date_str || cr.cheque_date }, staleDays);
  const isDynamicallyStale = withMaturity.maturity_status === 'STALE_CHEQUE';
  const status = cr.status;
  const isRetiredOrTerminal = ['VOID', 'REPLACED', 'DELETED'].includes(status);
  const isCleared = status === 'CLEARED' || ap?.pdc_status === 'CLEARED' || hasUnreversedSettlement;
  const isHiddenLegacy = Boolean(cr.is_deleted) && status !== 'DELETED';

  // Evaluate Replace
  let replaceEligibility = { allowed: true, code: 'OK', reason: null, requiresRecoveryConfirmation: false };
  if (isHiddenLegacy) {
    replaceEligibility = { allowed: false, code: 'HIDDEN_LEGACY_RECORD', reason: 'This cheque was hidden by legacy print history deletion. Restore or classify it before replacing.' };
  } else if (isRetiredOrTerminal) {
    replaceEligibility = { allowed: false, code: 'TERMINAL_STATUS', reason: `Cheque is already ${status}${cr.replaced_by_cheque_number ? ` (replaced by #${cr.replaced_by_cheque_number})` : ''}.` };
  } else if (isCleared) {
    replaceEligibility = { allowed: false, code: 'ALREADY_CLEARED', reason: 'Cleared cheques have already been honored by the bank and cannot be replaced.' };
  } else if (cr.replaced_by_cheque_id) {
    replaceEligibility = { allowed: false, code: 'ALREADY_REPLACED', reason: `Cheque has already been replaced by #${cr.replaced_by_cheque_number || cr.replaced_by_cheque_id}.` };
  } else if (hasRemittanceLink) {
    replaceEligibility = { allowed: false, code: 'REMITTANCE_LINKED', reason: 'Linked to an agency loan remittance. Correct remittance attribution before replacing the payment.' };
  } else if (hasCashCustodyLink) {
    replaceEligibility = { allowed: false, code: 'CASH_CUSTODY_LINKED', reason: 'Linked to cash custody records.' };
  } else if (!['ISSUED', 'HELD_FOR_RELEASE', 'BOUNCED', 'STALE', 'DEPOSITED'].includes(status) && !isDynamicallyStale) {
    replaceEligibility = { allowed: false, code: 'INELIGIBLE_STATUS', reason: `Cheques with status ${status} cannot be replaced.` };
  } else if (status === 'DEPOSITED') {
    replaceEligibility = {
      allowed: true,
      code: 'REQUIRES_RECOVERY_CONFIRMATION',
      reason: 'Cheque is marked DEPOSITED. Confirm the physical instrument was recovered or stop-payment was arranged before replacing.',
      requiresRecoveryConfirmation: true,
    };
  }

  // Evaluate Void
  let voidEligibility = { allowed: true, code: 'OK', reason: null };
  if (isHiddenLegacy) {
    voidEligibility = { allowed: false, code: 'HIDDEN_LEGACY_RECORD', reason: 'Restore or classify this legacy hidden cheque first.' };
  } else if (isRetiredOrTerminal) {
    voidEligibility = { allowed: false, code: 'TERMINAL_STATUS', reason: `Cheque is already ${status}.` };
  } else if (isCleared) {
    voidEligibility = { allowed: false, code: 'ALREADY_CLEARED', reason: 'Cleared cheques cannot be voided.' };
  } else if (hasRemittanceLink) {
    voidEligibility = { allowed: false, code: 'REMITTANCE_LINKED', reason: 'Correct agency loan remittance attribution before voiding.' };
  } else if (hasCashCustodyLink) {
    voidEligibility = { allowed: false, code: 'CASH_CUSTODY_LINKED', reason: 'Linked to cash custody records.' };
  } else if (hasFreightLink) {
    voidEligibility = { allowed: false, code: 'FREIGHT_LINKED', reason: 'Linked to a Goods Receipt freight charge. Correct the receipt freight first.' };
  } else if (expensePeriodLocked) {
    voidEligibility = { allowed: false, code: 'PERIOD_LOCKED', reason: 'The expense period for this cheque is locked. Reopen the period before cancelling the expense.' };
  }

  // Evaluate Delete Payment (releases cheque number)
  let deleteEligibility = { allowed: true, code: 'OK', reason: null };
  if (isHiddenLegacy) {
    deleteEligibility = { allowed: false, code: 'HIDDEN_LEGACY_RECORD', reason: 'Restore visibility of this legacy hidden cheque before deleting or classifying it.' };
  } else if (status === 'DELETED') {
    deleteEligibility = { allowed: false, code: 'ALREADY_DELETED', reason: 'This payment was already deleted and its cheque number released.' };
  } else if (status === 'VOID' || status === 'REPLACED' || cr.replaced_by_cheque_id) {
    deleteEligibility = {
      allowed: false,
      code: 'RETIRED_INSTRUMENT_NUMBER_RESERVED',
      reason: `Cheque #${cr.cheque_number} is permanently retired (${status}) and its number cannot be reclaimed through ordinary deletion.`,
    };
  } else if (isCleared) {
    deleteEligibility = {
      allowed: false,
      code: 'ALREADY_CLEARED',
      reason: 'This cheque was cleared/settled. An honored cheque number remains permanently used; process an audited settlement correction if clearance was recorded in error.',
    };
  } else if (status === 'DEPOSITED' || status === 'BOUNCED') {
    deleteEligibility = {
      allowed: false,
      code: 'INSTRUMENT_PRESENTED',
      reason: `Cheque #${cr.cheque_number} has status ${status} (already presented/deposited), so its physical number cannot be reused as an unspoiled blank cheque. Use Replace or Void instead.`,
    };
  } else if (hasRemittanceLink) {
    deleteEligibility = {
      allowed: false,
      code: 'REMITTANCE_LINKED',
      reason: 'Linked to an agency loan remittance. Correct the remittance attribution in Employee Finance before deleting this Treasury source.',
    };
  } else if (hasCashCustodyLink) {
    deleteEligibility = {
      allowed: false,
      code: 'CASH_CUSTODY_LINKED',
      reason: 'Linked to physical cash drawer or advance custody records.',
    };
  } else if (hasFreightLink) {
    deleteEligibility = {
      allowed: false,
      code: 'FREIGHT_LINKED',
      reason: 'Owned by a Goods Receipt freight charge. Correct or detach the freight charge on the Goods Receipt first.',
    };
  } else if (expensePeriodLocked) {
    deleteEligibility = {
      allowed: false,
      code: 'PERIOD_LOCKED',
      reason: 'The accounting period for the linked expense is locked. Reopen the expense period before deleting this payment.',
    };
  }

  // Evaluate Print
  let printEligibility = { allowed: true, code: 'OK', reason: null };
  if (isHiddenLegacy || isRetiredOrTerminal) {
    printEligibility = {
      allowed: false,
      code: isHiddenLegacy ? 'HIDDEN_LEGACY_RECORD' : 'TERMINAL_STATUS',
      reason: isHiddenLegacy ? 'Hidden legacy cheque cannot be printed until restored.' : `Cannot print a ${status} cheque.`,
    };
  }

  return {
    kind: cr.ap_payment_id ? 'SUPPLIER_CHEQUE' : 'EXPENSE_CHEQUE',
    chequeRecordId: cr.id,
    apPaymentId: cr.ap_payment_id || null,
    expenseId: cr.expense_id || null,
    chequeNumber: cr.cheque_number,
    chequeDate: cr.cheque_date_str || cr.cheque_date,
    bankAccountId: cr.bank_account_id,
    bankAccountName: cr.bank_account_name,
    bankName: cr.bank_name,
    bankCurrency: cr.bank_currency || 'PHP',
    defaultTemplateId: cr.default_cheque_template_id || null,
    templateId: cr.template_id || cr.default_cheque_template_id || null,
    payee: cr.payee,
    amount: Number(cr.amount),
    purposeType: cr.purpose_type,
    memo: cr.memo,
    status: cr.status,
    maturityStatus: withMaturity.maturity_status,
    maturityLabel: withMaturity.maturity_label,
    isDeleted: Boolean(cr.is_deleted),
    isHiddenLegacy,
    hasPdfGenerated: Boolean(cr.has_pdf_generated),
    replacesChequeId: cr.replaces_cheque_id || null,
    replacesChequeNumber: cr.replaces_cheque_number || null,
    replacedByChequeId: cr.replaced_by_cheque_id || null,
    replacedByChequeNumber: cr.replaced_by_cheque_number || null,
    supplierName: ap?.supplier_name || null,
    referenceNumber: ap?.reference_number ?? expenseRecord?.reference_no ?? null,
    notes: ap?.notes ?? expenseRecord?.notes ?? null,
    expenseCategoryName: expenseRecord?.category_name || null,
    expenseDate: expenseRecord?.expense_date || null,
    allocations,
    chain,
    actions: {
      print: printEligibility,
      replace: replaceEligibility,
      void: voidEligibility,
      deletePayment: deleteEligibility,
      restoreVisibility: {
        allowed: isHiddenLegacy,
        code: isHiddenLegacy ? 'OK' : 'NOT_HIDDEN_LEGACY',
        reason: null,
      },
    },
  };
}

/**
 * Fetch outbound cheques for the Treasury Desk.
 * Supports filters for status, maturity, includeHistory (VOID/REPLACED), includeDeleted (DELETED),
 * includeHiddenLegacy (legacy is_deleted=true while not DELETED), and search by cheque number/payee.
 */
async function getOutboundClearanceList(db, pdcStatusFilter = null, maturityFilter = null, options = {}) {
  const {
    includeHistory = false,
    includeDeleted = false,
    includeHiddenLegacy = false,
    search = null,
    bankAccountId = null,
  } = options || {};

  const validStatuses = new Set([
    'ALL', 'ISSUED', 'HELD_FOR_RELEASE', 'DEPOSITED', 'CLEARED',
    'BOUNCED', 'VOID', 'STALE', 'REPLACED', 'DELETED',
  ]);
  if (pdcStatusFilter && !validStatuses.has(pdcStatusFilter)) {
    throw serviceError(400, 'INVALID_STATUS_FILTER', `Invalid pdc_status filter: ${pdcStatusFilter}`);
  }
  const normalizedStatus = (pdcStatusFilter && pdcStatusFilter !== 'ALL') ? pdcStatusFilter : null;
  const searchPattern = search && String(search).trim() ? `%${String(search).trim().toLowerCase()}%` : null;

  const query = `
    SELECT
      cr.id                                     AS cheque_record_id,
      cr.ap_payment_id                          AS payment_id,
      cr.expense_id,
      cr.purpose_type,
      cr.bank_account_id,
      ba.account_name                           AS bank_account_name,
      ba.bank_name,
      ba.currency                               AS bank_currency,
      ba.default_cheque_template_id,
      COALESCE(cr.template_id, ba.default_cheque_template_id) AS template_id,
      cr.cheque_number,
      TO_CHAR(cr.cheque_date, 'YYYY-MM-DD')     AS cheque_date,
      cr.amount,
      cr.payee,
      cr.status                                 AS pdc_status,
      cr.memo,
      cr.is_deleted,
      cr.void_reason,
      cr.deleted_reason,
      cr.deleted_at,
      cr.replaces_cheque_id,
      cr.replaced_by_cheque_id,
      prev_cr.cheque_number                     AS replaces_cheque_number,
      next_cr.cheque_number                     AS replaced_by_cheque_number,
      cr.created_at,
      s.supplier_id,
      s.supplier_name                           AS company_name,
      ap.reference_number,
      ap.notes                                  AS payment_notes,
      TO_CHAR(e.expense_date, 'YYYY-MM-DD')     AS expense_date,
      ec.category_name                          AS expense_category_name,
      COALESCE(bounce_agg.bounce_count, 0)::int AS bounce_count,
      EXISTS (
        SELECT 1 FROM cheque_clearance_log ccl
         WHERE ccl.cheque_record_id = cr.id
           AND ccl.action IN ('PRINTED', 'PDF_GENERATED')
      ) AS is_printed,
      EXISTS (
        SELECT 1 FROM cheque_clearance_log ccl
         WHERE ccl.cheque_record_id = cr.id
           AND ccl.action = 'TEST_PDF_GENERATED'
      ) AS has_test_pdf,
      COALESCE(alloc.bills, '[]'::json)         AS bills
    FROM cheque_records cr
    LEFT JOIN bank_account ba ON ba.bank_account_id = cr.bank_account_id
    LEFT JOIN ap_payment ap ON ap.payment_id = cr.ap_payment_id
    LEFT JOIN supplier s ON s.supplier_id = ap.supplier_id
    LEFT JOIN expense e ON e.expense_id = cr.expense_id
    LEFT JOIN expense_category ec ON ec.category_id = e.category_id
    LEFT JOIN cheque_records prev_cr ON prev_cr.id = cr.replaces_cheque_id
    LEFT JOIN cheque_records next_cr ON next_cr.id = cr.replaced_by_cheque_id
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
               'bill_id', sb.bill_id,
               'bill_number', sb.bill_number,
               'amount', apa.amount_allocated
             ) ORDER BY sb.bill_id) AS bills
        FROM ap_payment_allocation apa
        JOIN supplier_bill sb ON sb.bill_id = apa.bill_id
       WHERE apa.payment_id = cr.ap_payment_id
    ) alloc ON true
    LEFT JOIN (
      SELECT cheque_record_id, COUNT(*)::int AS bounce_count
      FROM cheque_clearance_log
      WHERE action = 'BOUNCED' AND cheque_type IN ('OUTBOUND_SUPPLIER', 'OUTBOUND_EXPENSE')
      GROUP BY cheque_record_id
    ) bounce_agg ON bounce_agg.cheque_record_id = cr.id
    WHERE (cr.ap_payment_id IS NOT NULL OR cr.expense_id IS NOT NULL OR cr.cheque_number IS NOT NULL)
      AND (
        -- Visibility filter:
        -- 1. Normal visible non-deleted rows
        (cr.is_deleted = false AND cr.status <> 'DELETED')
        -- 2. Explicit DELETED rows when includeDeleted or status=DELETED or searching
        OR (($2::boolean OR $1::varchar = 'DELETED') AND cr.status = 'DELETED')
        -- 3. Legacy hidden rows when includeHiddenLegacy is enabled
        OR ($3::boolean AND cr.is_deleted = true AND cr.status <> 'DELETED')
      )
      AND (
        -- Status filter:
        ($1::varchar IS NOT NULL AND cr.status = $1::varchar)
        OR (
          $1::varchar IS NULL
          AND (
            cr.status NOT IN ('VOID', 'REPLACED', 'DELETED')
            OR ($4::boolean AND cr.status IN ('VOID', 'REPLACED'))
            OR ($2::boolean AND cr.status = 'DELETED')
          )
        )
      )
      AND ($5::text IS NULL OR LOWER(COALESCE(cr.cheque_number, '')) LIKE $5 OR LOWER(COALESCE(cr.payee, '')) LIKE $5 OR LOWER(COALESCE(s.supplier_name, '')) LIKE $5)
      AND ($6::int IS NULL OR cr.bank_account_id = $6::int)
    ORDER BY cr.created_at DESC, cr.id DESC
  `;

  const { rows } = await db.query(query, [
    normalizedStatus,
    Boolean(includeDeleted),
    Boolean(includeHiddenLegacy),
    Boolean(includeHistory),
    searchPattern,
    bankAccountId ? Number(bankAccountId) : null,
  ]);
  const { staleDays } = await getPdcSettings(db);
  const combined = rows.map((r) => {
    const withMat = computePdcMaturity(r, staleDays);
    // If the user filtered specifically for STALE status, also match dynamically stale ISSUED cheques when requested
    return withMat;
  });

  if (maturityFilter && maturityFilter !== 'ALL') {
    return combined.filter((r) => r.maturity_status === maturityFilter);
  }
  return combined;
}

/**
 * Verify and clear an outbound cheque (bank has honored it).
 * Enforces live/current/not-deleted status and relies on the aggregate database trigger
 * for supplier_bill.amount_paid / status rather than manual single-payment overwrites.
 */
async function verifyOutboundPayment(client, { chequeRecordId, userId = null, expectedStatus = null }) {
  const { rows: [cr] } = await client.query(
    `SELECT id, ap_payment_id, expense_id, purpose_type, amount, cheque_number,
            bank_account_id, status, is_deleted, replaced_by_cheque_id
       FROM cheque_records
      WHERE id = $1
      FOR UPDATE`,
    [chequeRecordId]
  );
  if (!cr) throw serviceError(404, 'CHEQUE_NOT_FOUND', `Cheque record #${chequeRecordId} not found`);

  if (expectedStatus && cr.status !== expectedStatus) {
    throw serviceError(
      409,
      'STALE_CHEQUE_STATE',
      `Cheque state changed from ${expectedStatus} to ${cr.status}. Refresh and try again.`,
      { currentStatus: cr.status }
    );
  }
  if (cr.is_deleted && cr.status !== 'DELETED') {
    throw serviceError(409, 'CHEQUE_HIDDEN_LEGACY', `Cheque #${cr.cheque_number || cr.id} is hidden and requires review before clearance.`);
  }
  if (['VOID', 'REPLACED', 'DELETED', 'CLEARED'].includes(cr.status) || cr.replaced_by_cheque_id) {
    throw serviceError(
      409,
      'INVALID_CHEQUE_TRANSITION',
      `Cannot clear cheque #${cr.cheque_number || cr.id} with status ${cr.status}.`,
      { currentStatus: cr.status }
    );
  }
  if (!['ISSUED', 'HELD_FOR_RELEASE', 'DEPOSITED', 'STALE'].includes(cr.status)) {
    throw serviceError(
      409,
      'INVALID_CHEQUE_TRANSITION',
      `Cheque #${cr.cheque_number || cr.id} in status ${cr.status} must be re-deposited or active before clearing.`,
      { currentStatus: cr.status }
    );
  }

  let supplierId = null;
  if (cr.ap_payment_id) {
    const { rows: [ap] } = await client.query(
      `SELECT payment_id, supplier_id, amount, reference_number, pdc_status
         FROM ap_payment
        WHERE payment_id = $1
        FOR UPDATE`,
      [cr.ap_payment_id]
    );
    if (!ap) throw serviceError(404, 'AP_PAYMENT_NOT_FOUND', `Linked AP payment #${cr.ap_payment_id} not found`);
    if (['VOID', 'REPLACED', 'DELETED', 'CLEARED'].includes(ap.pdc_status)) {
      throw serviceError(409, 'INVALID_PAYMENT_TRANSITION', `Cannot clear AP payment with status ${ap.pdc_status}`);
    }
    supplierId = ap.supplier_id;

    // Lock supplier and allocated bills in deterministic order before updating ap_payment
    await client.query(`SELECT supplier_id FROM supplier WHERE supplier_id = $1 FOR UPDATE`, [supplierId]);
    const { rows: allocBills } = await client.query(
      `SELECT sb.bill_id, sb.bill_number, sb.total_amount, sb.amount_paid, sb.status, apa.amount_allocated
         FROM ap_payment_allocation apa
         JOIN supplier_bill sb ON sb.bill_id = apa.bill_id
        WHERE apa.payment_id = $1
        ORDER BY sb.bill_id ASC
        FOR UPDATE OF sb`,
      [ap.payment_id]
    );

    for (const b of allocBills) {
      if (b.status === 'Void') {
        throw serviceError(409, 'BILL_VOIDED', `Cannot clear cheque: allocated bill ${b.bill_number || b.bill_id} has been voided.`);
      }
      const remainingToSettle = Number(b.total_amount) - Number(b.amount_paid);
      if (Number(b.amount_allocated) - remainingToSettle > 0.005) {
        throw serviceError(
          409,
          'OVER_CLEARANCE_BLOCKED',
          `Cannot clear cheque: bill ${b.bill_number || b.bill_id} only has ${remainingToSettle.toFixed(2)} unsettled, but this cheque allocates ${Number(b.amount_allocated).toFixed(2)}.`
        );
      }
    }

    await client.query(`UPDATE cheque_records SET status = 'CLEARED', updated_at = now() WHERE id = $1`, [chequeRecordId]);

    // Updating ap_payment to CLEARED fires update_supplier_bill_balance_after_payment,
    // which recomputes each bill's amount_paid and status from the aggregate of all CLEARED payments.
    await client.query(`UPDATE ap_payment SET pdc_status = 'CLEARED' WHERE payment_id = $1`, [cr.ap_payment_id]);

    await apLedgerService.appendEntry(client, {
      supplierId: ap.supplier_id,
      paymentId: ap.payment_id,
      entryType: 'PAYMENT_SETTLED',
      amount: -parseFloat(ap.amount),
      paymentChannel: 'cheque',
      referenceNo: ap.reference_number || cr.cheque_number,
      notes: `Outbound cheque #${cr.cheque_number || cr.id} cleared`,
      createdBy: userId,
    });
  } else {
    await client.query(`UPDATE cheque_records SET status = 'CLEARED', updated_at = now() WHERE id = $1`, [chequeRecordId]);
  }

  await logOutboundClearanceEvent(client, {
    chequeType: resolveChequeTypeForAudit(cr),
    apPaymentId: cr.ap_payment_id,
    expenseId: cr.expense_id,
    chequeRecordId: cr.id,
    supplierId,
    bankAccountId: cr.bank_account_id,
    action: 'CLEARED',
    notes: 'Outbound cheque verified and cleared via Treasury Desk',
    createdBy: userId,
  });

  return { chequeRecordId: cr.id, apPaymentId: cr.ap_payment_id, pdc_status: 'CLEARED' };
}

/**
 * Process a bounced/dishonored outbound cheque.
 * Only posts PDC_BOUNCED_REVERSAL if the payment actually had an unreversed PAYMENT_SETTLED entry!
 * Rely on the database trigger on ap_payment for aggregate bill balance updates.
 */
async function processBouncedOutboundCheque(client, { chequeRecordId, bounceFee = 0, reason = null, userId = null, expectedStatus = null }) {
  const { rows: [cr] } = await client.query(
    `SELECT id, ap_payment_id, expense_id, purpose_type, amount, cheque_number,
            bank_account_id, status, is_deleted, replaced_by_cheque_id
       FROM cheque_records
      WHERE id = $1
      FOR UPDATE`,
    [chequeRecordId]
  );
  if (!cr) throw serviceError(404, 'CHEQUE_NOT_FOUND', `Cheque record #${chequeRecordId} not found`);

  if (expectedStatus && cr.status !== expectedStatus) {
    throw serviceError(
      409,
      'STALE_CHEQUE_STATE',
      `Cheque state changed from ${expectedStatus} to ${cr.status}. Refresh and try again.`,
      { currentStatus: cr.status }
    );
  }
  if (cr.is_deleted && cr.status !== 'DELETED') {
    throw serviceError(409, 'CHEQUE_HIDDEN_LEGACY', `Cheque #${cr.cheque_number || cr.id} is hidden and requires review.`);
  }
  if (['VOID', 'REPLACED', 'DELETED', 'BOUNCED'].includes(cr.status) || cr.replaced_by_cheque_id) {
    throw serviceError(
      409,
      'INVALID_CHEQUE_TRANSITION',
      `Cannot bounce cheque #${cr.cheque_number || cr.id} with status ${cr.status}.`,
      { currentStatus: cr.status }
    );
  }

  const parsedFee = parseFloat(bounceFee) || 0;
  if (parsedFee < 0) {
    throw serviceError(400, 'INVALID_BOUNCE_FEE', 'Bounce fee cannot be negative.');
  }
  const refNo = cr.cheque_number || `CR#${cr.id}`;

  const bounceRes = await client.query(
    `SELECT COUNT(*)::int AS count FROM cheque_clearance_log WHERE cheque_record_id = $1 AND action = 'BOUNCED'`,
    [chequeRecordId]
  );
  const attemptNumber = (bounceRes.rows[0]?.count || 0) + 1;

  await client.query(`UPDATE cheque_records SET status = 'BOUNCED', updated_at = now() WHERE id = $1`, [chequeRecordId]);

  let supplierId = null;
  let reversedSettlement = false;
  if (cr.ap_payment_id) {
    const { rows: [ap] } = await client.query(
      `SELECT payment_id, supplier_id, pdc_status FROM ap_payment WHERE payment_id = $1 FOR UPDATE`,
      [cr.ap_payment_id]
    );
    supplierId = ap.supplier_id;

    await client.query(`SELECT supplier_id FROM supplier WHERE supplier_id = $1 FOR UPDATE`, [supplierId]);
    await client.query(
      `SELECT sb.bill_id FROM ap_payment_allocation apa JOIN supplier_bill sb ON sb.bill_id = apa.bill_id WHERE apa.payment_id = $1 ORDER BY sb.bill_id ASC FOR UPDATE OF sb`,
      [ap.payment_id]
    );

    // Check whether this payment has an unreversed PAYMENT_SETTLED in ap_ledger
    const { rows: [ledgerCounts] } = await client.query(
      `SELECT COUNT(*) FILTER (WHERE entry_type = 'PAYMENT_SETTLED')::int AS settled_count,
              COUNT(*) FILTER (WHERE entry_type = 'PDC_BOUNCED_REVERSAL')::int AS reversed_count
         FROM ap_ledger
        WHERE payment_id = $1`,
      [ap.payment_id]
    );
    const hadUnreversedSettlement = (ledgerCounts?.settled_count || 0) > (ledgerCounts?.reversed_count || 0);

    // Updating ap_payment.pdc_status to BOUNCED triggers update_supplier_bill_balance_after_payment()
    // which recalculates amount_paid from remaining CLEARED payments accurately.
    await client.query(`UPDATE ap_payment SET pdc_status = 'BOUNCED' WHERE payment_id = $1`, [cr.ap_payment_id]);

    if (hadUnreversedSettlement) {
      await apLedgerService.appendEntry(client, {
        supplierId,
        paymentId: ap.payment_id,
        entryType: 'PDC_BOUNCED_REVERSAL',
        amount: parseFloat(cr.amount),
        referenceNo: refNo,
        notes: reason || `Bounced outbound cheque reversal for ${refNo} (Attempt #${attemptNumber})`,
        createdBy: userId,
      });
      reversedSettlement = true;
    }

    if (parsedFee > 0) {
      await apLedgerService.appendEntry(client, {
        supplierId,
        paymentId: ap.payment_id,
        entryType: 'BOUNCE_FEE_PENALTY',
        amount: parsedFee,
        referenceNo: refNo,
        notes: `Bank penalty fee for bounced outbound cheque ${refNo}`,
        createdBy: userId,
      });
    }

    const holdReason = `Bounced Outbound Cheque ${refNo} (Attempt #${attemptNumber})${reason ? ': ' + reason : ''}`;
    await client.query(
      `UPDATE supplier SET payment_hold = true, payment_hold_reason = $1 WHERE supplier_id = $2`,
      [holdReason, supplierId]
    );
  }

  await logOutboundClearanceEvent(client, {
    chequeType: resolveChequeTypeForAudit(cr),
    apPaymentId: cr.ap_payment_id,
    expenseId: cr.expense_id,
    chequeRecordId: cr.id,
    supplierId,
    bankAccountId: cr.bank_account_id,
    action: 'BOUNCED',
    attemptNumber,
    bounceReason: reason || 'NSF / Insufficient Funds',
    bounceFee: parsedFee,
    notes: reason,
    metadata: { reversedSettlement },
    createdBy: userId,
  });

  return {
    chequeRecordId: cr.id,
    apPaymentId: cr.ap_payment_id,
    bounceAttempt: attemptNumber,
    bounceFee: parsedFee,
    reversedSettlement,
  };
}

/**
 * Re-deposit / re-present a previously bounced outbound cheque.
 */
async function redepositOutboundCheque(client, { chequeRecordId, liftPaymentHold = false, notes = null, userId = null }) {
  const { rows: [cr] } = await client.query(
    `SELECT id, ap_payment_id, expense_id, purpose_type, status, is_deleted, bank_account_id, cheque_number
       FROM cheque_records WHERE id = $1 FOR UPDATE`,
    [chequeRecordId]
  );
  if (!cr) throw serviceError(404, 'CHEQUE_NOT_FOUND', `Cheque record #${chequeRecordId} not found`);
  if (cr.is_deleted) {
    throw serviceError(409, 'CHEQUE_HIDDEN_OR_DELETED', 'Cannot re-deposit a deleted or hidden cheque.');
  }
  if (cr.status !== 'BOUNCED') {
    throw serviceError(409, 'INVALID_CHEQUE_TRANSITION', `Only bounced cheques can be re-deposited. Current status: ${cr.status}`);
  }

  const prevRes = await client.query(
    `SELECT COUNT(*)::int AS count FROM cheque_clearance_log WHERE cheque_record_id = $1 AND action IN ('BOUNCED', 'REDEPOSITED')`,
    [chequeRecordId]
  );
  const attemptNumber = (prevRes.rows[0]?.count || 0) + 1;

  await client.query(`UPDATE cheque_records SET status = 'DEPOSITED', updated_at = now() WHERE id = $1`, [chequeRecordId]);

  let supplierId = null;
  if (cr.ap_payment_id) {
    const { rows: [ap] } = await client.query(`SELECT supplier_id FROM ap_payment WHERE payment_id = $1 FOR UPDATE`, [cr.ap_payment_id]);
    supplierId = ap.supplier_id;
    await client.query(`UPDATE ap_payment SET pdc_status = 'DEPOSITED' WHERE payment_id = $1`, [cr.ap_payment_id]);
    if (liftPaymentHold) {
      await client.query(`UPDATE supplier SET payment_hold = false, payment_hold_reason = NULL WHERE supplier_id = $1`, [supplierId]);
    }
  }

  await logOutboundClearanceEvent(client, {
    chequeType: resolveChequeTypeForAudit(cr),
    apPaymentId: cr.ap_payment_id,
    expenseId: cr.expense_id,
    chequeRecordId: cr.id,
    supplierId,
    bankAccountId: cr.bank_account_id,
    action: 'REDEPOSITED',
    attemptNumber,
    notes: notes || `Re-presented for bank clearance (Attempt #${attemptNumber})`,
    createdBy: userId,
  });

  return { chequeRecordId: cr.id, pdc_status: 'DEPOSITED', attemptNumber, liftedPaymentHold: liftPaymentHold };
}

/**
 * Void a cheque that was spoiled/abandoned without replacement.
 * Permanently reserves the cheque number; marks both cheque_records and ap_payment VOID.
 */
async function voidCheque(client, { chequeRecordId, reason, userId = null, expectedStatus = null }) {
  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if (!trimmedReason) {
    throw serviceError(400, 'VOID_REASON_REQUIRED', 'A void reason is required.');
  }

  const { rows: [cr] } = await client.query(
    `SELECT id, ap_payment_id, expense_id, purpose_type, status, is_deleted,
            bank_account_id, cheque_number, replaced_by_cheque_id
       FROM cheque_records WHERE id = $1 FOR UPDATE`,
    [chequeRecordId]
  );
  if (!cr) throw serviceError(404, 'CHEQUE_NOT_FOUND', `Cheque record #${chequeRecordId} not found`);

  if (expectedStatus && cr.status !== expectedStatus) {
    throw serviceError(
      409,
      'STALE_CHEQUE_STATE',
      `Cheque state changed from ${expectedStatus} to ${cr.status}. Refresh and try again.`,
      { currentStatus: cr.status }
    );
  }
  if (cr.is_deleted && cr.status !== 'DELETED') {
    throw serviceError(409, 'HIDDEN_LEGACY_RECORD', 'Restore visibility of this legacy hidden cheque before voiding it.');
  }
  if (['CLEARED', 'VOID', 'REPLACED', 'DELETED'].includes(cr.status) || cr.replaced_by_cheque_id) {
    throw serviceError(409, 'INVALID_CHEQUE_TRANSITION', `Cannot void a cheque with status ${cr.status}`);
  }

  let supplierId = null;
  if (cr.ap_payment_id) {
    const { rows: [ap] } = await client.query(
      `SELECT payment_id, supplier_id, pdc_status FROM ap_payment WHERE payment_id = $1 FOR UPDATE`,
      [cr.ap_payment_id]
    );
    if (ap) {
      supplierId = ap.supplier_id;
      if (ap.pdc_status === 'CLEARED') {
        throw serviceError(409, 'ALREADY_CLEARED', 'Cannot void a cleared supplier payment.');
      }
      await client.query(`SELECT supplier_id FROM supplier WHERE supplier_id = $1 FOR UPDATE`, [supplierId]);
      await client.query(
        `SELECT sb.bill_id FROM ap_payment_allocation apa JOIN supplier_bill sb ON sb.bill_id = apa.bill_id WHERE apa.payment_id = $1 ORDER BY sb.bill_id ASC FOR UPDATE OF sb`,
        [ap.payment_id]
      );
      await client.query(
        `UPDATE ap_payment
            SET pdc_status = 'VOID',
                voided_by = $1,
                voided_at = now(),
                void_reason = $2
          WHERE payment_id = $3`,
        [userId, trimmedReason, cr.ap_payment_id]
      );
    }
  }

  if (cr.expense_id) {
    const { rows: [exp] } = await client.query(
      `SELECT expense_id, TO_CHAR(expense_date, 'YYYY-MM-DD') AS expense_date, is_void
         FROM expense WHERE expense_id = $1 FOR UPDATE`,
      [cr.expense_id]
    );
    if (exp && !exp.is_void) {
      await periodLockService.assertPeriodOpen(exp.expense_date, { module: 'expenses', client });
      await client.query(
        `UPDATE expense
            SET is_void = true, voided_by = $1, voided_at = now(), void_reason = $2, modified_by = $1, updated_at = now()
          WHERE expense_id = $3`,
        [userId, trimmedReason, cr.expense_id]
      );
    }
  }

  await client.query(
    `UPDATE cheque_records
        SET status = 'VOID',
            is_void = true,
            voided_by = $1,
            voided_at = now(),
            void_reason = $2,
            updated_at = now()
      WHERE id = $3`,
    [userId, trimmedReason, chequeRecordId]
  );

  await logOutboundClearanceEvent(client, {
    chequeType: resolveChequeTypeForAudit(cr),
    apPaymentId: cr.ap_payment_id,
    expenseId: cr.expense_id,
    chequeRecordId: cr.id,
    supplierId,
    bankAccountId: cr.bank_account_id,
    action: 'VOID',
    notes: trimmedReason,
    metadata: { priorStatus: cr.status, chequeNumber: cr.cheque_number },
    createdBy: userId,
  });

  return { chequeRecordId: cr.id, apPaymentId: cr.ap_payment_id, expenseId: cr.expense_id, status: 'VOID' };
}

/**
 * Replace an outbound cheque (ISSUED, HELD_FOR_RELEASE, BOUNCED, STALE, or dynamically stale).
 * - Copies authoritative economic values server-side (payee, amount, purpose, memo, supplier, bills, expense).
 * - Retires original cheque_records (and ap_payment for supplier cheques) as REPLACED.
 * - For expense cheques: reuses the existing expense row (updates reference_no to new cheque number, keeps expense_date/category/amount/notes intact) so expenses are never duplicated.
 * - Resolves the target bank account's default print template when switching banks.
 */
async function replaceCheque(client, {
  chequeRecordId,
  newChequeNumber,
  newChequeDate = null,
  newBankAccountId = null,
  reasonCategory = 'Printing issue',
  reasonNotes = null,
  reason = null,
  confirmRecoveredOrStopped = false,
  expectedStatus = null,
  userId = null,
}) {
  const { rows: [cr] } = await client.query(
    `SELECT cr.*, TO_CHAR(cr.cheque_date, 'YYYY-MM-DD') AS cheque_date_str
       FROM cheque_records cr
      WHERE cr.id = $1
      FOR UPDATE`,
    [chequeRecordId]
  );
  if (!cr) throw serviceError(404, 'CHEQUE_NOT_FOUND', `Cheque record #${chequeRecordId} not found`);

  if (expectedStatus && cr.status !== expectedStatus) {
    throw serviceError(
      409,
      'STALE_CHEQUE_STATE',
      `Cheque state changed from ${expectedStatus} to ${cr.status}. Refresh and try again.`,
      { currentStatus: cr.status }
    );
  }
  if (cr.is_deleted && cr.status !== 'DELETED') {
    throw serviceError(
      409,
      'HIDDEN_LEGACY_RECORD',
      `Cheque #${cr.cheque_number || cr.id} was hidden by legacy print history deletion. Restore visibility before replacing.`
    );
  }
  if (['VOID', 'REPLACED', 'DELETED', 'CLEARED'].includes(cr.status) || cr.replaced_by_cheque_id) {
    const { rows: [succ] } = cr.replaced_by_cheque_id
      ? await client.query(`SELECT id, cheque_number, status FROM cheque_records WHERE id = $1`, [cr.replaced_by_cheque_id])
      : { rows: [] };
    throw serviceError(
      409,
      'CHEQUE_NOT_REPLACEABLE',
      succ
        ? `Cheque #${cr.cheque_number || cr.id} has already been replaced by cheque #${succ.cheque_number} (record #${succ.id}).`
        : `Cheque #${cr.cheque_number || cr.id} has status ${cr.status} and cannot be replaced.`,
      { currentStatus: cr.status, replacementCheque: succ || null }
    );
  }
  if (!cr.ap_payment_id && !cr.expense_id && !cr.cheque_number) {
    throw serviceError(400, 'STANDALONE_PRINT_NOT_REPLACEABLE', 'Unnumbered standalone print entries cannot be replaced.');
  }

  const { staleDays } = await getPdcSettings(client);
  const maturityInfo = computePdcMaturity({ ...cr, cheque_date: cr.cheque_date_str || cr.cheque_date }, staleDays);
  const isDynamicallyStale = maturityInfo.maturity_status === 'STALE_CHEQUE';

  const allowedStatuses = ['ISSUED', 'HELD_FOR_RELEASE', 'BOUNCED', 'STALE', 'DEPOSITED'];
  if (!allowedStatuses.includes(cr.status) && !isDynamicallyStale) {
    throw serviceError(409, 'CHEQUE_NOT_REPLACEABLE', `Cheque with status ${cr.status} cannot be replaced.`);
  }
  if (cr.status === 'DEPOSITED' && !confirmRecoveredOrStopped) {
    throw serviceError(
      409,
      'RECOVERY_CONFIRMATION_REQUIRED',
      'This cheque is marked DEPOSITED. Confirm that the physical cheque was recovered or a stop-payment order was confirmed before replacing it.'
    );
  }

  // Validate reason
  const validCategories = ['Printing issue', 'Damaged cheque', 'Stale cheque', 'Bounced cheque', 'Other'];
  const normalizedCategory = reasonCategory && validCategories.includes(reasonCategory) ? reasonCategory : (reason ? 'Other' : 'Printing issue');
  const trimmedNotes = typeof (reasonNotes ?? reason) === 'string' ? String(reasonNotes ?? reason).trim() : '';
  if (normalizedCategory === 'Other' && !trimmedNotes) {
    throw serviceError(400, 'REASON_NOTES_REQUIRED', 'Please provide a note explaining the replacement reason when selecting "Other".');
  }
  const combinedReason = trimmedNotes
    ? (normalizedCategory === 'Other' && reason && !reasonNotes ? trimmedNotes : `${normalizedCategory}: ${trimmedNotes}`)
    : normalizedCategory;

  const normalizedNumber = validateAndNormalizeChequeNumber(newChequeNumber);
  const effectiveDateStr = newChequeDate ? String(newChequeDate).trim().slice(0, 10) : (cr.cheque_date_str || null);
  const normalizedDate = validateOperatingDate(effectiveDateStr, 'Cheque date');

  // Lock source and target bank accounts in id order
  const targetBankAccountId = Number(newBankAccountId || cr.bank_account_id);
  const sourceBankAccountId = Number(cr.bank_account_id);
  const bankIdsToLock = [...new Set([sourceBankAccountId, targetBankAccountId].filter(Boolean))].sort((a, b) => a - b);
  const { rows: lockedBanks } = await client.query(
    `SELECT bank_account_id, account_name, bank_name, account_number, currency, is_active, default_cheque_template_id
       FROM bank_account
      WHERE bank_account_id = ANY($1::int[])
      ORDER BY bank_account_id ASC
      FOR UPDATE`,
    [bankIdsToLock]
  );
  const bankMap = new Map(lockedBanks.map((b) => [Number(b.bank_account_id), b]));
  const sourceBank = bankMap.get(sourceBankAccountId);
  const targetBank = bankMap.get(targetBankAccountId);

  if (!targetBank) {
    throw serviceError(404, 'BANK_ACCOUNT_NOT_FOUND', 'Selected replacement bank account was not found.');
  }
  if (!targetBank.is_active) {
    throw serviceError(409, 'BANK_ACCOUNT_INACTIVE', `Replacement bank account "${targetBank.account_name}" is inactive.`);
  }
  if (sourceBank && (sourceBank.currency || 'PHP') !== (targetBank.currency || 'PHP')) {
    throw serviceError(
      400,
      'BANK_CURRENCY_MISMATCH',
      `Cannot replace a ${sourceBank.currency || 'PHP'} cheque with a ${targetBank.currency || 'PHP'} account (${targetBank.account_name}). Currency conversion is not supported in exact-copy replacement.`
    );
  }
  if (targetBankAccountId === sourceBankAccountId && normalizedNumber === String(cr.cheque_number || '').trim()) {
    throw serviceError(
      400,
      'SAME_CHEQUE_NUMBER',
      `Replacement cheque number (#${normalizedNumber}) cannot be the same as the original cheque on the same bank account.`
    );
  }

  // Check if new bank + number is already reserved
  const conflict = await findConflictingCheque(client, targetBankAccountId, normalizedNumber, cr.id);
  if (conflict) {
    throw serviceError(
      409,
      'CHEQUE_NUMBER_RESERVED',
      `Cheque #${normalizedNumber} is already recorded for ${targetBank.account_name} (status: ${conflict.status}${conflict.is_deleted ? ', hidden' : ''}).`,
      { conflictingCheque: conflict }
    );
  }

  // Resolve print template:
  // If same bank account, keep cr.template_id || targetBank.default_cheque_template_id.
  // If bank account changed, use ONLY targetBank.default_cheque_template_id (never silently copy another bank's layout).
  const resolvedTemplateId = targetBankAccountId === sourceBankAccountId
    ? (cr.template_id || targetBank.default_cheque_template_id || null)
    : (targetBank.default_cheque_template_id || null);

  let newApPaymentId = null;
  let newExpenseId = null;
  let supplierId = null;

  if (cr.ap_payment_id) {
    const { rows: [oldAp] } = await client.query(
      `SELECT * FROM ap_payment WHERE payment_id = $1 FOR UPDATE`,
      [cr.ap_payment_id]
    );
    if (!oldAp) {
      throw serviceError(404, 'AP_PAYMENT_NOT_FOUND', `Original AP payment #${cr.ap_payment_id} not found.`);
    }
    if (['CLEARED', 'VOID', 'REPLACED', 'DELETED'].includes(oldAp.pdc_status)) {
      throw serviceError(409, 'INVALID_PAYMENT_STATE', `Original AP payment has status ${oldAp.pdc_status} and cannot be replaced.`);
    }
    supplierId = oldAp.supplier_id;

    // Check remittance / cash custody links on oldAp
    const { rows: [apDeps] } = await client.query(
      `SELECT
         EXISTS (
           SELECT 1 FROM loan_remittance r
            WHERE r.treasury_ap_payment_id = $1
              AND r.amount > COALESCE((
                SELECT SUM(c.amount)
                  FROM loan_remittance_correction c
                  JOIN loan_remittance_allocation a USING (remittance_allocation_id)
                 WHERE a.remittance_id = r.remittance_id
              ), 0)
         ) AS remittance_linked,
         EXISTS (SELECT 1 FROM cash_drawer_movement WHERE ap_payment_id = $1)
           OR EXISTS (SELECT 1 FROM cash_advance_event WHERE ap_payment_id = $1) AS cash_linked`,
      [oldAp.payment_id]
    );
    if (apDeps?.remittance_linked) {
      throw serviceError(409, 'REMITTANCE_LINKED', 'Correct agency loan remittance attribution before replacing its Treasury payment.');
    }
    if (apDeps?.cash_linked) {
      throw serviceError(409, 'CASH_CUSTODY_LINKED', 'Cash-linked payment cannot be replaced here.');
    }

    // Lock supplier and check active status / payment hold
    const { rows: [supplier] } = await client.query(
      `SELECT supplier_id, supplier_name, is_active, is_merged, payment_hold, payment_hold_reason
         FROM supplier WHERE supplier_id = $1 FOR UPDATE`,
      [supplierId]
    );
    if (!supplier || supplier.is_merged || supplier.is_active === false) {
      throw serviceError(409, 'SUPPLIER_INACTIVE_OR_MERGED', 'Supplier is inactive or merged; cannot issue a replacement payment.');
    }
    // Note: if the cheque bounced, it placed the supplier on hold for this exact cheque;
    // do not silently lift the hold, and if held for another reason while ISSUED, block unless bounce replacement.
    if (supplier.payment_hold && cr.status !== 'BOUNCED') {
      throw serviceError(
        409,
        'PAYMENT_HOLD_BLOCKED',
        `Supplier "${supplier.supplier_name}" is on payment hold${supplier.payment_hold_reason ? ': ' + supplier.payment_hold_reason : ''}.`
      );
    }

    // Fetch original allocations and revalidate against open bills (excluding oldAp.payment_id)
    const { rows: origAllocs } = await client.query(
      `SELECT bill_id, amount_allocated FROM ap_payment_allocation WHERE payment_id = $1 ORDER BY bill_id ASC`,
      [oldAp.payment_id]
    );

    if (origAllocs.length > 0) {
      const requestedAllocs = origAllocs.map((a) => ({
        bill_id: Number(a.bill_id),
        amount: Number(a.amount_allocated),
      }));
      const { rows: [{ dated_on: datedOn }] } = await client.query(
        `SELECT $1::date AS dated_on`,
        [normalizedDate]
      );
      await apPaymentService.resolveAllocations(client, {
        supplierId,
        amount: Number(oldAp.amount),
        allocations: requestedAllocs,
        settledOn: datedOn,
        excludePaymentId: oldAp.payment_id,
        checkSettledDateAgainstBill: false,
      });
    }

    // Preserve original payment_date, reference_number (unless it was just the old cheque number), and notes!
    const preservedRef = (oldAp.reference_number && oldAp.reference_number !== cr.cheque_number)
      ? oldAp.reference_number
      : oldAp.reference_number;
    const preservedNotes = oldAp.notes;

    const { rows: [newAp] } = await client.query(
      `INSERT INTO ap_payment
         (supplier_id, employee_id, payment_date, amount, method_id, reference_number, notes,
          pdc_status, cheque_date, bank_account_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'ISSUED', $8, $9, $10)
       RETURNING payment_id`,
      [
        oldAp.supplier_id,
        oldAp.employee_id,
        oldAp.payment_date,
        oldAp.amount,
        oldAp.method_id,
        preservedRef,
        preservedNotes,
        normalizedDate,
        targetBankAccountId,
        userId,
      ]
    );
    newApPaymentId = newAp.payment_id;

    for (const alloc of origAllocs) {
      await client.query(
        `INSERT INTO ap_payment_allocation (payment_id, bill_id, amount_allocated) VALUES ($1, $2, $3)`,
        [newApPaymentId, alloc.bill_id, alloc.amount_allocated]
      );
    }

    await client.query(
      `UPDATE ap_payment SET pdc_status = 'REPLACED' WHERE payment_id = $1`,
      [oldAp.payment_id]
    );

    // If goods_receipt_freight referenced the old ap_payment, point it to the replacement ap_payment
    await client.query(
      `UPDATE goods_receipt_freight SET payment_id = $1 WHERE payment_id = $2`,
      [newApPaymentId, oldAp.payment_id]
    );
  } else if (cr.expense_id) {
    // Reuse the existing expense identity so expenses are never duplicated!
    const { rows: [oldExp] } = await client.query(
      `SELECT * FROM expense WHERE expense_id = $1 FOR UPDATE`,
      [cr.expense_id]
    );
    if (!oldExp) {
      throw serviceError(404, 'EXPENSE_NOT_FOUND', `Linked expense #${cr.expense_id} not found.`);
    }
    if (oldExp.is_void) {
      throw serviceError(409, 'EXPENSE_VOIDED', 'Cannot replace cheque for a voided expense.');
    }
    // Check remittance link on expense (note: employee_remittance_source_guard blocks changing reference_no if remittance linked)
    const { rows: [expDeps] } = await client.query(
      `SELECT
         EXISTS (
           SELECT 1 FROM loan_remittance r
            WHERE r.treasury_expense_id = $1
              AND r.amount > COALESCE((
                SELECT SUM(c.amount)
                  FROM loan_remittance_correction c
                  JOIN loan_remittance_allocation a USING (remittance_allocation_id)
                 WHERE a.remittance_id = r.remittance_id
              ), 0)
         ) AS remittance_linked,
         EXISTS (SELECT 1 FROM cash_drawer_movement WHERE expense_id = $1)
           OR EXISTS (SELECT 1 FROM cash_advance_event WHERE expense_id = $1) AS cash_linked`,
      [oldExp.expense_id]
    );
    if (expDeps?.remittance_linked) {
      throw serviceError(409, 'REMITTANCE_LINKED', 'Correct agency loan remittance attribution before replacing its Treasury cheque.');
    }
    if (expDeps?.cash_linked) {
      throw serviceError(409, 'CASH_CUSTODY_LINKED', 'Cash-linked expense cheque cannot be replaced.');
    }

    // Keep expense_date, category_id, amount, payee, notes fixed; do not rewrite the expense row
    // if reference_no is unchanged or if period is locked, avoiding blocking a purely instrument-level replacement.
    newExpenseId = oldExp.expense_id;
  }

  // First mark old cheque REPLACED so the partial unique index uq_cheque_records_active_expense
  // allows inserting the new active cheque for the same expense_id.
  await client.query(
    `UPDATE cheque_records SET status = 'REPLACED', updated_at = now() WHERE id = $1`,
    [cr.id]
  );

  const { rows: [newCr] } = await client.query(
    `INSERT INTO cheque_records
       (template_id, payee, amount, cheque_date, memo, bank_account_id, cheque_number,
        status, purpose_type, ap_payment_id, expense_id, replaces_cheque_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'ISSUED', $8, $9, $10, $11)
     RETURNING id`,
    [
      resolvedTemplateId,
      cr.payee,
      cr.amount,
      normalizedDate,
      cr.memo,
      targetBankAccountId,
      normalizedNumber,
      cr.purpose_type,
      newApPaymentId,
      newExpenseId,
      cr.id,
    ]
  );

  await client.query(
    `UPDATE cheque_records SET replaced_by_cheque_id = $1, updated_at = now() WHERE id = $2`,
    [newCr.id, cr.id]
  );

  if (newApPaymentId) {
    await client.query(
      `UPDATE ap_payment SET cheque_record_id = $1 WHERE payment_id = $2`,
      [newCr.id, newApPaymentId]
    );
  }

  const chequeType = resolveChequeTypeForAudit(cr);
  await logOutboundClearanceEvent(client, {
    chequeType,
    apPaymentId: cr.ap_payment_id,
    expenseId: cr.expense_id,
    chequeRecordId: cr.id,
    supplierId,
    bankAccountId: cr.bank_account_id,
    action: 'REPLACED',
    notes: `Replaced by cheque #${normalizedNumber} (record #${newCr.id}) — ${combinedReason}`,
    metadata: {
      priorStatus: cr.status,
      oldChequeNumber: cr.cheque_number,
      oldBankAccountId: cr.bank_account_id,
      newChequeRecordId: newCr.id,
      newChequeNumber: normalizedNumber,
      newBankAccountId: targetBankAccountId,
      newChequeDate: normalizedDate,
      reasonCategory: normalizedCategory,
      reasonNotes: trimmedNotes || null,
    },
    createdBy: userId,
  });

  return {
    oldChequeRecordId: cr.id,
    oldChequeNumber: cr.cheque_number,
    newChequeRecordId: newCr.id,
    newChequeNumber: normalizedNumber,
    newChequeDate: normalizedDate,
    newBankAccountId: targetBankAccountId,
    newBankAccountName: targetBank.account_name,
    newApPaymentId,
    newExpenseId,
    templateId: resolvedTemplateId,
    missingTemplate: !resolvedTemplateId,
  };
}

/**
 * Shared erroneous-payment deletion service.
 * Marks the active unsettled cheque_records and ap_payment as DELETED, releasing
 * the cheque number on that bank account via the partial unique index
 * `WHERE cheque_number IS NOT NULL AND status <> 'DELETED'`.
 * Never reactivates an ancestor in a replacement chain.
 */
async function deleteErroneousPayment(client, {
  chequeRecordId = null,
  apPaymentId = null,
  reason,
  expectedStatus = null,
  userId = null,
}) {
  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if (!trimmedReason) {
    throw serviceError(400, 'DELETE_REASON_REQUIRED', 'A reason is required to delete a payment.');
  }

  let cr = null;
  let ap = null;

  if (chequeRecordId) {
    const { rows } = await client.query(
      `SELECT * FROM cheque_records WHERE id = $1 FOR UPDATE`,
      [chequeRecordId]
    );
    cr = rows[0] || null;
    if (!cr) {
      throw serviceError(404, 'CHEQUE_NOT_FOUND', `Cheque record #${chequeRecordId} not found.`);
    }
    if (cr.ap_payment_id) {
      apPaymentId = cr.ap_payment_id;
    }
  }

  if (apPaymentId) {
    const { rows } = await client.query(
      `SELECT * FROM ap_payment WHERE payment_id = $1 FOR UPDATE`,
      [apPaymentId]
    );
    ap = rows[0] || null;
    if (!ap && !cr) {
      throw serviceError(404, 'PAYMENT_NOT_FOUND', `Payment #${apPaymentId} not found.`);
    }
    if (ap?.cheque_record_id && !cr) {
      const { rows: crRows } = await client.query(
        `SELECT * FROM cheque_records WHERE id = $1 FOR UPDATE`,
        [ap.cheque_record_id]
      );
      cr = crRows[0] || null;
    }
  }

  if (!cr && ap) {
    throw serviceError(
      409,
      'DIRECT_SETTLED_PAYMENT_NOT_DELETABLE',
      'Direct non-cheque payments are already settled in the AP ledger and have no cheque number to release. Use an audited ledger adjustment or source correction instead.'
    );
  }

  if (!cr) {
    throw serviceError(404, 'CHEQUE_NOT_FOUND', 'Cheque record not found.');
  }

  // Standalone unnumbered print-only record
  if (!cr.ap_payment_id && !cr.expense_id && !cr.cheque_number) {
    if (cr.is_deleted) {
      throw serviceError(409, 'ALREADY_DELETED', 'Print entry was already removed.');
    }
    await client.query(
      `UPDATE cheque_records
          SET is_deleted = true,
              deleted_at = now(),
              deleted_by = $1,
              deleted_reason = $2,
              updated_at = now()
        WHERE id = $3`,
      [userId, trimmedReason, cr.id]
    );
    return {
      kind: 'STANDALONE_PRINT',
      chequeRecordId: cr.id,
      status: cr.status,
      isDeleted: true,
      releasedChequeNumber: null,
    };
  }

  if (expectedStatus && cr.status !== expectedStatus) {
    throw serviceError(
      409,
      'STALE_CHEQUE_STATE',
      `Cheque state changed from ${expectedStatus} to ${cr.status}. Refresh and try again.`,
      { currentStatus: cr.status }
    );
  }
  if (cr.is_deleted && cr.status !== 'DELETED') {
    throw serviceError(
      409,
      'HIDDEN_LEGACY_RECORD',
      `Cheque #${cr.cheque_number || cr.id} was hidden by legacy print history deletion. Restore visibility before deleting.`
    );
  }
  if (cr.status === 'DELETED') {
    throw serviceError(409, 'ALREADY_DELETED', `Payment for cheque #${cr.cheque_number || cr.id} is already deleted.`);
  }
  if (['VOID', 'REPLACED'].includes(cr.status) || cr.replaced_by_cheque_id) {
    throw serviceError(
      409,
      'RETIRED_INSTRUMENT_NUMBER_RESERVED',
      `Cheque #${cr.cheque_number || cr.id} is permanently retired (${cr.status}) and its number cannot be released.`
    );
  }
  if (cr.status === 'CLEARED' || ap?.pdc_status === 'CLEARED') {
    throw serviceError(
      409,
      'ALREADY_CLEARED',
      `Cheque #${cr.cheque_number || cr.id} has already cleared and cannot be deleted as an unused erroneous entry.`
    );
  }
  if (['DEPOSITED', 'BOUNCED'].includes(cr.status)) {
    throw serviceError(
      409,
      'INSTRUMENT_PRESENTED',
      `Cheque #${cr.cheque_number || cr.id} has status ${cr.status} (already deposited/presented) and its number cannot be reused. Use Replace or Void instead.`
    );
  }

  let supplierId = null;
  if (ap) {
    supplierId = ap.supplier_id;
    const { rows: [deps] } = await client.query(
      `SELECT
         EXISTS (
           SELECT 1 FROM loan_remittance r
            WHERE r.treasury_ap_payment_id = $1
              AND r.amount > COALESCE((
                SELECT SUM(c.amount)
                  FROM loan_remittance_correction c
                  JOIN loan_remittance_allocation a USING (remittance_allocation_id)
                 WHERE a.remittance_id = r.remittance_id
              ), 0)
         ) AS remittance_linked,
         EXISTS (SELECT 1 FROM cash_drawer_movement WHERE ap_payment_id = $1)
           OR EXISTS (SELECT 1 FROM cash_advance_event WHERE ap_payment_id = $1) AS cash_linked,
         EXISTS (SELECT 1 FROM goods_receipt_freight WHERE payment_id = $1) AS freight_linked,
         (
           SELECT COUNT(*) FILTER (WHERE entry_type = 'PAYMENT_SETTLED')
                - COUNT(*) FILTER (WHERE entry_type = 'PDC_BOUNCED_REVERSAL')
             FROM ap_ledger
            WHERE payment_id = $1
         ) > 0 AS settled_in_ledger`,
      [ap.payment_id]
    );
    if (deps?.remittance_linked) {
      throw serviceError(409, 'REMITTANCE_LINKED', 'Linked to an agency loan remittance. Correct the remittance attribution before deleting its Treasury source.');
    }
    if (deps?.cash_linked) {
      throw serviceError(409, 'CASH_CUSTODY_LINKED', 'Linked to cash drawer or advance custody records.');
    }
    if (deps?.freight_linked) {
      throw serviceError(409, 'FREIGHT_LINKED', 'Linked to a Goods Receipt freight charge. Detach or correct the freight charge on the Goods Receipt first.');
    }
    if (deps?.settled_in_ledger) {
      throw serviceError(409, 'ALREADY_SETTLED_IN_LEDGER', 'Payment has an active settlement in the AP ledger and cannot be deleted.');
    }

    await client.query(`SELECT supplier_id FROM supplier WHERE supplier_id = $1 FOR UPDATE`, [supplierId]);
    await client.query(
      `SELECT sb.bill_id FROM ap_payment_allocation apa JOIN supplier_bill sb ON sb.bill_id = apa.bill_id WHERE apa.payment_id = $1 ORDER BY sb.bill_id ASC FOR UPDATE OF sb`,
      [ap.payment_id]
    );

    await client.query(
      `UPDATE ap_payment
          SET pdc_status = 'DELETED',
              deleted_by = $1,
              deleted_at = now(),
              deleted_reason = $2
        WHERE payment_id = $3`,
      [userId, trimmedReason, ap.payment_id]
    );
  }

  if (cr.expense_id) {
    const { rows: [exp] } = await client.query(
      `SELECT expense_id, TO_CHAR(expense_date, 'YYYY-MM-DD') AS expense_date, is_void
         FROM expense WHERE expense_id = $1 FOR UPDATE`,
      [cr.expense_id]
    );
    if (exp) {
      const { rows: [expDeps] } = await client.query(
        `SELECT
           EXISTS (
             SELECT 1 FROM loan_remittance r
              WHERE r.treasury_expense_id = $1
                AND r.amount > COALESCE((
                  SELECT SUM(c.amount)
                    FROM loan_remittance_correction c
                    JOIN loan_remittance_allocation a USING (remittance_allocation_id)
                   WHERE a.remittance_id = r.remittance_id
                ), 0)
           ) AS remittance_linked,
           EXISTS (SELECT 1 FROM cash_drawer_movement WHERE expense_id = $1)
             OR EXISTS (SELECT 1 FROM cash_advance_event WHERE expense_id = $1) AS cash_linked`,
        [exp.expense_id]
      );
      if (expDeps?.remittance_linked) {
        throw serviceError(409, 'REMITTANCE_LINKED', 'Linked to an agency loan remittance. Correct remittance attribution before deleting.');
      }
      if (expDeps?.cash_linked) {
        throw serviceError(409, 'CASH_CUSTODY_LINKED', 'Linked to cash custody records.');
      }
      if (!exp.is_void) {
        await periodLockService.assertPeriodOpen(exp.expense_date, { module: 'expenses', client });
        await client.query(
          `UPDATE expense
              SET is_void = true,
                  voided_by = $1,
                  voided_at = now(),
                  void_reason = $2,
                  modified_by = $1,
                  updated_at = now()
            WHERE expense_id = $3`,
          [userId, `Payment deleted: ${trimmedReason}`, exp.expense_id]
        );
      }
    }
  }

  // Note: If cr was a replacement (cr.replaces_cheque_id IS NOT NULL), we preserve the historical
  // link (A -> deleted B) and NEVER automatically reactivate ancestor A.
  await client.query(
    `UPDATE cheque_records
        SET status = 'DELETED',
            is_deleted = true,
            deleted_at = now(),
            deleted_by = $1,
            deleted_reason = $2,
            updated_at = now()
      WHERE id = $3`,
    [userId, trimmedReason, cr.id]
  );

  const { rows: [bankAcc] } = cr.bank_account_id
    ? await client.query(`SELECT account_name, bank_name FROM bank_account WHERE bank_account_id = $1`, [cr.bank_account_id])
    : { rows: [] };

  await logOutboundClearanceEvent(client, {
    chequeType: resolveChequeTypeForAudit(cr),
    apPaymentId: cr.ap_payment_id,
    expenseId: cr.expense_id,
    chequeRecordId: cr.id,
    supplierId,
    bankAccountId: cr.bank_account_id,
    action: 'DELETED',
    notes: trimmedReason,
    metadata: {
      priorStatus: cr.status,
      releasedChequeNumber: cr.cheque_number,
      bankAccountId: cr.bank_account_id,
      bankAccountName: bankAcc?.account_name || null,
      amount: cr.amount,
      payee: cr.payee,
      replacesChequeId: cr.replaces_cheque_id || null,
    },
    createdBy: userId,
  });

  return {
    kind: cr.ap_payment_id ? 'SUPPLIER_CHEQUE' : 'EXPENSE_CHEQUE',
    chequeRecordId: cr.id,
    apPaymentId: cr.ap_payment_id || null,
    expenseId: cr.expense_id || null,
    status: 'DELETED',
    releasedChequeNumber: cr.cheque_number,
    bankAccountId: cr.bank_account_id,
    bankAccountName: bankAcc?.account_name || null,
    replacesChequeId: cr.replaces_cheque_id || null,
  };
}

/**
 * Restore visibility of a numbered financial cheque that was hidden by legacy Print History delete.
 * Does NOT release its number or change its financial status.
 */
async function restoreHiddenChequeVisibility(client, { chequeRecordId, reason = null, userId = null }) {
  const { rows: [cr] } = await client.query(
    `SELECT * FROM cheque_records WHERE id = $1 FOR UPDATE`,
    [chequeRecordId]
  );
  if (!cr) throw serviceError(404, 'CHEQUE_NOT_FOUND', `Cheque record #${chequeRecordId} not found.`);
  if (cr.status === 'DELETED') {
    throw serviceError(409, 'ALREADY_DELETED', 'Deleted payments with released numbers cannot be restored.');
  }
  if (!cr.is_deleted) {
    return { chequeRecordId: cr.id, status: cr.status, isDeleted: false };
  }

  await client.query(
    `UPDATE cheque_records
        SET is_deleted = false,
            deleted_at = NULL,
            updated_at = now()
      WHERE id = $1`,
    [cr.id]
  );

  let supplierId = null;
  if (cr.ap_payment_id) {
    const { rows: [ap] } = await client.query(`SELECT supplier_id FROM ap_payment WHERE payment_id = $1`, [cr.ap_payment_id]);
    supplierId = ap?.supplier_id || null;
  }

  await logOutboundClearanceEvent(client, {
    chequeType: resolveChequeTypeForAudit(cr),
    apPaymentId: cr.ap_payment_id,
    expenseId: cr.expense_id,
    chequeRecordId: cr.id,
    supplierId,
    bankAccountId: cr.bank_account_id,
    action: 'RESTORED',
    notes: reason || 'Restored visibility of legacy hidden cheque record',
    metadata: { status: cr.status, chequeNumber: cr.cheque_number },
    createdBy: userId,
  });

  return { chequeRecordId: cr.id, chequeNumber: cr.cheque_number, status: cr.status, isDeleted: false };
}

/**
 * Fetch audit history for a specific outbound cheque, including replacement chain events.
 */
async function getOutboundClearanceHistory(db, chequeRecordId) {
  const { rows } = await db.query(
    `SELECT l.log_id, l.cheque_type, l.cheque_record_id, l.ap_payment_id, l.expense_id,
            l.action, l.attempt_number, l.bounce_reason, l.bounce_fee, l.notes,
            l.metadata, l.created_at, l.created_by,
            u.username AS created_by_username,
            TRIM(BOTH ' ' FROM COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS created_by_name
     FROM cheque_clearance_log l
     LEFT JOIN employee u ON u.employee_id = l.created_by
     WHERE l.cheque_record_id = $1
       AND l.cheque_type IN ('OUTBOUND_SUPPLIER', 'OUTBOUND_EXPENSE', 'OUTBOUND_STANDALONE')
     ORDER BY l.created_at ASC, l.log_id ASC`,
    [chequeRecordId]
  );
  return rows;
}

/**
 * Operational KPI summary stats for Treasury Desk.
 * Excludes VOID, REPLACED, and DELETED records so retired attempts never inflate active totals.
 */
async function getOutboundPdcSummaryStats(db) {
  const query = `
    SELECT
      COUNT(CASE WHEN cr.status IN ('ISSUED', 'HELD_FOR_RELEASE') THEN 1 END)::int AS held_for_release_count,
      COALESCE(SUM(CASE WHEN cr.status IN ('ISSUED', 'HELD_FOR_RELEASE') THEN cr.amount ELSE 0 END), 0) AS held_for_release_total,
      COUNT(CASE WHEN cr.status IN ('ISSUED', 'HELD_FOR_RELEASE', 'DEPOSITED') AND cr.cheque_date <= CURRENT_DATE THEN 1 END)::int AS due_today_count,
      COALESCE(SUM(CASE WHEN cr.status IN ('ISSUED', 'HELD_FOR_RELEASE', 'DEPOSITED') AND cr.cheque_date <= CURRENT_DATE THEN cr.amount ELSE 0 END), 0) AS due_today_total,
      COALESCE(SUM(CASE WHEN cr.status = 'CLEARED' AND DATE_TRUNC('month', cr.updated_at) = DATE_TRUNC('month', CURRENT_DATE) THEN cr.amount ELSE 0 END), 0) AS cleared_month_total,
      COUNT(CASE WHEN cr.status = 'BOUNCED' THEN 1 END)::int AS bounced_count,
      COALESCE(SUM(CASE WHEN cr.status = 'BOUNCED' THEN cr.amount ELSE 0 END), 0) AS bounced_total
    FROM cheque_records cr
    WHERE cr.is_deleted = false
      AND cr.status NOT IN ('VOID', 'REPLACED', 'DELETED')
      AND (cr.ap_payment_id IS NOT NULL OR cr.expense_id IS NOT NULL)
  `;
  const { rows } = await db.query(query);
  return rows[0] || {
    held_for_release_count: 0, held_for_release_total: 0,
    due_today_count: 0, due_today_total: 0,
    cleared_month_total: 0, bounced_count: 0, bounced_total: 0,
  };
}

module.exports = {
  getPdcSettings,
  logOutboundClearanceEvent,
  resolveChequeTypeForAudit,
  validateAndNormalizeChequeNumber,
  validateOperatingDate,
  beginLifecycleRequest,
  finishLifecycleRequest,
  findConflictingCheque,
  suggestNextChequeNumber,
  issueOutboundCheque,
  evaluateChequeActionEligibility,
  getOutboundClearanceList,
  verifyOutboundPayment,
  processBouncedOutboundCheque,
  redepositOutboundCheque,
  voidCheque,
  replaceCheque,
  deleteErroneousPayment,
  restoreHiddenChequeVisibility,
  getOutboundClearanceHistory,
  getOutboundPdcSummaryStats,
};
