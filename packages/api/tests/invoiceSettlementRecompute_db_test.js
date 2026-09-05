// Real-database integration test for recompute_invoice_settlement(), the single
// definition of invoice.amount_paid / invoice.status introduced by
// 20260906_01_recompute_invoice_settlement.sql and refined by 20260906_03.
// Excluded from the normal jest run (see jest.config.js testPathIgnorePatterns,
// matching the existing *_db_test.js convention) — run manually against a live
// DB with:
//   node tests/invoiceSettlementRecompute_db_test.js
//
// The bug this pins down: a POS tender lands in invoice_payments while an A/R
// receipt lands in customer_payment + invoice_payment_allocation. Before this
// change, the trigger counted only the first and paymentRoutes counted only the
// second, so an invoice settled through both had one of them silently erased —
// whichever wrote last won, and the next write flipped it back. Confirmed live
// on INV-TXNDATE-FIXTURE, which held 300.00 of tender and 400.00 of allocation
// and reported amount_paid = 300.00.
//
// Runs entirely inside a transaction that is rolled back at the end, so it
// leaves no trace in the database regardless of outcome.

const db = require('../db');

function assert(cond, msg) {
  if (!cond) throw new Error('Assertion failed: ' + msg);
}

async function invoiceState(client, invoiceId) {
  const { rows: [row] } = await client.query(
    'SELECT amount_paid, status FROM invoice WHERE invoice_id = $1', [invoiceId]);
  return { paid: Number(row.amount_paid), status: row.status };
}

async function run() {
  const client = await db.getClient();
  let failed = false;
  try {
    await client.query('BEGIN');

    const { rows: [customer] } = await client.query('SELECT customer_id FROM customer LIMIT 1');
    const { rows: [employee] } = await client.query('SELECT employee_id FROM employee LIMIT 1');
    const { rows: [method] } = await client.query(
      "SELECT method_id, code FROM payment_methods WHERE code = 'cash' AND enabled = true LIMIT 1");
    assert(customer && employee && method, 'seed data (customer/employee/cash payment method) not found');

    const mkInvoice = async (total, status = 'Unpaid') => {
      const { rows: [inv] } = await client.query(
        `INSERT INTO invoice (invoice_number, customer_id, employee_id, total_amount, amount_paid, status, terms, payment_terms_days)
         VALUES ($1, $2, $3, $4, 0, $5, 'Net 30', 30)
         RETURNING invoice_id`,
        [`TEST-SETTLE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          customer.customer_id, employee.employee_id, total, status]
      );
      return inv.invoice_id;
    };

    const mkCustomerPayment = async (amount, pdcStatus = 'CLEARED') => {
      const { rows: [p] } = await client.query(
        `INSERT INTO customer_payment (customer_id, employee_id, amount, payment_method, method_id, pdc_status)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING payment_id`,
        [customer.customer_id, employee.employee_id, amount, method.code, method.method_id, pdcStatus]
      );
      return p.payment_id;
    };

    // ── 1. The two settlement paths are added, not chosen between ──────────
    {
      const invoiceId = await mkInvoice(1000.00);

      await client.query(
        `INSERT INTO invoice_payments (invoice_id, method_id, amount_paid, created_by, payment_status, settled_at)
         VALUES ($1, $2, 300.00, $3, 'settled', CURRENT_TIMESTAMP)`,
        [invoiceId, method.method_id, employee.employee_id]
      );
      let st = await invoiceState(client, invoiceId);
      assert(st.paid === 300, `POS tender alone: expected 300, got ${st.paid}`);

      const paymentId = await mkCustomerPayment(400.00);
      await client.query(
        `INSERT INTO invoice_payment_allocation (invoice_id, payment_id, amount_allocated) VALUES ($1, $2, 400.00)`,
        [invoiceId, paymentId]
      );

      st = await invoiceState(client, invoiceId);
      assert(st.paid === 700, `both paths: expected 700, got ${st.paid} (the old bug reported 300)`);
      assert(st.status === 'Partially Paid', `both paths: expected 'Partially Paid', got '${st.status}'`);
    }

    // ── 2. An allocation closing the balance marks the invoice Paid ────────
    {
      const invoiceId = await mkInvoice(500.00);
      const paymentId = await mkCustomerPayment(500.00);
      await client.query(
        `INSERT INTO invoice_payment_allocation (invoice_id, payment_id, amount_allocated) VALUES ($1, $2, 500.00)`,
        [invoiceId, paymentId]
      );
      const st = await invoiceState(client, invoiceId);
      assert(st.paid === 500 && st.status === 'Paid', `expected 500/Paid, got ${st.paid}/${st.status}`);
    }

    // ── 3. A bounced cheque's allocation stops counting as settlement ──────
    //    The allocation row stays as the audit record; only pdc_status changes.
    {
      const invoiceId = await mkInvoice(800.00);
      const paymentId = await mkCustomerPayment(800.00, 'RECEIVED');
      await client.query(
        `INSERT INTO invoice_payment_allocation (invoice_id, payment_id, amount_allocated) VALUES ($1, $2, 800.00)`,
        [invoiceId, paymentId]
      );
      let st = await invoiceState(client, invoiceId);
      assert(st.status === 'Paid', `cheque in hand should still close the invoice, got '${st.status}'`);

      await client.query(`UPDATE customer_payment SET pdc_status = 'BOUNCED' WHERE payment_id = $1`, [paymentId]);
      st = await invoiceState(client, invoiceId);
      assert(st.paid === 0 && st.status === 'Unpaid', `after bounce: expected 0/Unpaid, got ${st.paid}/${st.status}`);

      const { rows: [{ cnt }] } = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM invoice_payment_allocation WHERE payment_id = $1`, [paymentId]);
      assert(cnt === 1, 'the bounced allocation must be kept as an audit record, not deleted');
    }

    // ── 4. 'Written Off' and 'Cancelled' are terminal ──────────────────────
    //    301 invoices carry 'Written Off' from the A/R cutover. Touching a
    //    payment on one must not revive it into the aging report.
    for (const terminal of ['Written Off', 'Cancelled']) {
      const invoiceId = await mkInvoice(600.00, terminal);
      await client.query(
        `INSERT INTO invoice_payments (invoice_id, method_id, amount_paid, created_by, payment_status, settled_at)
         VALUES ($1, $2, 100.00, $3, 'settled', CURRENT_TIMESTAMP)`,
        [invoiceId, method.method_id, employee.employee_id]
      );
      const st = await invoiceState(client, invoiceId);
      assert(st.status === terminal, `'${terminal}' must be terminal, became '${st.status}'`);
      assert(st.paid === 100, `'${terminal}' should still track what was collected, got ${st.paid}`);
    }

    // ── 5. A credit note covering the invoice makes it Fully Refunded ──────
    {
      const invoiceId = await mkInvoice(400.00);
      await client.query(
        `INSERT INTO credit_note (cn_number, invoice_id, employee_id, total_amount)
         VALUES ($1, $2, $3, 400.00)`,
        [`TEST-CN-${Date.now()}`, invoiceId, employee.employee_id]
      );
      const st = await invoiceState(client, invoiceId);
      assert(st.status === 'Fully Refunded', `expected 'Fully Refunded', got '${st.status}'`);
    }

    // ── 6. Idempotent: recomputing repeatedly changes nothing ──────────────
    {
      const invoiceId = await mkInvoice(250.00);
      const paymentId = await mkCustomerPayment(100.00);
      await client.query(
        `INSERT INTO invoice_payment_allocation (invoice_id, payment_id, amount_allocated) VALUES ($1, $2, 100.00)`,
        [invoiceId, paymentId]
      );
      const before = await invoiceState(client, invoiceId);
      for (let i = 0; i < 3; i++) {
        await client.query('SELECT recompute_invoice_settlement($1)', [invoiceId]);
      }
      const after = await invoiceState(client, invoiceId);
      assert(before.paid === after.paid && before.status === after.status,
        `not idempotent: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    }

    console.log('invoiceSettlementRecompute DB test passed');
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
