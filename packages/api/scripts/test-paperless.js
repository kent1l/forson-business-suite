'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const paperlessService = require('../services/paperlessService');
const { generateReceiptConsolidationPDF } = require('../helpers/pdf/receiptConsolidationPdf');
const fs = require('fs');

async function main() {
    console.log('=== Testing 2x2 PDF Generation with Paperless /thumb/ Artifacts ===');
    const docs = await paperlessService.listDocuments({ pageSize: 4 });
    if (!docs?.results?.length) {
        console.log('No documents found.');
        return;
    }

    const receiptItems = [];
    for (const doc of docs.results) {
        console.log(`Fetching /thumb/ artifact for Document #${doc.id} ("${doc.title}")...`);
        const imgBuf = await paperlessService.downloadDocumentArtifact(doc.id, 'thumb');
        console.log(`  Buffer size: ${imgBuf.length} bytes, Content-Type: ${imgBuf.contentType}`);
        
        receiptItems.push({
            imageBuffer: imgBuf,
            physical_receipt_no: doc.title,
            system_code: `INV-202608-${String(doc.id).padStart(4, '0')}`,
            paperless_id: doc.id,
            title: doc.title,
        });
    }

    const pdfBuffer = await generateReceiptConsolidationPDF(receiptItems, { returnBuffer: true });
    console.log(`\nSuccessfully generated 2x2 PDF! Size: ${pdfBuffer.length} bytes.`);
    
    const outPath = path.join(__dirname, 'sample_2x2_output.pdf');
    fs.writeFileSync(outPath, pdfBuffer);
    console.log(`Saved sample PDF to: ${outPath}`);
}

main().catch(err => {
    console.error('Test Error:', err);
    process.exit(1);
});
