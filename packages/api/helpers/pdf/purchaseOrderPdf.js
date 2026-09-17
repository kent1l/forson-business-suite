const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));

/** A missing price must look unknown, never like a free item. */
const formatCurrency = (value) => {
    const amount = Number(value);
    if (value === null || value === undefined || value === '' || !Number.isFinite(amount) || amount === 0) {
        return '<span class="price-unavailable">—</span>';
    }
    return `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Chromium renders these counters reliably; CSS @page counters do not work in
// Puppeteer's print pipeline and previously produced the misleading "0 of 0".
const pageFooterTemplate = `
  <div style="width:100%; font-family:Arial,Helvetica,sans-serif; font-size:8px; color:#6B7280; text-align:center;">
    Page <span class="pageNumber"></span> of <span class="totalPages"></span>
  </div>`;

const generatePurchaseOrderPDF = async (poData, linesData, options = {}) => {
    const debugPrefix = '[PO-PDF]';
    const templatePath = path.join(__dirname, '../../templates/pdf/purchase-order.html');
    let html = fs.readFileSync(templatePath, 'utf8');
    console.log(`${debugPrefix} template loaded from: ${templatePath}`);

    // A cost can be absent on historic/imported lines. Keep that distinction in
    // the document instead of displaying a misleading zero price.
    const lines = linesData.map(line => ({
        display_name: line.display_name || '',
        quantity: Number(line.quantity) || 0,
        unit: line.unit || '',
        cost_price: line.cost_price,
    }));

    // Format dates
    const po = {
        ...poData,
        order_date: poData.order_date ? new Date(poData.order_date).toLocaleDateString() : '',
        expected_date: poData.expected_date ? new Date(poData.expected_date).toLocaleDateString() : '',
    };

    // Format line items into HTML
    const lineItemsHtml = lines.map(line => `
        <tr>
            <td>${escapeHtml(line.display_name)}</td>
            <td class="text-right">${escapeHtml(line.quantity)}${line.unit ? ` ${escapeHtml(line.unit)}` : ''}</td>
            <td class="text-right">${formatCurrency(line.cost_price)}</td>
        </tr>
    `).join('');

    // Format notes section
    const notesHtml = po.notes ? `
        <div class="notes">
            <h3 class="notes-title">Notes</h3>
            <p class="notes-content">${escapeHtml(po.notes)}</p>
        </div>
    ` : '';

    // Replace template variables
    const company = options.company || {};
    const replacements = {
        '{{po.po_number}}': po.po_number,
        '{{po.supplier_name}}': po.supplier_name,
        '{{po.address}}': po.address || '',
        '{{po.contact_email}}': po.contact_email || '',
        '{{po.order_date}}': po.order_date,
        '{{po.expected_date}}': po.expected_date,
        '{{po.employee_name}}': po.employee_name,
        '{{lines}}': lineItemsHtml,
        '{{total_amount}}': formatCurrency(po.total_amount),
        '{{notes}}': notesHtml,
        '{{company.name}}': company.name || '',
        '{{company.address}}': company.address || '',
        '{{company.phone}}': company.phone || '',
        '{{company.email}}': company.email || '',
        '{{company.website}}': company.website || ''
    };

    Object.entries(replacements).forEach(([key, value]) => {
        html = html.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
    });

    const outDir = options.outputDir || os.tmpdir();
    const safePoNumber = String(po.po_number || poData.po_id || Date.now()).replace(/[^A-Za-z0-9_-]/g, '_');
    const outputPath = path.join(outDir, `po_${safePoNumber}.pdf`);

    let browser;
    try {
        const execPath = process.env.PUPPETEER_EXECUTABLE_PATH;
        if (execPath) {
            console.log(`${debugPrefix} Using Chromium at: ${execPath}`);
        } else {
            console.log(`${debugPrefix} No PUPPETEER_EXECUTABLE_PATH set; using bundled Chromium if available`);
        }

        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: execPath || undefined,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium']
        });
        const page = await browser.newPage();
        console.log(`${debugPrefix} Setting HTML content (length=${html.length})`);
        await page.setContent(html, { waitUntil: 'networkidle0' });
        console.log(`${debugPrefix} Generating PDF to: ${outputPath}`);
        await page.pdf({
            path: outputPath,
            printBackground: true,
            format: 'A4',
            displayHeaderFooter: true,
            headerTemplate: '<div></div>',
            footerTemplate: pageFooterTemplate,
            margin: { top: '10mm', right: '10mm', bottom: '16mm', left: '10mm' }
        });
        await page.close();
        console.log(`${debugPrefix} PDF generated successfully`);
        return outputPath;
    } catch (error) {
        console.error(`${debugPrefix} PDF Generation Error:`, error && error.stack ? error.stack : error);
        throw error;
    } finally {
        if (browser) {
            try { await browser.close(); } catch { /* noop */ }
        }
    }
};

module.exports = { generatePurchaseOrderPDF, formatCurrency, pageFooterTemplate };
