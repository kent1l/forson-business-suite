const { effectiveRuleColumns } = require('../helpers/fitmentDocumentSql');
const { evaluateFitmentRules } = require('../helpers/fitmentMatcher');
const express = require('express');
const db = require('../db');
const { meiliClient } = require('../meilisearch');
const { activeAliasCondition } = require('../helpers/partNumberSoftDelete');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const router = express.Router();

const parsePartIds = (value) => [...new Set(String(value || '')
    .split(',')
    .map(id => id.trim())
    .filter(id => /^\d+$/.test(id))
    .map(Number)
    .filter(Number.isSafeInteger))].slice(0, 200);

// GET /api/power-search/interchangeable-parts?part_ids=1,2
// Punctuation/case-insensitive part-number equality is deterministic, so this
// stays a local PostgreSQL lookup rather than calling search or an AI service.
router.get('/power-search/interchangeable-parts', protect, hasPermission(['parts:view', 'pos:use']), async (req, res) => {
    const partIds = parsePartIds(req.query.part_ids);
    if (partIds.length === 0) return res.json([]);

    try {
        const { rows } = await db.query(`
            WITH searched_numbers AS (
                SELECT DISTINCT REGEXP_REPLACE(LOWER(pn.part_number), '[^a-z0-9]', '', 'g') AS normalized_number
                FROM part_number pn
                WHERE pn.part_id = ANY($1::int[])
                  AND ${activeAliasCondition('pn')}
                  AND LENGTH(REGEXP_REPLACE(LOWER(pn.part_number), '[^a-z0-9]', '', 'g')) >= 3
            ), matches AS (
                SELECT pn.part_id,
                       ARRAY_AGG(DISTINCT pn.part_number) AS matching_part_numbers
                FROM part_number pn
                JOIN searched_numbers sn
                  ON REGEXP_REPLACE(LOWER(pn.part_number), '[^a-z0-9]', '', 'g') = sn.normalized_number
                WHERE ${activeAliasCondition('pn')}
                  AND pn.part_id <> ALL($1::int[])
                GROUP BY pn.part_id
            )
            SELECT p.part_id,
                   p.internal_sku,
                   p.detail,
                   p.measurement_unit,
                   b.brand_name,
                   g.group_name,
                   (SELECT display_name FROM public.parts_view pv WHERE pv.part_id = p.part_id) AS display_name,
                   m.matching_part_numbers,
                   COALESCE(stock.stock_on_hand, 0) AS stock_on_hand
            FROM matches m
            JOIN part p ON p.part_id = m.part_id
            LEFT JOIN brand b ON b.brand_id = p.brand_id
            LEFT JOIN "group" g ON g.group_id = p.group_id
            LEFT JOIN LATERAL (
                SELECT SUM(it.quantity) AS stock_on_hand
                FROM inventory_transaction it
                WHERE it.part_id = p.part_id
            ) stock ON TRUE
            WHERE p.is_active = TRUE
            ORDER BY p.internal_sku ASC NULLS LAST, p.part_id ASC
        `, [partIds]);
        res.json(rows);
    } catch (err) {
        console.error('Interchangeable part-number lookup failed:', err.message);
        res.status(500).send('Server Error during interchangeable part-number lookup.');
    }
});

// GET /api/power-search/parts - Advanced multi-filter search using Meilisearch
// Default behavior: only return active parts unless `status=all` or `status=inactive` is passed.
// Vehicle filter params (all optional, integers): make_id, model_id, engine_id, year.
// When any vehicle filter is set the route resolves matching part IDs from DB first
// (including engine-only claims and universal declarations),
// then intersects with Meilisearch keyword results for relevance ranking.
router.get('/power-search/parts', protect, hasPermission(['parts:view', 'pos:use']), async (req, res) => {
    const { keyword, status = 'active' } = req.query;
    const parsedIds = {};
    for (const field of ['make_id','model_id','chassis_id','engine_id','year']) {
        if (req.query[field] == null || req.query[field] === '') { parsedIds[field]=null; continue; }
        if (!/^\d+$/.test(String(req.query[field])) || !Number.isSafeInteger(Number(req.query[field])) || Number(req.query[field]) <= 0) return res.status(400).json({code:'INVALID_FILTER',message:`Invalid ${field}`});
        parsedIds[field]=Number(req.query[field]);
    }
    const {make_id:makeId,model_id:modelId,chassis_id:chassisId,engine_id:engineId}=parsedIds;
    const vehicleQuery={...parsedIds};
    for (const field of ['market','variant','position','drivetrain','transmission','generation','fuel_type']) {
        if (req.query[field]) {
            if (typeof req.query[field] !== 'string' || req.query[field].length>200) return res.status(400).json({code:'INVALID_FILTER',message:`Invalid ${field}`});
            vehicleQuery[field]=req.query[field].trim();
        }
    }
    if (req.query.displacement_liters != null) {
        const displacement=Number(req.query.displacement_liters);
        if (!Number.isFinite(displacement)||displacement<=0||displacement>=20) return res.status(400).json({code:'INVALID_FILTER',message:'Invalid displacement_liters'});
        vehicleQuery.displacement_liters=displacement;
    }

    // --- Phase 4b: structured vehicle filter → candidate part IDs from DB ---
    // Runs only when at least one vehicle dimension is specified.
    // null = no vehicle filter active; [] = filter active but nothing matched.
    let vehiclePartIds = null;

    const vehicleAssessments = new Map();
    try {
        if (Object.values(vehicleQuery).some(value=>value!=null && value!=='')) {
            const params = [];
            const checks = ["r.is_active=TRUE", "r.effect='include'"];
            for (const [column,value] of [['make_id',makeId],['model_id',modelId],['chassis_id',chassisId],['engine_id',engineId]]) {
                if (value) { params.push(value); checks.push(`(a.${column} IS NULL OR a.${column}=$${params.length})`); }
            }
            // SQL retrieves coherent candidates; the shared evaluator handles unknown
            // classification details and exclusions before returning a fitment status.
            const candidates = await db.query(`SELECT DISTINCT r.part_id FROM part_application_rule r JOIN application a USING(application_id) WHERE ${checks.join(' AND ')}`,params);
            const ids = candidates.rows.map(r=>r.part_id);
            const universals=(await db.query('SELECT part_id FROM part WHERE is_universal=TRUE')).rows;
            const allIds=[...new Set([...ids,...universals.map(r=>r.part_id)])];
            const rules = allIds.length ? (await db.query(`SELECT r.*,a.make_id,a.model_id,a.chassis_id,a.engine_id,${effectiveRuleColumns()} FROM part_application_rule r JOIN application a USING(application_id) WHERE r.part_id=ANY($1::int[]) AND r.is_active=TRUE`,[allIds])).rows : [];
            const byPart = new Map();
            for (const rule of rules) { if (!byPart.has(rule.part_id)) byPart.set(rule.part_id,[]); byPart.get(rule.part_id).push(rule); }
            vehiclePartIds=[];
            for (const [partId,rows] of byPart) {
                const result=evaluateFitmentRules(rows,vehicleQuery);
                if (['confirmed','needs_details'].includes(result.state)) {
                    vehiclePartIds.push(partId);
                    vehicleAssessments.set(partId,{status:result.status,reasons:result.reasons});
                }
            }
            // Universal is a separate declaration; its explicit exclusions still apply.
            for (const {part_id} of universals) {
                const exclusions = (byPart.get(part_id) || []).filter(r=>r.effect==='exclude');
                const result = evaluateFitmentRules(exclusions,vehicleQuery);
                if (result.status !== 'excluded') {
                    if (!vehiclePartIds.includes(part_id)) vehiclePartIds.push(part_id);
                    vehicleAssessments.set(part_id,{status:'linked',reasons:['universal_part']});
                }
            }
        }

        // Vehicle filter is active but produced no candidates — short-circuit before Meili
        if (vehiclePartIds !== null && vehiclePartIds.length === 0) {
            return res.json([]);
        }

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
                p.measurement_unit,
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
              ${status === 'active' ? 'AND p.is_active=TRUE' : status === 'inactive' ? 'AND p.is_active=FALSE' : ''}
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
                applications: formattedApps,
                fitment: vehicleAssessments.get(id) || { status: 'linked', reasons: [] }
            };
        }).filter(Boolean);

        res.json(parts);
    } catch (err) {
        console.error('Meilisearch Error:', err.message);
        res.status(500).send('Server Error during search.');
    }
});

module.exports = router;
