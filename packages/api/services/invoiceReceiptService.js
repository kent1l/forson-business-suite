'use strict';

const db = require('../db');
const physical = require('./physicalDocumentService');

function fail(message, statusCode = 422, code = 'RECEIPT_CORRECTION_INVALID') {
    const error = new Error(message);
    Object.assign(error, { statusCode, code });
    throw error;
}

function validateDecision(invoice, decision, canRelease) {
    const reason = typeof decision.reason === 'string' ? decision.reason.trim() : '';
    if (reason.length < 5 || reason.length > 100) fail('Enter a reason between 5 and 100 characters.');
    if (!Number.isInteger(decision.expected_version) || decision.expected_version !== invoice.physical_receipt_version) {
        fail('Receipt assignment changed. Close and reopen this action to review the latest receipt.', 409, 'RECEIPT_VERSION_CONFLICT');
    }
    for (const key of ['series_id', 'original_series_id']) {
        if (decision[key] != null && decision[key] !== '' && (!Number.isSafeInteger(Number(decision[key])) || Number(decision[key]) < 1)) {
            fail('Select a valid document series.');
        }
    }
    if (invoice.physical_receipt_no || invoice.physical_document_registry_id) {
        if (!['UNUSED', 'SPOILED', 'VOIDED'].includes(decision.paper_outcome)) fail('Choose what happened to the original paper receipt.');
        if (decision.paper_outcome === 'UNUSED' && !canRelease) fail('Releasing an unused receipt requires the release receipt number permission.', 403, 'RECEIPT_RELEASE_FORBIDDEN');
    }
    return reason;
}

async function getSnapshot(invoiceId) {
    const { rows: [invoice] } = await db.query('SELECT * FROM public.invoice WHERE invoice_id = $1', [invoiceId]);
    if (!invoice) fail('Invoice not found.', 404);
    const { rows: series } = await db.query(
        `SELECT s.*, t.short_label, t.controlled_category, t.tax_designation, t.is_active AS type_active,
                EXISTS (SELECT 1 FROM public.physical_document_series_context sc WHERE sc.series_id = s.series_id
                    AND sc.is_active AND sc.context IN ('POS', 'INVOICING', 'CASHIER_APPROVAL')) AS sales_eligible
         FROM public.physical_document_series s JOIN public.physical_document_type t ON t.type_id = s.type_id
         ORDER BY s.name, s.series_id`
    );
    const { rows: history } = await db.query(
        `SELECT e.event_id, e.event_type, e.original_suggestion, e.submitted_reference, e.reason,
                e.before_state, e.after_state, e.created_at, CONCAT_WS(' ', emp.first_name, emp.last_name) AS actor_name
         FROM public.physical_document_event e LEFT JOIN public.employee emp ON emp.employee_id = e.actor_id
         WHERE (e.source_type = 'INVOICE' AND e.source_id = $1)
            OR e.registry_id = $2 ORDER BY e.event_id DESC LIMIT 100`,
        [invoiceId, invoice.physical_document_registry_id]
    );
    return { invoice, series, history };
}

async function lockSeries(client, ids) {
    const uniqueIds = [...new Set(ids.filter(Boolean).map(Number))].sort((a, b) => a - b);
    if (!uniqueIds.length) return;
    await client.query('SELECT series_id FROM public.physical_document_series WHERE series_id = ANY($1::int[]) ORDER BY series_id FOR UPDATE', [uniqueIds]);
}

async function getOriginalSeriesId(client, invoice, decision) {
    if (invoice.physical_document_series_id) return invoice.physical_document_series_id;
    if (!invoice.physical_receipt_no) return null;
    const parsed = physical.parseReferenceComponents(invoice.physical_receipt_no);
    // An unused legacy typo can be removed without inventing a paper identity.
    if (!parsed?.prefix || parsed.serial == null) {
        if (decision.paper_outcome === 'UNUSED') return null;
        fail('The original legacy reference cannot be mapped to a numbered series. Correct its assignment before voiding.');
    }
    const { rows } = await client.query(
        `SELECT s.series_id FROM public.physical_document_series s
         JOIN public.physical_document_type t ON t.type_id = s.type_id
         WHERE UPPER(s.prefix) = $1 AND t.controlled_category NOT IN ('COLLECTION_RECEIPT', 'NOTEBOOK')
           AND ($2::int IS NULL OR s.series_id = $2)
           AND (s.min_serial IS NULL OR s.min_serial <= $3) AND (s.max_serial IS NULL OR s.max_serial >= $3)`,
        [parsed.prefix, decision.original_series_id || null, parsed.serial]
    );
    if (rows.length !== 1) {
        if (decision.paper_outcome === 'UNUSED' && !decision.original_series_id) return null;
        fail('Select the original paper series to account for this legacy receipt.');
    }
    return rows[0].series_id;
}

async function appendEvent(client, invoice, { registryId, seriesId, eventType, reason, actorId, before, after, reference }) {
    await client.query(
        `INSERT INTO public.physical_document_event
         (series_id, registry_id, source_type, source_id, event_type, original_suggestion, submitted_reference, reason, actor_id, before_state, after_state)
         VALUES ($1, $2, 'INVOICE', $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)`,
        [seriesId || null, registryId || null, invoice.invoice_id, eventType, invoice.physical_receipt_no,
            reference || null, reason, actorId, JSON.stringify(before), JSON.stringify(after)]
    );
}

// Caller owns the invoice lock and transaction. Previous assignments are never
// overwritten; PRIMARY points at the current paper, HISTORICAL preserves evidence.
async function retireOriginal(client, invoice, decision, reason, actorId, seriesId) {
    let registryId = invoice.physical_document_registry_id;
    const state = { UNUSED: 'UNOCCUPIED', SPOILED: 'SPOILED', VOIDED: 'VOIDED' }[decision.paper_outcome];
    if (!invoice.physical_receipt_no && !registryId) return null;
    if (!registryId && seriesId) {
        const parsed = physical.parseReferenceComponents(invoice.physical_receipt_no);
        const occupied = await physical.isReferenceOccupied(client, seriesId, parsed.canonical, null, invoice.invoice_id);
        if (occupied.occupied) fail('The original receipt is occupied by another assignment. Resolve its ownership before correcting it.', 409);
        const { rows: [record] } = await client.query(
            `INSERT INTO public.physical_document_registry
             (series_id, canonical_full_reference, serial_number, state, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $5) RETURNING registry_id`,
            [seriesId, parsed.canonical, parsed.serial, state, actorId]
        );
        registryId = record.registry_id;
        await client.query(
            `INSERT INTO public.physical_document_source_link (registry_id, source_type, invoice_id, role)
             VALUES ($1, 'INVOICE', $2, 'PRIMARY')`, [registryId, invoice.invoice_id]
        );
    } else if (registryId) {
        const { rows: [registry] } = await client.query('SELECT * FROM public.physical_document_registry WHERE registry_id = $1 FOR UPDATE', [registryId]);
        if (!registry || registry.state !== 'ISSUED') fail('The original paper is no longer issued. Refresh the transaction before continuing.', 409);
        await client.query(
            `UPDATE public.physical_document_registry SET state = $2, version = version + 1,
                updated_at = CURRENT_TIMESTAMP, updated_by = $3 WHERE registry_id = $1`, [registryId, state, actorId]
        );
    }
    if (registryId) await client.query("UPDATE public.physical_document_source_link SET role = 'HISTORICAL' WHERE registry_id = $1 AND invoice_id = $2", [registryId, invoice.invoice_id]);
    await appendEvent(client, invoice, {
        registryId, seriesId, eventType: decision.paper_outcome === 'UNUSED' ? 'ASSIGNMENT_RELEASED' : state,
        reason, actorId, before: { reference: invoice.physical_receipt_no, state: 'ISSUED' },
        after: { reference: invoice.physical_receipt_no, state }, reference: invoice.physical_receipt_no,
    });
    return registryId;
}

async function validateReplacement(client, invoice, decision) {
    const { rows: [series] } = await client.query(
        `SELECT s.*, t.is_active AS type_active, t.controlled_category FROM public.physical_document_series s
         JOIN public.physical_document_type t ON t.type_id = s.type_id WHERE s.series_id = $1`, [decision.series_id]
    );
    if (!series?.is_active || !series.type_active || ['COLLECTION_RECEIPT', 'NOTEBOOK'].includes(series.controlled_category)) fail('Select an active sales document series.');
    const { rows: contexts } = await client.query(
        `SELECT 1 FROM public.physical_document_series_context WHERE series_id = $1 AND is_active
         AND context IN ('POS', 'INVOICING', 'CASHIER_APPROVAL')`, [series.series_id]
    );
    if (!contexts.length) fail('This series is not enabled for sales transactions.');
    const parsed = physical.parseReferenceComponents(decision.physical_receipt_no);
    if (!Number.isSafeInteger(parsed?.serial) || parsed.serial < 1 || parsed.prefix !== series.prefix.toUpperCase()) fail('Enter a valid number matching the selected series prefix.');
    if ((series.min_serial != null && parsed.serial < Number(series.min_serial)) || (series.max_serial != null && parsed.serial > Number(series.max_serial))) fail('Receipt number is outside the selected series bounds.');
    const { rows: incompatible } = await client.query(
        `SELECT DISTINCT il.tax_rate_id FROM public.invoice_line il WHERE il.invoice_id = $1 AND il.tax_rate_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.physical_document_series_tax st WHERE st.series_id = $2 AND st.tax_rate_id = il.tax_rate_id)
         UNION SELECT itb.tax_rate_id FROM public.invoice_tax_breakdown itb WHERE itb.invoice_id = $1 AND itb.tax_rate_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.physical_document_series_tax st WHERE st.series_id = $2 AND st.tax_rate_id = itb.tax_rate_id)`,
        [invoice.invoice_id, series.series_id]
    );
    if (incompatible.length) fail('This series is incompatible with the invoice taxes. Receipt correction cannot change the sale taxes.', 422, 'RECEIPT_TAX_INCOMPATIBLE');
    const occupied = await physical.isReferenceOccupied(client, series.series_id, parsed.canonical);
    const { rows: [legacy] } = await client.query('SELECT public.is_physical_receipt_no_taken($1) AS taken', [parsed.canonical]);
    if (occupied.occupied || legacy.taken) fail('Physical Receipt No already exists. Please use a unique number.', 409, 'RECEIPT_NUMBER_TAKEN');
    return { series, parsed };
}

async function correctReceipt(client, invoice, decision, actorId, canRelease) {
    if (invoice.status === 'Cancelled') fail('Cancelled invoices retain their paper history and cannot be reassigned.', 409);
    const reason = validateDecision(invoice, decision, canRelease);
    if (!['PAPER', 'NOTEBOOK'].includes(decision.recording_method)) fail('Choose Paper or Notebook explicitly.');
    if (decision.recording_method === 'PAPER' && (!decision.series_id || !decision.physical_receipt_no)) fail('Select a series and enter the corrected paper number.');
    const originalSeriesId = await getOriginalSeriesId(client, invoice, decision);
    await lockSeries(client, [originalSeriesId, decision.series_id]);
    let replacement = null;
    if (decision.recording_method === 'PAPER') replacement = await validateReplacement(client, invoice, decision);
    else {
        const { rows: policies } = await client.query(
            "SELECT 1 FROM public.physical_document_selection_policy WHERE context IN ('POS', 'INVOICING', 'CASHIER_APPROVAL') AND allow_notebook = false"
        );
        if (policies.length) fail('Notebook correction is disabled by the sales document policy.');
    }
    await retireOriginal(client, invoice, decision, reason, actorId, originalSeriesId);
    let registryId = null;
    if (replacement) {
        const { series, parsed } = replacement;
        const { rows: [record] } = await client.query(
            `INSERT INTO public.physical_document_registry
             (series_id, canonical_full_reference, serial_number, state, created_by, updated_by)
             VALUES ($1, $2, $3, 'ISSUED', $4, $4) RETURNING registry_id`,
            [series.series_id, parsed.canonical, parsed.serial, actorId]
        );
        registryId = record.registry_id;
        await client.query(
            `INSERT INTO public.physical_document_source_link (registry_id, source_type, invoice_id, role)
             VALUES ($1, 'INVOICE', $2, 'PRIMARY')`, [registryId, invoice.invoice_id]
        );
        // Corrections do not change ordinary issuance order or cashier preference.
        await client.query(
            `UPDATE public.physical_document_series SET high_water_serial = GREATEST(COALESCE(high_water_serial, 0), $2),
                version = version + 1, updated_at = CURRENT_TIMESTAMP, updated_by = $3 WHERE series_id = $1`,
            [series.series_id, parsed.serial, actorId]
        );
    }
    const { rows: [updated] } = await client.query(
        `UPDATE public.invoice SET physical_receipt_no = $2, recording_method = $3,
            physical_document_type_id = $4, physical_document_series_id = $5, physical_document_registry_id = $6,
            physical_receipt_version = physical_receipt_version + 1 WHERE invoice_id = $1 RETURNING *`,
        [invoice.invoice_id, replacement?.parsed.canonical || null, decision.recording_method,
            replacement?.series.type_id || null, replacement?.series.series_id || null, registryId]
    );
    await appendEvent(client, invoice, {
        registryId, seriesId: updated.physical_document_series_id, eventType: 'REFERENCE_EDITED', reason, actorId,
        before: { reference: invoice.physical_receipt_no, series_id: invoice.physical_document_series_id },
        after: { reference: updated.physical_receipt_no, series_id: updated.physical_document_series_id, recording_method: updated.recording_method, paper_outcome: decision.paper_outcome || null },
        reference: updated.physical_receipt_no,
    });
    return updated;
}

async function voidReceipt(client, invoice, decision, actorId, canRelease) {
    const reason = validateDecision(invoice, decision, canRelease);
    const originalSeriesId = await getOriginalSeriesId(client, invoice, decision);
    await lockSeries(client, [originalSeriesId]);
    const registryId = await retireOriginal(client, invoice, decision, reason, actorId, originalSeriesId);
    const released = decision.paper_outcome === 'UNUSED';
    await client.query(
        `UPDATE public.invoice SET physical_receipt_no = $2::varchar(50),
            physical_document_registry_id = $3, physical_document_series_id = $4,
            physical_document_type_id = (SELECT type_id FROM public.physical_document_series WHERE series_id = $4),
            recording_method = CASE WHEN $2::varchar(50) IS NOT NULL THEN 'PAPER' WHEN $5::boolean THEN 'NOTEBOOK' ELSE recording_method END,
            physical_receipt_version = physical_receipt_version + 1 WHERE invoice_id = $1`,
        [invoice.invoice_id, released ? null : invoice.physical_receipt_no,
            released ? null : registryId, released ? null : originalSeriesId, released]
    );
    // Even Notebook voids require a reason and leave an audit event.
    await appendEvent(client, invoice, { registryId, seriesId: originalSeriesId, eventType: 'INVOICE_VOIDED', reason, actorId,
        before: { status: invoice.status, reference: invoice.physical_receipt_no },
        after: { status: 'Cancelled', paper_outcome: decision.paper_outcome || null }, reference: invoice.physical_receipt_no });
}

module.exports = { getSnapshot, validateDecision, correctReceipt, voidReceipt };
