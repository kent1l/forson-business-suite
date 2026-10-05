#!/usr/bin/env node
// Read-only pre-rollout audit. Run against staging and production independently.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });
const { Client } = require('pg');
const policy = require('../services/masterDataMergePolicy');

const migrations = path.resolve(__dirname, '../../../database/migrations');
const entities = ['supplier', 'customer', 'brand', 'group'];
const quote = name => '"' + name.replace(/"/g, '""') + '"';
const draftFields = {
    supplier: new Set(['supplier_id', 'supplierId', 'selectedSupplier', 'freight_supplier_id', 'freightSupplierId']),
    customer: new Set(['customer_id', 'customerId', 'selectedCustomer']),
};

function walk(value, callback, location = '') {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
        const next = location ? `${location}.${key}` : key;
        callback(key, child, next);
        walk(child, callback, next);
    }
}

async function audit(client) {
    const report = { checkedAt: new Date().toISOString(), findings: {}, migrations: {}, policyDrift: [] };
    const add = (name, rows) => { report.findings[name] = rows; };
    const { rows: applied } = await client.query('SELECT filename, checksum FROM public.schema_migrations');
    const byName = new Map(applied.map(row => [row.filename, row.checksum]));
    for (const file of fs.readdirSync(migrations).filter(name => name.endsWith('.sql') && name.includes('master_data_merge'))) {
        const checksum = crypto.createHash('sha256').update(fs.readFileSync(path.join(migrations, file))).digest('hex');
        report.migrations[file] = !byName.has(file) ? 'pending' : byName.get(file) === checksum ? 'applied' : 'checksum_mismatch';
    }
    const { rows: [schema] } = await client.query("SELECT to_regclass('public.supplier_alias') IS NOT NULL AS ready");
    report.schemaReady = schema.ready;
    if (!schema.ready) return report;
    const retired = {};
    for (const entity of entities) {
        const table = quote(entity);
        const id = `${entity}_id`;
        const target = `merged_into_${id}`;
        const { rows: broken } = await client.query(`SELECT ${id} AS id, ${target} AS canonical_id, is_active
            FROM public.${table} WHERE is_merged AND is_active IS DISTINCT FROM FALSE ORDER BY ${id}`);
        add(`${entity}.activeMerged`, broken);
        const { rows: chains } = await client.query(`SELECT source.${id} AS id, source.${target} AS canonical_id
            FROM public.${table} source LEFT JOIN public.${table} canonical ON canonical.${id} = source.${target}
            WHERE source.is_merged AND (source.${target} = source.${id} OR canonical.${id} IS NULL
                OR canonical.is_merged OR canonical.is_active IS DISTINCT FROM TRUE) ORDER BY source.${id}`);
        add(`${entity}.invalidCanonical`, chains);
        retired[entity] = new Set((await client.query(`SELECT ${id} FROM public.${table} WHERE is_merged`))
            .rows.map(row => row[id]));
        for (const [child, column, action] of policy[entity].references) {
            if (action === 'provenance' || action === 'workflow') continue;
            const { rows } = await client.query(`SELECT r.${column} AS retired_id, COUNT(*)::int AS count
                FROM public.${quote(child)} r JOIN public.${table} source ON source.${id} = r.${column}
                WHERE source.is_merged GROUP BY r.${column} ORDER BY r.${column}`);
            add(`${entity}.${child}.${column}.retiredReferences`, rows);
        }
    }
    for (const field of ['supplier_invoice_no', 'physical_receipt_no']) {
        const extra = field === 'physical_receipt_no' ? `AND btrim(gr.${field}) <> ''` :
            "AND gr.workflow_status <> 'Cancelled'";
        const { rows } = await client.query(`SELECT source.merged_into_supplier_id AS canonical_id,
            gr.${field} AS document_number, array_agg(gr.grn_id ORDER BY gr.grn_id) AS receipt_ids
            FROM public.goods_receipt gr JOIN public.supplier source ON source.supplier_id = gr.supplier_id
            WHERE source.is_merged AND gr.${field} IS NOT NULL ${extra} AND gr.status <> 'Voided'
            GROUP BY source.merged_into_supplier_id, gr.${field}
            HAVING COUNT(*) > 1 OR EXISTS (SELECT 1 FROM public.goods_receipt other
                WHERE other.supplier_id = source.merged_into_supplier_id
                AND other.${field} = gr.${field} AND other.status <> 'Voided' ${field === 'supplier_invoice_no' ?
    "AND other.workflow_status <> 'Cancelled'" : ''})`);
        add(`supplier.${field}.candidateCollisions`, rows);
    }
    const { rows: certificates } = await client.query(`SELECT source.merged_into_customer_id AS canonical_id,
        c.certificate_type, c.certificate_no, array_agg(c.certificate_id) AS certificate_ids
        FROM public.withholding_tax_certificate c JOIN public.customer source ON source.customer_id = c.customer_id
        WHERE source.is_merged AND c.certificate_no IS NOT NULL
        GROUP BY source.merged_into_customer_id, c.certificate_type, c.certificate_no
        HAVING COUNT(*) > 1 OR EXISTS (SELECT 1 FROM public.withholding_tax_certificate other
            WHERE other.customer_id = source.merged_into_customer_id AND other.certificate_type = c.certificate_type
              AND other.certificate_no = c.certificate_no)`);
    add('customer.certificateCandidateCollisions', certificates);
    const { rows: wallets } = await client.query(`SELECT w.wallet_id, w.customer_id, w.balance,
        COALESCE(SUM(t.amount), 0) AS transaction_total,
        (array_agg(t.balance_after ORDER BY t.created_at DESC, t.transaction_id DESC))[1] AS last_balance
        FROM public.customer_wallet w LEFT JOIN public.customer_wallet_transaction t ON t.wallet_id = w.wallet_id
        GROUP BY w.wallet_id HAVING w.balance IS DISTINCT FROM COALESCE(SUM(t.amount), 0)
            OR w.balance IS DISTINCT FROM COALESCE((array_agg(t.balance_after ORDER BY t.created_at DESC,
                t.transaction_id DESC))[1], 0)`);
    add('customer.walletMismatches', wallets);
    const { rows: drafts } = await client.query(`SELECT draft_id, draft_name, draft_data FROM public.draft_transaction
        WHERE expires_at > CURRENT_TIMESTAMP ORDER BY draft_id`);
    const staleDrafts = [];
    for (const draft of drafts) walk(draft.draft_data, (key, value, location) => {
        for (const entity of ['supplier', 'customer']) {
            if (draftFields[entity].has(key) && retired[entity].has(Number(value))) {
                staleDrafts.push({ draft_id: draft.draft_id, draft_name: draft.draft_name,
                    entity, retired_id: Number(value), path: location });
            }
        }
    });
    add('activeDraftsWithRetiredIds', staleDrafts);
    const { rows: catalog } = await client.query(`SELECT parent.relname AS entity, child.relname AS table_name,
        attribute.attname AS column_name FROM pg_constraint fk
        JOIN pg_class child ON child.oid = fk.conrelid JOIN pg_namespace cn ON cn.oid = child.relnamespace
        JOIN pg_class parent ON parent.oid = fk.confrelid JOIN pg_namespace pn ON pn.oid = parent.relnamespace
        JOIN pg_attribute attribute ON attribute.attrelid = child.oid AND attribute.attnum = fk.conkey[1]
        WHERE fk.contype = 'f' AND cardinality(fk.conkey) = 1 AND cn.nspname = 'public'
          AND pn.nspname = 'public' AND parent.relname = ANY($1::text[])`, [entities]);
    const expected = new Set(entities.flatMap(entity => policy[entity].references.map(([table, column]) => `${entity}.${table}.${column}`)));
    const actual = new Set(catalog.map(row => `${row.entity}.${row.table_name}.${row.column_name}`));
    report.policyDrift = [...new Set([...expected, ...actual])].filter(key => !expected.has(key) || !actual.has(key))
        .map(key => ({ relationship: key, status: expected.has(key) ? 'missing_from_catalog' : 'missing_from_policy' }));
    return report;
}

async function main() {
    const client = new Client({ host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432,
        user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
    try {
        await client.connect();
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const report = await audit(client);
        await client.query('ROLLBACK');
        console.log(JSON.stringify(report, null, 2));
        if (!report.schemaReady || report.policyDrift.length || Object.values(report.findings).some(rows => rows.length) ||
            Object.values(report.migrations).some(status => status !== 'applied')) process.exitCode = 2;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(error);
        process.exitCode = 1;
    } finally { await client.end().catch(() => {}); }
}

if (require.main === module) main();
module.exports = { audit };
