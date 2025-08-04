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

// GET /api/power-search/parts - Advanced search for parts
router.get('/power-search/parts', async (req, res) => {
    const { brand_id, group_id, application_id } = req.query;

    let queryParams = [];
    let whereClauses = ["1 = 1"]; // Start with a clause that is always true

    let baseQuery = `
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
    `;

    if (application_id) {
        baseQuery += ` JOIN part_application pa ON p.part_id = pa.part_id`;
        queryParams.push(application_id);
        whereClauses.push(`pa.application_id = $${queryParams.length}`);
    }

    if (brand_id) {
        queryParams.push(brand_id);
        whereClauses.push(`p.brand_id = $${queryParams.length}`);
    }

    if (group_id) {
        queryParams.push(group_id);
        whereClauses.push(`p.group_id = $${queryParams.length}`);
    }

    const finalQuery = `${baseQuery} WHERE ${whereClauses.join(' AND ')} ORDER BY p.part_id;`;

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
