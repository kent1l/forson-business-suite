const express = require('express');
const multer = require('multer');
const Papa = require('papaparse');
const { Parser } = require('json2csv');
const db = require('../db');
const { protect, isAdmin } = require('../middleware/authMiddleware');
const { generateUniqueCode } = require('../helpers/codeGenerator'); // 1. Import the new helper
const router = express.Router();

// Configure multer for in-memory file storage
const upload = multer({ storage: multer.memoryStorage() });

// Define configurations for each entity, including fields for CSV and the database.
const ENTITY_CONFIG = {
    parts: {
        table: 'part',
        upsertConflictKey: 'internal_sku',
        csvFields: ['internal_sku', 'detail', 'brand_name', 'group_name', 'part_numbers', 'barcode', 'is_active', 'last_cost', 'last_sale_price', 'reorder_point', 'warning_quantity', 'measurement_unit', 'is_tax_inclusive_price', 'is_price_change_allowed', 'is_using_default_quantity', 'is_service', 'low_stock_warning'],
        dbFields: ['internal_sku', 'detail', 'barcode', 'is_active', 'last_cost', 'last_sale_price', 'reorder_point', 'warning_quantity', 'measurement_unit', 'is_tax_inclusive_price', 'is_price_change_allowed', 'is_using_default_quantity', 'is_service', 'low_stock_warning', 'brand_id', 'group_id']
    },
    customers: {
        table: 'customer',
        upsertConflictKey: 'email',
        fields: ['first_name', 'last_name', 'company_name', 'phone', 'email', 'address', 'is_active']
    },
    suppliers: {
        table: 'supplier',
        upsertConflictKey: 'supplier_name',
        fields: ['supplier_name', 'contact_person', 'phone', 'email', 'address', 'is_active']
    }
};

// GET /api/data/export/:entity - Export data as CSV
router.get('/export/:entity', protect, isAdmin, async (req, res) => {
    const { entity } = req.params;
    const config = ENTITY_CONFIG[entity];

    if (!config) {
        return res.status(404).json({ message: 'Invalid entity for export.' });
    }

    const fieldsToExport = config.csvFields || config.fields;

    try {
        let query;
        if (entity === 'parts') {
            query = `
                SELECT
                    p.internal_sku, p.detail, b.brand_name, g.group_name,
                    (SELECT STRING_AGG(pn.part_number, '|') FROM part_number pn WHERE pn.part_id = p.part_id) as part_numbers,
                    p.barcode, p.is_active, p.last_cost, p.last_sale_price, p.reorder_point, p.warning_quantity,
                    p.measurement_unit, p.is_tax_inclusive_price, p.is_price_change_allowed, p.is_using_default_quantity,
                    p.is_service, p.low_stock_warning
                FROM part p
                LEFT JOIN brand b ON p.brand_id = b.brand_id
                LEFT JOIN "group" g ON p.group_id = g.group_id
            `;
        } else {
            query = `SELECT ${fieldsToExport.join(', ')} FROM ${config.table}`;
        }
        
        const { rows } = await db.query(query);
        const json2csvParser = new Parser({ fields: fieldsToExport });
        const csv = json2csvParser.parse(rows);

        res.header('Content-Type', 'text/csv');
        res.attachment(`${entity}-export-${new Date().toISOString()}.csv`);
        res.send(csv);
    } catch (error) {
        console.error(`Export error for ${entity}:`, error);
        res.status(500).json({ message: `Failed to export ${entity}.` });
    }
});

// POST /api/data/import/:entity - Import data from CSV
router.post('/import/:entity', protect, isAdmin, upload.single('file'), async (req, res) => {
    const { entity } = req.params;
    const config = ENTITY_CONFIG[entity];

    if (!config) return res.status(404).json({ message: 'Invalid entity for import.' });
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });

    const csvData = req.file.buffer.toString('utf8');
    const client = await db.getClient();
    let createdCount = 0;
    let updatedCount = 0;
    const newBrands = new Set();
    const newGroups = new Set();

    try {
        await client.query('BEGIN');
        const parsed = Papa.parse(csvData, { header: true, skipEmptyLines: true });

        for (const [index, row] of parsed.data.entries()) {
            const rowNum = index + 2;

            if (entity === 'parts') {
                const { brand_name, group_name, internal_sku } = row;
                if (!brand_name || !group_name) throw new Error(`Row ${rowNum}: 'brand_name' and 'group_name' are required.`);
                
                let brandRes = await client.query('SELECT brand_id, brand_code FROM brand WHERE brand_name = $1', [brand_name]);
                if (brandRes.rows.length === 0) {
                    // 2. Use the imported helper function
                    const brandCode = await generateUniqueCode(client, brand_name, 'brand', 'brand_code');
                    brandRes = await client.query('INSERT INTO brand (brand_name, brand_code) VALUES ($1, $2) RETURNING brand_id, brand_code', [brand_name, brandCode]);
                    newBrands.add(`${brand_name} (${brandCode})`);
                }
                row.brand_id = brandRes.rows[0].brand_id;

                let groupRes = await client.query('SELECT group_id, group_code FROM "group" WHERE group_name = $1', [group_name]);
                if (groupRes.rows.length === 0) {
                    // 2. Use the imported helper function
                    const groupCode = await generateUniqueCode(client, group_name, 'group', 'group_code');
                    groupRes = await client.query('INSERT INTO "group" (group_name, group_code) VALUES ($1, $2) RETURNING group_id, group_code', [group_name, groupCode]);
                    newGroups.add(`${group_name} (${groupCode})`);
                }
                row.group_id = groupRes.rows[0].group_id;

                if (!internal_sku) {
                    const skuPrefix = `${groupRes.rows[0].group_code}-${brandRes.rows[0].brand_code}`;
                    const seqRes = await client.query('SELECT last_number FROM document_sequence WHERE prefix = $1 FOR UPDATE', [skuPrefix]);
                    let nextSeqNum = 1;
                    if (seqRes.rows.length > 0) {
                        nextSeqNum = seqRes.rows[0].last_number + 1;
                        await client.query('UPDATE document_sequence SET last_number = $1 WHERE prefix = $2', [nextSeqNum, skuPrefix]);
                    } else {
                        await client.query('INSERT INTO document_sequence (prefix, period, last_number) VALUES ($1, \'ALL\', $2)', [skuPrefix, nextSeqNum]);
                    }
                    row.internal_sku = `${skuPrefix}-${String(nextSeqNum).padStart(4, '0')}`;
                }
            }

            const fieldsToProcess = config.dbFields || config.fields;
            const values = fieldsToProcess.map(field => row[field] === '' ? null : row[field]);
            const conflictUpdateClauses = fieldsToProcess
                .filter(field => field !== config.upsertConflictKey)
                .map(field => `${field} = EXCLUDED.${field}`)
                .join(', ');

            const query = `
                INSERT INTO ${config.table} (${fieldsToProcess.join(', ')})
                VALUES (${fieldsToProcess.map((_, i) => `$${i + 1}`).join(', ')})
                ON CONFLICT (${config.upsertConflictKey}) DO UPDATE
                SET ${conflictUpdateClauses}
                RETURNING *, xmax;
            `;
            
            const result = await client.query(query, values);
            const newOrUpdatedRow = result.rows[0];

            if (entity === 'parts' && row.part_numbers) {
                const partNumbers = row.part_numbers.split('|').map(pn => pn.trim()).filter(Boolean);
                await client.query('DELETE FROM part_number WHERE part_id = $1', [newOrUpdatedRow.part_id]);
                for (const pn of partNumbers) {
                    await client.query('INSERT INTO part_number (part_id, part_number) VALUES ($1, $2)', [newOrUpdatedRow.part_id, pn]);
                }
            }

            if (newOrUpdatedRow.xmax === '0') createdCount++;
            else updatedCount++;
        }

        await client.query('COMMIT');
        
        let message = `Import successful. Created: ${createdCount}, Updated: ${updatedCount}.`;
        if (newBrands.size > 0) message += ` New Brands: ${[...newBrands].join(', ')}.`;
        if (newGroups.size > 0) message += ` New Groups: ${[...newGroups].join(', ')}.`;

        res.json({ message, created: createdCount, updated: updatedCount });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Import error for ${entity}:`, error);
        res.status(500).json({ message: error.message || `Failed to import ${entity}. Check file format and data.` });
    } finally {
        client.release();
    }
});

module.exports = router;
