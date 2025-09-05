const express = require('express');
const db = require('../db');
const { constructDisplayName } = require('../helpers/displayNameHelper');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const { syncPartWithMeili, removePartFromMeili, meiliClient } = require('../meilisearch');
const { activeAliasCondition } = require('../helpers/partNumberSoftDelete');
const router = express.Router();

// Helper function to get all data for a part for Meilisearch indexing
const getPartDataForMeili = async (client, partId) => {
    const query = `
        SELECT
            p.*, b.brand_name, g.group_name,
            (SELECT STRING_AGG(pn.part_number, '; ') FROM part_number pn WHERE pn.part_id = p.part_id AND ${activeAliasCondition('pn')}) as part_numbers,
                        (SELECT ARRAY_AGG(
                                CONCAT(vmk.make_name, ' ', vmd.model_name, COALESCE(CONCAT(' ', veng.engine_name), ''))
                        ) FROM part_application pa
                            JOIN application a ON pa.application_id = a.application_id
                            LEFT JOIN vehicle_make vmk ON a.make_id = vmk.make_id
                            LEFT JOIN vehicle_model vmd ON a.model_id = vmd.model_id
                            LEFT JOIN vehicle_engine veng ON a.engine_id = veng.engine_id
                        WHERE pa.part_id = p.part_id) AS applications_array,
            (SELECT ARRAY_AGG(t.tag_name) FROM tag t JOIN part_tag pt ON t.tag_id = pt.tag_id WHERE pt.part_id = p.part_id) AS tags_array
        FROM part AS p
        LEFT JOIN brand AS b ON p.brand_id = b.brand_id
        LEFT JOIN "group" AS g ON p.group_id = g.group_id
        WHERE p.part_id = $1
    `;
    const res = await client.query(query, [partId]);
    if (res.rows.length === 0) return null;

    const part = res.rows[0];
    return {
        ...part,
        display_name: constructDisplayName(part),
        applications: part.applications_array || [],
        // Flatten applications into a single searchable string for Meilisearch
        searchable_applications: (part.applications_array && Array.isArray(part.applications_array))
            ? part.applications_array.map(app => {
                // SQL returns a concatenated string like "Make Model Engine" for each application.
                if (typeof app === 'string') return app;
                // If for some reason the application is an object, concatenate known fields.
                return `${app.make || ''} ${app.model || ''} ${app.engine || ''}`.trim();
            }).join(', ')
            : '' ,
        tags: part.tags_array || []
    };
};

// Helper function to handle tag logic
const manageTags = async (client, tags, partId) => {
    console.log('manageTags called with:', { tags, partId }); // Debugging log

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

        // Associate tags with the part in a single query
        const partTagValues = sanitizedTags.map(tag => `(${partId}, ${existingTags[tag]})`).join(', ');
        await client.query(
            `INSERT INTO part_tag (part_id, tag_id) VALUES ${partTagValues} ON CONFLICT DO NOTHING`
        );
    }
};

// GET all parts with status filter, search, and sorting (POWERED BY MEILISEARCH)
router.get('/parts', protect, hasPermission('parts:view'), async (req, res) => {
    const { status = 'active', search = '', tags = '' } = req.query;
    try {
        const index = meiliClient.index('parts');
        const searchOptions = { limit: 200, attributesToRetrieve: ['part_id'] };
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
                WHERE pa.part_id = p.part_id) AS applications,
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
    const { tags, created_by, part_numbers_string, ...partData } = req.body;
    // detail is optional; only brand and group are required
    if (!partData.brand_id || !partData.group_id) {
        return res.status(400).json({ message: 'Brand and group are required' });
    }
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const brandRes = await client.query('SELECT brand_code, brand_name FROM brand WHERE brand_id = $1', [partData.brand_id]);
        const groupRes = await client.query('SELECT group_code, group_name FROM "group" WHERE group_id = $1', [partData.group_id]);
        if (brandRes.rows.length === 0 || groupRes.rows.length === 0) throw new Error('Invalid brand or group ID');
        
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
                await client.query('INSERT INTO part_number (part_id, part_number) VALUES ($1, $2) ON CONFLICT (part_id, part_number) DO NOTHING', [newPartData.part_id, number]);
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
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send('Server Error');
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
