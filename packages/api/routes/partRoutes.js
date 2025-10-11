const express = require('express');
const db = require('../db');
const { constructDisplayName } = require('../helpers/displayNameHelper');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const { syncPartWithMeili, removePartFromMeili, meiliClient } = require('../meilisearch');
const { activeAliasCondition } = require('../helpers/partNumberSoftDelete');
const { normalizePartData } = require('../helpers/normalizePart');
const {
    fetchPartApplications,
    formatApplicationDisplay,
    buildSearchableApplications
} = require('../helpers/applicationHelper');
const router = express.Router();

// Helper function to get all data for a part for Meilisearch indexing
const getPartDataForMeili = async (client, partId) => {
    const query = `
        SELECT
            p.*,
            b.brand_name,
            g.group_name,
            (SELECT STRING_AGG(pn.part_number, '; ') FROM part_number pn WHERE pn.part_id = p.part_id AND ${activeAliasCondition('pn')}) AS part_numbers,
            (SELECT ARRAY_AGG(t.tag_name) FROM tag t JOIN part_tag pt ON t.tag_id = pt.tag_id WHERE pt.part_id = p.part_id) AS tags_array
        FROM part AS p
        LEFT JOIN brand AS b ON p.brand_id = b.brand_id
        LEFT JOIN "group" AS g ON p.group_id = g.group_id
        WHERE p.part_id = $1
    `;
    const res = await client.query(query, [partId]);
    if (res.rows.length === 0) return null;

    const part = res.rows[0];
    const applicationRows = await fetchPartApplications(client, partId);
    const applicationLabels = applicationRows.map(formatApplicationDisplay).filter(Boolean);
    const searchableApplications = buildSearchableApplications(applicationRows);
    const normalizedFields = normalizePartData(part);
    return {
        ...part,
        display_name: constructDisplayName(part),
        applications: applicationLabels,
        searchable_applications: searchableApplications,
        tags: part.tags_array || [],
        normalized_internal_sku: normalizedFields.normalized_internal_sku,
        normalized_part_numbers: normalizedFields.normalized_part_numbers
    };
};

// Helper function to handle tag logic
const manageTags = async (client, tags, partId) => {
    console.log('[DEBUG] manageTags - Starting with:', { tags, partId });
    if (!Array.isArray(tags)) {
        console.log('[DEBUG] manageTags - Tags is not an array:', tags);
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

// GET all parts with status filter, search, and sorting (POWERED BY MEILISEARCH)
router.get('/parts', protect, hasPermission('parts:view'), async (req, res) => {
    const { status = 'active', search = '', tags = '' } = req.query;
    try {
        const index = meiliClient.index('parts');
        const searchOptions = { 
            limit: 200, 
            attributesToRetrieve: ['part_id'],
            // Prioritize exact normalized matches, then fall back to fuzzy search
            attributesToSearchOn: ['normalized_internal_sku', 'normalized_part_numbers', 'internal_sku', 'part_numbers', 'display_name', 'detail', 'brand_name', 'group_name', 'searchable_applications', 'tags']
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

        const searchResults = await index.search(search, searchOptions);
        const partIds = searchResults.hits.map(hit => hit.part_id);
        if (partIds.length === 0) return res.json([]);

        const query = `
            SELECT
                p.*, b.brand_name, g.group_name,
                (SELECT STRING_AGG(pn.part_number, '; ' ORDER BY pn.display_order) FROM part_number pn WHERE pn.part_id = p.part_id AND ${activeAliasCondition('pn')}) AS part_numbers,
                (SELECT STRING_AGG(
                    CONCAT(
                        COALESCE(app.make, ''),
                        CASE WHEN app.model IS NOT NULL AND app.model <> '' THEN CONCAT(' ', app.model) ELSE '' END,
                        CASE WHEN app.engine IS NOT NULL AND app.engine <> '' THEN CONCAT(' ', app.engine) ELSE '' END,
                        CASE
                            WHEN app.year_start IS NOT NULL AND app.year_end IS NOT NULL AND app.year_start = app.year_end THEN CONCAT(' [', app.year_start, ']')
                            WHEN app.year_start IS NOT NULL AND app.year_end IS NOT NULL THEN CONCAT(' [', app.year_start, '-', app.year_end, ']')
                            WHEN app.year_start IS NOT NULL THEN CONCAT(' [', app.year_start, '-]')
                            WHEN app.year_end IS NOT NULL THEN CONCAT(' [-', app.year_end, ']')
                            ELSE ''
                        END
                    ), '; '
                ) FROM (
                    SELECT paf.make_name AS make,
                           paf.model_name AS model,
                           paf.engine_name AS engine,
                           paf.year_start,
                           paf.year_end
                    FROM part_application_flexible paf
                    WHERE paf.part_id = p.part_id
                ) app) AS applications,
                (SELECT STRING_AGG(t.tag_name, ', ') FROM tag t JOIN part_tag pt ON t.tag_id = pt.tag_id WHERE pt.part_id = p.part_id) AS tags
            FROM part AS p
            LEFT JOIN brand AS b ON p.brand_id = b.brand_id
            LEFT JOIN "group" AS g ON p.group_id = g.group_id
            WHERE p.part_id = ANY($1::int[])
            ORDER BY array_position($1::int[], p.part_id)
        `;
        const { rows } = await db.query(query, [partIds]);
        const partsWithDisplayName = rows.map(part => ({ ...part, display_name: constructDisplayName(part) }));
        res.json(partsWithDisplayName);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET a single part by ID
router.get('/parts/:id', protect, hasPermission('parts:view'), async (req, res) => {
    const { id } = req.params;
    try {
        const query = `
            SELECT
                p.*, b.brand_name, g.group_name,
                (SELECT STRING_AGG(pn.part_number, '; ' ORDER BY pn.display_order) FROM part_number pn WHERE pn.part_id = p.part_id AND ${activeAliasCondition('pn')}) AS part_numbers
            FROM part AS p
            LEFT JOIN brand AS b ON p.brand_id = b.brand_id
            LEFT JOIN "group" AS g ON p.group_id = g.group_id
            WHERE p.part_id = $1;
        `;
        const { rows } = await db.query(query, [id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Part not found' });
        const part = { ...rows[0], display_name: constructDisplayName(rows[0]) };
        res.json(part);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
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
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

router.post('/parts', protect, hasPermission('parts:create'), async (req, res) => {
    console.log('[DEBUG] POST /parts - Request body:', req.body);
    const { tags, created_by, part_numbers_string, ...partData } = req.body;
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
            INSERT INTO part (detail, brand_id, group_id, internal_sku, reorder_point, warning_quantity, is_active, last_cost, last_sale_price, barcode, measurement_unit, is_price_change_allowed, is_using_default_quantity, is_service, low_stock_warning, created_by, tax_rate_id, is_tax_inclusive_price)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING *;
        `;
        const newPart = await client.query(newPartQuery, [
            partData.detail, partData.brand_id, partData.group_id, internalSku, partData.reorder_point, 
            partData.warning_quantity, partData.is_active, partData.last_cost, partData.last_sale_price, partData.barcode,
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
        await client.query('COMMIT');
        
        const partForMeili = await getPartDataForMeili(db, newPartData.part_id);
        if (partForMeili) {
            // Sync to search and return enriched payload including display_name
            syncPartWithMeili(partForMeili);
            return res.status(201).json(partForMeili);
        }

        // Fallback to raw row if enrichment fails
        res.status(201).json(newPartData);
    } catch (err) {
        console.log('[DEBUG] POST /parts - Error occurred:', err);
        console.log('[DEBUG] POST /parts - Error stack:', err.stack);
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).json({ 
            message: 'Server Error',
            error: err.message,
            stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined
        });
    } finally {
        console.log('[DEBUG] POST /parts - Releasing client');
        client.release();
    }
});

router.put('/parts/bulk-update', protect, hasPermission('parts:edit'), async (req, res) => {
    const { partIds, updates } = req.body || {};

    if (!Array.isArray(partIds) || partIds.length === 0) {
        return res.status(400).json({ message: 'No part IDs were provided for bulk update.' });
    }

    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
        return res.status(400).json({ message: 'Updates payload is missing or invalid.' });
    }

    const normalizedPartIds = Array.from(new Set(
        partIds
            .map(id => {
                const parsed = Number(id);
                return Number.isFinite(parsed) ? Math.trunc(parsed) : NaN;
            })
            .filter(id => Number.isInteger(id))
    ));

    if (normalizedPartIds.length === 0) {
        return res.status(400).json({ message: 'No valid part IDs were provided.' });
    }

    const parseBoolean = (value, field) => {
        if (typeof value === 'boolean') return value;
        if (value === 'true' || value === '1' || value === 1) return true;
        if (value === 'false' || value === '0' || value === 0) return false;
        throw new Error(`Invalid boolean value provided for ${field}.`);
    };

    const parseNumber = (value, field) => {
        if (value === null || value === undefined || value === '') {
            throw new Error(`Missing numeric value for ${field}.`);
        }
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            throw new Error(`Invalid numeric value provided for ${field}.`);
        }
        return parsed;
    };

    const parseInteger = (value, field) => {
        if (value === null || value === undefined || value === '') {
            throw new Error(`Missing integer value for ${field}.`);
        }
        const parsed = Number(value);
        if (!Number.isInteger(parsed)) {
            throw new Error(`Invalid integer value provided for ${field}.`);
        }
        return parsed;
    };

    const parseNullableInteger = (value, field) => {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        return parseInteger(value, field);
    };

    const fieldParsers = {
        brand_id: (value) => parseInteger(value, 'brand_id'),
        group_id: (value) => parseInteger(value, 'group_id'),
        reorder_point: (value) => parseInteger(value, 'reorder_point'),
        warning_quantity: (value) => parseInteger(value, 'warning_quantity'),
        last_cost: (value) => parseNumber(value, 'last_cost'),
        last_sale_price: (value) => parseNumber(value, 'last_sale_price'),
        barcode: (value) => {
            if (typeof value !== 'string') {
                throw new Error('Barcode must be a string.');
            }
            return value.trim();
        },
        measurement_unit: (value) => {
            if (typeof value !== 'string') {
                throw new Error('Measurement unit must be a string.');
            }
            return value.trim();
        },
        tax_rate_id: (value) => parseNullableInteger(value, 'tax_rate_id'),
        is_active: (value) => parseBoolean(value, 'is_active'),
        is_price_change_allowed: (value) => parseBoolean(value, 'is_price_change_allowed'),
        is_using_default_quantity: (value) => parseBoolean(value, 'is_using_default_quantity'),
        is_service: (value) => parseBoolean(value, 'is_service'),
        low_stock_warning: (value) => parseBoolean(value, 'low_stock_warning'),
        is_tax_inclusive_price: (value) => parseBoolean(value, 'is_tax_inclusive_price')
    };

    const setFragments = [];
    const values = [];
    let paramIndex = 1;

    try {
        for (const [key, rawValue] of Object.entries(updates)) {
            if (!Object.prototype.hasOwnProperty.call(fieldParsers, key)) {
                continue;
            }

            const parsedValue = fieldParsers[key](rawValue);
            setFragments.push(`${key} = $${paramIndex++}`);
            values.push(parsedValue);
        }
    } catch (err) {
        return res.status(400).json({ message: err.message });
    }

    if (setFragments.length === 0) {
        return res.status(400).json({ message: 'No valid fields were provided for update.' });
    }

    // Always stamp who modified and when
    setFragments.push(`modified_by = $${paramIndex++}`);
    values.push(req.user?.employee_id || null);
    setFragments.push('date_modified = CURRENT_TIMESTAMP');

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        values.push(normalizedPartIds);
        const updateQuery = `
            UPDATE part
            SET ${setFragments.join(', ')}
            WHERE part_id = ANY($${paramIndex})
            RETURNING part_id;
        `;

        const { rows, rowCount } = await client.query(updateQuery, values);
        if (rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'No matching parts were updated.' });
        }

        await client.query('COMMIT');

        const syncedPartIds = [];
        for (const row of rows) {
            try {
                const partData = await getPartDataForMeili(db, row.part_id);
                if (partData) {
                    syncPartWithMeili(partData);
                    syncedPartIds.push(row.part_id);
                }
            } catch (syncError) {
                console.error(`[WARN] Failed to sync part ${row.part_id} with Meilisearch:`, syncError);
            }
        }

        return res.json({
            message: 'Parts updated successfully.',
            updatedCount: rowCount,
            partIds: rows.map(r => r.part_id),
            syncedCount: syncedPartIds.length
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Bulk part update failed:', err);
        return res.status(500).json({
            message: 'Failed to apply bulk updates.',
            error: process.env.NODE_ENV !== 'production' ? err.message : undefined
        });
    } finally {
        client.release();
    }
});

router.put('/parts/:id', protect, hasPermission('parts:edit'), async (req, res) => {
    const { id } = req.params;
    const { tags, modified_by, ...partData } = req.body;
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
                barcode = $9, measurement_unit = $10, is_price_change_allowed = $11, 
                is_using_default_quantity = $12, is_service = $13, low_stock_warning = $14, 
                modified_by = $15, date_modified = CURRENT_TIMESTAMP, tax_rate_id = $16,
                is_tax_inclusive_price = $17
            WHERE part_id = $18 RETURNING *`,
            [
                partData.detail, partData.brand_id, partData.group_id, partData.reorder_point, partData.warning_quantity, partData.is_active, 
                partData.last_cost, partData.last_sale_price, partData.barcode, partData.measurement_unit, partData.is_price_change_allowed, 
                partData.is_using_default_quantity, partData.is_service, partData.low_stock_warning, modified_by, taxRateIdOrNull,
                partData.is_tax_inclusive_price, id
            ]
        );
        if (updatedPart.rows.length === 0) {
            return res.status(404).json({ message: 'Part not found' });
        }
        
        await manageTags(client, tags, id);
        await client.query('COMMIT');

        const partForMeili = await getPartDataForMeili(db, id);
        if (partForMeili) {
            syncPartWithMeili(partForMeili);
            return res.json(partForMeili);
        }
        
        // Fallback to raw row if enrichment fails
        res.json(updatedPart.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send('Server Error');
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
        removePartFromMeili(id);
        res.json({ message: 'Part deleted successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = { router, manageTags, getPartDataForMeili };
