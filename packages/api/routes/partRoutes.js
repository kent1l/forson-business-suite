const express = require('express');
const db = require('../db');
const { constructDisplayName } = require('../helpers/displayNameHelper');
const router = express.Router();

// GET all parts with status filter
router.get('/parts', async (req, res) => {
  const { status = 'active' } = req.query; // Default to 'active'

  let statusFilter = "WHERE p.is_active = TRUE";
  if (status === 'inactive') {
    statusFilter = "WHERE p.is_active = FALSE";
  } else if (status === 'all') {
    statusFilter = ""; // No filter
  }

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
      ${statusFilter}
      ORDER BY p.part_id;
    `;
    const { rows } = await db.query(query);
    
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

// ... (The rest of the partRoutes.js file remains the same)
// GET a single part by ID
router.get('/parts/:id', async (req, res) => {
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
router.post('/parts', async (req, res) => {
  const { 
    detail, brand_id, group_id, part_numbers_string,
    reorder_point, warning_quantity, is_active, last_cost, last_sale_price,
    barcode, measurement_unit, is_price_change_allowed, is_using_default_quantity,
    is_service, low_stock_warning, created_by
  } = req.body;

  if (!detail || !brand_id || !group_id) {
    return res.status(400).json({ message: 'Detail, brand_id, and group_id are required' });
  }

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // SKU Generation Logic
    const brandRes = await client.query('SELECT brand_code FROM brand WHERE brand_id = $1', [brand_id]);
    const groupRes = await client.query('SELECT group_code FROM "group" WHERE group_id = $1', [group_id]);
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

    // Insert the new part with all fields
    const newPartQuery = `
        INSERT INTO part (
            detail, brand_id, group_id, internal_sku, reorder_point, 
            warning_quantity, is_active, last_cost, last_sale_price, barcode,
            measurement_unit, is_price_change_allowed, is_using_default_quantity,
            is_service, low_stock_warning, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING *;
    `;
    const newPart = await client.query(newPartQuery, [
        detail, brand_id, group_id, internalSku, reorder_point, 
        warning_quantity, is_active, last_cost, last_sale_price, barcode,
        measurement_unit, is_price_change_allowed, is_using_default_quantity,
        is_service, low_stock_warning, created_by
    ]);
    const newPartData = newPart.rows[0];

    // Process and insert part numbers
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
    res.status(201).json(newPartData);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err.message);
    res.status(500).send('Server Error');
  } finally {
    client.release();
  }
});

// PUT - Update an existing part with all fields
router.put('/parts/:id', async (req, res) => {
    const { id } = req.params;
    const {
        detail, brand_id, group_id, reorder_point, 
        warning_quantity, is_active, last_cost, last_sale_price,
        barcode, measurement_unit, is_price_change_allowed, is_using_default_quantity,
        is_service, low_stock_warning, modified_by
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
                modified_by = $15, date_modified = CURRENT_TIMESTAMP 
            WHERE part_id = $16 RETURNING *`,
            [
                detail, brand_id, group_id, reorder_point, warning_quantity, is_active, 
                last_cost, last_sale_price, barcode, measurement_unit, is_price_change_allowed, 
                is_using_default_quantity, is_service, low_stock_warning, modified_by, id
            ]
        );

        if (updatedPart.rows.length === 0) {
            return res.status(404).json({ message: 'Part not found' });
        }

        res.json(updatedPart.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// DELETE - Delete a part
router.delete('/parts/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const deleteOp = await db.query('DELETE FROM part WHERE part_id = $1 RETURNING *', [id]);
        if (deleteOp.rowCount === 0) {
            return res.status(404).json({ message: 'Part not found' });
        }
        res.json({ message: 'Part deleted successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});


module.exports = router;
