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

    // Sort items A-Z by physical receipt number / title
    const sortedRawItems = [...(items || [])].sort((a, b) => {
        const titleA = String(a.physical_receipt_no || a.title || '').trim();
        const titleB = String(b.physical_receipt_no || b.title || '').trim();
        return titleA.localeCompare(titleB, undefined, { numeric: true, sensitivity: 'base' });
    });

    const formattedItems = sortedRawItems.map(item => {
        let src = item.imageDataUri || '';
        if (!src && item.imageBuffer && Buffer.isBuffer(item.imageBuffer)) {
            const buf = item.imageBuffer;
            let mime = buf.contentType || '';

            if (!mime || mime === 'application/octet-stream') {
                if (buf[0] === 0xff && buf[1] === 0xd8) mime = 'image/jpeg';
                else if (buf[0] === 0x89 && buf[1] === 0x50) mime = 'image/png';
                else if (buf[0] === 0x52 && buf[1] === 0x49) mime = 'image/webp'; // RIFF (WebP)
                else if (buf[0] === 0x47 && buf[1] === 0x49) mime = 'image/gif';
                else mime = 'image/webp'; // Paperless default thumbnail mime
            }
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
                    <div class="empty-tile"></div>
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
            margin: { top: '10mm', right: '10mm', bottom: '16mm', left: '10mm' }
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

/**
 * Render 2x2 grid tile rows for embedding directly into documents (like SOA)
 * Uses a fixed tile row height budget of 122mm per 2-tile row with break-inside: avoid.
 * Allows receipt tiles to flow into remaining blank space on the prior SOA text page if space permits.
 */
function renderReceiptGridPagesHtml(items = [], options = {}) {
    const sortedRawItems = [...(items || [])].sort((a, b) => {
        const titleA = String(a.physical_receipt_no || a.title || '').trim();
        const titleB = String(b.physical_receipt_no || b.title || '').trim();
        return titleA.localeCompare(titleB, undefined, { numeric: true, sensitivity: 'base' });
    });

    const formattedItems = sortedRawItems.map(item => {
        let src = item.imageDataUri || '';
        if (!src && item.imageBuffer && Buffer.isBuffer(item.imageBuffer)) {
            const buf = item.imageBuffer;
            let mime = buf.contentType || '';

            if (!mime || mime === 'application/octet-stream') {
                if (buf[0] === 0xff && buf[1] === 0xd8) mime = 'image/jpeg';
                else if (buf[0] === 0x89 && buf[1] === 0x50) mime = 'image/png';
                else if (buf[0] === 0x52 && buf[1] === 0x49) mime = 'image/webp';
                else if (buf[0] === 0x47 && buf[1] === 0x49) mime = 'image/gif';
                else mime = 'image/webp';
            }
            src = `data:${mime};base64,${buf.toString('base64')}`;
        }

        const physReceiptNo = item.physical_receipt_no || item.title || (item.paperless_id ? `Paperless #${item.paperless_id}` : 'Physical Receipt');
        const systemCode = item.system_code || item.reference_id || item.primary_ref || (item.paperless_id ? `Doc ID: ${item.paperless_id}` : 'ERP System Code');

        return { src, physReceiptNo, systemCode };
    });

    if (formattedItems.length === 0) return '';

    // Group items into pairs of 2 for 2-tile rows (fixed height budget: 122mm per row)
    const rows = [];
    for (let i = 0; i < formattedItems.length; i += 2) {
        rows.push(formattedItems.slice(i, i + 2));
    }

    const rowsHtml = rows.map(row => {
        const slotsHtml = [];
        for (let i = 0; i < 2; i++) {
            const item = row[i];
            if (item && item.src) {
                slotsHtml.push(`
                    <div class="receipt-tile-card">
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
                    <div class="receipt-tile-card">
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
                slotsHtml.push(`<div class="empty-tile"></div>`);
            }
        }

        return `<div class="receipt-tile-row">${slotsHtml.join('')}</div>`;
    }).join('\n');

    return `<div class="receipt-section">${rowsHtml}</div>`;
}


module.exports = { generateReceiptConsolidationPDF, renderReceiptGridPagesHtml };

