'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const { getPaperlessConfig } = require('../config/paperlessConfig');
const paperlessService = require('../services/paperlessService');
const { generateReceiptConsolidationPDF } = require('../helpers/pdf/receiptConsolidationPdf');

async function main() {
    console.log('=== Paperless Configuration ===');
    const config = getPaperlessConfig();
    console.log('API URL:', config.apiUrl);
    console.log('API Token configured:', Boolean(config.apiToken));
    console.log('Timeout MS:', config.timeoutMs);
    console.log('Verify SSL:', config.verifySsl);

    console.log('\n=== Testing Connection Health ===');
    const health = await paperlessService.testConnection();
    console.log('Health Result:', JSON.stringify(health, null, 2));

    if (health.healthy) {
        console.log('\n=== Fetching Sample Documents ===');
        const docs = await paperlessService.listDocuments({ pageSize: 5 });
        console.log(`Found ${docs?.count || 0} total documents in Paperless.`);
        if (docs?.results?.length > 0) {
            docs.results.slice(0, 5).forEach(d => {
                console.log(` - ID #${d.id} | Title: "${d.title}" | Created: ${d.created}`);
            });
        }

        console.log('\n=== Testing Title Matching (CI-1616 vs CI_1616) ===');
        const matchHyphen = await paperlessService.findDocumentByReceiptNo('CI-1616');
        console.log('Search "CI-1616" -> Match:', matchHyphen ? `#${matchHyphen.id} "${matchHyphen.title}"` : 'NONE');

        const matchUnderscore = await paperlessService.findDocumentByReceiptNo('CI_1616');
        console.log('Search "CI_1616" -> Match:', matchUnderscore ? `#${matchUnderscore.id} "${matchUnderscore.title}"` : 'NONE');

        if (docs?.results?.length > 0) {
            console.log('\n=== Testing 2x2 PDF Consolidation Generation for top 4 receipts ===');
            const top4 = docs.results.slice(0, 4);
            const receiptItems = [];

            for (const doc of top4) {
                try {
                    console.log(`Fetching preview artifact for Document #${doc.id}...`);
                    const imgBuf = await paperlessService.downloadDocumentArtifact(doc.id, 'preview');
                    receiptItems.push({
                        imageBuffer: imgBuf,
                        physical_receipt_no: doc.title,
                        system_code: `INV-${doc.created ? doc.created.substring(0, 7).replace('-', '') : '202608'}-${String(doc.id).padStart(4, '0')}`,
                        paperless_id: doc.id,
                        title: doc.title,
                    });
                } catch (imgErr) {
                    console.error(`Failed preview fetch for #${doc.id}:`, imgErr.message);
                }
            }

            const pdfBuffer = await generateReceiptConsolidationPDF(receiptItems, { returnBuffer: true });
            console.log(`Successfully generated 2x2 A4 PDF! Size: ${pdfBuffer.length} bytes.`);
        }
    }
}

main().catch(err => {
    console.error('Fatal Test Error:', err);
    process.exit(1);
});
