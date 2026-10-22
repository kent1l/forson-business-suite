const express = require('express');
const router = express.Router();
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const physicalDocumentService = require('../services/physicalDocumentService');
const { formatPhysicalReceiptNumber } = require('../helpers/receiptNumberFormatter');
const { parsePaginationQuery, paginatedResponse } = require('../helpers/pagination');

// ── Runtime Endpoints for Cashier Workflows ─────────────────────────────────

// GET /api/physical-documents/options?context=&workstation_id=
router.get('/physical-documents/options', protect, hasPermission(['invoicing:create', 'ar:receive_payment', 'pos:use']), async (req, res) => {
    try {
        const context = req.query.context || 'POS';
        const workstationId = req.query.workstation_id || 'default';
        const employeeId = req.user?.employee_id;

        const options = await physicalDocumentService.getOptions({
            context,
            workstation_id: workstationId,
            employee_id: employeeId,
        });

        res.json(options);
    } catch (err) {
        console.error('Error fetching physical document options:', err);
        res.status(500).json({ message: 'Server error fetching physical document options.' });
    }
});

// GET /api/physical-documents/suggestion?series_id=&context=
router.get('/physical-documents/suggestion', protect, hasPermission(['invoicing:create', 'ar:receive_payment', 'pos:use']), async (req, res) => {
    try {
        const seriesId = parseInt(req.query.series_id, 10);
        const context = req.query.context || 'POS';

        if (!seriesId || isNaN(seriesId)) {
            return res.status(400).json({ message: 'Valid series_id query parameter is required.' });
        }

        const suggestion = await physicalDocumentService.getSuggestion(seriesId, context);
        res.json(suggestion);
    } catch (err) {
        console.error('Error fetching suggestion:', err);
        const status = err.statusCode || 500;
        res.status(status).json({ message: err.message, code: err.code });
    }
});

// POST /api/physical-documents/validate
router.post('/physical-documents/validate', protect, hasPermission(['invoicing:create', 'ar:receive_payment', 'pos:use']), async (req, res) => {
    try {
        const { series_id, physical_receipt_no, suggestion_token, lines_tax_rate_ids, exclude_registry_id } = req.body;
        const result = await physicalDocumentService.validateReference({
            series_id: series_id ? parseInt(series_id, 10) : null,
            physical_receipt_no,
            suggestion_token,
            lines_tax_rate_ids,
            exclude_registry_id: exclude_registry_id ? parseInt(exclude_registry_id, 10) : null,
        });

        res.json(result);
    } catch (err) {
        console.error('Error validating physical receipt reference:', err);
        res.status(500).json({ message: 'Server error validating physical receipt number.' });
    }
});

// ── Application Settings Endpoints (settings:edit) ──────────────────────────

// GET /api/settings/physical-document-types
router.get('/settings/physical-document-types', protect, hasPermission(['settings:edit', 'invoicing:create', 'pos:use']), async (_req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT t.*, 
                    (SELECT COUNT(*)::int FROM public.physical_document_series s WHERE s.type_id = t.type_id) AS series_count
             FROM public.physical_document_type t 
             ORDER BY t.type_id`
        );
        res.json(rows);
    } catch (err) {
        console.error('Error fetching physical document types:', err);
        res.status(500).json({ message: 'Server error fetching physical document types.' });
    }
});

// POST /api/settings/physical-document-types
router.post('/settings/physical-document-types', protect, hasPermission('settings:edit'), async (req, res) => {
    try {
        const { code, name, short_label, controlled_category, tax_designation, default_method, is_active } = req.body;
        const employeeId = req.user?.employee_id;

        if (!code || !name) {
            return res.status(400).json({ message: 'Code and Name are required fields.' });
        }

        const normalizedCode = String(code).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        const shortLabel = (short_label || normalizedCode.slice(0, 10)).trim();
        const category = (controlled_category || 'SALES_INVOICE').trim().toUpperCase();
        const taxDesig = tax_designation || 'VAT';
        const method = default_method || 'HIGHEST_PLUS_ONE';
        const active = is_active !== undefined ? Boolean(is_active) : true;

        const { rows } = await db.query(
            `INSERT INTO public.physical_document_type
             (code, name, short_label, controlled_category, tax_designation, default_method, is_active, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
             RETURNING *`,
            [normalizedCode, String(name).trim(), shortLabel, category, taxDesig, method, active, employeeId]
        );

        res.status(201).json(rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ message: `Document type code "${req.body.code}" already exists.` });
        }
        console.error('Error creating document type:', err);
        res.status(500).json({ message: err.message || 'Server error creating document type.' });
    }
});

// PATCH /api/settings/physical-document-types/:id
router.patch('/settings/physical-document-types/:id', protect, hasPermission('settings:edit'), async (req, res) => {
    try {
        const typeId = parseInt(req.params.id, 10);
        const { name, short_label, is_active, default_method, controlled_category, tax_designation } = req.body;
        const employeeId = req.user?.employee_id;

        const { rows } = await db.query(
            `UPDATE public.physical_document_type
             SET name = COALESCE($1, name),
                 short_label = COALESCE($2, short_label),
                 is_active = COALESCE($3, is_active),
                 default_method = COALESCE($4, default_method),
                 controlled_category = COALESCE($5, controlled_category),
                 tax_designation = COALESCE($6, tax_designation),
                 updated_at = CURRENT_TIMESTAMP,
                 updated_by = $7
             WHERE type_id = $8
             RETURNING *`,
            [
                name !== undefined ? String(name).trim() : null,
                short_label !== undefined ? String(short_label).trim() : null,
                is_active !== undefined ? Boolean(is_active) : null,
                default_method !== undefined ? default_method : null,
                controlled_category !== undefined ? String(controlled_category).trim().toUpperCase() : null,
                tax_designation !== undefined ? tax_designation : null,
                employeeId,
                typeId
            ]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Document type not found.' });
        }
        res.json(rows[0]);
    } catch (err) {
        console.error('Error updating document type:', err);
        res.status(500).json({ message: 'Server error updating document type.' });
    }
});

// DELETE /api/settings/physical-document-types/:id
router.delete('/settings/physical-document-types/:id', protect, hasPermission('settings:edit'), async (req, res) => {
    try {
        const typeId = parseInt(req.params.id, 10);
        const { rows: linkedSeries } = await db.query(
            `SELECT series_id FROM public.physical_document_series WHERE type_id = $1 LIMIT 1`,
            [typeId]
        );
        if (linkedSeries.length > 0) {
            // Soft-deactivate if linked to series
            await db.query(
                `UPDATE public.physical_document_type SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE type_id = $1`,
                [typeId]
            );
            return res.json({ message: 'Document type deactivated because it is linked to existing series.', deactivated: true });
        }

        const { rows } = await db.query(
            `DELETE FROM public.physical_document_type WHERE type_id = $1 RETURNING *`,
            [typeId]
        );
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Document type not found.' });
        }
        res.json({ message: 'Document type deleted successfully.' });
    } catch (err) {
        console.error('Error deleting document type:', err);
        res.status(500).json({ message: 'Server error deleting document type.' });
    }
});

// GET /api/settings/physical-document-series
router.get('/settings/physical-document-series', protect, hasPermission(['settings:edit', 'invoicing:create']), async (_req, res) => {
    try {
        const { rows: seriesList } = await db.query(
            `SELECT s.*, t.code AS type_code, t.name AS type_name, t.short_label, t.controlled_category, t.tax_designation
             FROM public.physical_document_series s
             JOIN public.physical_document_type t ON t.type_id = s.type_id
             ORDER BY s.series_id`
        );

        const seriesIds = seriesList.map(s => s.series_id);
        let taxMap = new Map();
        let contextMap = new Map();

        if (seriesIds.length > 0) {
            const { rows: taxes } = await db.query(
                `SELECT st.*, tr.rate_name, tr.rate_percentage
                 FROM public.physical_document_series_tax st
                 JOIN public.tax_rate tr ON tr.tax_rate_id = st.tax_rate_id
                 WHERE st.series_id = ANY($1::int[])`,
                [seriesIds]
            );
            for (const t of taxes) {
                if (!taxMap.has(t.series_id)) taxMap.set(t.series_id, []);
                taxMap.get(t.series_id).push(t);
            }

            const { rows: contexts } = await db.query(
                `SELECT * FROM public.physical_document_series_context
                 WHERE series_id = ANY($1::int[])`,
                [seriesIds]
            );
            for (const c of contexts) {
                if (!contextMap.has(c.series_id)) contextMap.set(c.series_id, []);
                contextMap.get(c.series_id).push(c);
            }
        }

        const result = seriesList.map(s => ({
            ...s,
            tax_mappings: taxMap.get(s.series_id) || [],
            contexts: contextMap.get(s.series_id) || [],
        }));

        res.json(result);
    } catch (err) {
        console.error('Error fetching document series:', err);
        res.status(500).json({ message: 'Server error fetching document series.' });
    }
});

// POST /api/settings/physical-document-series
router.post('/settings/physical-document-series', protect, hasPermission('settings:edit'), async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const {
            type_id, code, name, prefix, method,
            initial_serial = 1, min_serial, max_serial,
            is_active = true, contexts = [], tax_mappings = []
        } = req.body;
        const employeeId = req.user?.employee_id;

        if (!type_id || !code || !name || !prefix) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'type_id, code, name, and prefix are required.' });
        }

        const cleanPrefix = prefix.trim().toUpperCase();

        // Check if prefix already exists on an active series with the same category/namespace
        const { rows: clashRows } = await client.query(
            `SELECT s.series_id, s.name FROM public.physical_document_series s
             WHERE UPPER(s.prefix) = $1 AND s.is_active = true`,
            [cleanPrefix]
        );
        if (clashRows.length > 0 && is_active) {
            // Check if warning confirmed or rejected
            if (!req.body.confirm_duplicate_prefix) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    code: 'PREFIX_OVERLAP_WARNING',
                    message: `Prefix ${cleanPrefix} is already active on series '${clashRows[0].name}'. Multiple active series sharing a prefix can cause reference collisions unless paper stock is physically separated. Send confirm_duplicate_prefix=true to proceed.`,
                });
            }
        }

        const { rows: inserted } = await client.query(
            `INSERT INTO public.physical_document_series
             (type_id, code, name, prefix, method, initial_serial, min_serial, max_serial, is_active, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
             RETURNING *`,
            [type_id, code.trim().toUpperCase(), name.trim(), cleanPrefix, method || 'HIGHEST_PLUS_ONE',
             parseInt(initial_serial, 10), min_serial ? parseInt(min_serial, 10) : null, max_serial ? parseInt(max_serial, 10) : null,
             is_active, employeeId]
        );
        const newSeries = inserted[0];

        // Insert contexts
        const validContexts = ['POS', 'INVOICING', 'CASHIER_APPROVAL', 'COLLECTION'];
        for (const ctx of contexts) {
            const ctxName = typeof ctx === 'string' ? ctx : ctx.context;
            const wsId = typeof ctx === 'object' ? ctx.workstation_id : null;
            if (validContexts.includes(ctxName)) {
                await client.query(
                    `INSERT INTO public.physical_document_series_context (series_id, context, workstation_id, is_active)
                     VALUES ($1, $2, $3, true)
                     ON CONFLICT (series_id, context, COALESCE(workstation_id, '')) DO NOTHING`,
                    [newSeries.series_id, ctxName, wsId || null]
                );
            }
        }

        // Insert tax mappings
        for (const tm of tax_mappings) {
            if (tm.tax_rate_id) {
                await client.query(
                    `INSERT INTO public.physical_document_series_tax (series_id, tax_rate_id, role)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (series_id, tax_rate_id) DO UPDATE SET role = EXCLUDED.role`,
                    [newSeries.series_id, tm.tax_rate_id, tm.role || 'ALLOWED_RESOLVED']
                );
            }
        }

        await client.query('COMMIT');
        res.status(201).json(newSeries);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creating document series:', err);
        res.status(500).json({ message: 'Server error creating document series.', error: err.message });
    } finally {
        client.release();
    }
});

// PATCH /api/settings/physical-document-series/:id
router.patch('/settings/physical-document-series/:id', protect, hasPermission('settings:edit'), async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const seriesId = parseInt(req.params.id, 10);
        const { name, method, min_serial, max_serial, is_active, contexts, tax_mappings, expected_version } = req.body;
        const employeeId = req.user?.employee_id;

        const { rows: current } = await client.query(
            `SELECT * FROM public.physical_document_series WHERE series_id = $1 FOR UPDATE`,
            [seriesId]
        );
        if (current.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Document series not found.' });
        }
        if (expected_version != null && current[0].version !== parseInt(expected_version, 10)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ message: 'Conflict: series has been modified by another user.', code: 'CONCURRENCY_CONFLICT' });
        }

        const { rows: updated } = await client.query(
            `UPDATE public.physical_document_series
             SET name = COALESCE($1, name),
                 method = COALESCE($2, method),
                 min_serial = CASE WHEN $3::bigint IS NOT NULL THEN $3::bigint ELSE min_serial END,
                 max_serial = CASE WHEN $4::bigint IS NOT NULL THEN $4::bigint ELSE max_serial END,
                 is_active = COALESCE($5, is_active),
                 version = version + 1,
                 updated_at = CURRENT_TIMESTAMP,
                 updated_by = $6
             WHERE series_id = $7
             RETURNING *`,
            [name, method, min_serial, max_serial, is_active, employeeId, seriesId]
        );

        if (Array.isArray(contexts)) {
            await client.query(`DELETE FROM public.physical_document_series_context WHERE series_id = $1`, [seriesId]);
            const validContexts = ['POS', 'INVOICING', 'CASHIER_APPROVAL', 'COLLECTION'];
            for (const ctx of contexts) {
                const ctxName = typeof ctx === 'string' ? ctx : ctx.context;
                const wsId = typeof ctx === 'object' ? ctx.workstation_id : null;
                if (validContexts.includes(ctxName)) {
                    await client.query(
                        `INSERT INTO public.physical_document_series_context (series_id, context, workstation_id, is_active)
                         VALUES ($1, $2, $3, true)
                         ON CONFLICT (series_id, context, COALESCE(workstation_id, '')) DO NOTHING`,
                        [seriesId, ctxName, wsId || null]
                    );
                }
            }
        }

        if (Array.isArray(tax_mappings)) {
            await client.query(`DELETE FROM public.physical_document_series_tax WHERE series_id = $1`, [seriesId]);
            for (const tm of tax_mappings) {
                if (tm.tax_rate_id) {
                    await client.query(
                        `INSERT INTO public.physical_document_series_tax (series_id, tax_rate_id, role)
                         VALUES ($1, $2, $3)
                         ON CONFLICT (series_id, tax_rate_id) DO UPDATE SET role = EXCLUDED.role`,
                        [seriesId, tm.tax_rate_id, tm.role || 'ALLOWED_RESOLVED']
                    );
                }
            }
        }

        await client.query('COMMIT');
        res.json(updated[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error updating document series:', err);
        res.status(500).json({ message: 'Server error updating document series.', error: err.message });
    } finally {
        client.release();
    }
});

// POST /api/settings/physical-document-series/:id/adjust-sequence
router.post('/settings/physical-document-series/:id/adjust-sequence', protect, hasPermission('settings:edit'), async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const seriesId = parseInt(req.params.id, 10);
        const { expected_version, high_water_serial, last_issued_serial, reason, notes } = req.body;
        const employeeId = req.user?.employee_id;

        if (!reason || !reason.trim()) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Reason is required for sequence adjustment.' });
        }

        const { rows: seriesRows } = await client.query(
            `SELECT * FROM public.physical_document_series WHERE series_id = $1 FOR UPDATE`,
            [seriesId]
        );
        if (seriesRows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Document series not found.' });
        }
        const series = seriesRows[0];

        if (expected_version != null && series.version !== parseInt(expected_version, 10)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ message: 'Version conflict: series was modified concurrently.', code: 'CONCURRENCY_CONFLICT' });
        }

        const beforeState = {
            high_water_serial: series.high_water_serial,
            last_issued_serial: series.last_issued_serial,
            version: series.version,
        };

        const newHighWater = high_water_serial !== undefined ? parseInt(high_water_serial, 10) : series.high_water_serial;
        const newLastIssued = last_issued_serial !== undefined ? parseInt(last_issued_serial, 10) : series.last_issued_serial;

        const { rows: updatedRows } = await client.query(
            `UPDATE public.physical_document_series
             SET high_water_serial = $1,
                 last_issued_serial = $2,
                 version = version + 1,
                 updated_at = CURRENT_TIMESTAMP,
                 updated_by = $3
             WHERE series_id = $4
             RETURNING *`,
            [newHighWater, newLastIssued, employeeId, seriesId]
        );

        const afterState = {
            high_water_serial: updatedRows[0].high_water_serial,
            last_issued_serial: updatedRows[0].last_issued_serial,
            version: updatedRows[0].version,
        };

        // Append audit event
        await client.query(
            `INSERT INTO public.physical_document_event
             (series_id, event_type, reason, notes, before_state, after_state, actor_id)
             VALUES ($1, 'SEQUENCE_ADJUSTED', $2, $3, $4, $5, $6)`,
            [seriesId, reason.trim(), notes || null, JSON.stringify(beforeState), JSON.stringify(afterState), employeeId]
        );

        // Preview next suggestion
        const nextPreview = await physicalDocumentService.getSuggestion(seriesId, null, client);

        await client.query('COMMIT');
        res.json({
            message: 'Sequence adjusted successfully.',
            series: updatedRows[0],
            before: beforeState,
            after: afterState,
            next_preview: nextPreview,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error adjusting sequence:', err);
        res.status(500).json({ message: 'Server error adjusting sequence.', error: err.message });
    } finally {
        client.release();
    }
});

// GET /api/settings/physical-document-selection-policies
router.get('/settings/physical-document-selection-policies', protect, hasPermission(['settings:edit', 'invoicing:create']), async (_req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT p.*, s.name AS fixed_or_fallback_series_name, s.prefix AS fixed_or_fallback_series_prefix
             FROM public.physical_document_selection_policy p
             LEFT JOIN public.physical_document_series s ON s.series_id = p.fixed_or_fallback_series_id
             ORDER BY p.context, p.workstation_id`
        );
        res.json(rows);
    } catch (err) {
        console.error('Error fetching selection policies:', err);
        res.status(500).json({ message: 'Server error fetching selection policies.' });
    }
});

// PUT /api/settings/physical-document-selection-policies
router.put('/settings/physical-document-selection-policies', protect, hasPermission('settings:edit'), async (req, res) => {
    try {
        const { context, workstation_id = null, mode = 'LAST_SUCCESSFUL', fixed_or_fallback_series_id = null, allow_notebook = true, expected_version } = req.body;
        const employeeId = req.user?.employee_id;

        if (!context) {
            return res.status(400).json({ message: 'context is required.' });
        }
        if (mode === 'FIXED_DEFAULT' && !fixed_or_fallback_series_id) {
            return res.status(400).json({ message: 'fixed_or_fallback_series_id is required when mode is FIXED_DEFAULT.' });
        }

        const wsKey = workstation_id ? workstation_id.trim() : null;

        // Check concurrency if updating
        if (expected_version != null) {
            const { rows: existing } = await db.query(
                `SELECT version FROM public.physical_document_selection_policy
                 WHERE context = $1 AND COALESCE(workstation_id, '') = COALESCE($2, '')`,
                [context, wsKey]
            );
            if (existing.length > 0 && existing[0].version !== parseInt(expected_version, 10)) {
                return res.status(409).json({ message: 'Conflict: policy was updated concurrently.', code: 'CONCURRENCY_CONFLICT' });
            }
        }

        const { rows } = await db.query(
            `INSERT INTO public.physical_document_selection_policy
             (context, workstation_id, mode, fixed_or_fallback_series_id, allow_notebook, updated_by, version)
             VALUES ($1, $2, $3, $4, $5, $6, 1)
             ON CONFLICT (context, COALESCE(workstation_id, ''))
             DO UPDATE SET mode = EXCLUDED.mode,
                           fixed_or_fallback_series_id = EXCLUDED.fixed_or_fallback_series_id,
                           allow_notebook = EXCLUDED.allow_notebook,
                           version = public.physical_document_selection_policy.version + 1,
                           updated_at = CURRENT_TIMESTAMP,
                           updated_by = EXCLUDED.updated_by
             RETURNING *`,
            [context, wsKey, mode, fixed_or_fallback_series_id, allow_notebook, employeeId]
        );

        res.json(rows[0]);
    } catch (err) {
        console.error('Error saving selection policy:', err);
        res.status(500).json({ message: 'Server error saving selection policy.' });
    }
});

// GET /api/settings/physical-document-spoilage
router.get('/settings/physical-document-spoilage', protect, hasPermission('settings:edit'), async (req, res) => {
    try {
        const { page, limit, offset } = parsePaginationQuery(req.query);
        const { series_id, search } = req.query;

        let conditions = ["r.state = 'SPOILED'"];
        let params = [];
        let pIndex = 1;

        if (series_id) {
            conditions.push(`r.series_id = $${pIndex++}`);
            params.push(parseInt(series_id, 10));
        }

        if (search) {
            conditions.push(`r.canonical_full_reference ILIKE $${pIndex++}`);
            params.push(`%${search.trim()}%`);
        }

        const whereSql = conditions.join(' AND ');

        const { rows: countRows } = await db.query(
            `SELECT count(*) FROM public.physical_document_registry r WHERE ${whereSql}`,
            params
        );
        const total = parseInt(countRows[0].count, 10);

        const { rows } = await db.query(
            `SELECT r.*, s.name AS series_name, s.prefix,
                    e.first_name || ' ' || e.last_name AS actor_name,
                    ev.reason AS spoilage_reason, ev.notes AS spoilage_notes
             FROM public.physical_document_registry r
             JOIN public.physical_document_series s ON s.series_id = r.series_id
             LEFT JOIN public.employee e ON e.employee_id = r.created_by
             LEFT JOIN LATERAL (
                 SELECT reason, notes FROM public.physical_document_event
                 WHERE registry_id = r.registry_id AND event_type = 'SPOILED'
                 ORDER BY created_at DESC LIMIT 1
             ) ev ON true
             WHERE ${whereSql}
             ORDER BY r.created_at DESC
             LIMIT $${pIndex++} OFFSET $${pIndex++}`,
            [...params, limit, offset]
        );

        res.json(paginatedResponse(rows, total, page, limit));
    } catch (err) {
        console.error('Error fetching spoiled receipts:', err);
        res.status(500).json({ message: 'Server error fetching spoiled receipts.' });
    }
});

// POST /api/settings/physical-document-spoilage
router.post('/settings/physical-document-spoilage', protect, hasPermission('settings:edit'), async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const { series_id, physical_receipt_no, reason, notes } = req.body;
        const employeeId = req.user?.employee_id;

        if (!series_id || !physical_receipt_no || !reason) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'series_id, physical_receipt_no, and reason are required.' });
        }

        const formatted = formatPhysicalReceiptNumber(physical_receipt_no);
        const parsed = physicalDocumentService.parseReferenceComponents(formatted);
        if (!parsed || parsed.serial == null) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Invalid physical receipt format.' });
        }

        // Check if already occupied
        const occ = await physicalDocumentService.isReferenceOccupied(client, parseInt(series_id, 10), parsed.canonical);
        if (occ.occupied) {
            await client.query('ROLLBACK');
            return res.status(409).json({ message: `Receipt ${parsed.canonical} is already ${occ.state}.` });
        }

        const { rows: regRows } = await client.query(
            `INSERT INTO public.physical_document_registry
             (series_id, canonical_full_reference, serial_number, state, created_by, updated_by)
             VALUES ($1, $2, $3, 'SPOILED', $4, $4)
             RETURNING *`,
            [parseInt(series_id, 10), parsed.canonical, parsed.serial, employeeId]
        );

        await client.query(
            `INSERT INTO public.physical_document_event
             (series_id, registry_id, event_type, original_suggestion, submitted_reference, reason, notes, actor_id)
             VALUES ($1, $2, 'SPOILED', $3, $3, $4, $5, $6)`,
            [parseInt(series_id, 10), regRows[0].registry_id, parsed.canonical, reason.trim(), notes || null, employeeId]
        );

        await client.query('COMMIT');
        res.status(201).json(regRows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error marking receipt as spoiled:', err);
        res.status(500).json({ message: 'Server error recording spoilage.' });
    } finally {
        client.release();
    }
});

// POST /api/settings/physical-document-spoilage/:id/correct
router.post('/settings/physical-document-spoilage/:id/correct', protect, hasPermission('settings:edit'), async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const registryId = parseInt(req.params.id, 10);
        const { reason, notes, expected_version } = req.body;
        const employeeId = req.user?.employee_id;

        if (!reason || !reason.trim()) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Reason is required to correct spoilage.' });
        }

        const { rows: regRows } = await client.query(
            `SELECT * FROM public.physical_document_registry WHERE registry_id = $1 FOR UPDATE`,
            [registryId]
        );
        if (regRows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Registry record not found.' });
        }
        const record = regRows[0];

        if (record.state !== 'SPOILED') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: `Cannot correct non-spoiled record (current state: ${record.state}).` });
        }

        if (expected_version != null && record.version !== parseInt(expected_version, 10)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ message: 'Conflict: record was modified concurrently.', code: 'CONCURRENCY_CONFLICT' });
        }

        // Change state to UNOCCUPIED so it can be re-issued
        const { rows: updatedRows } = await client.query(
            `UPDATE public.physical_document_registry
             SET state = 'UNOCCUPIED',
                 version = version + 1,
                 updated_at = CURRENT_TIMESTAMP,
                 updated_by = $1
             WHERE registry_id = $2
             RETURNING *`,
            [employeeId, registryId]
        );

        // Audit event
        await client.query(
            `INSERT INTO public.physical_document_event
             (series_id, registry_id, event_type, submitted_reference, reason, notes, actor_id)
             VALUES ($1, $2, 'SPOILAGE_CORRECTED', $3, $4, $5, $6)`,
            [record.series_id, registryId, record.canonical_full_reference, reason.trim(), notes || null, employeeId]
        );

        await client.query('COMMIT');
        res.json({
            message: 'Spoilage corrected. Receipt number is now eligible for issuance.',
            registry: updatedRows[0],
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error correcting spoilage:', err);
        res.status(500).json({ message: 'Server error correcting spoilage.' });
    } finally {
        client.release();
    }
});

module.exports = router;
