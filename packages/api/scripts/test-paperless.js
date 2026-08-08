'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const paperlessService = require('../services/paperlessService');
const { generateStatementOfAccountPDF } = require('../helpers/pdf/soaPdf');
const fs = require('fs');

async function main() {
    console.log('=== Testing End-to-End SOA PDF Generation with Continuation Footer & 2x2 Receipts ===');
    
    // Fetch 4 real documents from Paperless
    const docs = await paperlessService.listDocuments({ pageSize: 4 });
    const receiptItems = [];
    if (docs?.results?.length) {
        for (const doc of docs.results) {
            const imgBuf = await paperlessService.downloadDocumentArtifact(doc.id, 'thumb');
            receiptItems.push({
                imageBuffer: imgBuf,
                physical_receipt_no: doc.title,
                system_code: `INV-202608-${String(doc.id).padStart(4, '0')}`,
                paperless_id: doc.id,
                title: doc.title,
            });
        }
    }

    const mockCustomer = {
        customer_id: 101,
        name: 'ACME Supermarket Trading Inc.',
        code: 'ACME-01',
        tin: '123-456-789-000',
        address: '123 Main Commercial Ave, Metro Manila',
        contact_person: 'John Doe',
        contact_number: '0917-123-4567',
        email: 'billing@acme.com',
        credit_limit: 500000,
        payment_terms: '30 Days Net',
        wallet_balance: 15000,
        credit_hold: false,
    };

    // Create 15 ledger rows to trigger multi-page table break
    const mockLedgerRows = [];
    for (let i = 1; i <= 15; i++) {
        mockLedgerRows.push({
            date: new Date(),
            invoice_date: new Date(),
            due_date: new Date(Date.now() + 30 * 24 * 3600 * 1000),
            primary_ref: `CI_${1600 + i}`,
            sub_ref: `INV-202608-0${500 + i}`,
            type_label: 'Sales Invoice',
            description: `Order #${1000 + i} Delivery - ${10 * i} cases commercial parts`,
            debit_amount: 15000 * i,
            credit_amount: null,
            running_balance: 15000 * i * ((i + 1) / 2),
        });
    }

    const mockAging = {
        current: 500000,
        days_1_30: 0,
        days_31_60: 0,
        days_61_90: 0,
        days_90_plus: 0,
    };

    const options = {
        company: {
            name: 'Forson Business Suite Inc.',
            address: '789 Enterprise Tower, Makati City',
            tin: '987-654-321-000',
        },
        statementNumber: 'SOA-202608-0001',
        statementDate: new Date(),
        startDate: new Date(Date.now() - 30 * 24 * 3600 * 1000),
        endDate: new Date(),
        openingBalance: 0,
        totalInvoiced: 500000,
        totalSettled: 0,
        closingBalance: 500000,
        includePaperlessReceipts: true,
        receiptItems,
    };

    console.log('Generating SOA PDF with 15 rows and receipt items...');
    const pdfPath = await generateStatementOfAccountPDF(mockCustomer, mockLedgerRows, mockAging, options);
    const pdfStats = fs.statSync(pdfPath);
    console.log(`Successfully generated SOA PDF at: ${pdfPath}`);
    console.log(`PDF File Size: ${pdfStats.size} bytes`);
}

main().catch(err => {
    console.error('Test Error:', err);
    process.exit(1);
});
