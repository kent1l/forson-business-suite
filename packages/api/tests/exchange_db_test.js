// Real-database integration test for the POS Item Exchange ("Change Item")
// module (services/exchangeService.js, docs/plans/2026-09-11_pos-item-exchange-module.md
// Phase 1). Excluded from the normal jest run (see jest.config.js
// testPathIgnorePatterns, matching the existing *_db_test.js convention) — run
// manually against a live DB with:
//   node tests/exchange_db_test.js
//
// Covers the seven cases from the PRD's Phase 4 spec (§6.4): even exchange,
// upgrade paid in cash, upgrade charged to an on-account customer, downgrade
// on an on-account customer, discount proration, over-return rejection, and
// the defective-vs-resellable inventory toggle.
//
// Case 3 in particular pins the bug found live while building this module:
// the invoice_payments ledger safety-net trigger (20260906_01) used to post a
// second, unwanted PAYMENT_SETTLED entry for the exchange_credit tender,
// double-counting the returned item's value. 20260911_02 fixed it; this test
// asserts the customer's ar_ledger balance moves by exactly the upgrade
// differential, not by the differential minus twice the returned value.
//
// Runs entirely inside a transaction that is rolled back at the end, so it
// leaves no trace in the database regardless of outcome.

const db = require('../db');
const { processExchange, ExchangeError } = require('../services/exchangeService');

let failures = 0;

function assert(cond, msg) {
  if (!cond) {
    failures += 1;
    console.error(`  ✘ ${msg}`);
  } else {
    console.log(`  ✔ ${msg}`);
  }
}

async function expectRejection(promise, fragment) {
  let threw = null;
  try { await promise; } catch (err) { threw = err; }
  assert(threw, `expected a rejection mentioning "${fragment}", but the call succeeded`);
  if (threw) {
    assert(String(threw.message).includes(fragment),
      `expected rejection mentioning "${fragment}", got: ${threw.message}`);
  }
  return threw;
}

async function run() {
  const client = await db.getClient();
  const stamp = Date.now();

  try {
    await client.query('BEGIN');

    const { rows: [employee] } = await client.query('SELECT employee_id FROM employee LIMIT 1');
    const { rows: [brand] } = await client.query('SELECT brand_id FROM brand LIMIT 1');
    const { rows: [group] } = await client.query('SELECT group_id FROM "group" LIMIT 1');
    const { rows: [zeroRate] } = await client.query(`SELECT tax_rate_id FROM tax_rate WHERE rate_percentage = 0 LIMIT 1`);
    const { rows: [cashMethod] } = await client.query(`SELECT method_id FROM payment_methods WHERE code = 'cash' AND enabled = true LIMIT 1`);
    const { rows: [exchangeCreditMethod] } = await client.query(`SELECT method_id FROM payment_methods WHERE code = 'exchange_credit' LIMIT 1`);
    assert(employee && brand && group && zeroRate && cashMethod, 'seed data (employee/brand/group/tax_rate/cash payment method) present');
    assert(exchangeCreditMethod, "payment_methods row 'exchange_credit' present (run migration 20260911_01_pos_exchange_schema.sql first if not)");

    const employeeId = employee.employee_id;
    const taxRateId = zeroRate.tax_rate_id;

    const mkPart = async (label, price) => {
      const { rows: [part] } = await client.query(
        `INSERT INTO part (internal_sku, detail, brand_id, group_id, is_active, wac_cost, last_sale_price, tax_rate_id)
         VALUES ($1, $2, $3, $4, true, $5, $6, $7) RETURNING part_id`,
        [`TEST-EXCH-${label}-${stamp}`, `Exchange test part ${label}`, brand.brand_id, group.group_id, round2(price * 0.6), price, taxRateId]
      );
      return part.part_id;
    };

    const mkCustomer = async (label) => {
      const { rows: [c] } = await client.query(
        `INSERT INTO customer (first_name, last_name) VALUES ($1, 'ExchangeFixture') RETURNING customer_id`,
        [label]
      );
      return c.customer_id;
    };

    /** A fully-paid cash sale to exchange against. Its own terms don't matter —
     * processExchange derives credit-sale status from the exchange request, not
     * from how the original sale was originally paid for. */
    const mkOriginalInvoice = async (customerId, partId, qty, price, discountAmount = 0) => {
      const invoiceNumber = `TEST-EXCH-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
      const total = round2(qty * price - discountAmount);
      const { rows: [inv] } = await client.query(
        `INSERT INTO invoice (invoice_number, customer_id, employee_id, total_amount, subtotal_ex_tax, tax_total, amount_paid, status, terms, payment_terms_days, tax_calculation_version)
         VALUES ($1, $2, $3, $4, $4, 0, $4, 'Paid', 'Cash', 0, 'v1.0') RETURNING invoice_id`,
        [invoiceNumber, customerId, employeeId, total]
      );
      const { rows: [line] } = await client.query(
        `INSERT INTO invoice_line (invoice_id, part_id, quantity, sale_price, cost_at_sale, discount_amount, tax_rate_id, tax_rate_snapshot, tax_base, tax_amount, is_tax_inclusive)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, 0, false) RETURNING invoice_line_id`,
        [inv.invoice_id, partId, qty, price, round2(price * 0.6), discountAmount, taxRateId, total]
      );
      return { invoiceId: inv.invoice_id, invoiceNumber, lineId: line.invoice_line_id };
    };

    const invoiceRow = async (invoiceId) => {
      const { rows: [r] } = await client.query(
        'SELECT status, amount_paid, total_amount FROM invoice WHERE invoice_id = $1', [invoiceId]);
      return { status: r.status, paid: Number(r.amount_paid), total: Number(r.total_amount) };
    };

    const ledgerBalance = async (customerId) => {
      const { rows: [r] } = await client.query(
        'SELECT COALESCE(SUM(amount), 0) AS bal FROM ar_ledger WHERE customer_id = $1', [customerId]);
      return Number(r.bal);
    };

    const invTransactions = async (referenceNo) => {
      const { rows } = await client.query(
        'SELECT part_id, trans_type, quantity FROM inventory_transaction WHERE reference_no = $1 ORDER BY inv_trans_id', [referenceNo]);
      return rows;
    };

    const invoicePaymentRows = async (invoiceId) => {
      const { rows } = await client.query(
        'SELECT method_id, amount_paid, payment_status FROM invoice_payments WHERE invoice_id = $1 ORDER BY payment_id', [invoiceId]);
      return rows;
    };

    const fixtureCustomer = await mkCustomer('Case1-2-5-6-7');
    const onAccountCustomer = await mkCustomer('Case3-4');

    const part500 = await mkPart('P500', 500);
    const part800 = await mkPart('P800', 800);
    const part350 = await mkPart('P350', 350);

    // ── Test Case 1: Even exchange (₱500 ↔ ₱500) ──────────────────────────
    console.log('\nCase 1: Even exchange');
    {
      const { invoiceId, lineId } = await mkOriginalInvoice(fixtureCustomer, part500, 1, 500);
      const before = await ledgerBalance(fixtureCustomer);

      const result = await processExchange(client, {
        original_invoice_id: invoiceId, employee_id: employeeId,
        returned_lines: [{ invoice_line_id: lineId, quantity: 1, is_defective: false }],
        replacement_lines: [{ part_id: part500, quantity: 1, sale_price: 500 }],
      });

      assert(result.net_differential === 0, `net_differential expected 0, got ${result.net_differential}`);
      assert(result.amount_due === 0, `amount_due expected 0, got ${result.amount_due}`);
      assert(result.leftover_credit === 0, `leftover_credit expected 0, got ${result.leftover_credit}`);

      const newInv = await invoiceRow(result.invoice.invoice_id);
      assert(newInv.status === 'Paid', `new invoice status expected 'Paid', got '${newInv.status}'`);
      assert(newInv.paid === 500, `new invoice amount_paid expected 500, got ${newInv.paid}`);

      const cnTx = await invTransactions(result.credit_note.cn_number);
      assert(cnTx.length === 1 && cnTx[0].trans_type === 'Refund' && Number(cnTx[0].quantity) === 1,
        `expected one Refund inventory_transaction of qty 1, got ${JSON.stringify(cnTx)}`);
      const invTx = await invTransactions(result.invoice.invoice_number);
      assert(invTx.length === 1 && invTx[0].trans_type === 'StockOut' && Number(invTx[0].quantity) === -1,
        `expected one StockOut inventory_transaction of qty -1, got ${JSON.stringify(invTx)}`);

      const payRows = await invoicePaymentRows(result.invoice.invoice_id);
      assert(payRows.length === 1 && payRows[0].method_id === exchangeCreditMethod.method_id && Number(payRows[0].amount_paid) === 500,
        `expected a single exchange_credit tender of 500, got ${JSON.stringify(payRows)}`);

      // ₱0 cash effect (PRD scenario #1): a non-credit exchange with no tenders
      // due must leave the *replacement* invoice with no ar_ledger footprint at
      // all — no INVOICE_POSTED (it's not a credit sale) and no PAYMENT_SETTLED
      // for the exchange_credit tender (that value is ledgered once, against the
      // original invoice, below).
      const { rows: newInvLedger } = await client.query('SELECT entry_type FROM ar_ledger WHERE invoice_id = $1', [result.invoice.invoice_id]);
      assert(newInvLedger.length === 0, `expected zero ar_ledger rows for the new invoice, got ${JSON.stringify(newInvLedger)}`);

      // Note: this still moves the customer's ar_ledger balance by -500, even
      // though no cash or credit relationship exists. That mirrors
      // refundRoutes.js exactly (CREDIT_MEMO_APPLIED posts unconditionally,
      // regardless of customer type) — a pre-existing asymmetry, since a plain
      // cash sale never posts an offsetting INVOICE_POSTED entry in the first
      // place. Out of scope for this module to fix; asserted here so a future
      // change to that shared behavior doesn't silently drift.
      const after = await ledgerBalance(fixtureCustomer);
      assert(after - before === -500, `even exchange on a non-credit customer still ledgers the credit note's -500 (refundRoutes.js parity), moved by ${after - before}`);
    }

    // ── Test Case 2: Upgrade, cash difference paid (+₱300) ────────────────
    console.log('\nCase 2: Upgrade paid in cash (+300)');
    {
      const { invoiceId, lineId } = await mkOriginalInvoice(fixtureCustomer, part500, 1, 500);

      const result = await processExchange(client, {
        original_invoice_id: invoiceId, employee_id: employeeId,
        returned_lines: [{ invoice_line_id: lineId, quantity: 1, is_defective: false }],
        replacement_lines: [{ part_id: part800, quantity: 1, sale_price: 800 }],
        payments: [{ method_id: cashMethod.method_id, amount_paid: 300 }],
      });

      assert(result.net_differential === 300, `net_differential expected 300, got ${result.net_differential}`);
      assert(result.amount_due === 300, `amount_due expected 300, got ${result.amount_due}`);

      const newInv = await invoiceRow(result.invoice.invoice_id);
      assert(newInv.status === 'Paid', `new invoice status expected 'Paid', got '${newInv.status}'`);
      assert(newInv.paid === 800, `new invoice amount_paid expected 800 (500 exchange credit + 300 cash), got ${newInv.paid}`);

      const payRows = await invoicePaymentRows(result.invoice.invoice_id);
      assert(payRows.length === 2, `expected 2 tenders (exchange_credit + cash), got ${payRows.length}`);

      // The 300 collected at the counter is real drawer intake and must ledger
      // normally, unlike the exchange_credit tender.
      const { rows: ledgerRows } = await client.query(
        `SELECT entry_type, amount FROM ar_ledger WHERE invoice_id = $1`, [result.invoice.invoice_id]);
      assert(ledgerRows.length === 1 && ledgerRows[0].entry_type === 'PAYMENT_SETTLED' && Number(ledgerRows[0].amount) === -300,
        `expected exactly one PAYMENT_SETTLED(-300) ledger row for the cash tender, got ${JSON.stringify(ledgerRows)}`);
    }

    // ── Test Case 3: Upgrade charged to an on-account customer ────────────
    console.log('\nCase 3: Upgrade charged to on-account customer (regression for the ledger double-count bug)');
    {
      const { invoiceId, lineId } = await mkOriginalInvoice(onAccountCustomer, part500, 1, 500);
      const before = await ledgerBalance(onAccountCustomer);

      const result = await processExchange(client, {
        original_invoice_id: invoiceId, employee_id: employeeId,
        returned_lines: [{ invoice_line_id: lineId, quantity: 1, is_defective: false }],
        replacement_lines: [{ part_id: part800, quantity: 1, sale_price: 800 }],
        payment_terms_days: 30, // charged to account, no payments[]
      });

      assert(result.is_credit_sale === true, 'expected is_credit_sale true when payment_terms_days > 0');
      assert(result.net_differential === 300, `net_differential expected 300, got ${result.net_differential}`);

      const newInv = await invoiceRow(result.invoice.invoice_id);
      assert(newInv.status === 'Partially Paid', `new invoice status expected 'Partially Paid', got '${newInv.status}'`);
      assert(newInv.paid === 500, `new invoice amount_paid expected 500 (exchange credit only), got ${newInv.paid}`);

      const after = await ledgerBalance(onAccountCustomer);
      assert(after - before === 300,
        `A/R balance must move by exactly the +300 upgrade differential; moved by ${after - before} `
        + `(a -500/+800 double count without the exchange_credit safety-net skip would show -200 here)`);
    }

    // ── Test Case 4: Downgrade on an on-account customer ───────────────────
    console.log('\nCase 4: Downgrade on on-account customer, zero cash paid');
    {
      const { invoiceId, lineId } = await mkOriginalInvoice(onAccountCustomer, part800, 1, 800);
      const before = await ledgerBalance(onAccountCustomer);

      const result = await processExchange(client, {
        original_invoice_id: invoiceId, employee_id: employeeId,
        returned_lines: [{ invoice_line_id: lineId, quantity: 1, is_defective: false }],
        replacement_lines: [{ part_id: part350, quantity: 1, sale_price: 350 }],
        payment_terms_days: 30,
      });

      assert(result.net_differential === -450, `net_differential expected -450, got ${result.net_differential}`);
      assert(result.leftover_credit === 450, `leftover_credit expected 450, got ${result.leftover_credit}`);

      const after = await ledgerBalance(onAccountCustomer);
      assert(after - before === -450, `A/R balance must strictly decrease by 450; moved by ${after - before}`);

      const payRows = await invoicePaymentRows(result.invoice.invoice_id);
      assert(payRows.every(p => p.method_id === exchangeCreditMethod.method_id),
        `expected zero cash tenders on an on-account downgrade, got ${JSON.stringify(payRows)}`);

      const { rows: [wallet] } = await client.query('SELECT balance FROM customer_wallet WHERE customer_id = $1', [onAccountCustomer]);
      assert(!wallet || Number(wallet.balance) === 0,
        `on-account downgrade must never create wallet credit (PRD Decision #2), got balance ${wallet && wallet.balance}`);
    }

    // ── Test Case 5: Discounted item prorates return credit correctly ─────
    console.log('\nCase 5: Discount proration on a partial return');
    {
      // 2 units @ 500 with a 200 discount on the whole line = 100/unit discount.
      // Returning 1 of the 2 must credit (500 - 100) = 400, not the full 500.
      const { invoiceId, lineId } = await mkOriginalInvoice(fixtureCustomer, part500, 2, 500, 200);

      // Replacement priced below the 400 credit (a 50 downgrade) — irrelevant
      // to what this case checks, so just dispose of it as a cash payout to
      // keep the settlement path out of the way.
      const result = await processExchange(client, {
        original_invoice_id: invoiceId, employee_id: employeeId,
        returned_lines: [{ invoice_line_id: lineId, quantity: 1, is_defective: false }],
        replacement_lines: [{ part_id: part350, quantity: 1, sale_price: 350 }],
        downgrade_disposition: 'cash_payout',
      });

      assert(result.credit_note.total_amount === 400, `prorated credit expected 400 (500 - 100 discount share), got ${result.credit_note.total_amount}`);
    }

    // ── Test Case 6: Returning more than purchased throws ─────────────────
    console.log('\nCase 6: Over-return is rejected');
    {
      const { invoiceId, lineId } = await mkOriginalInvoice(fixtureCustomer, part500, 1, 500);

      const err = await expectRejection(
        processExchange(client, {
          original_invoice_id: invoiceId, employee_id: employeeId,
          returned_lines: [{ invoice_line_id: lineId, quantity: 2, is_defective: false }],
          replacement_lines: [{ part_id: part350, quantity: 1, sale_price: 350 }],
        }),
        'available 1'
      );
      assert(err instanceof ExchangeError && err.statusCode === 400, `expected an ExchangeError with statusCode 400, got ${err && err.constructor.name}/${err && err.statusCode}`);
    }

    // ── Test Case 7: Defective toggle quarantines the returned unit ───────
    console.log('\nCase 7: Defective return flags inventory as quarantined');
    {
      const { invoiceId, lineId } = await mkOriginalInvoice(fixtureCustomer, part500, 1, 500);

      const result = await processExchange(client, {
        original_invoice_id: invoiceId, employee_id: employeeId,
        returned_lines: [{ invoice_line_id: lineId, quantity: 1, is_defective: true }],
        replacement_lines: [{ part_id: part500, quantity: 1, sale_price: 500 }],
      });

      const cnTx = await invTransactions(result.credit_note.cn_number);
      assert(cnTx.length === 1 && cnTx[0].trans_type === 'Defective Return',
        `expected a 'Defective Return' inventory_transaction, got ${JSON.stringify(cnTx)}`);

      const { rows: [cnLine] } = await client.query(
        'SELECT is_defective FROM credit_note_line WHERE cn_id = $1', [result.credit_note.cn_id]);
      assert(cnLine.is_defective === true, `expected credit_note_line.is_defective = true, got ${cnLine.is_defective}`);
    }

    if (failures === 0) {
      console.log('\nexchange_db_test: all assertions passed');
    } else {
      console.error(`\nexchange_db_test: ${failures} assertion(s) failed`);
    }
  } catch (err) {
    failures += 1;
    console.error('Test run threw unexpectedly:', err);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
  process.exit(failures ? 1 : 0);
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

run();
