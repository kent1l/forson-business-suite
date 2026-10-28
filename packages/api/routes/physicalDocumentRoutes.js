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

        const suggestion = await physicalDocumentService.getSuggestion(seriesId, context, null, req.user?.employee_id ?? null);
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
            employee_id: req.user?.employee_id ?? null,
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

// A bounded, paginated view of a physical booklet, including numbers without a record.
router.get('/settings/physical-document-monitor', protect, hasPermission('settings:edit'), async (req, res) => {
    try {
        const seriesId = Number(req.query.series_id);
        const page = Number(req.query.page || 1);
        if (!Number.isSafeInteger(seriesId) || seriesId < 1 || !Number.isSafeInteger(page) || page < 1) return res.status(400).json({ message: 'Invalid series or page.' });
        const { rows: seriesRows } = await db.query('SELECT * FROM public.physical_document_series WHERE series_id = $1', [seriesId]);
        const series = seriesRows[0];
        if (!series) return res.status(404).json({ message: 'Series not found.' });
        if (series.min_serial == null || series.max_serial == null) return res.json({ needs_bounds: true, items: [], total: 0 });
        const start = BigInt(series.min_serial) + BigInt(page - 1) * 25n;
        const end = BigInt(series.max_serial);
        if (start > end) return res.json({ items: [], total: String(end - BigInt(series.min_serial) + 1n) });
        const last = start + 24n < end ? start + 24n : end;
        const { rows } = await db.query(`
            SELECT n.serial_number, UPPER(s.prefix) || '-' || n.serial_number AS reference,
                r.registry_id, r.state, r.version, r.updated_at, follow_up.reason AS follow_up_reason,
                COALESCE(links.sources, '[]'::json) AS sources,
                legacy.invoices, legacy.payments
            FROM public.physical_document_series s
            CROSS JOIN generate_series($2::bigint, $3::bigint) n(serial_number)
            LEFT JOIN LATERAL (
                SELECT * FROM public.physical_document_registry r
                WHERE r.series_id = s.series_id AND r.serial_number = n.serial_number
                ORDER BY (r.state IN ('ISSUED','VOIDED','SPOILED')) DESC, r.updated_at DESC, r.registry_id DESC LIMIT 1
            ) r ON true
            LEFT JOIN LATERAL (
                SELECT reason FROM public.physical_document_event ev
                WHERE ev.series_id = s.series_id AND ev.submitted_reference = UPPER(s.prefix) || '-' || n.serial_number AND ev.event_type = 'FOLLOW_UP'
                ORDER BY ev.created_at DESC, ev.event_id DESC LIMIT 1
            ) follow_up ON true
            LEFT JOIN LATERAL (
                SELECT json_agg(json_build_object('type', l.source_type, 'id', COALESCE(l.invoice_id, l.payment_id, l.collection_group_id))) AS sources
                FROM public.physical_document_source_link l WHERE l.registry_id = r.registry_id
            ) links ON true
            LEFT JOIN LATERAL (
                SELECT ARRAY(SELECT invoice_id FROM public.invoice WHERE UPPER(TRIM(physical_receipt_no)) = UPPER(s.prefix) || '-' || n.serial_number) AS invoices,
                       ARRAY(SELECT payment_id FROM public.customer_payment WHERE UPPER(TRIM(physical_receipt_no)) = UPPER(s.prefix) || '-' || n.serial_number) AS payments
            ) legacy ON true
            WHERE s.series_id = $1 ORDER BY n.serial_number`, [seriesId, String(start), String(last)]);
        res.json({ items: rows, total: String(end - BigInt(series.min_serial) + 1n) });
    } catch (err) {
        console.error('Error fetching receipt monitor:', err);
        res.status(500).json({ message: 'Failed to load receipt monitor.' });
    }
});

router.get('/settings/physical-document-monitor/history', protect, hasPermission('settings:edit'), async (req, res) => {
    try {
        const seriesId = Number(req.query.series_id);
        const reference = formatPhysicalReceiptNumber(req.query.reference);
        if (!Number.isSafeInteger(seriesId) || seriesId < 1 || !reference) return res.status(400).json({ message: 'Series and reference are required.' });
        const { rows } = await db.query(`SELECT ev.*, e.first_name || ' ' || e.last_name AS actor_name
            FROM public.physical_document_event ev LEFT JOIN public.employee e ON e.employee_id = ev.actor_id
            LEFT JOIN public.physical_document_registry r ON r.registry_id = ev.registry_id
            WHERE ev.series_id = $1 AND (ev.submitted_reference = $2 OR r.canonical_full_reference = $2)
            ORDER BY ev.created_at DESC, ev.event_id DESC`, [seriesId, reference]);
        res.json(rows);
    } catch (err) {
        console.error('Error fetching receipt history:', err);
        res.status(500).json({ message: 'Failed to load receipt history.' });
    }
});

router.post('/settings/physical-document-monitor/follow-up', protect, hasPermission('settings:edit'), async (req, res) => {
    try {
        const seriesId = Number(req.body.series_id);
        const parsed = physicalDocumentService.parseReferenceComponents(req.body.reference);
        const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
        if (!Number.isSafeInteger(seriesId) || seriesId < 1 || !parsed?.serial || !reason || reason.length > 100) return res.status(400).json({ message: 'Series, reference and a reason of up to 100 characters are required.' });
        const { rows } = await db.query('SELECT prefix, min_serial, max_serial FROM public.physical_document_series WHERE series_id = $1', [seriesId]);
        const series = rows[0];
        if (!series || parsed.prefix !== series.prefix.toUpperCase() || series.min_serial == null || series.max_serial == null || BigInt(parsed.serial) < BigInt(series.min_serial) || BigInt(parsed.serial) > BigInt(series.max_serial)) return res.status(400).json({ message: 'Reference is outside the configured series.' });
        await db.query(`INSERT INTO public.physical_document_event (series_id, event_type, submitted_reference, reason, actor_id)
            VALUES ($1, 'FOLLOW_UP', $2, $3, $4)`, [seriesId, parsed.canonical, reason, req.user?.employee_id]);
        res.status(201).json({ message: 'Follow-up recorded.' });
    } catch (err) {
        console.error('Error recording receipt follow-up:', err);
        res.status(500).json({ message: 'Failed to record follow-up.' });
    }
});

// GET /api/settings/physical-document-spoilage
router.get('/settings/physical-document-spoilage', protect, hasPermission('settings:edit'), async (req, res) => {
    try {
        const { page, pageSize, offset } = parsePaginationQuery(req.query);
        const { series_id, search, date_from, date_to, sortBy, sortOrder } = req.query;
        const sortFields = {
            reference: 'r.canonical_full_reference', series: 's.name',
            recorded_at: 'COALESCE(ev.created_at, r.updated_at)',
            actor: "COALESCE(e.first_name || ' ' || e.last_name, 'System / Cashier')",
            reason: "COALESCE(ev.reason, 'Spoiled')",
        };
        const sortField = Object.hasOwn(sortFields, sortBy) ? sortFields[sortBy] : sortFields.recorded_at;
        const direction = String(sortOrder).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
        for (const value of [date_from, date_to]) {
            if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)) {
                return res.status(400).json({ message: 'Invalid date filter.' });
            }
        }

        let conditions = ["r.state = 'SPOILED'"];
        let params = [];
        let pIndex = 1;

        if (series_id) {
            conditions.push(`r.series_id = $${pIndex++}`);
            params.push(parseInt(series_id, 10));
        }

        if (search) {
            conditions.push(`(r.canonical_full_reference ILIKE $${pIndex} OR s.name ILIKE $${pIndex} OR s.prefix ILIKE $${pIndex} OR COALESCE(e.first_name || ' ' || e.last_name, 'System / Cashier') ILIKE $${pIndex} OR COALESCE(ev.reason, 'Spoiled') ILIKE $${pIndex} OR ev.notes ILIKE $${pIndex})`);
            pIndex++;
            params.push(`%${search.trim()}%`);
        }
        if (date_from) {
            conditions.push(`COALESCE(ev.created_at, r.updated_at) >= ($${pIndex++}::date::timestamp AT TIME ZONE 'Asia/Manila')`);
            params.push(date_from);
        }
        if (date_to) {
            conditions.push(`COALESCE(ev.created_at, r.updated_at) < (($${pIndex++}::date + 1)::timestamp AT TIME ZONE 'Asia/Manila')`);
            params.push(date_to);
        }

        const whereSql = conditions.join(' AND ');
        const fromSql = `FROM public.physical_document_registry r
             JOIN public.physical_document_series s ON s.series_id = r.series_id
             LEFT JOIN LATERAL (
                 SELECT reason, notes, actor_id, created_at FROM public.physical_document_event
                 WHERE registry_id = r.registry_id AND event_type = 'SPOILED'
                 ORDER BY created_at DESC, event_id DESC LIMIT 1
             ) ev ON true
             LEFT JOIN public.employee e ON e.employee_id = COALESCE(ev.actor_id, r.updated_by, r.created_by)`;

        const { rows: countRows } = await db.query(
            `SELECT count(*) ${fromSql} WHERE ${whereSql}`,
            params
        );
        const total = parseInt(countRows[0].count, 10);

        const { rows } = await db.query(
            `SELECT r.*, s.name AS series_name, s.prefix,
                    e.first_name || ' ' || e.last_name AS actor_name,
                    ev.reason AS spoilage_reason, ev.notes AS spoilage_notes,
                    COALESCE(ev.created_at, r.updated_at) AS spoiled_at
             ${fromSql}
             WHERE ${whereSql}
             ORDER BY ${sortField} ${direction} NULLS LAST, r.registry_id DESC
             LIMIT $${pIndex++} OFFSET $${pIndex++}`,
            [...params, pageSize, offset]
        );

        res.json(paginatedResponse({ data: rows, total, page, pageSize }));
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
