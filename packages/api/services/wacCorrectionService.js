/**
 * Cost correction for cycle-counted stock with no receipt on file.
 *
 * Weighted average cost is a property of the StockIn history, not a stored figure:
 * part.wac_cost is written only by trg_update_wac and recompute_wac_for_part(), so a
 * value set by hand survives exactly until the next recompute. Correcting a part whose
 * receipts were never entered therefore means recording that receipt as a real
 * inventory_transaction row.
 *
 * That is true whether or not the receipt can be found — the difference is only where
 * the cost comes from. When a document exists, backfilling it on the goods receipt
 * page is faster and safer (it is deduplicated against the supplier's own invoice
 * number). This service exists for what backfill cannot do: a part a cycle count has
 * confirmed holds real stock, for which genuinely no document can be found. Estimating
 * that stock's cost is a manager's call, made once, directly — there is no research
 * step to separate from the posting action, so this is a single action, not a
 * propose/approve workflow.
 */
const { recomputeWacForParts } = require('./transactionDateService');

const APPROVED_COUNT_STATUSES = ['MATCHED_AUTO_APPROVED', 'APPROVED_ADJUSTED'];

function badRequest(message) {
    const err = new Error(message);
    err.statusCode = 400;
    return err;
}

/** Current stock, cost, and the most recent validated cycle count, if any. */
async function getPartStatus(client, partId) {
    const { rows: [part] } = await client.query(
        `WITH stock AS (
            SELECT part_id, COALESCE(SUM(quantity), 0) AS stock_on_hand
            FROM inventory_transaction WHERE part_id = $1 GROUP BY part_id
        )
        SELECT p.part_id, p.internal_sku, p.detail,
               (SELECT display_name FROM public.parts_view pv WHERE pv.part_id = p.part_id) AS display_name,
               COALESCE(s.stock_on_hand, 0) AS current_qty,
               COALESCE(p.wac_cost, 0)      AS wac_cost,
               COALESCE(p.last_cost, 0)     AS last_cost
          FROM part p LEFT JOIN stock s ON s.part_id = p.part_id
         WHERE p.part_id = $1`,
        [partId]
    );
    if (!part) throw badRequest('Part not found.');

    const { rows: [count] } = await client.query(
        `SELECT line_id, counted_qty, counted_at
           FROM cycle_count_line
          WHERE part_id = $1 AND status = ANY($2) AND counted_qty IS NOT NULL
          ORDER BY counted_at DESC LIMIT 1`,
        [partId, APPROVED_COUNT_STATUSES]
    );

    return {
        ...part,
        counted_qty: count ? Number(count.counted_qty) : null,
        counted_at: count?.counted_at || null,
        // This is a live comparison against current stock, not the count's own
        // snapshot — everything that happened since the count (sales, prior
        // adjustments) is already reflected in current_qty, so the shortfall shown
        // here is only what still needs explaining right now.
        suggested_qty: count ? Number((Number(count.counted_qty) - Number(part.current_qty)).toFixed(4)) : null,
    };
}

/**
 * Post a manager's cost estimate for stock a cycle count confirmed but no receipt can
 * be found for.
 *
 * The quantity is not taken on faith from the count — the manager sees and can adjust
 * it, because a count's snapshot can be stale by the time this runs (a later or
 * overlapping count, or ordinary sales, may have already changed what "current" means).
 * Positive quantity is valued at the given estimate and posted as a StockIn, so it
 * enters the WAC average like any receipt. Negative quantity is shrinkage — a plain
 * Adjustment, since it corrects a count, not a cost.
 */
async function postEstimate(client, partId, { quantity, unitCost, notes, employeeId }) {
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty === 0) {
        throw badRequest('Quantity must be a non-zero number.');
    }
    if (qty > 0 && !(Number(unitCost) > 0)) {
        throw badRequest('An estimated unit cost is required to post additional stock.');
    }
    if (!notes || String(notes).trim().length < 5) {
        throw badRequest('Explain where this estimate comes from (e.g. price list, comparable item) for the audit trail.');
    }

    const before = await getPartStatus(client, partId);
    const reference = `WACEST-${partId}-${Date.now()}`;

    if (qty > 0) {
        await client.query(
            `INSERT INTO inventory_transaction
                (part_id, trans_type, quantity, unit_cost, reference_no, employee_id, notes)
             VALUES ($1, 'StockIn', $2, $3, $4, $5, $6)`,
            [partId, qty, unitCost, reference, employeeId || null, `Cost estimate — ${notes}`]
        );
    } else {
        await client.query(
            `INSERT INTO inventory_transaction
                (part_id, trans_type, quantity, reference_no, employee_id, notes)
             VALUES ($1, 'Adjustment', $2, $3, $4, $5)`,
            [partId, qty, reference, employeeId || null, `Cost correction write-off — ${notes}`]
        );
    }

    // recompute_wac_for_part() reads part.wac_cost as its "old" value, but by the time
    // it runs, the StockIn insert above has already fired trg_update_wac once and
    // mutated that column — so its old_wac_cost is really "after the raw trigger, before
    // the replay," not "before this action." `before.wac_cost`, captured above prior to
    // any insert, is the value that is actually true.
    const [impact] = await recomputeWacForParts(client, [partId]);

    await client.query(
        `INSERT INTO wac_correction_audit_log
            (part_id, action, wac_before, wac_after, gap_qty, actioned_by, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [partId, qty > 0 ? 'ESTIMATED' : 'WRITTEN_OFF',
         before.wac_cost, impact?.new_wac_cost ?? null, qty, employeeId || null, notes]
    );

    // A real cost basis now exists, so the part leaves the costing queue.
    await client.query(
        `DELETE FROM part_tag
          WHERE part_id = $1
            AND tag_id = (SELECT tag_id FROM tag WHERE tag_name = 'pending_costing')`,
        [partId]
    );

    return {
        part_id: partId,
        quantity_posted: qty,
        old_wac_cost: before.wac_cost,
        new_wac_cost: impact?.new_wac_cost ?? null,
    };
}

module.exports = { getPartStatus, postEstimate };
