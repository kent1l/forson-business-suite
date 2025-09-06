const express = require('express');
const db = require('../db');
const { meiliClient } = require('../meilisearch');
const { constructDisplayName } = require('../helpers/displayNameHelper');
const { activeAliasCondition } = require('../helpers/partNumberSoftDelete');
const router = express.Router();

// GET /api/power-search/parts - Advanced multi-filter search using Meilisearch
router.get('/power-search/parts', async (req, res) => {
    const { keyword } = req.query; // Other filters (brand, group, application, year) reserved for future enhancement

    try {
        const index = meiliClient.index('parts');
        const searchOptions = {
            limit: 200,
            attributesToRetrieve: [
                'part_id',
                'applications',            // may be array of strings or objects depending on indexer
                'applications_array',      // legacy / alternate field name
                'searchable_applications'
            ]
        };

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
                p.last_cost,
                b.brand_name,
                g.group_name,
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
                        display_name: constructDisplayName(p),
                        applications: formattedApps
                    };
                }).filter(Boolean);        res.json(parts);
    } catch (err) {
        console.error('Meilisearch Error:', err.message);
        res.status(500).send('Server Error during search.');
    }
});

module.exports = router;