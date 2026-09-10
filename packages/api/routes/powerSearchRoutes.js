const express = require('express');
const db = require('../db');
const { meiliClient } = require('../meilisearch');
const { activeAliasCondition } = require('../helpers/partNumberSoftDelete');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const router = express.Router();

// GET /api/power-search/parts - Advanced multi-filter search using Meilisearch
// Default behavior: only return active parts unless `status=all` or `status=inactive` is passed.
// Vehicle filter params (all optional, integers): make_id, model_id, engine_id, year.
// When any vehicle filter is set the route resolves matching part IDs from DB first
// (including engine-only parts via vehicle_engine_fitment and is_universal parts),
// then intersects with Meilisearch keyword results for relevance ranking.
router.get('/power-search/parts', protect, hasPermission(['parts:view', 'pos:use']), async (req, res) => {
    const { keyword, status = 'active' } = req.query;
    const makeId   = req.query.make_id   ? parseInt(req.query.make_id, 10)   : null;
    const modelId  = req.query.model_id  ? parseInt(req.query.model_id, 10)  : null;
    const engineId = req.query.engine_id ? parseInt(req.query.engine_id, 10) : null;
    const year     = req.query.year      ? parseInt(req.query.year, 10)      : null;

    // --- Phase 4b: structured vehicle filter → candidate part IDs from DB ---
    // Runs only when at least one vehicle dimension is specified.
    // null = no vehicle filter active; [] = filter active but nothing matched.
    let vehiclePartIds = null;

    if (makeId || modelId || engineId) {
        const params = [];
        let p = 1;
        const ph = (val) => { params.push(val); return `$${p++}`; };

        // Build WHERE clause for the application table.
        // engine_id also matches applications linked to any model that uses that engine
        // (via vehicle_engine_fitment), so engine-only fitments surface correctly.
        const whereClauses = [];
        if (engineId) {
            const ep = ph(engineId);
            whereClauses.push(`(a.engine_id = ${ep} OR (a.model_id IS NOT NULL AND a.model_id IN (
                SELECT vef.model_id FROM vehicle_engine_fitment vef WHERE vef.engine_id = ${ep}
            )))`);
        }
        if (modelId) whereClauses.push(`a.model_id = ${ph(modelId)}`);
        if (makeId)  whereClauses.push(`a.make_id  = ${ph(makeId)}`);

        let yearWhereClause = '';
        if (year) {
            const yp = ph(year);
            yearWhereClause = `WHERE (pa.year_start IS NULL OR pa.year_start <= ${yp})
              AND (pa.year_end IS NULL OR pa.year_end >= ${yp})`;
        }

        const universalStatusClause =
            status === 'active'   ? 'AND is_active = true'  :
            status === 'inactive' ? 'AND is_active = false' : '';

        const sql = `
            WITH matched_apps AS (
                SELECT DISTINCT a.application_id
                FROM application a
                WHERE ${whereClauses.join(' AND ')}
            )
            SELECT DISTINCT pa.part_id
            FROM part_application pa
            JOIN matched_apps ma ON pa.application_id = ma.application_id
            ${yearWhereClause}
            UNION
            SELECT part_id FROM part WHERE is_universal = true ${universalStatusClause}
        `;

        const { rows: vRows } = await db.query(sql, params);
        vehiclePartIds = vRows.map(r => r.part_id);
    }

    // Vehicle filter is active but produced no candidates — short-circuit before Meili
    if (vehiclePartIds !== null && vehiclePartIds.length === 0) {
        return res.json([]);
    }

    try {
        const index = meiliClient.index('parts');
        const searchOptions = {
            limit: 200,
            matchingStrategy: 'all',
            attributesToSearchOn: [
                'barcodes',
                'internal_sku',
                'normalized_internal_sku',
                'part_numbers',
                'normalized_part_numbers',
                'display_name',
                'brand_name',
                'group_name',
                'searchable_applications',
                'tags',
                'detail'
            ],
            attributesToRetrieve: [
                'part_id',
                'is_active',
                'applications',            // may be array of strings or objects depending on indexer
                'applications_array',      // legacy / alternate field name
                'searchable_applications'
            ]
        };

        // Apply status filter to Meilisearch query so inactive parts aren't returned by default
        const filter = [];
        if (status === 'active') filter.push('is_active = true');
        else if (status === 'inactive') filter.push('is_active = false');
        if (filter.length > 0) searchOptions.filter = filter.join(' AND ');

        const searchResults = await index.search(keyword || '', searchOptions);
        let partIds = searchResults.hits.map(h => h.part_id).filter(Boolean);

        // Intersect with vehicle-filtered candidates when the vehicle filter was active.
        if (vehiclePartIds !== null) {
            const vehicleSet = new Set(vehiclePartIds);
            if (keyword && keyword.trim()) {
                // Keyword + vehicle: intersection preserving Meili rank order
                partIds = partIds.filter(id => vehicleSet.has(id));
            } else {
                // Vehicle-only (no keyword): use vehicle set directly, limited to 200
                partIds = vehiclePartIds.slice(0, 200);
            }
        }

        if (partIds.length === 0) return res.json([]);

        // Fetch display fields from DB while preserving result order
        const query = `
            SELECT
                p.part_id,
                p.internal_sku,
                p.detail,
                p.last_sale_price,
                p.last_sale_price_date,
                p.last_cost,
                p.last_cost_date,
                COALESCE(p.wac_cost, 0) AS wac_cost,
                -- The last posted receipt is the authoritative record of what this part
                -- was actually bought for. part.last_cost is *usually* the same figure,
                -- but the WAC trigger also fires on non-purchase StockIn rows (an
                -- invoice void reverses stock at cost_at_sale, a cost estimate posts a
                -- synthetic StockIn), so it can drift away from a real supplier price.
                -- Reading the receipt directly lets the UI show the supplier's unit cost
                -- and the landed cost side by side, and say which document they came from.
                lr.grn_number       AS last_receipt_grn_number,
                lr.receipt_date     AS last_receipt_date,
                lr.cost_price       AS last_receipt_unit_cost,
                lr.landed_unit_cost AS last_receipt_landed_cost,
                lr.sale_price       AS last_receipt_sale_price,
                p.tax_rate_id,
                p.is_tax_inclusive_price,
                b.brand_name,
                g.group_name,
                (SELECT display_name FROM public.parts_view pv WHERE pv.part_id = p.part_id) AS display_name,
                (
                    SELECT ARRAY_AGG(pb.barcode)
                    FROM part_barcode pb WHERE pb.part_id = p.part_id
                ) AS barcodes,
                (
                    SELECT STRING_AGG(pn.part_number, '; ' ORDER BY pn.display_order)
                    FROM part_number pn WHERE pn.part_id = p.part_id AND ${activeAliasCondition('pn')}
                ) AS part_numbers,
                (
                    SELECT COALESCE(SUM(it.quantity), 0) FROM inventory_transaction it WHERE it.part_id = p.part_id
                ) AS stock_on_hand
            FROM part p
            LEFT JOIN brand b ON p.brand_id = b.brand_id
            LEFT JOIN "group" g ON p.group_id = g.group_id
            LEFT JOIN LATERAL (
                SELECT gr.grn_number, gr.receipt_date, grl.cost_price,
                       grl.landed_unit_cost, grl.sale_price
                FROM goods_receipt_line grl
                JOIN goods_receipt gr ON gr.grn_id = grl.grn_id
                WHERE grl.part_id = p.part_id
                  AND gr.status = 'Active'
                  AND gr.workflow_status = 'Posted'
                  -- A line returned in full delivered nothing and costs nothing: its
                  -- landed cost is legitimately 0, which is not a price anyone should
                  -- be shown. Skip past it to the last receipt that actually stocked.
                  AND (grl.quantity - grl.return_quantity) > 0
                ORDER BY gr.receipt_date DESC, gr.grn_id DESC
                LIMIT 1
            ) lr ON TRUE
            WHERE p.part_id = ANY($1::int[])
            ORDER BY array_position($1::int[], p.part_id);
        `;

        const { rows } = await db.query(query, [partIds]);

        const rowsById = rows.reduce((acc, r) => { acc[r.part_id] = r; return acc; }, {});
        const parts = partIds.map(id => {
            const p = rowsById[id] || null;
            if (!p) return null;

            const hit = searchResults.hits.find(h => h.part_id === id) || {};
            const rawApps = hit.applications || hit.applications_array || [];

            let normalized = [];
            if (Array.isArray(rawApps)) {
                normalized = rawApps;
            } else if (typeof rawApps === 'string') {
                if (rawApps.includes(',')) {
                    normalized = rawApps.split(',').map(s => s.trim()).filter(Boolean);
                } else if (rawApps.trim()) {
                    normalized = [rawApps.trim()];
                }
            } else if (rawApps) {
                normalized = [rawApps];
            }

            const formattedApps = normalized.flatMap(a => {
                if (!a) return [];
                if (typeof a === 'number') return [{ application_id: a, _source: 'id' }];
                if (typeof a === 'string') {
                    const trimmed = a.trim();
                    if (!trimmed) return [];
                    if (/^\d+$/.test(trimmed)) return [{ application_id: parseInt(trimmed, 10), _source: 'id-string' }];
                    return [{ display: trimmed, _source: 'string' }];
                }
                if (typeof a === 'object') {
                    if (a.application_id && !(a.make || a.model || a.engine || a.display)) {
                        return [{ application_id: a.application_id, _source: 'id-object' }];
                    }
                    const base = `${a.make || ''} ${a.model || ''} ${a.engine || ''}`.trim();
                    const yrs = (a.year_start || a.year_end)
                        ? ` (${[a.year_start, a.year_end].filter(Boolean).join('-')})`
                        : '';
                    const display = (a.display || (base + yrs).trim()).trim();
                    if (!display) return [];
                    return [{ display, ...a, _source: 'object' }];
                }
                return [];
            });

            return {
                ...p,
                display_name: p.display_name || '',
                applications: formattedApps
            };
        }).filter(Boolean);

        res.json(parts);
    } catch (err) {
        console.error('Meilisearch Error:', err.message);
        res.status(500).send('Server Error during search.');
    }
});

module.exports = router;
