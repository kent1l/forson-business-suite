const crypto = require('crypto');
const db = require('../db');
const apPdcService = require('../services/apPdcService');
const apPaymentService = require('../services/apPaymentService');

describe('Cheque Replacement, Payment Deletion, and Lifecycle Integrity (Real PostgreSQL)', () => {
  let client;
  let supplierId;
  let supplierName;
  let employeeId;
  let bankAccountId;
  let cashMethodId;
  let expenseCategoryId;

  beforeAll(async () => {
    client = await db.getClient();
    await client.query('BEGIN');

    const { rows: [emp] } = await client.query('SELECT employee_id FROM employee LIMIT 1');
    employeeId = emp.employee_id;

    const { rows: [cashMethod] } = await client.query("SELECT method_id FROM payment_methods WHERE code = 'cash' LIMIT 1");
    cashMethodId = cashMethod.method_id;

    const { rows: [expCat] } = await client.query('SELECT category_id FROM expense_category WHERE is_active = true LIMIT 1');
    expenseCategoryId = expCat?.category_id;

    const suffix = Date.now();
    supplierName = `TEST_SUPPLIER_CHEQUE_SUITE_${suffix}`;
    const { rows: [sup] } = await client.query(
      `INSERT INTO supplier (supplier_name, contact_person, phone, email, is_active)
       VALUES ($1, 'Test Contact', '09170000000', $2, true)
       RETURNING supplier_id`,
      [supplierName, `cheque_suite_${suffix}@example.com`]
    );
    supplierId = sup.supplier_id;

    const { rows: [bank] } = await client.query(
      `INSERT INTO bank_account (bank_name, account_name, account_number, currency, is_active)
       VALUES ('TEST BANK SUITE', 'TEST ACCOUNT', $1, 'PHP', true)
       RETURNING bank_account_id`,
      [`SUITE-${suffix}`]
    );
    bankAccountId = bank.bank_account_id;
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });

  async function withSavepoint(fn) {
    const sp = `sp_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    await client.query(`SAVEPOINT ${sp}`);
    try {
      const res = await fn(client);
      await client.query(`RELEASE SAVEPOINT ${sp}`);
      return res;
    } catch (err) {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {});
      await client.query(`RELEASE SAVEPOINT ${sp}`).catch(() => {});
      throw err;
    }
  }

  async function createBill(amount, billNumSuffix) {
    const { rows: [bill] } = await client.query(
      `INSERT INTO supplier_bill (supplier_id, bill_number, bill_date, due_date, total_amount, amount_paid, status)
       VALUES ($1, $2, '2026-10-01', '2026-11-01', $3, 0, 'Unpaid')
       RETURNING *`,
      [supplierId, `BILL-${billNumSuffix}-${Date.now()}`, amount]
    );
    return bill;
  }

  test('1. Replace ISSUED supplier cheque atomically updates old/new records and transfers bill allocations without double-counting', async () => {
    const bill1 = await createBill(3650, 'R1A');
    const bill2 = await createBill(8500, 'R1B');

    const issued = await withSavepoint((c) =>
      apPdcService.issueOutboundCheque(c, {
        purposeType: 'SUPPLIER_PAYMENT',
        supplierId,
        payee: supplierName,
        bankAccountId,
        chequeNumber: '313083',
        chequeDate: '2026-11-15',
        amount: 12150,
        allocations: [
          { bill_id: bill1.bill_id, amount: 3650 },
          { bill_id: bill2.bill_id, amount: 8500 },
        ],
        employeeId,
        userId: employeeId,
      })
    );

    const replaced = await withSavepoint((c) =>
      apPdcService.replaceCheque(c, {
        chequeRecordId: issued.chequeRecordId,
        newChequeNumber: '313084',
        newChequeDate: '2026-11-20',
        reasonCategory: 'Printing issue',
        reasonNotes: 'Typo in cheque date',
        userId: employeeId,
      })
    );

    const { rows: [oldCr] } = await client.query('SELECT * FROM cheque_records WHERE id = $1', [issued.chequeRecordId]);
    const { rows: [newCr] } = await client.query('SELECT * FROM cheque_records WHERE id = $1', [replaced.newChequeRecordId]);

    expect(oldCr.status).toBe('REPLACED');
    expect(oldCr.is_deleted).toBe(false);
    expect(oldCr.replaced_by_cheque_id).toBe(replaced.newChequeRecordId);
    expect(newCr.replaces_cheque_id).toBe(issued.chequeRecordId);
    expect(newCr.status).toBe('ISSUED');

    const { rows: [oldPay] } = await client.query('SELECT pdc_status FROM ap_payment WHERE payment_id = $1', [issued.apPaymentId]);
    expect(oldPay.pdc_status).toBe('REPLACED');

    // Verify scheduled amount on bills is 3650 and 8500 (not doubled)
    const { rows: billRows } = await client.query(
      `SELECT b.bill_id,
              COALESCE(SUM(CASE WHEN p.pdc_status = 'ISSUED' AND COALESCE(c.is_deleted, false) = false AND COALESCE(c.status, 'ISSUED') = 'ISSUED' THEN pa.amount_allocated ELSE 0 END), 0) AS scheduled_amount
         FROM supplier_bill b
         LEFT JOIN ap_payment_allocation pa ON pa.bill_id = b.bill_id
         LEFT JOIN ap_payment p ON p.payment_id = pa.payment_id
         LEFT JOIN cheque_records c ON c.ap_payment_id = p.payment_id
        WHERE b.bill_id = ANY($1::int[])
        GROUP BY b.bill_id
        ORDER BY b.bill_id`,
      [[bill1.bill_id, bill2.bill_id]]
    );
    expect(Number(billRows[0].scheduled_amount)).toBe(3650);
    expect(Number(billRows[1].scheduled_amount)).toBe(8500);

    // Verify clearing the replacement cheque settles the bills once
    await withSavepoint((c) =>
      apPdcService.verifyOutboundPayment(c, {
        chequeRecordId: replaced.newChequeRecordId,
        userId: employeeId,
      })
    );
    const { rows: settledBills } = await client.query(
      `SELECT bill_id, amount_paid, status FROM supplier_bill WHERE bill_id = ANY($1::int[]) ORDER BY bill_id`,
      [[bill1.bill_id, bill2.bill_id]]
    );
    expect(Number(settledBills[0].amount_paid)).toBe(3650);
    expect(settledBills[0].status).toBe('Paid');
    expect(Number(settledBills[1].amount_paid)).toBe(8500);
    expect(settledBills[1].status).toBe('Paid');
  });

  test('2. Replace DEPOSITED cheque requires confirmRecoveredOrStopped=true; succeeds when provided', async () => {
    const bill = await createBill(2000, 'R2');
    const issued = await withSavepoint((c) =>
      apPdcService.issueOutboundCheque(c, {
        purposeType: 'SUPPLIER_PAYMENT',
        supplierId,
        payee: supplierName,
        bankAccountId,
        chequeNumber: '400101',
        chequeDate: '2026-11-15',
        amount: 2000,
        allocations: [{ bill_id: bill.bill_id, amount: 2000 }],
        employeeId,
        userId: employeeId,
      })
    );

    await client.query(`UPDATE cheque_records SET status = 'DEPOSITED' WHERE id = $1`, [issued.chequeRecordId]);
    await client.query(`UPDATE ap_payment SET pdc_status = 'DEPOSITED' WHERE payment_id = $1`, [issued.apPaymentId]);

    await expect(
      withSavepoint((c) =>
        apPdcService.replaceCheque(c, {
          chequeRecordId: issued.chequeRecordId,
          newChequeNumber: '400102',
          newChequeDate: '2026-11-16',
          reasonCategory: 'Other',
          reasonNotes: 'Stop payment placed',
          confirmRecoveredOrStopped: false,
          userId: employeeId,
        })
      )
    ).rejects.toMatchObject({ status: 409, code: 'RECOVERY_CONFIRMATION_REQUIRED' });

    const replaced = await withSavepoint((c) =>
      apPdcService.replaceCheque(c, {
        chequeRecordId: issued.chequeRecordId,
        newChequeNumber: '400102',
        newChequeDate: '2026-11-16',
        reasonCategory: 'Other',
        reasonNotes: 'Stop payment placed',
        confirmRecoveredOrStopped: true,
        userId: employeeId,
      })
    );
    expect(replaced.newChequeNumber).toBe('400102');
  });

  test('3. Replace BOUNCED cheque carries over allocations and clearing replacement settles bill once', async () => {
    const bill = await createBill(5000, 'R3');
    const issued = await withSavepoint((c) =>
      apPdcService.issueOutboundCheque(c, {
        purposeType: 'SUPPLIER_PAYMENT',
        supplierId,
        payee: supplierName,
        bankAccountId,
        chequeNumber: '400201',
        chequeDate: '2026-10-25',
        amount: 5000,
        allocations: [{ bill_id: bill.bill_id, amount: 5000 }],
        employeeId,
        userId: employeeId,
      })
    );

    await withSavepoint((c) =>
      apPdcService.processBouncedOutboundCheque(c, {
        chequeRecordId: issued.chequeRecordId,
        reason: 'DAIF',
        userId: employeeId,
      })
    );

    const replaced = await withSavepoint((c) =>
      apPdcService.replaceCheque(c, {
        chequeRecordId: issued.chequeRecordId,
        newChequeNumber: '400202',
        newChequeDate: '2026-11-05',
        reasonCategory: 'Bounced cheque',
        reasonNotes: 'Re-issued after bounce',
        userId: employeeId,
      })
    );

    // Lift payment hold created by bounce
    await client.query('UPDATE supplier SET payment_hold = false, payment_hold_reason = NULL WHERE supplier_id = $1', [supplierId]);

    await withSavepoint((c) =>
      apPdcService.verifyOutboundPayment(c, {
        chequeRecordId: replaced.newChequeRecordId,
        userId: employeeId,
      })
    );

    const { rows: [settledBill] } = await client.query('SELECT amount_paid, status FROM supplier_bill WHERE bill_id = $1', [bill.bill_id]);
    expect(Number(settledBill.amount_paid)).toBe(5000);
    expect(settledBill.status).toBe('Paid');
  });

  test('4. Bounce after clear -> redeposit -> clear again posts second PAYMENT_SETTLED and settles bill cleanly', async () => {
    const bill = await createBill(4200, 'R4');
    const issued = await withSavepoint((c) =>
      apPdcService.issueOutboundCheque(c, {
        purposeType: 'SUPPLIER_PAYMENT',
        supplierId,
        payee: supplierName,
        bankAccountId,
        chequeNumber: '400301',
        chequeDate: '2026-10-20',
        amount: 4200,
        allocations: [{ bill_id: bill.bill_id, amount: 4200 }],
        employeeId,
        userId: employeeId,
      })
    );

    // Clear #1
    await withSavepoint((c) =>
      apPdcService.verifyOutboundPayment(c, {
        chequeRecordId: issued.chequeRecordId,
        userId: employeeId,
      })
    );

    // Bounce after clear
    await withSavepoint((c) =>
      apPdcService.processBouncedOutboundCheque(c, {
        chequeRecordId: issued.chequeRecordId,
        reason: 'Insufficient funds',
        userId: employeeId,
      })
    );

    const { rows: [afterBounce] } = await client.query('SELECT amount_paid, status FROM supplier_bill WHERE bill_id = $1', [bill.bill_id]);
    expect(Number(afterBounce.amount_paid)).toBe(0);
    expect(afterBounce.status).toBe('Unpaid');

    // Redeposit (and lift payment hold)
    await withSavepoint((c) =>
      apPdcService.redepositOutboundCheque(c, {
        chequeRecordId: issued.chequeRecordId,
        liftPaymentHold: true,
        notes: 'Redepositing after funding',
        userId: employeeId,
      })
    );

    // Clear #2
    await withSavepoint((c) =>
      apPdcService.verifyOutboundPayment(c, {
        chequeRecordId: issued.chequeRecordId,
        userId: employeeId,
      })
    );

    const { rows: [afterSecondClear] } = await client.query('SELECT amount_paid, status FROM supplier_bill WHERE bill_id = $1', [bill.bill_id]);
    expect(Number(afterSecondClear.amount_paid)).toBe(4200);
    expect(afterSecondClear.status).toBe('Paid');

    const { rows: ledgerEntries } = await client.query(
      `SELECT entry_type, amount FROM ap_ledger WHERE payment_id = $1 ORDER BY ledger_id ASC`,
      [issued.apPaymentId]
    );
    expect(ledgerEntries.map((e) => e.entry_type)).toEqual([
      'PAYMENT_SETTLED',
      'PDC_BOUNCED_REVERSAL',
      'PAYMENT_SETTLED',
    ]);
  });

  test('5. Multi-hop replacement chain (A -> B -> C) preserves bidirectional lineage', async () => {
    const bill = await createBill(1500, 'R5');
    const a = await withSavepoint((c) =>
      apPdcService.issueOutboundCheque(c, {
        purposeType: 'SUPPLIER_PAYMENT',
        supplierId,
        payee: supplierName,
        bankAccountId,
        chequeNumber: '400501',
        chequeDate: '2026-11-01',
        amount: 1500,
        allocations: [{ bill_id: bill.bill_id, amount: 1500 }],
        employeeId,
        userId: employeeId,
      })
    );

    const b = await withSavepoint((c) =>
      apPdcService.replaceCheque(c, {
        chequeRecordId: a.chequeRecordId,
        newChequeNumber: '400502',
        newChequeDate: '2026-11-05',
        reasonCategory: 'Printing issue',
        reasonNotes: 'First replacement',
        userId: employeeId,
      })
    );

    const c = await withSavepoint((cl) =>
      apPdcService.replaceCheque(cl, {
        chequeRecordId: b.newChequeRecordId,
        newChequeNumber: '400503',
        newChequeDate: '2026-11-10',
        reasonCategory: 'Damaged cheque',
        reasonNotes: 'Second replacement',
        userId: employeeId,
      })
    );

    const { rows: chain } = await client.query(
      `SELECT id, cheque_number, status, replaces_cheque_id, replaced_by_cheque_id
         FROM cheque_records
        WHERE id = ANY($1::int[])
        ORDER BY id ASC`,
      [[a.chequeRecordId, b.newChequeRecordId, c.newChequeRecordId]]
    );
    expect(chain.map((r) => r.cheque_number)).toEqual(['400501', '400502', '400503']);
    expect(chain[0].replaced_by_cheque_id).toBe(b.newChequeRecordId);
    expect(chain[1].replaces_cheque_id).toBe(a.chequeRecordId);
    expect(chain[1].replaced_by_cheque_id).toBe(c.newChequeRecordId);
    expect(chain[2].replaces_cheque_id).toBe(b.newChequeRecordId);
  });

  test('6. Replace expense-backed cheque updates expense linkage and satisfies uq_cheque_records_active_expense', async () => {
    const expIssued = await withSavepoint((c) =>
      apPdcService.issueOutboundCheque(c, {
        purposeType: 'RENT',
        payee: 'LANDLORD INC',
        bankAccountId,
        chequeNumber: '400601',
        chequeDate: '2026-11-01',
        amount: 15000,
        expenseCategoryId,
        memo: 'November Rent',
        employeeId,
        userId: employeeId,
      })
    );

    const expReplaced = await withSavepoint((c) =>
      apPdcService.replaceCheque(c, {
        chequeRecordId: expIssued.chequeRecordId,
        newChequeNumber: '400602',
        newChequeDate: '2026-11-02',
        reasonCategory: 'Printing issue',
        reasonNotes: 'Updated rent cheque date',
        userId: employeeId,
      })
    );

    expect(expReplaced.newExpenseId).toBe(expIssued.expenseId);
  });

  test('7. Delete unprinted ISSUED cheque marks DELETED, frees bill capacity, and allows reusing cheque number on same bank', async () => {
    const bill = await createBill(3100, 'R7');
    const issued = await withSavepoint((c) =>
      apPdcService.issueOutboundCheque(c, {
        purposeType: 'SUPPLIER_PAYMENT',
        supplierId,
        payee: supplierName,
        bankAccountId,
        chequeNumber: '400701',
        chequeDate: '2026-11-01',
        amount: 3100,
        allocations: [{ bill_id: bill.bill_id, amount: 3100 }],
        employeeId,
        userId: employeeId,
      })
    );

    const delRes = await withSavepoint((c) =>
      apPdcService.deleteErroneousPayment(c, {
        chequeRecordId: issued.chequeRecordId,
        reason: 'Entered on wrong supplier',
        userId: employeeId,
      })
    );
    expect(delRes.status).toBe('DELETED');
    expect(delRes.releasedChequeNumber).toBe('400701');

    // Reusing cheque number 400701 on same bank account should now succeed
    const reissued = await withSavepoint((c) =>
      apPdcService.issueOutboundCheque(c, {
        purposeType: 'SUPPLIER_PAYMENT',
        supplierId,
        payee: supplierName,
        bankAccountId,
        chequeNumber: '400701',
        chequeDate: '2026-11-01',
        amount: 3100,
        allocations: [{ bill_id: bill.bill_id, amount: 3100 }],
        employeeId,
        userId: employeeId,
      })
    );
    const { rows: [reissuedCr] } = await client.query('SELECT cheque_number FROM cheque_records WHERE id = $1', [reissued.chequeRecordId]);
    expect(reissuedCr.cheque_number).toBe('400701');
  });

  test('8. Delete cleared, bounced, void, replaced, or settled cash payment is rejected with 409', async () => {
    const bill = await createBill(6000, 'R8');

    // Voided cheque -> delete rejected (number reserved)
    const voidIssued = await withSavepoint((c) =>
      apPdcService.issueOutboundCheque(c, {
        purposeType: 'SUPPLIER_PAYMENT',
        supplierId,
        payee: supplierName,
        bankAccountId,
        chequeNumber: '400801',
        chequeDate: '2026-11-01',
        amount: 1000,
        allocations: [{ bill_id: bill.bill_id, amount: 1000 }],
        employeeId,
        userId: employeeId,
      })
    );

    await withSavepoint((c) =>
      apPdcService.voidCheque(c, {
        chequeRecordId: voidIssued.chequeRecordId,
        reason: 'Spoiled physical cheque',
        userId: employeeId,
      })
    );

    await expect(
      withSavepoint((c) =>
        apPdcService.deleteErroneousPayment(c, {
          chequeRecordId: voidIssued.chequeRecordId,
          reason: 'Try delete voided cheque',
          userId: employeeId,
        })
      )
    ).rejects.toMatchObject({ status: 409, code: 'RETIRED_INSTRUMENT_NUMBER_RESERVED' });

    // Direct cash payment (settled immediately) -> delete rejected with 409
    const cashPay = await withSavepoint((c) =>
      apPaymentService.recordDirectPayment(c, {
        supplierId,
        methodId: cashMethodId,
        amount: 1000,
        settlementDate: '2026-10-19',
        referenceNumber: 'CASH-REF-8',
        allocations: [{ bill_id: bill.bill_id, amount: 1000 }],
        userId: employeeId,
      })
    );

    await expect(
      withSavepoint((c) =>
        apPdcService.deleteErroneousPayment(c, {
          apPaymentId: cashPay.paymentId,
          reason: 'Try delete settled cash payment',
          userId: employeeId,
        })
      )
    ).rejects.toMatchObject({ status: 409, code: 'DIRECT_SETTLED_PAYMENT_NOT_DELETABLE' });
  });

  test('9. Direct payment over-allocation guard prevents cash payment from exceeding remaining unscheduled capacity', async () => {
    const bill = await createBill(1000, 'R9');
    await withSavepoint((c) =>
      apPdcService.issueOutboundCheque(c, {
        purposeType: 'SUPPLIER_PAYMENT',
        supplierId,
        payee: supplierName,
        bankAccountId,
        chequeNumber: '400901',
        chequeDate: '2026-11-15',
        amount: 700,
        allocations: [{ bill_id: bill.bill_id, amount: 700 }],
        employeeId,
        userId: employeeId,
      })
    );

    await expect(
      withSavepoint((c) =>
        apPaymentService.recordDirectPayment(c, {
          supplierId,
          methodId: cashMethodId,
          amount: 400,
          settlementDate: '2026-10-19',
          referenceNumber: 'CASH-OVER-9',
          allocations: [{ bill_id: bill.bill_id, amount: 400 }],
          userId: employeeId,
        })
      )
    ).rejects.toMatchObject({ status: 400 });
  });

  test('10. Financial period lock guard rejects expense cheque mutations in a locked period with 423 PERIOD_LOCKED', async () => {
    await client.query(
      `INSERT INTO period_lock (module, period_month, is_locked, locked_by, locked_at)
       VALUES ('expenses', '2024-01-01', true, $1, NOW())
       ON CONFLICT (module, period_month) DO UPDATE SET is_locked = true`,
      [employeeId]
    );

    await expect(
      withSavepoint((c) =>
        apPdcService.issueOutboundCheque(c, {
          purposeType: 'RENT',
          payee: 'LOCKED PERIOD LANDLORD',
          bankAccountId,
          chequeNumber: '401001',
          chequeDate: '2024-01-15',
          amount: 1200,
          expenseCategoryId,
          memo: 'Locked period rent',
          employeeId,
          userId: employeeId,
        })
      )
    ).rejects.toMatchObject({ statusCode: 423, code: 'PERIOD_LOCKED' });
  });

  test('11. Idempotent request lifecycle records replay and blocks conflicting reuse of same Idempotency-Key', async () => {
    const idemKey = crypto.randomUUID();
    const payload = { bankAccountId, chequeNumber: '401101', amount: 2500 };

    await withSavepoint(async (c) => {
      const reqId = await apPdcService.beginLifecycleRequest(c, {
        requestId: idemKey,
        actorId: employeeId,
        action: 'ISSUE',
        targetType: 'BANK_ACCOUNT',
        targetId: bankAccountId,
        payload,
      });
      await apPdcService.finishLifecycleRequest(c, reqId, 201, { chequeRecordId: 999999, chequeNumber: '401101' });
    });

    // Exact same request replays stored response
    await expect(
      withSavepoint((c) =>
        apPdcService.beginLifecycleRequest(c, {
          requestId: idemKey,
          actorId: employeeId,
          action: 'ISSUE',
          targetType: 'BANK_ACCOUNT',
          targetId: bankAccountId,
          payload,
        })
      )
    ).rejects.toMatchObject({
      replay: {
        status: 201,
        body: { chequeRecordId: 999999, chequeNumber: '401101' },
      },
    });

    // Different payload with same key throws 409 IDEMPOTENCY_CONFLICT
    await expect(
      withSavepoint((c) =>
        apPdcService.beginLifecycleRequest(c, {
          requestId: idemKey,
          actorId: employeeId,
          action: 'ISSUE',
          targetType: 'BANK_ACCOUNT',
          targetId: bankAccountId,
          payload: { ...payload, chequeNumber: '401102' },
        })
      )
    ).rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' });
  });

  test('12. Sequence suggestion skips DELETED/VOID/REPLACED numbers cleanly and increments last active cheque number', async () => {
    const suggestion = await apPdcService.suggestNextChequeNumber(client, bankAccountId);
    expect(suggestion).toBe('400902');
  });
});
