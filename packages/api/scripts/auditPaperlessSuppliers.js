'use strict';

// Read-only audit. On the host: node packages/api/scripts/auditPaperlessSuppliers.js --host 127.0.0.1
require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env'), quiet: true });
const { Client } = require('pg');
const { listAllPaperlessObjects, listDocuments } = require('../services/paperlessService');
const { normalizePartyName, normalizeReceiptIdentifier } = require('../helpers/paperlessMatching');

async function main() {
    const hostIndex = process.argv.indexOf('--host');
    const client = new Client({
        host: hostIndex >= 0 ? process.argv[hostIndex + 1] : process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });
    await client.connect();
    try {
        const [{ rows: suppliers }, correspondents, types, { rows: receipts }] = await Promise.all([
            client.query('SELECT supplier_id, supplier_name, is_active, is_merged FROM supplier ORDER BY supplier_name'),
            listAllPaperlessObjects('correspondents'),
            listAllPaperlessObjects('document_types'),
            client.query(`SELECT gr.grn_id, gr.grn_number,
                COALESCE(NULLIF(gr.physical_receipt_no, ''), gr.supplier_invoice_no) AS receipt_no,
                s.supplier_id, s.supplier_name FROM goods_receipt gr JOIN supplier s USING (supplier_id)
                WHERE gr.status <> 'Voided' AND gr.workflow_status = 'Posted' ORDER BY gr.grn_id`),
        ]);
        const partyMatch = (s, c) => normalizePartyName(s.supplier_name) === normalizePartyName(c.name);
        const matches = suppliers.flatMap(s => correspondents.filter(c => partyMatch(s, c))
            .map(c => ({ supplier_id: s.supplier_id, supplier: s.supplier_name, correspondent_id: c.id, correspondent: c.name })));
        const goodsTypes = types.filter(t => normalizePartyName(t.name) === normalizePartyName('Goods Receipt'));
        if (goodsTypes.length !== 1) throw new Error('Expected one unambiguous Goods Receipt document type');
        const documents = [];
        let page = 1;
        let data;
        do {
            data = await listDocuments({ documentTypeId: goodsTypes[0].id, pageSize: 100, page: page++ });
            documents.push(...(data.results || []));
        } while (data.next);
        const receiptAudit = receipts.map(r => {
            const parties = correspondents.filter(c => partyMatch(r, c));
            const key = normalizeReceiptIdentifier(r.receipt_no);
            const docs = key && parties.length === 1 ? documents.filter(d =>
                d.document_type === goodsTypes[0].id && d.correspondent === parties[0].id &&
                normalizeReceiptIdentifier(d.title) === key) : [];
            return { ...r, document_ids: docs.map(d => d.id), status: !key ? 'missing_receipt_number' :
                parties.length !== 1 ? 'unmatched_or_ambiguous_supplier' :
                    docs.length === 1 ? 'matched' : docs.length > 1 ? 'ambiguous_documents' : 'document_not_found' };
        });
        const report = {
            checked_at: new Date().toISOString(),
            summary: {
                suppliers: suppliers.length, correspondents: correspondents.length, normalized_pairs: matches.length,
                goods_receipt_documents: documents.length,
                goods_receipt_documents_without_correspondent: documents.filter(d => !d.correspondent).length,
                active_posted_grns: receipts.length,
                grn_match_statuses: receiptAudit.reduce((counts, r) => ({ ...counts, [r.status]: (counts[r.status] || 0) + 1 }), {}),
            },
            matches,
            suppliers_without_correspondent: suppliers.filter(s => !correspondents.some(c => partyMatch(s, c))),
            correspondents_without_supplier: correspondents.filter(c => !suppliers.some(s => partyMatch(s, c)))
                .map(({ id, name }) => ({ id, name })),
            goods_receipts_without_correspondent: documents.filter(d => !d.correspondent).map(({ id, title }) => ({ id, title })),
            receipt_audit: receiptAudit,
        };
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } finally {
        await client.end();
    }
}

main().catch(err => { console.error(err.message); process.exitCode = 1; });
