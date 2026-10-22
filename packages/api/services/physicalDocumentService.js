const crypto = require('crypto');
const db = require('../db');
const { formatPhysicalReceiptNumber } = require('../helpers/receiptNumberFormatter');

function getTokenSecret() {
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required to sign physical receipt suggestion tokens');
    return process.env.JWT_SECRET;
}
const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Sign an opaque suggestion token with HMAC SHA-256
 */
function signSuggestionToken(payload) {
    const data = JSON.stringify({
        ...payload,
        iat: Date.now(),
    });
    const encoded = Buffer.from(data).toString('base64url');
    const hmac = crypto.createHmac('sha256', getTokenSecret()).update(encoded).digest('base64url');
    return `${encoded}.${hmac}`;
}

/**
 * Verify an opaque suggestion token. When the token was issued to an employee,
 * it is only valid for that same employee.
 */
function verifySuggestionToken(token, employeeId = null) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encoded, signature] = parts;
    const expectedSig = crypto.createHmac('sha256', getTokenSecret()).update(encoded).digest('base64url');
    if (signature !== expectedSig) return null;
    try {
        const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        if (Date.now() - decoded.iat > TOKEN_TTL_MS) return null;
        if (decoded.employee_id != null && String(decoded.employee_id) !== String(employeeId)) return null;
        return decoded;
    } catch {
        return null;
    }
}

/**
 * Parse prefix and numeric serial from a full physical reference
 */
function parseReferenceComponents(reference) {
    const formatted = formatPhysicalReceiptNumber(reference);
    if (!formatted) return null;
    const match = formatted.match(/^([A-Z]{1,10})\W*0*([0-9]{1,})$/i);
    if (match) {
        return {
            prefix: match[1].toUpperCase(),
            serial: parseInt(match[2], 10),
            canonical: `${match[1].toUpperCase()}-${match[2]}`
        };
    }
    // Non-numeric suffix
    return {
        prefix: null,
        serial: null,
        canonical: formatted
    };
}

/**
 * Check if a reference is occupied in physical_document_registry or legacy tables
 */
async function isReferenceOccupied(clientOrDb, seriesId, canonicalRef, excludeRegistryId = null, excludeInvoiceId = null, excludePaymentId = null) {
    const runner = clientOrDb || db;
    // 1. Check registry occupied states (ISSUED, VOIDED, SPOILED)
    const { rows: regRows } = await runner.query(
        `SELECT registry_id, state FROM public.physical_document_registry
         WHERE series_id = $1 AND canonical_full_reference = $2 AND state IN ('ISSUED', 'VOIDED', 'SPOILED')
           AND ($3::int IS NULL OR registry_id != $3)`,
        [seriesId, canonicalRef, excludeRegistryId]
    );
    if (regRows.length > 0) {
        return {
            occupied: true,
            state: regRows[0].state,
            registry_id: regRows[0].registry_id,
        };
    }

    // 2. Check legacy invoice table
    const { rows: invRows } = await runner.query(
        `SELECT invoice_id FROM public.invoice
         WHERE UPPER(TRIM(physical_receipt_no)) = $1
           AND ($2::int IS NULL OR invoice_id != $2)`,
        [canonicalRef, excludeInvoiceId]
    );
    if (invRows.length > 0) {
        return {
            occupied: true,
            state: 'ISSUED',
            source: 'invoice',
            source_id: invRows[0].invoice_id,
        };
    }

    // 3. Check legacy customer_payment table
    const { rows: payRows } = await runner.query(
        `SELECT payment_id FROM public.customer_payment
         WHERE UPPER(TRIM(physical_receipt_no)) = $1
           AND ($2::int IS NULL OR payment_id != $2)`,
        [canonicalRef, excludePaymentId]
    );
    if (payRows.length > 0) {
        return {
            occupied: true,
            state: 'ISSUED',
            source: 'customer_payment',
            source_id: payRows[0].payment_id,
        };
    }

    return { occupied: false };
}

/**
 * Generate next number suggestion for a series
 */
async function getSuggestion(seriesId, _context = null, clientOrDb = null, employeeId = null) {
    const runner = clientOrDb || db;
    const { rows: seriesRows } = await runner.query(
        `SELECT s.*, t.controlled_category, t.tax_designation
         FROM public.physical_document_series s
         JOIN public.physical_document_type t ON t.type_id = s.type_id
         WHERE s.series_id = $1 AND s.is_active = true`,
        [seriesId]
    );
    if (seriesRows.length === 0) {
        const err = new Error('Physical document series not found or inactive');
        err.statusCode = 404;
        err.code = 'SERIES_NOT_FOUND';
        throw err;
    }
    const series = seriesRows[0];

    if (series.method === 'NONE') {
        return {
            series_id: series.series_id,
            method: 'NONE',
            canonical_reference: null,
            prefix: series.prefix,
            serial: null,
            suggestion_token: null,
            exhausted: false,
        };
    }

    let candidateSerial;

    if (series.method === 'HIGHEST_PLUS_ONE') {
        // Find highest occupied serial in this series
        const { rows: maxRows } = await runner.query(
            `SELECT MAX(serial_number) AS max_occupied
             FROM public.physical_document_registry
             WHERE series_id = $1 AND state IN ('ISSUED', 'VOIDED', 'SPOILED')`,
            [seriesId]
        );
        const maxOccupied = maxRows[0]?.max_occupied != null ? parseInt(maxRows[0].max_occupied, 10) : 0;
        const highWater = series.high_water_serial != null ? parseInt(series.high_water_serial, 10) : 0;
        const initial = parseInt(series.initial_serial, 10);
        const baseline = Math.max(initial - 1, maxOccupied, highWater);
        candidateSerial = baseline + 1;
    } else {
        // LAST_ISSUED_PLUS_ONE
        const lastIssued = series.last_issued_serial != null ? parseInt(series.last_issued_serial, 10) : null;
        if (lastIssued != null) {
            candidateSerial = lastIssued + 1;
        } else {
            candidateSerial = parseInt(series.initial_serial, 10);
        }
    }

    if (series.min_serial != null && candidateSerial < parseInt(series.min_serial, 10)) {
        candidateSerial = parseInt(series.min_serial, 10);
    }

    // Step forward until an unoccupied reference is found (handles discontinuous occupied gaps)
    let occupied = true;
    let attempts = 0;
    const maxAttempts = 1000;
    let candidateRef = null;

    while (occupied && attempts < maxAttempts) {
        if (series.max_serial != null && candidateSerial > parseInt(series.max_serial, 10)) {
            return {
                series_id: series.series_id,
                method: series.method,
                canonical_reference: null,
                prefix: series.prefix,
                serial: null,
                suggestion_token: null,
                exhausted: true,
            };
        }

        candidateRef = `${series.prefix.toUpperCase()}-${candidateSerial}`;
        const occ = await isReferenceOccupied(runner, series.series_id, candidateRef);
        if (!occ.occupied) {
            occupied = false;
        } else {
            candidateSerial++;
            attempts++;
        }
    }

    if (occupied) {
        return {
            series_id: series.series_id,
            method: series.method,
            canonical_reference: null,
            prefix: series.prefix,
            serial: null,
            suggestion_token: null,
            exhausted: true,
        };
    }

    const tokenPayload = {
        series_id: series.series_id,
        prefix: series.prefix.toUpperCase(),
        serial: candidateSerial,
        canonical_reference: candidateRef,
        series_version: series.version,
        employee_id: employeeId,
    };
    const suggestionToken = signSuggestionToken(tokenPayload);

    return {
        series_id: series.series_id,
        method: series.method,
        canonical_reference: candidateRef,
        prefix: series.prefix.toUpperCase(),
        serial: candidateSerial,
        series_version: series.version,
        suggestion_token: suggestionToken,
        exhausted: false,
    };
}

/**
 * Get active series, effective policy and options for cashier contexts
 */
async function getOptions({ context, workstation_id = 'default', employee_id }) {
    // 1. Get effective policy
    const { rows: policyRows } = await db.query(
        `SELECT * FROM public.physical_document_selection_policy
         WHERE context = $1 AND (workstation_id = $2 OR workstation_id IS NULL OR workstation_id = '')
         ORDER BY (workstation_id IS NOT NULL AND workstation_id != '') DESC
         LIMIT 1`,
        [context, workstation_id]
    );

    const policy = policyRows[0] || {
        mode: 'LAST_SUCCESSFUL',
        fixed_or_fallback_series_id: null,
        allow_notebook: true,
    };

    // 2. Get active document types configured in application settings
    const { rows: allActiveTypes } = await db.query(
        `SELECT type_id, code, name, short_label, controlled_category, tax_designation, default_method, is_active
         FROM public.physical_document_type
         WHERE is_active = true
         ORDER BY name`
    );

    // 3. Get active series eligible for this context
    const { rows: seriesRows } = await db.query(
        `SELECT s.series_id, s.type_id, s.code, s.name, s.prefix, s.method, s.version,
                t.code AS type_code, t.name AS type_name, t.short_label, t.controlled_category, t.tax_designation
         FROM public.physical_document_series s
         JOIN public.physical_document_type t ON t.type_id = s.type_id
         JOIN public.physical_document_series_context sc ON sc.series_id = s.series_id
         WHERE sc.context = $1
           AND (sc.workstation_id IS NULL OR sc.workstation_id = '' OR sc.workstation_id = $2)
           AND s.is_active = true
           AND t.is_active = true
           AND sc.is_active = true
         ORDER BY t.controlled_category, s.name`,
        [context, workstation_id]
    );

    // 4. For each series, load tax mappings
    const seriesIds = seriesRows.map(s => s.series_id);
    let taxMappingsBySeries = new Map();
    if (seriesIds.length > 0) {
        const { rows: taxRows } = await db.query(
            `SELECT st.series_id, st.tax_rate_id, st.role, tr.rate_name, tr.rate_percentage
             FROM public.physical_document_series_tax st
             JOIN public.tax_rate tr ON tr.tax_rate_id = st.tax_rate_id
             WHERE st.series_id = ANY($1::int[])`,
            [seriesIds]
        );
        for (const tr of taxRows) {
            if (!taxMappingsBySeries.has(tr.series_id)) {
                taxMappingsBySeries.set(tr.series_id, []);
            }
            taxMappingsBySeries.get(tr.series_id).push(tr);
        }
    }

    const seriesList = seriesRows.map(s => ({
        ...s,
        tax_mappings: taxMappingsBySeries.get(s.series_id) || [],
        default_tax_rate_id: (taxMappingsBySeries.get(s.series_id) || []).find(t => t.role === 'DEFAULT_FALLBACK')?.tax_rate_id || null,
    }));

    // 5. Build dynamic choices array entirely from application settings
    const choices = seriesList.map(s => ({
        key: String(s.series_id),
        series_id: s.series_id,
        type_id: s.type_id,
        type_code: s.type_code,
        recording_method: 'PAPER',
        label: s.short_label || s.prefix,
        title: `${s.name} (${s.prefix})`,
        prefix: s.prefix,
        default_tax_rate_id: s.default_tax_rate_id,
    }));

    // Add Notebook choice if active in document types and permitted by selection policy
    const notebookType = allActiveTypes.find(t => t.code === 'NOTEBOOK' || t.controlled_category === 'NOTEBOOK');
    if (notebookType && policy.allow_notebook !== false) {
        choices.push({
            key: 'NOTEBOOK',
            series_id: null,
            type_id: notebookType.type_id,
            type_code: notebookType.code,
            recording_method: 'NOTEBOOK',
            label: notebookType.short_label || 'Notebook',
            title: notebookType.name || 'Notebook / Manual Log',
            prefix: null,
            default_tax_rate_id: null,
        });
    }

    // 6. Resolve default selection according to policy and page-level history
    let defaultChoice = null;
    let defaultSeriesId = null;
    let defaultRecordingMethod = 'PAPER';
    let selectionRequired = false;

    if (policy.mode === 'FIXED_DEFAULT') {
        const found = choices.find(c => c.series_id === policy.fixed_or_fallback_series_id);
        if (found) {
            defaultChoice = found.key;
            defaultSeriesId = found.series_id;
            defaultRecordingMethod = found.recording_method;
        } else if (choices.length > 0) {
            defaultChoice = choices[0].key;
            defaultSeriesId = choices[0].series_id;
            defaultRecordingMethod = choices[0].recording_method;
        }
        selectionRequired = !defaultChoice;
    } else if (policy.mode === 'LAST_SUCCESSFUL') {
        let lastSuccess = null;
        if (employee_id) {
            const { rows: lsRows } = await db.query(
                `SELECT last_series_id, recording_method, last_type_code FROM public.physical_document_last_success
                 WHERE employee_id = $1 AND workstation_id = $2 AND context = $3`,
                [employee_id, workstation_id, context]
            );
            if (lsRows.length > 0) {
                lastSuccess = lsRows[0];
            }
        }
        if (!lastSuccess) {
            const { rows: lsRows } = await db.query(
                `SELECT last_series_id, recording_method, last_type_code FROM public.physical_document_last_success
                 WHERE context = $1
                 ORDER BY issued_at DESC
                 LIMIT 1`,
                [context]
            );
            if (lsRows.length > 0) {
                lastSuccess = lsRows[0];
            }
        }

        if (lastSuccess) {
            if (lastSuccess.recording_method === 'NOTEBOOK') {
                const nbChoice = choices.find(c => c.key === 'NOTEBOOK');
                if (nbChoice) {
                    defaultChoice = 'NOTEBOOK';
                    defaultSeriesId = null;
                    defaultRecordingMethod = 'NOTEBOOK';
                }
            } else if (lastSuccess.last_series_id) {
                const sChoice = choices.find(c => c.series_id === lastSuccess.last_series_id);
                if (sChoice) {
                    defaultChoice = sChoice.key;
                    defaultSeriesId = sChoice.series_id;
                    defaultRecordingMethod = 'PAPER';
                }
            } else if (lastSuccess.last_type_code) {
                const tChoice = choices.find(c => c.type_code === lastSuccess.last_type_code);
                if (tChoice) {
                    defaultChoice = tChoice.key;
                    defaultSeriesId = tChoice.series_id;
                    defaultRecordingMethod = tChoice.recording_method;
                }
            }
        }

        // Fallback to configured fallback series if not resolved yet
        if (!defaultChoice && policy.fixed_or_fallback_series_id) {
            const fbChoice = choices.find(c => c.series_id === policy.fixed_or_fallback_series_id);
            if (fbChoice) {
                defaultChoice = fbChoice.key;
                defaultSeriesId = fbChoice.series_id;
                defaultRecordingMethod = fbChoice.recording_method;
            }
        }

        // If still not resolved, take first available choice
        if (!defaultChoice && choices.length > 0) {
            defaultChoice = choices[0].key;
            defaultSeriesId = choices[0].series_id;
            defaultRecordingMethod = choices[0].recording_method;
        }

        selectionRequired = !defaultChoice;
    } else {
        // ALWAYS_ASK
        defaultChoice = null;
        defaultSeriesId = null;
        selectionRequired = true;
    }

    return {
        context,
        workstation_id,
        policy: {
            mode: policy.mode,
            allow_notebook: policy.allow_notebook,
            default_choice: defaultChoice,
            default_series_id: defaultSeriesId,
            default_recording_method: defaultRecordingMethod,
            selection_required: selectionRequired,
        },
        choices,
        series: seriesList,
        types: allActiveTypes,
    };
}

/**
 * Validate physical receipt reference and check availability & tax compatibility
 */
async function validateReference({ series_id, physical_receipt_no, suggestion_token = null, employee_id = null, lines_tax_rate_ids = [], exclude_registry_id = null }) {
    if (!series_id) {
        return { valid: false, code: 'SERIES_REQUIRED', message: 'Physical document series is required.' };
    }

    const { rows: seriesRows } = await db.query(
        `SELECT s.*, t.controlled_category, t.tax_designation
         FROM public.physical_document_series s
         JOIN public.physical_document_type t ON t.type_id = s.type_id
         WHERE s.series_id = $1`,
        [series_id]
    );
    if (seriesRows.length === 0) {
        return { valid: false, code: 'SERIES_NOT_FOUND', message: 'Physical document series not found.' };
    }
    const series = seriesRows[0];

    const parsed = parseReferenceComponents(physical_receipt_no);
    if (!parsed || parsed.serial == null) {
        return {
            valid: false,
            code: 'INVALID_FORMAT',
            message: 'Physical receipt number must contain a valid prefix and numeric serial (e.g., SI-1234).',
        };
    }

    // Prefix match check
    if (parsed.prefix !== series.prefix.toUpperCase()) {
        return {
            valid: false,
            code: 'PREFIX_MISMATCH',
            message: `Prefix ${parsed.prefix} does not match series prefix ${series.prefix}.`,
        };
    }

    // Bounds check
    if (series.min_serial != null && parsed.serial < parseInt(series.min_serial, 10)) {
        return {
            valid: false,
            code: 'OUT_OF_BOUNDS',
            message: `Serial ${parsed.serial} is below minimum allowed serial ${series.min_serial}.`,
        };
    }
    if (series.max_serial != null && parsed.serial > parseInt(series.max_serial, 10)) {
        return {
            valid: false,
            code: 'OUT_OF_BOUNDS',
            message: `Serial ${parsed.serial} exceeds maximum allowed serial ${series.max_serial}.`,
        };
    }

    // Occupancy check
    const occ = await isReferenceOccupied(null, series.series_id, parsed.canonical, exclude_registry_id);
    if (occ.occupied) {
        return {
            valid: false,
            code: occ.state === 'SPOILED' ? 'RECEIPT_NUMBER_SPOILED' : 'RECEIPT_NUMBER_TAKEN',
            message: `Physical receipt number ${parsed.canonical} is already ${occ.state.toLowerCase()}.`,
            canonical: parsed.canonical,
            serial: parsed.serial,
        };
    }

    // Tax compatibility check (if lines provided)
    if (Array.isArray(lines_tax_rate_ids) && lines_tax_rate_ids.length > 0) {
        const { rows: allowedTaxRows } = await db.query(
            `SELECT tax_rate_id FROM public.physical_document_series_tax WHERE series_id = $1`,
            [series_id]
        );
        const allowedIds = new Set(allowedTaxRows.map(r => r.tax_rate_id));
        for (const tid of lines_tax_rate_ids) {
            if (tid != null && !allowedIds.has(tid)) {
                return {
                    valid: false,
                    code: 'RECEIPT_TAX_INCOMPATIBLE',
                    message: `Line tax rate ID ${tid} is not allowed for series ${series.name}.`,
                    canonical: parsed.canonical,
                    serial: parsed.serial,
                };
            }
        }
    }

    // Compare with suggestion token
    let isSuggested = false;
    let originalSuggestion = null;
    let exceptionRequired = false;

    if (suggestion_token) {
        const decoded = verifySuggestionToken(suggestion_token, employee_id);
        if (decoded && decoded.series_id === series.series_id) {
            originalSuggestion = decoded.canonical_reference;
            if (decoded.canonical_reference === parsed.canonical) {
                isSuggested = true;
            } else {
                exceptionRequired = true;
            }
        }
    }

    return {
        valid: true,
        canonical: parsed.canonical,
        serial: parsed.serial,
        prefix: parsed.prefix,
        is_suggested: isSuggested,
        original_suggestion: originalSuggestion,
        exception_required: exceptionRequired,
    };
}

/**
 * Atomic Cashier Posting Transaction Step
 * Must be called INSIDE an existing pg client transaction.
 */
async function postPhysicalDocument(client, {
    recording_method = 'PAPER',
    series_id = null,
    physical_receipt_no = null,
    suggestion_token = null,
    exception = null,
    source_type, // 'INVOICE' | 'CUSTOMER_PAYMENT' | 'COLLECTION_GROUP'
    source_id,
    employee_id,
    workstation_id = 'default',
    context = 'POS',
    request_id = null,
    lines_tax_rate_ids = [],
}) {
    // 1. Notebook branch
    if (recording_method === 'NOTEBOOK') {
        if (employee_id) {
            await client.query(
                `INSERT INTO public.physical_document_last_success
                 (employee_id, workstation_id, context, last_series_id, recording_method, last_type_code, last_issuance_id, issued_at)
                 VALUES ($1, $2, $3, NULL, 'NOTEBOOK', 'NOTEBOOK', $4, CURRENT_TIMESTAMP)
                 ON CONFLICT (employee_id, workstation_id, context)
                 DO UPDATE SET last_series_id = NULL,
                               recording_method = 'NOTEBOOK',
                               last_type_code = 'NOTEBOOK',
                               last_issuance_id = EXCLUDED.last_issuance_id,
                               issued_at = CURRENT_TIMESTAMP`,
                [employee_id, workstation_id, context, `${source_type ? source_type.toLowerCase() : 'notebook'}:${source_id || ''}`]
            );
        }
        return {
            recording_method: 'NOTEBOOK',
            series_id: null,
            registry_id: null,
            canonical_full_reference: null,
            serial_number: null,
        };
    }

    if (recording_method !== 'PAPER') {
        const err = new Error(`Invalid recording_method: ${recording_method}`);
        err.statusCode = 400;
        err.code = 'INVALID_RECORDING_METHOD';
        throw err;
    }

    if (!series_id || !physical_receipt_no) {
        const err = new Error('Both series_id and physical_receipt_no are required for paper issuance.');
        err.statusCode = 422;
        err.code = 'RECEIPT_ASSIGNMENT_REQUIRED';
        throw err;
    }

    // 2. Deterministic lock on series
    const { rows: seriesRows } = await client.query(
        `SELECT * FROM public.physical_document_series WHERE series_id = $1 FOR UPDATE`,
        [series_id]
    );
    if (seriesRows.length === 0 || !seriesRows[0].is_active) {
        const err = new Error('Physical document series not found or inactive.');
        err.statusCode = 409;
        err.code = 'SERIES_CHANGED';
        throw err;
    }
    const series = seriesRows[0];

    // 3. Format and parse
    const parsed = parseReferenceComponents(physical_receipt_no);
    if (!parsed || parsed.serial == null) {
        const err = new Error('Invalid physical receipt number format.');
        err.statusCode = 400;
        err.code = 'INVALID_FORMAT';
        throw err;
    }

    if (parsed.prefix !== series.prefix.toUpperCase()) {
        const err = new Error(`Submitted prefix ${parsed.prefix} does not match configured series prefix ${series.prefix}.`);
        err.statusCode = 400;
        err.code = 'PREFIX_MISMATCH';
        throw err;
    }

    if (series.min_serial != null && parsed.serial < parseInt(series.min_serial, 10)) {
        const err = new Error(`Serial ${parsed.serial} is below minimum allowed ${series.min_serial}.`);
        err.statusCode = 400;
        err.code = 'OUT_OF_BOUNDS';
        throw err;
    }
    if (series.max_serial != null && parsed.serial > parseInt(series.max_serial, 10)) {
        const err = new Error(`Serial ${parsed.serial} exceeds maximum allowed ${series.max_serial}.`);
        err.statusCode = 409;
        err.code = 'SERIES_EXHAUSTED';
        throw err;
    }

    // 4. Tax compatibility under lock
    if (Array.isArray(lines_tax_rate_ids) && lines_tax_rate_ids.length > 0) {
        const { rows: allowedTaxRows } = await client.query(
            `SELECT tax_rate_id FROM public.physical_document_series_tax WHERE series_id = $1`,
            [series_id]
        );
        const allowedIds = new Set(allowedTaxRows.map(r => r.tax_rate_id));
        for (const tid of lines_tax_rate_ids) {
            if (tid != null && !allowedIds.has(tid)) {
                const err = new Error(`Tax rate ${tid} is not permitted for series ${series.name}.`);
                err.statusCode = 422;
                err.code = 'RECEIPT_TAX_INCOMPATIBLE';
                throw err;
            }
        }
    }

    // 5. Check occupancy of entered reference under lock
    const occ = await isReferenceOccupied(client, series.series_id, parsed.canonical);
    if (occ.occupied) {
        const err = new Error(`Physical receipt number ${parsed.canonical} is already ${occ.state.toLowerCase()}.`);
        err.statusCode = 409;
        err.code = occ.state === 'SPOILED' ? 'RECEIPT_NUMBER_SPOILED' : 'RECEIPT_NUMBER_TAKEN';
        throw err;
    }

    // 6. Handle exception & spoilage of original suggestion if applicable
    if (suggestion_token) {
        const decoded = verifySuggestionToken(suggestion_token, employee_id);
        if (decoded && decoded.canonical_reference !== parsed.canonical) {
            if (!exception || !exception.reason) {
                const err = new Error('Receipt exception reason is required when deviating from suggested number.');
                err.statusCode = 422;
                err.code = 'RECEIPT_EXCEPTION_REQUIRED';
                throw err;
            }

            if (!['NEW_BOOKLET', 'SPOILED_SUGGESTION', 'OTHER_NOT_SPOILED'].includes(exception.reason)) {
                const err = new Error(`Invalid exception reason: ${exception.reason}`);
                err.statusCode = 400;
                err.code = 'INVALID_EXCEPTION_REASON';
                throw err;
            }

            if (exception.reason === 'SPOILED_SUGGESTION') {
                const spoiledRef = formatPhysicalReceiptNumber(exception.spoiled_reference || decoded.canonical_reference);
                if (spoiledRef !== decoded.canonical_reference) {
                    const err = new Error('Spoiled reference must match the original suggested reference.');
                    err.statusCode = 400;
                    err.code = 'SPOILED_TARGET_MISMATCH';
                    throw err;
                }

                // Check if original suggestion was concurrently occupied
                const spoiledOcc = await isReferenceOccupied(client, series.series_id, spoiledRef);
                if (spoiledOcc.occupied) {
                    const err = new Error(`Original suggestion ${spoiledRef} was concurrently issued or spoiled. Please refresh.`);
                    err.statusCode = 409;
                    err.code = 'RECEIPT_DECISION_STALE';
                    throw err;
                }

                const spoiledSerial = parseReferenceComponents(spoiledRef).serial;

                // Insert spoiled registry entry
                const { rows: spoiledRows } = await client.query(
                    `INSERT INTO public.physical_document_registry
                     (series_id, canonical_full_reference, serial_number, state, request_id, created_by, updated_by)
                     VALUES ($1, $2, $3, 'SPOILED', $4, $5, $5)
                     RETURNING registry_id`,
                    [series.series_id, spoiledRef, spoiledSerial, request_id, employee_id]
                );

                // Log spoilage event
                await client.query(
                    `INSERT INTO public.physical_document_event
                     (series_id, registry_id, request_id, event_type, original_suggestion, submitted_reference, reason, notes, actor_id)
                     VALUES ($1, $2, $3, 'SPOILED', $4, $5, $6, $7, $8)`,
                    [series.series_id, spoiledRows[0].registry_id, request_id, 'SPOILED',
                     spoiledRef, parsed.canonical, exception.reason, exception.notes || null, employee_id]
                );
            }
        }
    }

    // 7. Insert ISSUED row into physical_document_registry
    const { rows: regRows } = await client.query(
        `INSERT INTO public.physical_document_registry
         (series_id, canonical_full_reference, serial_number, state, request_id, created_by, updated_by)
         VALUES ($1, $2, $3, 'ISSUED', $4, $5, $5)
         RETURNING registry_id`,
        [series.series_id, parsed.canonical, parsed.serial, request_id, employee_id]
    );
    const registryId = regRows[0].registry_id;

    // 8. Insert physical_document_source_link
    let invoiceId = null;
    let paymentId = null;
    let collectionGroupId = null;

    if (source_type === 'INVOICE') invoiceId = source_id;
    else if (source_type === 'CUSTOMER_PAYMENT') paymentId = source_id;
    else if (source_type === 'COLLECTION_GROUP') collectionGroupId = source_id;

    await client.query(
        `INSERT INTO public.physical_document_source_link
         (registry_id, source_type, invoice_id, payment_id, collection_group_id, role)
         VALUES ($1, $2, $3, $4, $5, 'PRIMARY')`,
        [registryId, source_type, invoiceId, paymentId, collectionGroupId]
    );

    // 9. Update series sequence pointers & version
    const newHighWater = Math.max(
        series.high_water_serial != null ? parseInt(series.high_water_serial, 10) : 0,
        parsed.serial
    );
    const newLastIssued = parsed.serial;

    await client.query(
        `UPDATE public.physical_document_series
         SET high_water_serial = $1,
             last_issued_serial = $2,
             version = version + 1,
             updated_at = CURRENT_TIMESTAMP,
             updated_by = $3
         WHERE series_id = $4`,
        [newHighWater, newLastIssued, employee_id, series.series_id]
    );

    // 10. Update last_success preference for cashier + workstation + context
    if (employee_id) {
        const { rows: tRows } = await client.query(`SELECT code FROM public.physical_document_type WHERE type_id = $1`, [series.type_id]);
        const seriesTypeCode = tRows[0]?.code || null;

        await client.query(
            `INSERT INTO public.physical_document_last_success
             (employee_id, workstation_id, context, last_series_id, recording_method, last_type_code, last_issuance_id, issued_at)
             VALUES ($1, $2, $3, $4, 'PAPER', $5, $6, CURRENT_TIMESTAMP)
             ON CONFLICT (employee_id, workstation_id, context)
             DO UPDATE SET last_series_id = EXCLUDED.last_series_id,
                           recording_method = 'PAPER',
                           last_type_code = EXCLUDED.last_type_code,
                           last_issuance_id = EXCLUDED.last_issuance_id,
                           issued_at = CURRENT_TIMESTAMP`,
            [employee_id, workstation_id, context, series.series_id, seriesTypeCode, `${source_type.toLowerCase()}:${source_id}`]
        );
    }

    // 11. Append ISSUED audit event
    await client.query(
        `INSERT INTO public.physical_document_event
         (series_id, registry_id, source_type, source_id, request_id, event_type, original_suggestion, submitted_reference, reason, actor_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [series.series_id, registryId, source_type, source_id, request_id,
         'ISSUED', exception?.original_suggestion || parsed.canonical, parsed.canonical, exception?.reason || 'SUGGESTION_ACCEPTED', employee_id]
    );

    return {
        recording_method: 'PAPER',
        series_id: series.series_id,
        type_id: series.type_id,
        registry_id: registryId,
        canonical_full_reference: parsed.canonical,
        serial_number: parsed.serial,
    };
}

module.exports = {
    signSuggestionToken,
    verifySuggestionToken,
    parseReferenceComponents,
    isReferenceOccupied,
    getSuggestion,
    getOptions,
    validateReference,
    postPhysicalDocument,
};
