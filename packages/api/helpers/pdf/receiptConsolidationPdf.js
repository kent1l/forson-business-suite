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
 * Render 2x2 grid HTML pages for embedding directly into documents (like SOA)
 */
function renderReceiptGridPagesHtml(items = [], options = {}) {
    const formattedItems = (items || []).map(item => {
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

    const chunks = [];
    if (formattedItems.length > 0) {
        for (let i = 0; i < formattedItems.length; i += 4) {
            chunks.push(formattedItems.slice(i, i + 4));
        }
    }

    if (chunks.length === 0) return '';

    return chunks.map((chunk, pageIdx) => {
        const slotsHtml = [];
        for (let i = 0; i < 4; i++) {
            const item = chunk[i];
            if (item && item.src) {
                slotsHtml.push(`
                    <div style="border: 1px solid #CBD5E1; border-radius: 6px; padding: 8px; background: #ffffff; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; height: 100%; box-sizing: border-box;">
                        <div style="flex: 1; display: flex; align-items: center; justify-content: center; background: #F8FAFC; border-radius: 4px; border: 1px dashed #E2E8F0; overflow: hidden; padding: 4px; max-height: calc(100% - 42px);">
                            <img src="${item.src}" style="max-width: 100%; max-height: 100%; object-fit: contain; display: block;" alt="${item.physReceiptNo}" />
                        </div>
                        <div style="margin-top: 6px; padding-top: 4px; border-top: 1px solid #E2E8F0; display: flex; flex-direction: column; justify-content: center;">
                            <div style="font-size: 11px; font-weight: 700; color: #0F172A; letter-spacing: 0.2px; line-height: 1.2;">${item.physReceiptNo}</div>
                            <div style="font-size: 9.5px; font-family: monospace; color: #475569; margin-top: 2px; line-height: 1.2;">${item.systemCode}</div>
                        </div>
                    </div>
                `);
            } else if (item) {
                slotsHtml.push(`
                    <div style="border: 1px solid #CBD5E1; border-radius: 6px; padding: 8px; background: #ffffff; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; height: 100%; box-sizing: border-box;">
                        <div style="flex: 1; display: flex; align-items: center; justify-content: center; background: #F8FAFC; border-radius: 4px; border: 1px dashed #E2E8F0; overflow: hidden; padding: 4px; max-height: calc(100% - 42px);">
                            <span style="font-size: 11px; color: #64748B;">No Image Preview</span>
                        </div>
                        <div style="margin-top: 6px; padding-top: 4px; border-top: 1px solid #E2E8F0; display: flex; flex-direction: column; justify-content: center;">
                            <div style="font-size: 11px; font-weight: 700; color: #0F172A; letter-spacing: 0.2px; line-height: 1.2;">${item.physReceiptNo}</div>
                            <div style="font-size: 9.5px; font-family: monospace; color: #475569; margin-top: 2px; line-height: 1.2;">${item.systemCode}</div>
                        </div>
                    </div>
                `);
            } else {
                slotsHtml.push(`
                    <div style="border: 1.5px dashed #CBD5E1; background: #F8FAFC; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #94A3B8; font-size: 11px; font-weight: 600; letter-spacing: 0.5px; height: 100%; box-sizing: border-box;">
                        <span>— EMPTY SLOT —</span>
                    </div>
                `);
            }
        }

        return `
            <div style="page-break-before: always; padding-top: 6px;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1E40AF; padding-bottom: 6px; margin-bottom: 12px;">
                    <div style="font-size: 13px; font-weight: 700; color: #0F172A; text-transform: uppercase; letter-spacing: 0.5px;">Statement Appendix: Verified Physical Receipts</div>
                    <div style="font-size: 10px; font-weight: 600; color: #475569;">Appendix Page ${pageIdx + 1} of ${chunks.length}</div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 6mm; height: 235mm; box-sizing: border-box;">
                    ${slotsHtml.join('')}
                </div>
            </div>
        `;
    }).join('\n');
}

module.exports = { generateReceiptConsolidationPDF, renderReceiptGridPagesHtml };

