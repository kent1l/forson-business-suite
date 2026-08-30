/**
 * Automatic reconciliation of backfilled receipts against earlier cycle counts.
 *
 * A cycle count posts one catch-all adjustment for whatever it physically found; it has
 * no idea which undocumented delivery the stock came from. So when a receipt for that
 * same stock is backfilled later but dated BEFORE the count, the quantity lands twice --
 * once via the count's adjustment, once via the receipt.
 *
 * Such a receipt is documentation, not new inventory: the count already established what
 * is on the shelf. It therefore gets its cost effect (the StockIn feeds the WAC replay
 * like any receipt) and a compensating adjustment cancelling its quantity.
 *
 * The compensating amount is exactly the backfilled quantity -- NOT "whatever returns
 * stock to the counted figure". Sales made after the count are real, and forcing stock
 * back to the counted number would silently reverse them.
 *
 * This runs without asking, because an encoder copying an invoice should not have to
 * reason about count dates. It is never silent: every occurrence is logged with the
 * timeline that caused it for a manager to review.
 */

const APPROVED_COUNT_STATUSES = ['MATCHED_AUTO_APPROVED', 'APPROVED_ADJUSTED'];

/**
 * Reconcile one backfilled receipt line, if an approved count already accounts for it.
 * Returns the log row when a reconciliation was posted, or null when none was needed.
 */
async function reconcileBackfillLine(client, {
    partId, quantity, receiptDate, grnId, grnNumber, supplierInvoiceNo, employeeId,
}) {
    const { rows: [count] } = await client.query(
        `SELECT line_id, counted_qty, counted_at, system_qty_snapshot
           FROM cycle_count_line
          WHERE part_id = $1 AND status = ANY($2) AND counted_qty IS NOT NULL
          ORDER BY counted_at DESC
          LIMIT 1`,
        [partId, APPROVED_COUNT_STATUSES]
    );

    // No count, or the count predates this receipt: the receipt describes stock the
    // count never saw, so its quantity is genuinely new and must stand.
    if (!count || !count.counted_at) return null;
    if (new Date(count.counted_at).getTime() < new Date(receiptDate).getTime()) return null;

    const { rows: [{ stock_before }] } = await client.query(
        `SELECT COALESCE(SUM(quantity), 0) AS stock_before FROM inventory_transaction WHERE part_id = $1`,
        [partId]
    );
    const { rows: [partRow] } = await client.query(
        `SELECT COALESCE(wac_cost, 0) AS wac_cost FROM part WHERE part_id = $1`, [partId]
    );

    const qty = Number(quantity);
    const reconcileQty = -qty;

    await client.query(
        `INSERT INTO inventory_transaction
            (part_id, trans_type, quantity, reference_no, employee_id, notes)
         VALUES ($1, 'Adjustment', $2, $3, $4, $5)`,
        [partId, reconcileQty, grnNumber, employeeId || null,
         `Auto-reconciled: receipt dated ${new Date(receiptDate).toISOString().slice(0, 10)} predates the cycle count of ${new Date(count.counted_at).toISOString().slice(0, 10)}, which already recorded this stock. Cost applied, quantity not double-counted.`]
    );

    // How much stock the count found that the books could not explain. A backfill larger
    // than this documents arrivals the count never located -- that surplus is the part
    // worth investigating.
    const countVariance = count.system_qty_snapshot == null
        ? null
        : Number((Number(count.counted_qty) - Number(count.system_qty_snapshot)).toFixed(4));

    // Each earlier reconciliation against this same count already explained part of that
    // variance. Subtracting the full variance every time would credit the same found
    // stock repeatedly and understate a real shortfall as more invoices come in.
    const { rows: [prior] } = await client.query(
        `SELECT COALESCE(SUM(backfill_qty), 0) AS consumed
           FROM stock_reconciliation_log
          WHERE part_id = $1 AND cycle_count_line_id = $2`,
        [partId, count.line_id]
    );
    const remainingVariance = countVariance == null
        ? null
        : Math.max(countVariance - Number(prior.consumed), 0);
    const unexplainedShortfall = remainingVariance == null
        ? null
        : Number((qty - remainingVariance).toFixed(4));

    const { rows: [log] } = await client.query(
        `INSERT INTO stock_reconciliation_log
            (part_id, grn_id, grn_number, supplier_invoice_no, receipt_date, backfill_qty,
             reconcile_qty, cycle_count_line_id, counted_qty, counted_at, count_variance_qty,
             unexplained_shortfall, stock_before, stock_after, wac_before, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING *`,
        [partId, grnId, grnNumber, supplierInvoiceNo || null, receiptDate, qty,
         reconcileQty, count.line_id, count.counted_qty, count.counted_at, countVariance,
         unexplainedShortfall, Number(stock_before), Number(stock_before) + reconcileQty,
         partRow?.wac_cost ?? null, employeeId || null]
    );

    return log;
}

/** Record the WAC that resulted, once the chronological replay has run. */
async function recordWacAfter(client, reconIds, partWacMap) {
    for (const row of reconIds) {
        await client.query(
            `UPDATE stock_reconciliation_log SET wac_after = $2 WHERE recon_id = $1`,
            [row.recon_id, partWacMap.get(row.part_id) ?? null]
        );
    }
}

/**
 * A part's full ledger with the reconciliation events woven in, so "why does this part
 * look like this" has one answer instead of requiring someone to correlate tables.
 */
async function partTimeline(client, partId) {
    const { rows: transactions } = await client.query(
        `SELECT it.inv_trans_id, it.trans_type, it.quantity, it.unit_cost, it.reference_no,
                it.transaction_date, it.notes,
                e.first_name || ' ' || e.last_name AS employee_name,
                gr.is_backfill, gr.supplier_invoice_no
           FROM inventory_transaction it
           LEFT JOIN employee e ON e.employee_id = it.employee_id
           LEFT JOIN goods_receipt gr ON gr.grn_number = it.reference_no
          WHERE it.part_id = $1
          ORDER BY it.transaction_date ASC, it.inv_trans_id ASC`,
        [partId]
    );

    const { rows: counts } = await client.query(
        `SELECT line_id, status, system_qty_snapshot, counted_qty, counted_at
           FROM cycle_count_line
          WHERE part_id = $1 AND counted_at IS NOT NULL
          ORDER BY counted_at ASC`,
        [partId]
    );

    const { rows: reconciliations } = await client.query(
        `SELECT * FROM stock_reconciliation_log WHERE part_id = $1 ORDER BY created_at ASC`,
        [partId]
    );

    // Running balance makes the double-count (and its correction) visible at a glance.
    let balance = 0;
    const ledger = transactions.map(t => {
        balance = Number((balance + Number(t.quantity)).toFixed(4));
        return { ...t, running_balance: balance };
    });

    const { rows: [part] } = await client.query(
        `SELECT p.part_id, p.internal_sku, p.detail,
                (SELECT display_name FROM public.parts_view pv WHERE pv.part_id = p.part_id) AS display_name,
                COALESCE(p.wac_cost, 0) AS wac_cost, COALESCE(p.last_cost, 0) AS last_cost
           FROM part p WHERE p.part_id = $1`,
        [partId]
    );

    return { part, ledger, counts, reconciliations, current_qty: balance };
}

module.exports = { reconcileBackfillLine, recordWacAfter, partTimeline };
