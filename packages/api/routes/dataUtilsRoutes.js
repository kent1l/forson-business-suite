const express = require('express');
const multer = require('multer');
const Papa = require('papaparse');
const { Parser } = require('json2csv');
const db = require('../db');
const { protect, isAdmin } = require('../middleware/authMiddleware');
const { generateUniqueCode } = require('../helpers/codeGenerator');
const { syncPartWithMeili } = require('../meilisearch');
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
            // parts_view provides display_name and part_numbers natively
            query = `
                SELECT
                    pv.internal_sku, pv.detail, pv.brand_name, pv.group_name,
                    pv.display_name,
                    (SELECT STRING_AGG(pn.part_number, ';') FROM part_number pn
                     WHERE pn.part_id = pv.part_id AND pn.deleted_at IS NULL) AS part_numbers,
                    pv.barcode, pv.is_active, pv.last_cost, pv.last_sale_price,
                    (SELECT p2.reorder_point FROM part p2 WHERE p2.part_id = pv.part_id) AS reorder_point,
                    (SELECT p2.warning_quantity FROM part p2 WHERE p2.part_id = pv.part_id) AS warning_quantity,
                    (SELECT p2.measurement_unit FROM part p2 WHERE p2.part_id = pv.part_id) AS measurement_unit,
                    (SELECT p2.is_tax_inclusive_price FROM part p2 WHERE p2.part_id = pv.part_id) AS is_tax_inclusive_price,
                    (SELECT p2.is_price_change_allowed FROM part p2 WHERE p2.part_id = pv.part_id) AS is_price_change_allowed,
                    (SELECT p2.is_using_default_quantity FROM part p2 WHERE p2.part_id = pv.part_id) AS is_using_default_quantity,
                    (SELECT p2.is_service FROM part p2 WHERE p2.part_id = pv.part_id) AS is_service,
                    (SELECT p2.low_stock_warning FROM part p2 WHERE p2.part_id = pv.part_id) AS low_stock_warning
                FROM public.parts_view pv
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

        const partsToSync = [];

        for (const [index, row] of parsed.data.entries()) {
            const rowNum = index + 2;

            if (entity === 'parts') {
                const { brand_name, group_name, internal_sku } = row;
                if (!brand_name || !group_name) throw new Error(`Row ${rowNum}: 'brand_name' and 'group_name' are required.`);
                
                let brandRes = await client.query('SELECT brand_id, brand_code FROM brand WHERE brand_name = $1', [brand_name]);
                if (brandRes.rows.length === 0) {
                    const brandCode = await generateUniqueCode(client, brand_name, 'brand', 'brand_code');
                    brandRes = await client.query('INSERT INTO brand (brand_name, brand_code) VALUES ($1, $2) RETURNING brand_id, brand_code', [brand_name, brandCode]);
                    newBrands.add(`${brand_name} (${brandCode})`);
                }
                row.brand_id = brandRes.rows[0].brand_id;

                let groupRes = await client.query('SELECT group_id, group_code FROM "group" WHERE group_name = $1', [group_name]);
                if (groupRes.rows.length === 0) {
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
                const partNumbers = row.part_numbers.split(';').map(pn => pn.trim()).filter(Boolean);
                await client.query('DELETE FROM part_number WHERE part_id = $1', [newOrUpdatedRow.part_id]);
                for (const pn of partNumbers) {
                    await client.query('INSERT INTO part_number (part_id, part_number) VALUES ($1, $2)', [newOrUpdatedRow.part_id, pn]);
                }
            }

            if (newOrUpdatedRow.xmax === '0') createdCount++;
            else updatedCount++;

            if (entity === 'parts') {
                // Re-fetch from parts_view to get authoritative display_name
                const pvRes = await client.query(
                    'SELECT display_name FROM public.parts_view WHERE part_id = $1',
                    [newOrUpdatedRow.part_id]
                );
                const partForMeili = {
                    ...newOrUpdatedRow,
                    brand_name: row.brand_name,
                    group_name: row.group_name,
                    part_numbers: row.part_numbers || '',
                    display_name: pvRes.rows[0]?.display_name || ''
                };
                partsToSync.push(partForMeili);
            }
        }

        await client.query('COMMIT');

        if (partsToSync.length > 0) {
            syncPartWithMeili(partsToSync);
        }
        
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

// GET /api/data/sync-parts-to-meili - One-time sync
router.get('/sync-parts-to-meili', protect, isAdmin, async (req, res) => {
    const client = await db.getClient();
    try {
        console.log('Starting one-time sync of all parts to Meilisearch...');
        const query = `
            SELECT
                pv.*,
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
        `;
        const { rows } = await client.query(query);

        if (rows.length === 0) {
            return res.status(200).json({ message: 'No parts found in the database to sync.' });
        }

        const partsToSync = rows.map(part => ({
            ...part,
            // display_name is natively provided by parts_view
            applications: part.applications_array || [],
            tags: part.tags_array || []
        }));

        // Sync with Meilisearch
        await syncPartWithMeili(partsToSync);

        console.log(`Successfully synced ${partsToSync.length} parts to Meilisearch.`);
        res.status(200).json({ message: `Successfully synced ${partsToSync.length} parts.` });

    } catch (error) {
        console.error('Manual sync error:', error);
        res.status(500).json({ message: 'Failed to sync parts.', error: error.message });
    } finally {
        client.release();
    }
});

// --- NEW: Repair search // Search repair index jobs (async)
const {
    JOB_MODES,
    createRepairJob,
    fetchJobStatusPayload,
    cancelRepairJob
} = require('../search-repair-worker');

// POST /api/data/repair-search-index?mode=dry|full
router.post('/repair-search-index', protect, isAdmin, async (req, res) => {
    const { mode = JOB_MODES.FULL } = req.query;
    if (![JOB_MODES.DRY, JOB_MODES.FULL].includes(mode)) {
        return res.status(400).json({ message: 'Invalid mode. Use mode=dry or mode=full.' });
    }

    try {
        const createdBy = req.user?.username || req.user?.user || req.user?.employee_id || 'unknown-admin';
        const job = await createRepairJob({ mode, createdBy: String(createdBy) });

        return res.status(202).json({
            message: 'Repair job accepted and queued.',
            job_id: job.job_id,
            status: job.status,
            mode: job.mode,
            created_at: job.created_at
        });
    } catch (error) {
        console.error('[RepairSearch] failed to enqueue:', error);
        return res.status(500).json({ message: 'Failed to enqueue repair job.', error: error?.message || String(error) });
    }
});

// GET /api/data/repair-search-index/:job_id
router.get('/repair-search-index/:job_id', protect, isAdmin, async (req, res) => {
    try {
        const jobId = Number(req.params.job_id);
        if (!Number.isInteger(jobId) || jobId <= 0) {
            return res.status(400).json({ message: 'Invalid job_id.' });
        }

        const job = await fetchJobStatusPayload(jobId);
        if (!job) {
            return res.status(404).json({ message: 'Repair job not found.' });
        }

        return res.status(200).json(job);
    } catch (error) {
        console.error('[RepairSearch] failed to fetch job status:', error);
        return res.status(500).json({ message: 'Failed to fetch repair job status.', error: error?.message || String(error) });
    }
});

// POST /api/data/repair-search-index/:job_id/cancel
router.post('/repair-search-index/:job_id/cancel', protect, isAdmin, async (req, res) => {
    try {
        const jobId = Number(req.params.job_id);
        if (!Number.isInteger(jobId) || jobId <= 0) {
            return res.status(400).json({ message: 'Invalid job_id.' });
        }

        const job = await cancelRepairJob(jobId);
        if (!job) {
            return res.status(404).json({ message: 'Repair job not found.' });
        }

        return res.status(200).json({
            message: job.status === 'cancelling' ? 'Cancellation requested.' : 'Job cancelled.',
            job_id: job.job_id,
            status: job.status
        });
    } catch (error) {
        console.error('[RepairSearch] failed to cancel job:', error);
        return res.status(500).json({ message: 'Failed to cancel repair job.', error: error?.message || String(error) });
    }
});

module.exports = router;
