/**
 * Cost / WAC correction workflow.
 *
 * Weighted average cost is a property of the StockIn history, not a field: part.wac_cost
 * is written only by trg_update_wac and recompute_wac_for_part(), so a value poked into
 * it by hand survives exactly until the next recompute. Correcting a part whose receipts
 * were never entered therefore means reconstructing those receipts as real
 * inventory_transaction rows — which is what approving a correction does.
 *
 * The proposal step deliberately writes nothing to the ledger. An approved correction is
 * load-bearing (every later sale snapshots its cost from the resulting WAC), so the
 * person who researches a cost is not the person who commits it.
 *
 * Quantity is out of scope here — cycle count owns it. Because the WAC formula's
 * prev_stock term sums every transaction type, cost correction only yields a trustworthy
 * average once quantity is already right, so a line cannot be approved until it is
 * linked to an approved cycle count.
 */
const periodLockService = require('./periodLockService');
const { recomputeWacForParts } = require('./transactionDateService');

const APPROVED_COUNT_STATUSES = ['MATCHED_AUTO_APPROVED', 'APPROVED_ADJUSTED'];
const OPEN_STATUSES = ['PENDING', 'PROPOSED', 'PENDING_MANAGER_REVIEW'];

/** Same impact yardstick the Cost Data Health report ranks by. */
const IMPACT_ESTIMATE_SQL = `
    (ABS(COALESCE(s.stock_on_hand, 0)) * GREATEST(
        COALESCE(NULLIF(p.wac_cost, 0), 0),
        COALESCE(NULLIF(p.last_cost, 0), 0),
        COALESCE(NULLIF(p.last_sale_price, 0), 0)
    ))::numeric(14,2)`;

function badRequest(message) {
    const err = new Error(message);
    err.statusCode = 400;
    return err;
}

/**
 * Queue the highest-impact parts that still need cost research.
 *
 * Only parts with an approved cycle count are eligible: correcting cost on top of a
 * wrong quantity produces a confidently wrong average, since prev_stock feeds the
 * weighting. Parts still awaiting a count are simply not returned — the cycle count
 * generator already prioritises negative stock, so they arrive here on the next pass.
 */
async function generateBatch(client, { employeeId, supplierId = null, limit = 50, createdBy }) {
    const { rows: candidates } = await client.query(
        `WITH stock AS (
            SELECT part_id, COALESCE(SUM(quantity), 0) AS stock_on_hand
            FROM inventory_transaction GROUP BY part_id
        ),
        latest_count AS (
            SELECT DISTINCT ON (ccl.part_id)
                   ccl.part_id, ccl.line_id, ccl.counted_qty, ccl.counted_at
            FROM cycle_count_line ccl
            WHERE ccl.status = ANY($1) AND ccl.counted_qty IS NOT NULL
            ORDER BY ccl.part_id, ccl.counted_at DESC
        )
        SELECT p.part_id,
               COALESCE(s.stock_on_hand, 0) AS system_qty,
               COALESCE(p.wac_cost, 0)      AS wac_before,
               ${IMPACT_ESTIMATE_SQL}       AS impact_estimate,
               lc.line_id                   AS cycle_count_line_id,
               lc.counted_qty
        FROM part p
        LEFT JOIN stock s        ON s.part_id = p.part_id
        JOIN latest_count lc     ON lc.part_id = p.part_id
        WHERE p.is_service = FALSE AND p.is_active = TRUE
          AND (
                ((p.wac_cost IS NULL OR p.wac_cost = 0) AND COALESCE(s.stock_on_hand, 0) <> 0)
             OR COALESCE(s.stock_on_hand, 0) < 0
             OR COALESCE(p.last_cost, 0) = 0
          )
          AND ($2::int IS NULL OR EXISTS (
                SELECT 1 FROM goods_receipt_line grl
                JOIN goods_receipt gr ON gr.grn_id = grl.grn_id
                WHERE grl.part_id = p.part_id AND gr.supplier_id = $2::int
          ))
          AND NOT EXISTS (
                SELECT 1 FROM wac_correction_line wcl
                WHERE wcl.part_id = p.part_id AND wcl.status = ANY($3)
          )
        ORDER BY ${IMPACT_ESTIMATE_SQL} DESC NULLS LAST
        LIMIT $4`,
        [APPROVED_COUNT_STATUSES, supplierId, OPEN_STATUSES, limit]
    );

    if (candidates.length === 0) return { batch_id: null, lines: 0 };

    const { rows: [batch] } = await client.query(
        `INSERT INTO wac_correction_batch (employee_id, supplier_id, created_by)
         VALUES ($1, $2, $3) RETURNING batch_id`,
        [employeeId || null, supplierId, createdBy || null]
    );

    for (const c of candidates) {
        await client.query(
            `INSERT INTO wac_correction_line
                (batch_id, part_id, system_qty_snapshot, wac_before, impact_estimate,
                 cycle_count_line_id, counted_qty)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT DO NOTHING`,
            [batch.batch_id, c.part_id, c.system_qty, c.wac_before, c.impact_estimate,
             c.cycle_count_line_id, c.counted_qty]
        );
    }

    return { batch_id: batch.batch_id, lines: candidates.length };
}

/**
 * What the ledger will look like if this line's entries are posted.
 *
 * The gap is intentionally derived *after* the documented receipts rather than assumed
 * up front — that is what stops the undocumented remainder from double-counting against
 * a quantity the cycle count already reconciled.
 */
async function projectLine(client, lineId) {
    const { rows: [line] } = await client.query(
        `SELECT wcl.*,
                (SELECT COALESCE(SUM(quantity), 0) FROM inventory_transaction WHERE part_id = wcl.part_id) AS current_qty,
                (SELECT COALESCE(SUM(quantity), 0) FROM wac_correction_entry WHERE line_id = wcl.line_id) AS proposed_qty
           FROM wac_correction_line wcl
          WHERE wcl.line_id = $1`,
        [lineId]
    );
    if (!line) throw badRequest('Correction line not found.');

    const currentQty = Number(line.current_qty);
    const proposedQty = Number(line.proposed_qty);
    const projectedQty = currentQty + proposedQty;
    const countedQty = line.counted_qty == null ? null : Number(line.counted_qty);
    const gapQty = countedQty == null ? null : Number((countedQty - projectedQty).toFixed(4));

    return { line, currentQty, proposedQty, projectedQty, countedQty, gapQty };
}

/** Save the encoder's reconstructed receipts. Writes nothing to the ledger. */
async function proposeCorrection(client, lineId, { entries, gapUnitCost, notes, employeeId }) {
    if (!Array.isArray(entries) || entries.length === 0) {
        throw badRequest('At least one receipt entry is required.');
    }

    const { rows: [line] } = await client.query(
        `SELECT * FROM wac_correction_line WHERE line_id = $1 FOR UPDATE`, [lineId]
    );
    if (!line) throw badRequest('Correction line not found.');
    if (!OPEN_STATUSES.includes(line.status)) {
        throw badRequest(`This correction is already ${line.status.toLowerCase()} and cannot be edited.`);
    }

    for (const e of entries) {
        const qty = Number(e.quantity);
        const cost = Number(e.unit_cost);
        const when = new Date(e.date_received);
        if (!Number.isFinite(qty) || qty <= 0) throw badRequest('Each entry needs a quantity greater than zero.');
        if (!Number.isFinite(cost) || cost <= 0) throw badRequest('Each entry needs a unit cost greater than zero.');
        if (Number.isNaN(when.getTime())) throw badRequest('Each entry needs a valid date received.');
        if (when.getTime() > Date.now()) throw badRequest('An entry cannot be dated in the future.');
        // Posting will insert a dated StockIn, so the same period rules apply as to a
        // backdated goods receipt. Failing here keeps the encoder from doing the work
        // twice when the period turns out to be closed.
        await periodLockService.assertPeriodOpen(when, { module: 'goods_receipt' });
    }

    await client.query('DELETE FROM wac_correction_entry WHERE line_id = $1', [lineId]);
    for (const e of entries) {
        await client.query(
            `INSERT INTO wac_correction_entry
                (line_id, date_received, quantity, unit_cost, source_reference, is_estimate, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [lineId, new Date(e.date_received).toISOString(), e.quantity, e.unit_cost,
             e.source_reference || null, !!e.is_estimate, e.notes || null]
        );
    }

    const projection = await projectLine(client, lineId);
    if (projection.gapQty != null && projection.gapQty > 0 && !(Number(gapUnitCost) > 0)) {
        throw badRequest(
            `The documented receipts leave ${projection.gapQty} units unaccounted for against the counted quantity. ` +
            `Provide an estimated unit cost for the remainder, or add the missing receipts.`
        );
    }

    await client.query(
        `UPDATE wac_correction_line
            SET status = 'PENDING_MANAGER_REVIEW', proposed_by = $2, proposed_at = CURRENT_TIMESTAMP,
                gap_qty = $3, gap_unit_cost = $4, review_notes = $5
          WHERE line_id = $1`,
        [lineId, employeeId || null, projection.gapQty, gapUnitCost || null, notes || null]
    );

    await client.query(
        `INSERT INTO wac_correction_audit_log (line_id, part_id, action, wac_before, entry_count, gap_qty, actioned_by, notes)
         VALUES ($1, $2, 'PROPOSED', $3, $4, $5, $6, $7)`,
        [lineId, line.part_id, line.wac_before, entries.length, projection.gapQty, employeeId || null, notes || null]
    );

    return projectLine(client, lineId);
}

/**
 * Post an approved correction to the ledger, atomically.
 *
 * Order matters: documented receipts first, then the gap measured against what those
 * receipts actually produced, then a single chronological replay. The replay is not
 * optional — trg_update_wac derives prev_stock from the sum of all other rows regardless
 * of date, so it computes the wrong average for any receipt inserted mid-history.
 */
async function approveCorrection(client, lineId, { employeeId, notes }) {
    const { rows: [line] } = await client.query(
        `SELECT * FROM wac_correction_line WHERE line_id = $1 FOR UPDATE`, [lineId]
    );
    if (!line) throw badRequest('Correction line not found.');
    if (line.status !== 'PENDING_MANAGER_REVIEW') {
        throw badRequest('Only a proposed correction awaiting review can be approved.');
    }
    if (!line.cycle_count_line_id || line.counted_qty == null) {
        throw badRequest('This part has no approved cycle count. Correct its quantity before correcting its cost.');
    }

    const { rows: entries } = await client.query(
        `SELECT * FROM wac_correction_entry WHERE line_id = $1 ORDER BY date_received ASC, entry_id ASC`,
        [lineId]
    );
    if (entries.length === 0) throw badRequest('This correction has no receipt entries to post.');

    const reference = `WACFIX-${lineId}`;

    for (const e of entries) {
        await periodLockService.assertPeriodOpen(e.date_received, { module: 'goods_receipt' });
        const { rows: [tx] } = await client.query(
            `INSERT INTO inventory_transaction
                (part_id, trans_type, quantity, unit_cost, reference_no, employee_id, transaction_date, notes)
             VALUES ($1, 'StockIn', $2, $3, $4, $5, $6, $7)
             RETURNING inv_trans_id`,
            [line.part_id, e.quantity, e.unit_cost, reference, employeeId || null, e.date_received,
             e.source_reference ? `Cost correction — ${e.source_reference}` : 'Cost correction']
        );
        await client.query('UPDATE wac_correction_entry SET inv_trans_id = $1 WHERE entry_id = $2',
            [tx.inv_trans_id, e.entry_id]);
    }

    // Measure the shortfall only after the documented receipts are in.
    const { rows: [{ qty_now }] } = await client.query(
        `SELECT COALESCE(SUM(quantity), 0) AS qty_now FROM inventory_transaction WHERE part_id = $1`,
        [line.part_id]
    );
    const gapQty = Number((Number(line.counted_qty) - Number(qty_now)).toFixed(4));

    if (gapQty > 0) {
        // Physical stock beyond what could be documented: value it at the declared
        // estimate. This is the only place an estimated cost enters the average, and it
        // is scoped to the remainder rather than the whole quantity.
        if (!(Number(line.gap_unit_cost) > 0)) {
            throw badRequest('An estimated unit cost is required for the undocumented remainder.');
        }
        await client.query(
            `INSERT INTO inventory_transaction
                (part_id, trans_type, quantity, unit_cost, reference_no, employee_id, notes)
             VALUES ($1, 'StockIn', $2, $3, $4, $5, 'Cost correction — undocumented opening balance')`,
            [line.part_id, gapQty, line.gap_unit_cost, reference, employeeId || null]
        );
    } else if (gapQty < 0) {
        // Documented receipts exceed the physical count — shrinkage. Quantity-only, so
        // it must not carry a unit_cost or it would drag the average.
        await client.query(
            `INSERT INTO inventory_transaction
                (part_id, trans_type, quantity, reference_no, employee_id, notes)
             VALUES ($1, 'Adjustment', $2, $3, $4, 'Cost correction — variance to counted quantity')`,
            [line.part_id, gapQty, reference, employeeId || null]
        );
    }

    const [impact] = await recomputeWacForParts(client, [line.part_id]);

    await client.query(
        `UPDATE wac_correction_line
            SET status = 'APPROVED', reviewed_by = $2, reviewed_at = CURRENT_TIMESTAMP,
                gap_qty = $3, wac_after = $4, review_notes = COALESCE($5, review_notes)
          WHERE line_id = $1`,
        [lineId, employeeId || null, gapQty, impact?.new_wac_cost ?? null, notes || null]
    );

    await client.query(
        `INSERT INTO wac_correction_audit_log
            (line_id, part_id, action, wac_before, wac_after, entry_count, gap_qty, actioned_by, notes)
         VALUES ($1, $2, 'APPROVED', $3, $4, $5, $6, $7, $8)`,
        [lineId, line.part_id, impact?.old_wac_cost ?? line.wac_before, impact?.new_wac_cost ?? null,
         entries.length, gapQty, employeeId || null, notes || null]
    );

    // The part now has a real cost basis, so it no longer belongs in the costing queue.
    await client.query(
        `DELETE FROM part_tag
          WHERE part_id = $1
            AND tag_id = (SELECT tag_id FROM tag WHERE tag_name = 'pending_costing')`,
        [line.part_id]
    );

    return {
        line_id: lineId,
        part_id: line.part_id,
        gap_qty: gapQty,
        old_wac_cost: impact?.old_wac_cost ?? null,
        new_wac_cost: impact?.new_wac_cost ?? null,
        entries_posted: entries.length,
    };
}

async function rejectCorrection(client, lineId, { employeeId, notes }) {
    const { rows: [line] } = await client.query(
        `SELECT * FROM wac_correction_line WHERE line_id = $1 FOR UPDATE`, [lineId]
    );
    if (!line) throw badRequest('Correction line not found.');
    if (line.status !== 'PENDING_MANAGER_REVIEW') {
        throw badRequest('Only a proposed correction awaiting review can be sent back.');
    }
    if (!notes || String(notes).trim().length < 5) {
        throw badRequest('Explain what needs to change so the encoder can act on it.');
    }

    // Back to PENDING, not REJECTED — the part still needs correcting, and the encoder
    // keeps the entries they already gathered.
    await client.query(
        `UPDATE wac_correction_line
            SET status = 'PENDING', reviewed_by = $2, reviewed_at = CURRENT_TIMESTAMP, review_notes = $3
          WHERE line_id = $1`,
        [lineId, employeeId || null, notes]
    );

    await client.query(
        `INSERT INTO wac_correction_audit_log (line_id, part_id, action, actioned_by, notes)
         VALUES ($1, $2, 'REJECTED', $3, $4)`,
        [lineId, line.part_id, employeeId || null, notes]
    );

    return { line_id: lineId, status: 'PENDING' };
}

module.exports = {
    generateBatch,
    projectLine,
    proposeCorrection,
    approveCorrection,
    rejectCorrection,
    IMPACT_ESTIMATE_SQL,
    OPEN_STATUSES,
};
