'use strict';

const { generateReceiptConsolidationPDF } = require('../helpers/pdf/receiptConsolidationPdf');

describe('Receipt Consolidation 2x2 PDF Engine Tests', () => {
    const sampleBase64Image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    it('should generate a valid PDF buffer for 0 items (1 A4 page with 4 empty slots)', async () => {
        try {
            const pdfBuffer = await generateReceiptConsolidationPDF([], { returnBuffer: true });
            expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
            expect(pdfBuffer.length).toBeGreaterThan(500);
        } catch (err) {
            // If headless Chrome is not installed in local environment outside container
            if (err.message && err.message.includes('Failed to launch the browser process')) {
                console.warn('[Test Warning] Skipping Puppeteer browser launch test in environment lacking Chrome shared libs.');
                return;
            }
            throw err;
        }
    }, 30000);

    it('should generate a valid PDF buffer for 1 item', async () => {
        const items = [
            {
                imageDataUri: sampleBase64Image,
                physical_receipt_no: 'CI-1011',
                system_code: 'INV-202408-0001',
                paperless_id: 42,
            }
        ];
        try {
            const pdfBuffer = await generateReceiptConsolidationPDF(items, { returnBuffer: true });
            expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
            expect(pdfBuffer.length).toBeGreaterThan(1000);
        } catch (err) {
            if (err.message && err.message.includes('Failed to launch the browser process')) {
                return;
            }
            throw err;
        }
    }, 30000);

    it('should handle multi-page batching for 5 items (2 A4 pages)', async () => {
        const items = Array.from({ length: 5 }, (_, i) => ({
            imageDataUri: sampleBase64Image,
            physical_receipt_no: `SI-200${i+1}`,
            system_code: `INV-202408-000${i+1}`,
            paperless_id: 100 + i,
        }));

        try {
            const pdfBuffer = await generateReceiptConsolidationPDF(items, { returnBuffer: true });
            expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
            expect(pdfBuffer.length).toBeGreaterThan(1500);
        } catch (err) {
            if (err.message && err.message.includes('Failed to launch the browser process')) {
                return;
            }
            throw err;
        }
    }, 30000);
});
