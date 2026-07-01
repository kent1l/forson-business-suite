const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const { meiliClient } = require('../meilisearch');
const { enqueuePartUpsert, enqueuePartDelete } = require('../services/meiliOutboxService');
const { activeAliasCondition } = require('../helpers/partNumberSoftDelete');
const { normalizePartData } = require('../helpers/normalizePart');
const { parsePaginationQuery, paginatedResponse } = require('../helpers/pagination');
const router = express.Router();

// Helper function to get all data for a part for Meilisearch indexing
const getPartDataForMeili = async (client, partId) => {
    const query = `
        SELECT
            pv.*,
            (SELECT ARRAY_AGG(pb.barcode) FROM part_barcode pb WHERE pb.part_id = pv.part_id) as barcodes,
            (SELECT STRING_AGG(pn.part_number, '; ') FROM part_number pn WHERE pn.part_id = pv.part_id AND ${activeAliasCondition('pn')}) as part_numbers,
                        (SELECT ARRAY_AGG(
                                CONCAT(vmk.make_name, ' ', vmd.model_name, COALESCE(CONCAT(' ', veng.engine_name), ''))
                        ) FROM part_application pa
                            JOIN application a ON pa.application_id = a.application_id
                            LEFT JOIN vehicle_make vmk ON a.make_id = vmk.make_id
                            LEFT JOIN vehicle_model vmd ON a.model_id = vmd.model_id
                            LEFT JOIN vehicle_engine veng ON a.engine_id = veng.engine_id
                        WHERE pa.part_id = pv.part_id) AS applications_array,
            (SELECT ARRAY_AGG(t.tag_name) FROM tag t JOIN part_tag pt ON t.tag_id = pt.tag_id WHERE pt.part_id = pv.part_id) AS tags_array
        FROM public.parts_view AS pv
        WHERE pv.part_id = $1
    `;
    const res = await client.query(query, [partId]);
    if (res.rows.length === 0) return null;

    const part = res.rows[0];
    const normalizedFields = normalizePartData(part);
    return {
        ...part,
        // display_name is already provided by parts_view
        applications: part.applications_array || [],
        // Flatten applications into a single searchable string for Meilisearch
        searchable_applications: (part.applications_array && Array.isArray(part.applications_array))
            ? part.applications_array.map(app => {
                if (typeof app === 'string') return app;
                return `${app.make || ''} ${app.model || ''} ${app.engine || ''}`.trim();
            }).join(', ')
            : '',
        tags: part.tags_array || [],
        barcodes: part.barcodes || [],
        normalized_internal_sku: normalizedFields.normalized_internal_sku,
        normalized_part_numbers: normalizedFields.normalized_part_numbers
    };
};

// Helper function to handle tag logic
const manageTags = async (client, tags, partId) => {
    if (!Array.isArray(tags)) {
        return; // Skip tag processing if tags is not an array
    }

    // Delete existing tags for the part
    await client.query('DELETE FROM part_tag WHERE part_id = $1', [partId]);

    if (tags && tags.length > 0) {
        const sanitizedTags = tags.map(tag => tag.trim().toLowerCase());

        // Fetch existing tags in a single query
        const existingTagsRes = await client.query(
            'SELECT tag_id, tag_name FROM tag WHERE tag_name = ANY($1)',
            [sanitizedTags]
        );
        const existingTags = existingTagsRes.rows.reduce((map, row) => {
            map[row.tag_name] = row.tag_id;
            return map;
        }, {});

        const newTags = sanitizedTags.filter(tag => !existingTags[tag]);

        // Insert new tags in a single query
        if (newTags.length > 0) {
            const insertNewTagsRes = await client.query(
                `INSERT INTO tag (tag_name) VALUES ${newTags.map((_, i) => `($${i + 1})`).join(', ')} RETURNING tag_id, tag_name`,
                newTags
            );
            insertNewTagsRes.rows.forEach(row => {
                existingTags[row.tag_name] = row.tag_id;
            });
        }

        // Associate tags with the part using guarded, parameterized inserts.
        // This avoids relying on ON CONFLICT and prevents SQL injection by using parameters.
        for (const tag of sanitizedTags) {
            const tagId = existingTags[tag];
            if (!tagId) continue;
            const insertPartTag = `
                INSERT INTO part_tag (part_id, tag_id)
                SELECT $1, $2
                WHERE NOT EXISTS (
                    SELECT 1 FROM part_tag WHERE part_id = $1 AND tag_id = $2
                )
            `;
            await client.query(insertPartTag, [partId, tagId]);
        }
    }
};

// Helper function to handle multiple barcodes
const manageBarcodes = async (client, barcodes, partId) => {
    if (!Array.isArray(barcodes)) {
        return;
    }

    // Delete existing barcodes for the part
    await client.query('DELETE FROM part_barcode WHERE part_id = $1', [partId]);

    const validBarcodes = barcodes.map(b => (typeof b === 'string' ? b.trim() : '')).filter(Boolean);
    const uniqueBarcodes = [...new Set(validBarcodes)];

    for (const barcode of uniqueBarcodes) {
        // We use INSERT ... ON CONFLICT DO NOTHING to handle if the barcode is assigned somewhere else
        // or just insert. If it's unique across the table, we'll let it error if it's already used by ANOTHER part,
        // which matches the previous constraint behavior. But wait, if they try to use an existing barcode from another part,
        // it will throw a unique constraint error which the route catches.
        await client.query(
            'INSERT INTO part_barcode (part_id, barcode) VALUES ($1, $2)',
            [partId, barcode]
        );
    }
};

// GET all parts with status filter, search, and sorting (POWERED BY MEILISEARCH)
router.get('/parts', protect, hasPermission('parts:view'), async (req, res) => {
    const { status = 'active', search = '', tags = '' } = req.query;
    const { paginated, page, pageSize, offset, limit } = parsePaginationQuery(req.query);
    const sortBy = String(req.query.sortBy || 'name').toLowerCase();
    const sortDirection = String(req.query.sortDirection || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    const isGlobalSort = ['name', 'display_name', 'sku', 'application'].includes(sortBy);
    try {
        const index = meiliClient.index('parts');
        const searchOptions = {
            attributesToRetrieve: ['part_id'],
            // Strict Relevance with Exact-Match Priority
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
            ]
        };
        const filter = [];

        if (status === 'active') filter.push('is_active = true');
        else if (status === 'inactive') filter.push('is_active = false');

        if (tags) {
            const tagList = tags.split(',').map(t => t.trim().toLowerCase());
            // Use array includes instead of direct string interpolation for safety
            filter.push(`tags IN [${tagList.map(tag => `'${tag.replace(/'/g, "''")}'`).join(', ')}]`);
        }

        if (filter.length > 0) searchOptions.filter = filter.join(' AND ');

        console.log('[DEBUG] [GET /parts] Attempting Meilisearch query...');
        const metadataResults = paginated && isGlobalSort
            ? await index.search(search, { ...searchOptions, limit: 0, offset: 0 })
            : null;
        const totalHits = metadataResults?.estimatedTotalHits || metadataResults?.totalHits || 0;
        const fetchLimit = paginated && isGlobalSort
            ? Math.min(totalHits, 20000)
            : (paginated ? limit : 200);
        const fetchOffset = paginated && isGlobalSort ? 0 : (paginated ? offset : 0);

        const searchResults = await index.search(search, { ...searchOptions, limit: fetchLimit, offset: fetchOffset });
        const partIds = searchResults.hits.map(hit => hit.part_id);
        if (partIds.length === 0) {
            if (paginated) return res.json(paginatedResponse({ data: [], page, pageSize, total: 0 }));
            return res.json([]);
        }

        const queryParams = [partIds];
        const sqlOffset = isGlobalSort && paginated ? `LIMIT $2 OFFSET $3` : '';
        if (isGlobalSort && paginated) {
            queryParams.push(limit, offset);
        }
        let orderByClause = 'ORDER BY array_position($1::int[], pv.part_id)';
        if (isGlobalSort) {
            if (sortBy === 'sku') {
                orderByClause = `ORDER BY LOWER(COALESCE(pv.internal_sku, '')) ${sortDirection}, pv.part_id ${sortDirection}`;
            } else if (sortBy === 'application') {
                orderByClause = `ORDER BY LOWER(COALESCE(applications, '')) ${sortDirection}, pv.part_id ${sortDirection}`;
            } else {
                orderByClause = `ORDER BY LOWER(COALESCE(pv.group_name, '') || ' ' || COALESCE(pv.brand_name, '') || ' ' || COALESCE(pv.detail, '')) ${sortDirection}, pv.part_id ${sortDirection}`;
            }
        }

        const query = `
            SELECT
                pv.*,
                (SELECT ARRAY_AGG(pb.barcode) FROM part_barcode pb WHERE pb.part_id = pv.part_id) as barcodes,
                (SELECT STRING_AGG(pn.part_number, '; ' ORDER BY pn.display_order) FROM part_number pn WHERE pn.part_id = pv.part_id AND ${activeAliasCondition('pn')}) AS part_numbers,
                (SELECT STRING_AGG(
                    CONCAT(
                        vmk.make_name, ' ', vmd.model_name, COALESCE(CONCAT(' ', veng.engine_name), ''),
                        CASE
                            WHEN pa.year_start IS NOT NULL AND pa.year_end IS NOT NULL AND pa.year_start = pa.year_end THEN CONCAT(' [', pa.year_start, ']')
                            WHEN pa.year_start IS NOT NULL AND pa.year_end IS NOT NULL THEN CONCAT(' [', pa.year_start, '-', pa.year_end, ']')
                            WHEN pa.year_start IS NOT NULL THEN CONCAT(' [', pa.year_start, '-]')
                            WHEN pa.year_end IS NOT NULL THEN CONCAT(' [-', pa.year_end, ']')
                            ELSE ''
                        END
                    ), '; '
                ) FROM part_application pa
                  JOIN application a ON pa.application_id = a.application_id
                  LEFT JOIN vehicle_make vmk ON a.make_id = vmk.make_id
                  LEFT JOIN vehicle_model vmd ON a.model_id = vmd.model_id
                  LEFT JOIN vehicle_engine veng ON a.engine_id = veng.engine_id
                WHERE pa.part_id = pv.part_id) AS applications,
                (SELECT STRING_AGG(t.tag_name, ', ') FROM tag t JOIN part_tag pt ON t.tag_id = pt.tag_id WHERE pt.part_id = pv.part_id) AS tags
            FROM public.parts_view AS pv
            WHERE pv.part_id = ANY($1::int[])
            ${orderByClause}
            ${sqlOffset}
        `;
        console.log('[DEBUG] [GET /parts] Attempting Postgres query...');
        const { rows } = await db.query(query, queryParams);
        // display_name is natively provided by parts_view
        if (!paginated) {
            return res.json(rows);
        }
        const total = isGlobalSort
            ? (totalHits || rows.length)
            : (searchResults.estimatedTotalHits || searchResults.totalHits || rows.length);
        res.json(paginatedResponse({ data: rows, page, pageSize, total }));
    } catch (err) {
        console.error(`[${req.method} ${req.url}] Internal Error:`, err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// GET a single part by ID
router.get('/parts/:id', protect, hasPermission('parts:view'), async (req, res) => {
    const { id } = req.params;
    try {
        const query = `
            SELECT
                pv.*,
                (SELECT ARRAY_AGG(pb.barcode) FROM part_barcode pb WHERE pb.part_id = pv.part_id) as barcodes,
                (SELECT STRING_AGG(pn.part_number, '; ' ORDER BY pn.display_order) FROM part_number pn WHERE pn.part_id = pv.part_id AND ${activeAliasCondition('pn')}) AS part_numbers
            FROM public.parts_view AS pv
            WHERE pv.part_id = $1;
        `;
        const { rows } = await db.query(query, [id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Part not found' });
        // display_name is natively provided by parts_view
        res.json(rows[0]);
    } catch (err) {
        console.error(`[${req.method} ${req.url}] Internal Error:`, err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// GET /api/parts/:id/tags - Get all tags for a specific part
router.get('/parts/:id/tags', protect, hasPermission('parts:view'), async (req, res) => {
    const { id } = req.params;
    try {
        const query = `
            SELECT t.tag_id, t.tag_name 
            FROM tag t
            JOIN part_tag pt ON t.tag_id = pt.tag_id
            WHERE pt.part_id = $1
            ORDER BY t.tag_name;
        `;
        const { rows } = await db.query(query, [id]);
        res.json(rows);
    } catch (err) {
        console.error(`[${req.method} ${req.url}] Internal Error:`, err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

router.post('/parts', protect, hasPermission('parts:create'), async (req, res) => {
    console.log('[DEBUG] POST /parts - Request body:', req.body);
    const { tags, barcodes, created_by, part_numbers_string, ...partData } = req.body;
    // detail is optional; only brand and group are required
    if (!partData.brand_id || !partData.group_id) {
        console.log('[DEBUG] POST /parts - Missing brand_id or group_id');
        return res.status(400).json({ message: 'Brand and group are required' });
    }
    console.log('[DEBUG] POST /parts - Getting DB client');
    const client = await db.getClient();
    try {
        console.log('[DEBUG] POST /parts - Starting transaction');
        await client.query('BEGIN');
        console.log('[DEBUG] POST /parts - Fetching brand:', partData.brand_id);
        const brandRes = await client.query('SELECT brand_code, brand_name FROM brand WHERE brand_id = $1', [partData.brand_id]);
        console.log('[DEBUG] POST /parts - Fetching group:', partData.group_id);
        const groupRes = await client.query('SELECT group_code, group_name FROM "group" WHERE group_id = $1', [partData.group_id]);
        console.log('[DEBUG] POST /parts - Brand result:', brandRes.rows, 'Group result:', groupRes.rows);
        if (brandRes.rows.length === 0 || groupRes.rows.length === 0) {
            console.log('[DEBUG] POST /parts - Invalid brand or group');
            throw new Error('Invalid brand or group ID');
        }
        
        const skuPrefix = `${groupRes.rows[0].group_code}-${brandRes.rows[0].brand_code}`;
        let nextSeqNum = 1;
        const seqRes = await client.query('SELECT last_number FROM document_sequence WHERE prefix = $1 FOR UPDATE', [skuPrefix]);
        if (seqRes.rows.length > 0) {
            nextSeqNum = seqRes.rows[0].last_number + 1;
            await client.query('UPDATE document_sequence SET last_number = $1 WHERE prefix = $2', [nextSeqNum, skuPrefix]);
        } else {
            await client.query('INSERT INTO document_sequence (prefix, period, last_number) VALUES ($1, \'ALL\', $2)', [skuPrefix, nextSeqNum]);
        }
        const internalSku = `${skuPrefix}-${String(nextSeqNum).padStart(4, '0')}`;
        
        const taxRateIdOrNull = partData.tax_rate_id ? parseInt(partData.tax_rate_id, 10) : null;

        const newPartQuery = `
            INSERT INTO part (detail, brand_id, group_id, internal_sku, reorder_point, warning_quantity, is_active, last_cost, last_sale_price, measurement_unit, is_price_change_allowed, is_using_default_quantity, is_service, low_stock_warning, created_by, tax_rate_id, is_tax_inclusive_price)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *;
        `;
        const newPart = await client.query(newPartQuery, [
            partData.detail, partData.brand_id, partData.group_id, internalSku, partData.reorder_point, 
            partData.warning_quantity, partData.is_active, partData.last_cost, partData.last_sale_price,
            partData.measurement_unit, partData.is_price_change_allowed, partData.is_using_default_quantity,
            partData.is_service, partData.low_stock_warning, created_by, taxRateIdOrNull, partData.is_tax_inclusive_price
        ]);
        const newPartData = newPart.rows[0];

        if (part_numbers_string) {
            const numbers = part_numbers_string.split(/[,;]/).map(num => num.trim()).filter(Boolean);
            for (const number of numbers) {
                // Use guarded INSERT ... SELECT ... WHERE NOT EXISTS so code works even when
                // the DB uses a partial unique index (soft-delete) or the unique constraint
                // is not present. This avoids the Postgres "no unique constraint matching
                // the ON CONFLICT specification" error.
                const insertPartNumberQuery = `
                    WITH input_value AS (
                        SELECT CAST($2 AS character varying(100)) AS part_number
                    )
                    INSERT INTO part_number (part_id, part_number)
                    SELECT $1, input_value.part_number
                    FROM input_value
                    WHERE NOT EXISTS (
                        SELECT 1 FROM part_number 
                        WHERE part_id = $1 
                        AND part_number = input_value.part_number
                        AND ${activeAliasCondition('part_number')}
                    )
                `;
                console.log('[DEBUG] Inserting part number:', { partId: newPartData.part_id, number });
                await client.query(insertPartNumberQuery, [newPartData.part_id, number]);
            }
        }
        
        await manageTags(client, tags, newPartData.part_id);
        await manageBarcodes(client, barcodes, newPartData.part_id);
        await client.query('COMMIT');
        
        const partForMeili = await getPartDataForMeili(db, newPartData.part_id);
        if (partForMeili) {
            // Queue durable background sync and return enriched payload including display_name
            await enqueuePartUpsert(partForMeili.part_id, {
                source: 'partRoutes.create',
                version_ts: partForMeili.date_modified || partForMeili.date_created || new Date().toISOString()
            });
            return res.status(201).json(partForMeili);
        }

        // Fallback to raw row if enrichment fails
        res.status(201).json(newPartData);
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23505' && err.constraint === 'part_barcode_barcode_key') {
            return res.status(400).json({ error: 'This barcode is already assigned to another item.' });
        }
        console.error(`[${req.method} ${req.url}] Internal Error:`, err);
        res.status(500).json({ message: 'Internal Server Error' });
    } finally {
        client.release();
    }
});

router.put('/parts/bulk-update', protect, hasPermission('parts:edit'), async (req, res) => {
    // This is a placeholder for the bulk update logic.
    // For a real implementation, you would loop through partIds and apply updates.
    // After updating, you would need to re-sync each affected part with Meilisearch.
    res.status(501).json({ message: 'Bulk update not implemented yet.' });
});

router.put('/parts/:id', protect, hasPermission('parts:edit'), async (req, res) => {
    const { id } = req.params;
    const { tags, barcodes, modified_by, ...partData } = req.body;
    // detail is optional; only brand and group are required
    if (!partData.brand_id || !partData.group_id) {
        return res.status(400).json({ message: 'Brand and group are required' });
    }
    
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        
        const taxRateIdOrNull = partData.tax_rate_id ? parseInt(partData.tax_rate_id, 10) : null;

        const updatedPart = await client.query(
            `UPDATE part SET 
                detail = $1, brand_id = $2, group_id = $3, reorder_point = $4, 
                warning_quantity = $5, is_active = $6, last_cost = $7, last_sale_price = $8, 
                measurement_unit = $9, is_price_change_allowed = $10, 
                is_using_default_quantity = $11, is_service = $12, low_stock_warning = $13, 
                modified_by = $14, date_modified = CURRENT_TIMESTAMP, tax_rate_id = $15,
                is_tax_inclusive_price = $16
            WHERE part_id = $17 RETURNING *`,
            [
                partData.detail, partData.brand_id, partData.group_id, partData.reorder_point, partData.warning_quantity, partData.is_active, 
                partData.last_cost, partData.last_sale_price, partData.measurement_unit, partData.is_price_change_allowed, 
                partData.is_using_default_quantity, partData.is_service, partData.low_stock_warning, modified_by, taxRateIdOrNull,
                partData.is_tax_inclusive_price, id
            ]
        );
        if (updatedPart.rows.length === 0) {
            return res.status(404).json({ message: 'Part not found' });
        }
        
        await manageTags(client, tags, id);
        await manageBarcodes(client, barcodes, id);
        await client.query('COMMIT');

        const partForMeili = await getPartDataForMeili(db, id);
        if (partForMeili) {
            await enqueuePartUpsert(partForMeili.part_id, {
                source: 'partRoutes.update',
                version_ts: partForMeili.date_modified || partForMeili.date_created || new Date().toISOString()
            });
            return res.json(partForMeili);
        }
        
        // Fallback to raw row if enrichment fails
        res.json(updatedPart.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23505' && err.constraint === 'part_barcode_barcode_key') {
            return res.status(400).json({ error: 'This barcode is already assigned to another item.' });
        }
        console.error(`[${req.method} ${req.url}] Internal Error:`, err);
        res.status(500).json({ message: 'Internal Server Error' });
    } finally {
        client.release();
    }
});

// DELETE - Delete a part
router.delete('/parts/:id', protect, hasPermission('parts:delete'), async (req, res) => {
    const { id } = req.params;
    try {
        const deleteOp = await db.query('DELETE FROM part WHERE part_id = $1 RETURNING *', [id]);
        if (deleteOp.rowCount === 0) {
            return res.status(404).json({ message: 'Part not found' });
        }
        await enqueuePartDelete(id, {
            source: 'partRoutes.delete',
            version_ts: new Date().toISOString()
        });
        res.json({ message: 'Part deleted successfully' });
    } catch (err) {
        console.error(`[${req.method} ${req.url}] Internal Error:`, err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

module.exports = { router, manageTags, manageBarcodes, getPartDataForMeili };

