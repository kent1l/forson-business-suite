const express = require('express');
const db = require('../db');
const { constructDisplayName } = require('../helpers/displayNameHelper');
const { protect, hasPermission } = require('../middleware/authMiddleware'); 
const { syncPartWithMeili, removePartFromMeili, meiliClient } = require('../meilisearch'); // <-- Import meiliClient
const router = express.Router();

// GET all parts with status filter, search, and sorting (NOW POWERED BY MEILISEARCH)
router.get('/parts', protect, hasPermission('parts:view'), async (req, res) => {
  const { status = 'active', search = '' } = req.query;

  try {
    // 1. Get a list of relevant part IDs from Meilisearch
    const index = meiliClient.index('parts');
    const searchOptions = {
      limit: 200, // Limit results for performance
      attributesToRetrieve: ['part_id'], // We only need the ID from the search
    };

    const filter = [];
    if (status === 'active') {
      filter.push('is_active = true');
    } else if (status === 'inactive') {
      filter.push('is_active = false');
    }
    // 'all' status doesn't add a filter

    if (filter.length > 0) {
      searchOptions.filter = filter;
    }

    const searchResults = await index.search(search, searchOptions);
    const partIds = searchResults.hits.map(hit => hit.part_id);

    if (partIds.length === 0) {
      return res.json([]);
    }

    // 2. Use those IDs to get the full, detailed data from PostgreSQL
    const query = `
      SELECT
        p.*,
        b.brand_name,
        g.group_name,
        (
          SELECT STRING_AGG(pn.part_number, '; ' ORDER BY pn.display_order) 
          FROM part_number pn 
          WHERE pn.part_id = p.part_id
        ) AS part_numbers,
        (
          SELECT STRING_AGG(
            CONCAT(a.make, ' ', a.model), '; '
          )
          FROM part_application pa
          JOIN application a ON pa.application_id = a.application_id
          WHERE pa.part_id = p.part_id
        ) AS applications
      FROM part AS p
      LEFT JOIN brand AS b ON p.brand_id = b.brand_id
      LEFT JOIN "group" AS g ON p.group_id = g.group_id
      WHERE p.part_id = ANY($1::int[])
    `;
    const { rows } = await db.query(query, [partIds]);
    
    const partsWithDisplayName = rows.map(part => ({
        ...part,
        display_name: constructDisplayName(part)
    }));

    res.json(partsWithDisplayName);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});


// --- OTHER ROUTES (GET single, POST, PUT, DELETE) remain the same ---

// GET a single part by ID
router.get('/parts/:id', protect, hasPermission('parts:view'), async (req, res) => {
  const { id } = req.params;
  try {
    const query = `
      SELECT
        p.*,
        b.brand_name,
        g.group_name,
        (
          SELECT STRING_AGG(pn.part_number, '; ' ORDER BY pn.display_order) 
          FROM part_number pn 
          WHERE pn.part_id = p.part_id
        ) AS part_numbers
      FROM part AS p
      LEFT JOIN brand AS b ON p.brand_id = b.brand_id
      LEFT JOIN "group" AS g ON p.group_id = g.group_id
      WHERE p.part_id = $1;
    `;
    const { rows } = await db.query(query, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Part not found' });
    }

    const part = rows[0];
    part.display_name = constructDisplayName(part);
    
    res.json(part);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// POST - Create a new part with all fields
router.post('/parts', protect, hasPermission('parts:create'), async (req, res) => {
  const { 
    detail, brand_id, group_id, part_numbers_string,
    reorder_point, warning_quantity, is_active, last_cost, last_sale_price,
    barcode, measurement_unit, is_price_change_allowed, is_using_default_quantity,
    is_service, low_stock_warning, created_by, tax_rate_id, is_tax_inclusive_price
  } = req.body;

  if (!detail || !brand_id || !group_id) {
    return res.status(400).json({ message: 'Detail, brand_id, and group_id are required' });
  }

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // SKU Generation Logic
    const brandRes = await client.query('SELECT brand_code, brand_name FROM brand WHERE brand_id = $1', [brand_id]);
    const groupRes = await client.query('SELECT group_code, group_name FROM "group" WHERE group_id = $1', [group_id]);
    if (brandRes.rows.length === 0 || groupRes.rows.length === 0) { throw new Error('Invalid brand_id or group_id'); }
    const brandCode = brandRes.rows[0].brand_code;
    const groupCode = groupRes.rows[0].group_code;
    const skuPrefix = `${groupCode}-${brandCode}`;
    let nextSeqNum = 1;
    const seqRes = await client.query('SELECT last_number FROM document_sequence WHERE prefix = $1 FOR UPDATE', [skuPrefix]);
    if (seqRes.rows.length > 0) {
        nextSeqNum = seqRes.rows[0].last_number + 1;
        await client.query('UPDATE document_sequence SET last_number = $1 WHERE prefix = $2', [nextSeqNum, skuPrefix]);
    } else {
        await client.query('INSERT INTO document_sequence (prefix, period, last_number) VALUES ($1, \'ALL\', $2)', [skuPrefix, nextSeqNum]);
    }
    const formattedSeqNum = String(nextSeqNum).padStart(4, '0');
    const internalSku = `${skuPrefix}-${formattedSeqNum}`;

    const newPartQuery = `
        INSERT INTO part (
            detail, brand_id, group_id, internal_sku, reorder_point, 
            warning_quantity, is_active, last_cost, last_sale_price, barcode,
            measurement_unit, is_price_change_allowed, is_using_default_quantity,
            is_service, low_stock_warning, created_by, tax_rate_id, is_tax_inclusive_price
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        RETURNING *;
    `;
    const newPart = await client.query(newPartQuery, [
        detail, brand_id, group_id, internalSku, reorder_point, 
        warning_quantity, is_active, last_cost, last_sale_price, barcode,
        measurement_unit, is_price_change_allowed, is_using_default_quantity,
        is_service, low_stock_warning, created_by, tax_rate_id, is_tax_inclusive_price
    ]);
    const newPartData = newPart.rows[0];

    if (part_numbers_string) {
        const numbers = part_numbers_string.split(/[,;]/).map(num => num.trim()).filter(Boolean);
        if (numbers.length > 0) {
            for (const number of numbers) {
                const partNumQuery = `
                    INSERT INTO part_number (part_id, part_number)
                    VALUES ($1, $2) ON CONFLICT (part_id, part_number) DO NOTHING;
                `;
                await client.query(partNumQuery, [newPartData.part_id, number]);
            }
        }
    }

    await client.query('COMMIT');
    
    const partForMeili = {
        ...newPartData,
        brand_name: brandRes.rows[0].brand_name,
        group_name: groupRes.rows[0].group_name,
        part_numbers: part_numbers_string,
        display_name: constructDisplayName({
            ...newPartData,
            brand_name: brandRes.rows[0].brand_name,
            group_name: groupRes.rows[0].group_name,
            part_numbers: part_numbers_string,
        }),
    };
    syncPartWithMeili(partForMeili);

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
    const { partIds, updates } = req.body;

    if (!Array.isArray(partIds) || partIds.length === 0) {
        return res.status(400).json({ message: 'partIds must be a non-empty array.' });
    }
    if (typeof updates !== 'object' || Object.keys(updates).length === 0) {
        return res.status(400).json({ message: 'Updates object cannot be empty.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const setClauses = [];
        const queryParams = [];
        let paramIndex = 1;

        for (const key in updates) {
            if (Object.hasOwnProperty.call(updates, key)) {
                setClauses.push(`${key} = $${paramIndex++}`);
                queryParams.push(updates[key]);
            }
        }
        
        setClauses.push(`modified_by = $${paramIndex++}`);
        queryParams.push(req.user.employee_id);
        setClauses.push(`date_modified = CURRENT_TIMESTAMP`);

        queryParams.push(partIds);
        
        const query = `
            UPDATE part 
            SET ${setClauses.join(', ')}
            WHERE part_id = ANY($${paramIndex})
            RETURNING *;
        `;

        const { rows } = await client.query(query, queryParams);

        await client.query('COMMIT');
        res.json({ message: `${rows.length} parts updated successfully.` });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Bulk update transaction error:', err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});

// PUT - Update an existing part with all fields
router.put('/parts/:id', protect, hasPermission('parts:edit'), async (req, res) => {
    const { id } = req.params;
    const {
        detail, brand_id, group_id, reorder_point, 
        warning_quantity, is_active, last_cost, last_sale_price,
        barcode, measurement_unit, is_price_change_allowed, is_using_default_quantity,
        is_service, low_stock_warning, modified_by, tax_rate_id, is_tax_inclusive_price
    } = req.body;

    if (!detail || !brand_id || !group_id) {
        return res.status(400).json({ message: 'Detail, brand_id, and group_id are required' });
    }

    try {
        const updatedPart = await db.query(
            `UPDATE part SET 
                detail = $1, brand_id = $2, group_id = $3, reorder_point = $4, 
                warning_quantity = $5, is_active = $6, last_cost = $7, last_sale_price = $8, 
                barcode = $9, measurement_unit = $10, is_price_change_allowed = $11, 
                is_using_default_quantity = $12, is_service = $13, low_stock_warning = $14, 
                modified_by = $15, date_modified = CURRENT_TIMESTAMP, tax_rate_id = $16,
                is_tax_inclusive_price = $17
            WHERE part_id = $18 RETURNING *`,
            [
                detail, brand_id, group_id, reorder_point, warning_quantity, is_active, 
                last_cost, last_sale_price, barcode, measurement_unit, is_price_change_allowed, 
                is_using_default_quantity, is_service, low_stock_warning, modified_by, tax_rate_id,
                is_tax_inclusive_price, id
            ]
        );

        if (updatedPart.rows.length === 0) {
            return res.status(404).json({ message: 'Part not found' });
        }

        // Sync with Meilisearch after successful update
        const fullPartQuery = `
            SELECT p.*, b.brand_name, g.group_name,
                   (SELECT STRING_AGG(pn.part_number, '; ') FROM part_number pn WHERE pn.part_id = p.part_id) as part_numbers
            FROM part p
            LEFT JOIN brand b ON p.brand_id = b.brand_id
            LEFT JOIN "group" g ON p.group_id = g.group_id
            WHERE p.part_id = $1
        `;
        const fullPartRes = await db.query(fullPartQuery, [id]);
        const partForMeili = {
            ...fullPartRes.rows[0],
            display_name: constructDisplayName(fullPartRes.rows[0]),
        };
        syncPartWithMeili(partForMeili);


        res.json(updatedPart.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
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

        // Remove from Meilisearch
        removePartFromMeili(id);
        
        res.json({ message: 'Part deleted successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;