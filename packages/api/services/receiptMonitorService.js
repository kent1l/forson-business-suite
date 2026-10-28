'use strict';

const db = require('../db');
const { formatPhysicalReceiptNumber } = require('../helpers/receiptNumberFormatter');

function fail(message, statusCode = 400) { throw Object.assign(new Error(message), { statusCode }); }
const id = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) <= 2147483647;
// Mirrors numbered reference parsing without converting PostgreSQL BIGINT to JS Number.
function parse(reference) {
    const match = formatPhysicalReceiptNumber(reference)?.match(/^([A-Z]{1,10})\W*0*([0-9]+)$/);
    if (!match) fail('Enter a numbered receipt reference.');
    const serial = BigInt(match[2]);
    if (serial < 1n || serial > 9223372036854775807n) fail('Invalid receipt serial.');
    return { prefix: match[1], serial: String(serial), canonical: `${match[1]}-${serial}` };
}
async function seriesFor(runner, seriesId, reference, lock = false, requireBounds = true) {
    if (!id(seriesId)) fail('Invalid series.');
    const { rows: [series] } = await runner.query(`SELECT * FROM physical_document_series WHERE series_id = $1${lock ? ' FOR UPDATE' : ''}`, [seriesId]);
    if (!series) fail('Series not found.', 404);
    if (reference != null) {
        const parsed = parse(reference);
        if (parsed.prefix !== series.prefix.toUpperCase() || (requireBounds && (series.min_serial == null || series.max_serial == null))
            || (series.min_serial != null && BigInt(parsed.serial) < BigInt(series.min_serial))
            || (series.max_serial != null && BigInt(parsed.serial) > BigInt(series.max_serial))) fail('Reference is outside the configured series.');
    }
    return series;
}

// Sparse evidence only: pagination never expands the full booklet, even for BIGINT bounds.
async function evidence(runner, series) {
    const { rows } = await runner.query(`
        WITH transactions AS (
            SELECT 'INVOICE' AS type, invoice_id AS id, physical_receipt_no AS reference,
                physical_document_registry_id AS registry_id, physical_document_series_id AS series_id, NULL::int AS group_id, status = 'Cancelled' AS cancelled
            FROM invoice WHERE physical_receipt_no IS NOT NULL
            UNION ALL SELECT 'CUSTOMER_PAYMENT', payment_id, physical_receipt_no, physical_document_registry_id, physical_document_series_id, collection_group_id, false
            FROM customer_payment WHERE physical_receipt_no IS NOT NULL
            UNION ALL SELECT 'COLLECTION_GROUP', group_id, physical_receipt_no, physical_document_registry_id, physical_document_series_id, NULL::int, false
            FROM customer_payment_collection_group WHERE physical_receipt_no IS NOT NULL
        ), parsed AS (
            SELECT *, regexp_match(UPPER(TRIM(reference)), '^([A-Z]{1,10})[^A-Z0-9]*0*([0-9]+)$') AS parts FROM transactions
        )
        SELECT type, id, reference, registry_id, series_id, group_id, cancelled, ((parts)[2]::numeric)::text AS serial_number
        FROM parsed WHERE (parts)[1] = $1 AND (parts)[2]::numeric BETWEEN $2::numeric AND $3::numeric`,
    [series.prefix.toUpperCase(), series.min_serial ?? '1', series.max_serial ?? '9223372036854775807']);
    const { rows: registry } = await runner.query(`SELECT DISTINCT ON (serial_number) * FROM physical_document_registry
        WHERE series_id = $1 AND serial_number BETWEEN $2 AND $3
        ORDER BY serial_number, (state <> 'UNOCCUPIED') DESC, updated_at DESC, registry_id DESC`,
    [series.series_id, series.min_serial ?? '1', series.max_serial ?? '9223372036854775807']);
    const map = new Map();
    for (const record of registry) map.set(String(record.serial_number), { ...record, sources: [], candidates: [] });
    for (const tx of rows) {
        const row = map.get(tx.serial_number) || { serial_number: tx.serial_number, sources: [], candidates: [] };
        row.candidates.push(tx); map.set(tx.serial_number, row);
    }
    for (const row of map.values()) row.status = row.state && row.state !== 'UNOCCUPIED' ? row.state : row.candidates.length ? (row.candidates.every(tx => tx.cancelled) ? 'VOIDED' : 'ISSUED') : 'NO_RECORD';
    return map;
}
async function monitor({ series_id, page = 1, status = 'ALL' }, runner = db) {
    if (!/^\d+$/.test(String(page)) || BigInt(page) < 1n || BigInt(page) > 9223372036854775807n || !['ALL', 'ISSUED', 'SPOILED', 'VOIDED', 'NO_RECORD'].includes(status)) fail('Invalid page or status.');
    const series = await seriesFor(runner, series_id);
    if (series.min_serial == null || series.max_serial == null) return { needs_bounds: true, items: [], total: '0' };
    const min = BigInt(series.min_serial), max = BigInt(series.max_serial);
    if (min < 1n || max < min) fail('Series bounds are invalid.');
    const records = await evidence(runner, series);
    const occupied = [...records.entries()].filter(([, row]) => row.status !== 'NO_RECORD').sort(([a], [b]) => BigInt(a) < BigInt(b) ? -1 : 1);
    const offset = (BigInt(page) - 1n) * 25n;
    let total, serials = [];
    if (status === 'ALL') {
        total = max - min + 1n;
        for (let n = min + offset; n <= max && serials.length < 25; n++) serials.push(String(n));
    } else if (status === 'NO_RECORD') {
        total = max - min + 1n - BigInt(occupied.length);
        let cursor = min, skip = offset;
        for (const boundary of [...occupied.map(([serial]) => BigInt(serial)), max + 1n]) {
            const size = boundary - cursor;
            if (skip >= size) skip -= size;
            else {
                for (let n = cursor + skip; n < boundary && serials.length < 25; n++) serials.push(String(n));
                skip = 0n;
            }
            cursor = boundary + 1n;
            if (serials.length === 25) break;
        }
    } else {
        const filtered = occupied.filter(([, row]) => row.status === status);
        total = BigInt(filtered.length);
        if (offset < total) serials = filtered.slice(Number(offset), Number(offset) + 25).map(([serial]) => serial);
    }
    const references = serials.map(n => `${series.prefix.toUpperCase()}-${n}`);
    const { rows: flags } = await runner.query(`SELECT DISTINCT ON (submitted_reference) submitted_reference, event_id, event_type, reason
        FROM physical_document_event WHERE series_id = $1 AND submitted_reference = ANY($2::text[])
        AND event_type IN ('FOLLOW_UP', 'FOLLOW_UP_RESOLVED') ORDER BY submitted_reference, event_id DESC`, [series.series_id, references]);
    const { rows: links } = await runner.query(`SELECT l.*, COALESCE(l.invoice_id, l.payment_id, l.collection_group_id) AS id, l.source_type AS type,
        r.serial_number FROM physical_document_source_link l JOIN physical_document_registry r USING (registry_id)
        WHERE r.series_id = $1 AND r.serial_number = ANY($2::bigint[]) ORDER BY l.link_id`, [series.series_id, serials]);
    return { total: String(total), items: serials.map((serial, index) => {
        const row = records.get(serial) || { status: 'NO_RECORD', candidates: [] };
        const flag = flags.find(f => f.submitted_reference === references[index]);
        return { ...row, serial_number: serial, reference: references[index], sources: links.filter(l => String(l.serial_number) === serial),
            follow_up_id: flag?.event_type === 'FOLLOW_UP' ? flag.event_id : null,
            follow_up_reason: flag?.event_type === 'FOLLOW_UP' ? flag.reason : null };
    }) };
}
async function transaction(work) {
    const client = await db.getClient();
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (err) { await client.query('ROLLBACK'); if (['23505', '40P01', '40001'].includes(err.code)) fail('Receipt changed concurrently. Refresh and retry.', 409); throw err; }
    finally { client.release(); }
}
function reasonFor(value) {
    const reason = typeof value === 'string' ? value.trim() : '';
    if (reason.length < 5 || reason.length > 100) fail('Enter a reason between 5 and 100 characters.');
    return reason;
}
async function followUp(body, actorId) {
    if (body.resolve != null && typeof body.resolve !== 'boolean') fail('Invalid follow-up action.');
    const reason = reasonFor(body.reason), parsed = parse(body.reference);
    return transaction(async client => {
        const series = await seriesFor(client, body.series_id, parsed.canonical, true);
        const { rows: [latest] } = await client.query(`SELECT event_id, event_type FROM physical_document_event
            WHERE series_id = $1 AND submitted_reference = $2 AND event_type IN ('FOLLOW_UP', 'FOLLOW_UP_RESOLVED') ORDER BY event_id DESC LIMIT 1`, [series.series_id, parsed.canonical]);
        if (body.resolve) {
            if (latest?.event_type !== 'FOLLOW_UP' || latest.event_id !== body.expected_event_id) fail('Follow-up changed. Refresh and retry.', 409);
        } else {
            const record = (await evidence(client, series)).get(parsed.serial);
            if (record && record.status !== 'NO_RECORD') fail('This receipt is now occupied. Refresh before flagging it.', 409);
            if (latest?.event_type === 'FOLLOW_UP') fail('This receipt already has an open follow-up.', 409);
        }
        await client.query(`INSERT INTO physical_document_event (series_id, event_type, submitted_reference, reason, actor_id, before_state)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb)`, [series.series_id, body.resolve ? 'FOLLOW_UP_RESOLVED' : 'FOLLOW_UP', parsed.canonical, reason, actorId,
        JSON.stringify({ follow_up_event_id: latest?.event_id || null })]);
        return { message: body.resolve ? 'Follow-up resolved.' : 'Follow-up recorded.' };
    });
}
const sourceConfig = {
    INVOICE: { table: 'invoice', key: 'invoice_id', permission: 'invoice:edit_receipt_no', view: 'invoicing:create' },
    CUSTOMER_PAYMENT: { table: 'customer_payment', key: 'payment_id', permission: 'ar:receive_payment', view: 'ar:view' },
    COLLECTION_GROUP: { table: 'customer_payment_collection_group', key: 'group_id', permission: 'ar:receive_payment', view: 'ar:view' },
};
async function source(runner, type, sourceId, lock = false) {
    const config = Object.hasOwn(sourceConfig, type) ? sourceConfig[type] : null;
    if (!config || !id(sourceId)) fail('Invalid transaction.');
    const { rows: [record] } = await runner.query(`SELECT * FROM ${config.table} WHERE ${config.key} = $1${lock ? ' FOR UPDATE' : ''}`, [sourceId]);
    if (!record) fail('Transaction not found.', 404);
    return record;
}
async function reconcile(body, actorId) {
    const reason = reasonFor(body.reason), parsed = parse(body.reference), config = Object.hasOwn(sourceConfig, body.source_type) ? sourceConfig[body.source_type] : null;
    if (body.verified !== true || !config || !Object.hasOwn(body, 'expected_reference') || !Object.hasOwn(body, 'expected_registry_id')) fail('Review the transaction and confirm paper ownership first.');
    return transaction(async client => {
        // Same order as receipt corrections: transaction first, then series, then registry.
        const record = await source(client, body.source_type, body.source_id, true);
        if (record.physical_receipt_no !== body.expected_reference || record.physical_document_registry_id !== body.expected_registry_id
            || (body.source_type === 'INVOICE' && record.physical_receipt_version !== body.expected_version)) fail('Transaction changed. Review it again.', 409);
        if (record.physical_document_registry_id || (record.physical_receipt_no && parse(record.physical_receipt_no).canonical !== parsed.canonical)
            || record.status === 'Cancelled' || record.recording_method === 'NOTEBOOK' || record.collection_group_id) fail('Transaction already has another assignment, is grouped, voided or uses Notebook. Use its existing correction workflow.', 409);
        if (body.source_type === 'COLLECTION_GROUP') {
            const { rows: members } = await client.query('SELECT * FROM customer_payment WHERE collection_group_id=$1 ORDER BY payment_id FOR UPDATE', [body.source_id]);
            if (members.some(member => member.physical_document_registry_id || member.recording_method === 'NOTEBOOK'
                || (member.physical_receipt_no && parse(member.physical_receipt_no).canonical !== parsed.canonical))) fail('A group member has a conflicting paper assignment.', 409);
        }
        const series = await seriesFor(client, body.series_id, parsed.canonical, true);
        if (record.physical_document_series_id && record.physical_document_series_id !== series.series_id) fail('Transaction belongs to another series.', 409);
        const { rows: overlaps } = await client.query(`SELECT series_id FROM physical_document_series WHERE UPPER(prefix) = $1
            AND (min_serial IS NULL OR min_serial <= $2) AND (max_serial IS NULL OR max_serial >= $2)`, [parsed.prefix, parsed.serial]);
        if (overlaps.length !== 1) fail('Overlapping series make paper ownership ambiguous. Resolve the series configuration first.', 409);
        const row = (await evidence(client, series)).get(parsed.serial);
        if (row?.state && row.state !== 'UNOCCUPIED') fail('Receipt is occupied.', 409);
        if (row?.candidates.some(tx => !(tx.type === body.source_type && tx.id === Number(body.source_id))
            && !(body.source_type === 'COLLECTION_GROUP' && tx.type === 'CUSTOMER_PAYMENT' && tx.group_id === Number(body.source_id)))) fail('Multiple transactions claim this receipt. Resolve ownership first.', 409);
        const { rows: [type] } = await client.query('SELECT * FROM physical_document_type WHERE type_id = $1', [series.type_id]);
        const collection = body.source_type !== 'INVOICE';
        if (!series.is_active || !type.is_active || type.controlled_category === 'NOTEBOOK'
            || (collection ? type.controlled_category !== 'COLLECTION_RECEIPT' : type.controlled_category === 'COLLECTION_RECEIPT')) fail('Select an active series appropriate for this transaction.');
        if (!collection) {
            const { rows: invalidTax } = await client.query(`SELECT 1 FROM invoice_line il WHERE invoice_id = $1 AND tax_rate_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM physical_document_series_tax st WHERE st.series_id = $2 AND st.tax_rate_id = il.tax_rate_id) LIMIT 1`, [record.invoice_id, series.series_id]);
            if (invalidTax.length) fail('Invoice tax rates are incompatible with this series.');
        }
        const { rows: contexts } = await client.query(`SELECT 1 FROM physical_document_series_context WHERE series_id = $1 AND is_active
            AND context = ANY($2::text[])`, [series.series_id, collection ? ['COLLECTION'] : ['POS', 'INVOICING', 'CASHIER_APPROVAL']]);
        if (!contexts.length) fail('Series is not enabled for this transaction context.');
        const { rows: [registry] } = await client.query(`INSERT INTO physical_document_registry
            (series_id, canonical_full_reference, serial_number, state, created_by, updated_by) VALUES ($1,$2,$3,'ISSUED',$4,$4) RETURNING *`, [series.series_id, parsed.canonical, parsed.serial, actorId]);
        const column = { INVOICE: 'invoice_id', CUSTOMER_PAYMENT: 'payment_id', COLLECTION_GROUP: 'collection_group_id' }[body.source_type];
        await client.query(`INSERT INTO physical_document_source_link (registry_id, source_type, ${column}, role) VALUES ($1,$2,$3,'PRIMARY')`, [registry.registry_id, body.source_type, body.source_id]);
        await client.query(`UPDATE ${config.table} SET physical_receipt_no=$2, recording_method='PAPER', physical_document_type_id=$3,
            physical_document_series_id=$4, physical_document_registry_id=$5${collection ? '' : ', physical_receipt_version=physical_receipt_version+1'} WHERE ${config.key}=$1`,
        [body.source_id, parsed.canonical, series.type_id, series.series_id, registry.registry_id]);
        if (body.source_type === 'COLLECTION_GROUP') await client.query(`UPDATE customer_payment SET physical_receipt_no=$2,
            recording_method='PAPER', physical_document_type_id=$3, physical_document_series_id=$4, physical_document_registry_id=$5
            WHERE collection_group_id=$1`, [body.source_id, parsed.canonical, series.type_id, series.series_id, registry.registry_id]);
        await client.query(`UPDATE physical_document_series SET high_water_serial=GREATEST(COALESCE(high_water_serial,0),$2), version=version+1,
            updated_at=CURRENT_TIMESTAMP, updated_by=$3 WHERE series_id=$1`, [series.series_id, parsed.serial, actorId]);
        await client.query(`INSERT INTO physical_document_event (series_id,registry_id,source_type,source_id,event_type,submitted_reference,reason,actor_id,before_state,after_state)
            VALUES ($1,$2,$3,$4,'LEGACY_RECONCILED',$5,$6,$7,$8::jsonb,$9::jsonb)`, [series.series_id, registry.registry_id, body.source_type, body.source_id, parsed.canonical, reason, actorId,
        JSON.stringify({ reference: record.physical_receipt_no, registry_id: record.physical_document_registry_id }), JSON.stringify({ reference: parsed.canonical, registry_id: registry.registry_id, state: 'ISSUED' })]);
        return registry;
    });
}
module.exports = { monitor, evidence, seriesFor, parse, followUp, source, sourceConfig, reconcile, transaction };
