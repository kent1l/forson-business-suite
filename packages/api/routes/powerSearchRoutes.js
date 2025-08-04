const express = require('express');
const db = require('../db');
const router = express.Router();

// Helper function to construct the display name
const constructDisplayName = (part) => {
    const displayNameParts = [];
    const category = `${part.group_name || ''} (${part.brand_name || ''})`.replace('()', '').trim();
    if (category) displayNameParts.push(category);
    if (part.detail) displayNameParts.push(part.detail);
    if (part.part_numbers) displayNameParts.push(part.part_numbers);
    return displayNameParts.join(' | ');
};

// GET /api/power-search/parts - Advanced multi-filter text search
router.get('/power-search/parts', async (req, res) => {
    const { keyword, brand, group, application } = req.query;

    let queryParams = [];
    let whereClauses = [];

    let baseQuery = `
      SELECT DISTINCT
        p.part_id,
        p.internal_sku,
        p.detail,
        b.brand_name,
        g.group_name,
        (
          SELECT STRING_AGG(pn.part_number, '; ' ORDER BY pn.display_order) 
          FROM part_number pn 
          WHERE pn.part_id = p.part_id
        ) AS part_numbers,
        (
          SELECT STRING_AGG(
            CASE 
              WHEN pa.year_start IS NOT NULL AND pa.year_end IS NOT NULL AND pa.year_start = pa.year_end THEN CONCAT(a.make, ' ', a.model, ' [', pa.year_start, ']')
              WHEN pa.year_start IS NOT NULL AND pa.year_end IS NOT NULL THEN CONCAT(a.make, ' ', a.model, ' [', pa.year_start, '-', pa.year_end, ']')
              WHEN pa.year_start IS NOT NULL THEN CONCAT(a.make, ' ', a.model, ' [', pa.year_start, ']')
              WHEN pa.year_end IS NOT NULL THEN CONCAT(a.make, ' ', a.model, ' [', pa.year_end, ']')
              ELSE CONCAT(a.make, ' ', a.model)
            END,
            '; '
          )
          FROM part_application pa
          JOIN application a ON pa.application_id = a.application_id
          WHERE pa.part_id = p.part_id
        ) AS applications
      FROM part AS p
      LEFT JOIN brand AS b ON p.brand_id = b.brand_id
      LEFT JOIN "group" AS g ON p.group_id = g.group_id
      LEFT JOIN part_number p_num ON p.part_id = p_num.part_id
      LEFT JOIN part_application p_app ON p.part_id = p_app.part_id
      LEFT JOIN application app ON p_app.application_id = app.application_id
    `;

    if (keyword) {
        queryParams.push(`%${keyword}%`);
        whereClauses.push(`(p.detail ILIKE $${queryParams.length} OR p.internal_sku ILIKE $${queryParams.length} OR p_num.part_number ILIKE $${queryParams.length})`);
    }
    if (brand) {
        queryParams.push(`%${brand}%`);
        whereClauses.push(`b.brand_name ILIKE $${queryParams.length}`);
    }
    if (group) {
        queryParams.push(`%${group}%`);
        whereClauses.push(`g.group_name ILIKE $${queryParams.length}`);
    }
    if (application) {
        queryParams.push(`%${application}%`);
        whereClauses.push(`(app.make ILIKE $${queryParams.length} OR app.model ILIKE $${queryParams.length})`);
    }

    let finalQuery = baseQuery;
    if (whereClauses.length > 0) {
        finalQuery += ` WHERE ${whereClauses.join(' AND ')}`;
    }
    finalQuery += ` ORDER BY p.part_id;`;

    try {
        const { rows } = await db.query(finalQuery, queryParams);
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

module.exports = router;
