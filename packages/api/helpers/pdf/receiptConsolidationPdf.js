'use strict';

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Generates a 2x2 A4 printable PDF containing up to 4 receipts per page.
 *
 * @param {Array} items - List of receipt items:
 *   [{
 *      imageBuffer?: Buffer,
 *      imageDataUri?: string,
 *      physical_receipt_no?: string,
 *      system_code?: string,
 *      paperless_id?: number|string,
 *      title?: string
 *   }]
 * @param {Object} options - Custom options (outputDir, returnBuffer)
 * @returns {Promise<string|Buffer>} File path or PDF Buffer
 */
async function generateReceiptConsolidationPDF(items = [], options = {}) {
    const templatePath = path.join(__dirname, '../../templates/pdf/receipt-consolidation.html');
    let templateHtml = fs.readFileSync(templatePath, 'utf8');

    const formattedItems = (items || []).map(item => {
        let src = item.imageDataUri || '';
        if (!src && item.imageBuffer && Buffer.isBuffer(item.imageBuffer)) {
            // Detect mime type simple check
            const buf = item.imageBuffer;
            let mime = 'image/png';
            if (buf[0] === 0xff && buf[1] === 0xd8) mime = 'image/jpeg';
            else if (buf[0] === 0x47 && buf[1] === 0x49) mime = 'image/gif';
            else if (buf[0] === 0x25 && buf[1] === 0x50) mime = 'application/pdf'; // fallback
            src = `data:${mime};base64,${buf.toString('base64')}`;
        }

        const physReceiptNo = item.physical_receipt_no || item.title || (item.paperless_id ? `Paperless #${item.paperless_id}` : 'Physical Receipt');
        const systemCode = item.system_code || item.reference_id || item.primary_ref || (item.paperless_id ? `Doc ID: ${item.paperless_id}` : 'ERP System Code');

        return {
            src,
            physReceiptNo,
            systemCode,
        };
    });

    // Chunk items into batches of 4 per page
    const chunks = [];
    if (formattedItems.length === 0) {
        chunks.push([]);
    } else {
        for (let i = 0; i < formattedItems.length; i += 4) {
            chunks.push(formattedItems.slice(i, i + 4));
        }
    }

    const pagesHtml = chunks.map(chunk => {
        const slotsHtml = [];
        for (let i = 0; i < 4; i++) {
            const item = chunk[i];
            if (item && item.src) {
                slotsHtml.push(`
                    <div class="tile-card">
                        <div class="image-container">
                            <img src="${item.src}" class="receipt-image" alt="${item.physReceiptNo}" />
                        </div>
                        <div class="tile-footer">
                            <div class="phys-receipt-no">${item.physReceiptNo}</div>
                            <div class="system-code">${item.systemCode}</div>
                        </div>
                    </div>
                `);
            } else if (item) {
                slotsHtml.push(`
                    <div class="tile-card">
                        <div class="image-container">
                            <span style="font-size:11px;color:#64748b;">No Image Preview</span>
                        </div>
                        <div class="tile-footer">
                            <div class="phys-receipt-no">${item.physReceiptNo}</div>
                            <div class="system-code">${item.systemCode}</div>
                        </div>
                    </div>
                `);
            } else {
                slotsHtml.push(`
                    <div class="empty-card">
                        <span>— EMPTY SLOT —</span>
                    </div>
                `);
            }
        }

        return `<div class="a4-page">${slotsHtml.join('')}</div>`;
    }).join('\n');

    const finalHtml = templateHtml.replace('{{PAGE_SLOTS}}', pagesHtml);

    let browser;
    try {
        const execPath = process.env.PUPPETEER_EXECUTABLE_PATH;
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: execPath || undefined,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium']
        });
        const page = await browser.newPage();
        await page.setContent(finalHtml, { waitUntil: 'networkidle0' });

        const pdfBuffer = await page.pdf({
            printBackground: true,
            format: 'A4',
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
        });

        await page.close();

        if (options.returnBuffer) {
            return pdfBuffer;
        }

        const outDir = options.outputDir || os.tmpdir();
        const outputPath = path.join(outDir, `Receipt_Consolidation_${Date.now()}.pdf`);
        fs.writeFileSync(outputPath, pdfBuffer);
        return outputPath;
    } catch (error) {
        console.error('[ReceiptConsolidationPDF] Error generating PDF:', error);
        throw error;
    } finally {
        if (browser) {
            try { await browser.close(); } catch { /* noop */ }
        }
    }
}

module.exports = { generateReceiptConsolidationPDF };
