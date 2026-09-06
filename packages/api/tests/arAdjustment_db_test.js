// Real-database integration test for post-invoice A/R concessions
// (20260906_04 through _07 and services/arAdjustmentService.js). Excluded from
// the normal jest run per the *_db_test.js convention — run with:
//   node tests/arAdjustment_db_test.js
//
// The scenario driving the feature: a customer owes 12,800, pays 12,000, and the
// remaining 800 is forgiven. What must be true afterwards is that the invoice
// closes, the customer balance falls by the full 12,800, and *no cash figure
// anywhere moves by more than the 12,000 that was actually collected.
//
// Runs inside a transaction that is rolled back, so it leaves no trace.

const db = require('../db');
const arAdjustment = require('../services/arAdjustmentService');

function assert(cond, msg) {
  if (!cond) throw new Error('Assertion failed: ' + msg);
}

async function expectRejection(promise, fragment) {
  let threw = null;
  try { await promise; } catch (err) { threw = err; }
  assert(threw, `expected a rejection mentioning "${fragment}", but the call succeeded`);
  assert(String(threw.message).includes(fragment),
    `expected rejection mentioning "${fragment}", got: ${threw.message}`);
}

async function invoiceState(client, invoiceId) {
  const { rows: [r] } = await client.query(
    'SELECT amount_paid, status FROM invoice WHERE invoice_id = $1', [invoiceId]);
  return { paid: Number(r.amount_paid), status: r.status };
}

async function ledgerBalance(client, customerId) {
  const { rows: [r] } = await client.query(
    'SELECT COALESCE(SUM(amount), 0) AS bal FROM ar_ledger WHERE customer_id = $1', [customerId]);
  return Number(r.bal);
}

async function run() {
  const client = await db.getClient();
  let failed = false;
  try {
    await client.query('BEGIN');

    const { rows: [employee] } = await client.query('SELECT employee_id FROM employee LIMIT 1');
    const { rows: [method] } = await client.query(
      "SELECT method_id, code FROM payment_methods WHERE code = 'cash' AND enabled = true LIMIT 1");
    const { rows: [customer] } = await client.query(
      `INSERT INTO customer (first_name, last_name, company_name)
       VALUES ('Adjustment', 'Fixture', 'ADJ Test Trading') RETURNING customer_id`);
    assert(employee && method, 'seed data (employee / cash payment method) not found');

    const customerId = customer.customer_id;
    const employeeId = employee.employee_id;

    const mkInvoice = async (total) => {
      const { rows: [inv] } = await client.query(
        `INSERT INTO invoice (invoice_number, customer_id, employee_id, total_amount, amount_paid, status, terms, payment_terms_days)
         VALUES ($1, $2, $3, $4, 0, 'Unpaid', 'Net 30', 30) RETURNING invoice_id`,
        [`TEST-ADJ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, customerId, employeeId, total]
      );
      // Credit sale: the receivable is posted to the ledger, as invoiceRoutes does.
      await client.query(
        `SELECT append_ar_ledger_entry($1, $2, NULL, NULL, 'INVOICE_POSTED'::ar_ledger_entry_type,
                                       $3, NULL, NULL, 'test fixture', $4, NULL)`,
        [customerId, inv.invoice_id, total, employeeId]
      );
      return inv.invoice_id;
    };

    // ── The 12,800 / 12,000 / 800 case ──────────────────────────────────
    const invoiceId = await mkInvoice(12800.00);
    assert(await ledgerBalance(client, customerId) === 12800, 'receivable should be 12,800 after invoicing');

    // 12,000 collected in cash through the A/R receipt path.
    const { rows: [payment] } = await client.query(
      `INSERT INTO customer_payment (customer_id, employee_id, amount, payment_method, method_id, pdc_status)
       VALUES ($1, $2, 12000.00, $3, $4, 'CLEARED') RETURNING payment_id`,
      [customerId, employeeId, method.code, method.method_id]
    );
    await client.query(
      `INSERT INTO invoice_payment_allocation (invoice_id, payment_id, amount_allocated) VALUES ($1, $2, 12000.00)`,
      [invoiceId, payment.payment_id]
    );
    await client.query(
      `SELECT append_ar_ledger_entry($1, NULL, $2, NULL, 'PAYMENT_SETTLED'::ar_ledger_entry_type,
                                     -12000.00, $3, NULL, 'test collection', $4, 'customer_payment')`,
      [customerId, payment.payment_id, method.code, employeeId]
    );

    let st = await invoiceState(client, invoiceId);
    assert(st.paid === 12000 && st.status === 'Partially Paid',
      `after cash: expected 12000/Partially Paid, got ${st.paid}/${st.status}`);

    // The 800 forgiven.
    const doc = await arAdjustment.createAdjustment(client, {
      customerId,
      adjustmentType: 'SETTLEMENT_DISCOUNT',
      reasonCode: 'PROMPT_SETTLEMENT',
      allocations: [{ invoice_id: invoiceId, amount: 800.00 }],
      notes: 'Agreed with owner, full settlement today',
      grantedBy: employeeId,
      customerPaymentId: payment.payment_id,
    });

    assert(/^ADJ-\d{6}-\d{4}$/.test(doc.adjustment_no), `unexpected document number ${doc.adjustment_no}`);
    assert(doc.authorization_method === 'SELF' && doc.authorized_by === null,
      'a permission holder grants as SELF with no authorizer');

    st = await invoiceState(client, invoiceId);
    assert(st.paid === 12800 && st.status === 'Paid',
      `after concession: expected 12800/Paid, got ${st.paid}/${st.status}`);
    assert(await ledgerBalance(client, customerId) === 0, 'customer balance should be zero');

    // The concession is not money: exactly 12,000 of collections, and it never
    // became a tender.
    const { rows: [cash] } = await client.query(
      `SELECT COALESCE(SUM(-amount), 0) AS collected FROM ar_ledger
        WHERE customer_id = $1 AND entry_type = 'PAYMENT_SETTLED'`, [customerId]);
    assert(Number(cash.collected) === 12000, `collections must read 12,000, got ${cash.collected}`);

    const { rows: [tender] } = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM invoice_payment_allocation ipa
         JOIN customer_payment cp ON cp.payment_id = ipa.payment_id
        WHERE ipa.invoice_id = $1`, [invoiceId]);
    assert(tender.cnt === 1, 'the concession must not have created a second allocation/tender row');

    const { rows: [entry] } = await client.query(
      `SELECT entry_type, amount, payment_channel, reference_no FROM ar_ledger WHERE ledger_id = $1`,
      [doc.ledger_id]);
    assert(entry.entry_type === 'SETTLEMENT_DISCOUNT', `expected SETTLEMENT_DISCOUNT, got ${entry.entry_type}`);
    assert(Number(entry.amount) === -800, `expected -800, got ${entry.amount}`);
    assert(entry.payment_channel === null, 'a concession has no payment channel — no money moved');
    assert(entry.reference_no === doc.adjustment_no, 'ledger entry should reference the document number');

    // ── Reversal reopens the invoice ────────────────────────────────────
    const reversal = await arAdjustment.reverseAdjustment(client, {
      adjustmentId: doc.adjustment_id,
      reason: 'Discount was applied to the wrong account',
      employeeId,
    });
    st = await invoiceState(client, invoiceId);
    assert(st.paid === 12000 && st.status === 'Partially Paid',
      `after reversal: expected 12000/Partially Paid, got ${st.paid}/${st.status}`);
    assert(await ledgerBalance(client, customerId) === 800, 'reversal should reinstate 800 of receivable');
    assert(reversal.reverses_adjustment_no === doc.adjustment_no, 'reversal should name the original');

    const { rows: [orig] } = await client.query(
      `SELECT status, reversal_reason FROM ar_adjustment WHERE adjustment_id = $1`, [doc.adjustment_id]);
    assert(orig.status === 'REVERSED', `original should read REVERSED, got ${orig.status}`);

    // Both documents stay on the statement.
    const { rows: entries } = await client.query(
      `SELECT entry_type FROM ar_ledger WHERE customer_id = $1
        AND entry_type IN ('SETTLEMENT_DISCOUNT','ADJUSTMENT_REVERSAL') ORDER BY ledger_id`, [customerId]);
    assert(entries.length === 2, `expected both documents on the ledger, got ${entries.length}`);

    await expectRejection(
      arAdjustment.reverseAdjustment(client, {
        adjustmentId: doc.adjustment_id, reason: 'trying to reverse it twice over', employeeId }),
      'already been reversed');

    // ── Guard rails ─────────────────────────────────────────────────────
    const guardInvoice = await mkInvoice(1000.00);

    await expectRejection(arAdjustment.createAdjustment(client, {
      customerId, adjustmentType: 'BALANCE_WRITE_DOWN', reasonCode: 'BAD_DEBT_WRITE_OFF',
      allocations: [{ invoice_id: guardInvoice, amount: 1500.00 }],
      notes: 'over-allocating on purpose', grantedBy: employeeId,
    }), 'still outstanding');

    await expectRejection(arAdjustment.createAdjustment(client, {
      customerId, adjustmentType: 'BALANCE_WRITE_DOWN', reasonCode: 'BAD_DEBT_WRITE_OFF',
      allocations: [{ invoice_id: guardInvoice, amount: 100.00 }],
      notes: 'short', grantedBy: employeeId,
    }), 'requires a note');

    // No seeded reason carries a cap since 20260906_09 lifted the 1.00 ceiling on
    // ROUNDING -- it refused the everyday case it was meant to serve, closing an
    // odd balance at a whole peso. max_amount is still an editable column the
    // owner can set from Settings, so the ceiling it imposes is still live code:
    // one is set here, inside the transaction this test rolls back, so the rule
    // stays pinned without any reason shipping capped.
    await client.query(`UPDATE ar_adjustment_reason SET max_amount = 1.00 WHERE reason_code = 'ROUNDING'`);
    await expectRejection(arAdjustment.createAdjustment(client, {
      customerId, adjustmentType: 'BALANCE_WRITE_DOWN', reasonCode: 'ROUNDING',
      allocations: [{ invoice_id: guardInvoice, amount: 50.00 }], grantedBy: employeeId,
    }), 'capped at');
    await client.query(`UPDATE ar_adjustment_reason SET max_amount = NULL WHERE reason_code = 'ROUNDING'`);

    // And uncapped, the ordinary rounding-down case goes through: an odd balance
    // of 12,847.35 closed at 12,845.00. Given its own invoice so it does not
    // disturb the guard invoice's balance, which later assertions read.
    const oddInvoice = await mkInvoice(12847.35);
    const roundingDoc = await arAdjustment.createAdjustment(client, {
      customerId, adjustmentType: 'BALANCE_WRITE_DOWN', reasonCode: 'ROUNDING',
      allocations: [{ invoice_id: oddInvoice, amount: 2.35 }], grantedBy: employeeId,
    });
    assert(roundingDoc.status === 'POSTED', 'an uncapped rounding concession should post');
    assert(Number(roundingDoc.total_amount) === 2.35,
      `expected a 2.35 rounding concession, got ${roundingDoc.total_amount}`);

    await expectRejection(arAdjustment.createAdjustment(client, {
      customerId, adjustmentType: 'SETTLEMENT_DISCOUNT', reasonCode: 'BAD_DEBT_WRITE_OFF',
      allocations: [{ invoice_id: guardInvoice, amount: 100.00 }],
      notes: 'wrong scope for this reason', grantedBy: employeeId,
    }), 'cannot be used for');

    await expectRejection(arAdjustment.createAdjustment(client, {
      customerId, adjustmentType: 'BALANCE_WRITE_DOWN', reasonCode: 'BAD_DEBT_WRITE_OFF',
      allocations: [], notes: 'no invoices named at all', grantedBy: employeeId,
    }), 'must name the invoices');

    // ── Idempotency: a retried POST forgives the balance once ───────────
    const clientRef = '11111111-2222-3333-4444-555555555555';
    const first = await arAdjustment.createAdjustment(client, {
      customerId, adjustmentType: 'BALANCE_WRITE_DOWN', reasonCode: 'BAD_DEBT_WRITE_OFF',
      allocations: [{ invoice_id: guardInvoice, amount: 400.00 }],
      notes: 'Customer ceased trading in March', grantedBy: employeeId, clientRef,
    });
    const retry = await arAdjustment.createAdjustment(client, {
      customerId, adjustmentType: 'BALANCE_WRITE_DOWN', reasonCode: 'BAD_DEBT_WRITE_OFF',
      allocations: [{ invoice_id: guardInvoice, amount: 400.00 }],
      notes: 'Customer ceased trading in March', grantedBy: employeeId, clientRef,
    });
    assert(first.adjustment_id === retry.adjustment_id, 'a retried request must return the same document');
    st = await invoiceState(client, guardInvoice);
    assert(st.paid === 400, `retry must not forgive twice: expected 400, got ${st.paid}`);

    // ── A concession cannot be edited, only reversed ────────────────────
    await expectRejection(
      client.query(`UPDATE ar_adjustment SET total_amount = 999 WHERE adjustment_id = $1`, [first.adjustment_id]),
      'is immutable');
    // That failed statement aborts the transaction; restart to finish cleanly.
    await client.query('ROLLBACK');
    await client.query('BEGIN');

    console.log('arAdjustment DB test passed');
  } catch (err) {
    failed = true;
    console.error('Test failed:', err);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
  process.exit(failed ? 1 : 0);
}

run();
