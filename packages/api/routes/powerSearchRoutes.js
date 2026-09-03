const express = require('express');
const db = require('../db');
const { meiliClient } = require('../meilisearch');
const { activeAliasCondition } = require('../helpers/partNumberSoftDelete');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const router = express.Router();

// GET /api/power-search/parts - Advanced multi-filter search using Meilisearch
// Default behavior: only return active parts unless `status=all` or `status=inactive` is passed.
router.get('/power-search/parts', protect, hasPermission(['parts:view', 'pos:use']), async (req, res) => {
    const { keyword, status = 'active' } = req.query; // Other filters (brand, group, application, year) reserved for future enhancement

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
        const partIds = searchResults.hits.map(h => h.part_id).filter(Boolean);

        if (partIds.length === 0) return res.json([]);

        // Fetch stock and sale price and other display fields from DB while preserving MeiliSearch order
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

                // Map returned rows back into MeiliSearch order just in case
                const rowsById = rows.reduce((acc, r) => { acc[r.part_id] = r; return acc; }, {});
                const parts = partIds.map(id => {
                    const p = rowsById[id] || null;
                    if (!p) return null;

                    // Get the MeiliSearch hit for this part
                    const hit = searchResults.hits.find(h => h.part_id === id) || {};
                    
                    const rawApps = hit.applications || hit.applications_array || [];

                    // Normalize rawApps into an array of primitive/objects
                    let normalized = [];
                    if (Array.isArray(rawApps)) {
                        normalized = rawApps;
                    } else if (typeof rawApps === 'string') {
                        // Support legacy comma-separated id strings like "7, 3"
                        if (rawApps.includes(',')) {
                            normalized = rawApps.split(',').map(s => s.trim()).filter(Boolean);
                        } else if (rawApps.trim()) {
                            normalized = [rawApps.trim()];
                        }
                    } else if (rawApps) {
                        // Single object? wrap it
                        normalized = [rawApps];
                    }

                    const formattedApps = normalized.flatMap(a => {
                        if (!a) return [];
                        // Numeric ID coming from index (number)
                        if (typeof a === 'number') {
                            return [{ application_id: a, _source: 'id' }];
                        }
                        // Numeric string ID
                        if (typeof a === 'string') {
                            const trimmed = a.trim();
                            if (!trimmed) return [];
                            if (/^\d+$/.test(trimmed)) {
                                return [{ application_id: parseInt(trimmed, 10), _source: 'id-string' }];
                            }
                            // Plain text application already formatted
                            return [{ display: trimmed, _source: 'string' }];
                        }
                        if (typeof a === 'object') {
                            // If object only has application_id keep minimal so frontend enrichment can resolve full text
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
                }).filter(Boolean);        res.json(parts);
    } catch (err) {
        console.error('Meilisearch Error:', err.message);
        res.status(500).send('Server Error during search.');
    }
});

module.exports = router;
