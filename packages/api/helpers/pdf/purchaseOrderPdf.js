const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');

const generatePurchaseOrderPDF = async (poData, linesData, options = {}) => {
    const debugPrefix = '[PO-PDF]';
    const templatePath = path.join(__dirname, '../../templates/pdf/purchase-order.html');
    let html = fs.readFileSync(templatePath, 'utf8');
    console.log(`${debugPrefix} template loaded from: ${templatePath}`);

    // Calculate data for template
    // Build minimal lines array (only display_name and quantity)
    const lines = linesData.map(line => ({
        display_name: line.display_name,
        quantity: Number(line.quantity)
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
            <td>${line.display_name}</td>
            <td class="text-right">${line.quantity}</td>
        </tr>
    `).join('');

    // Format notes section
    const notesHtml = po.notes ? `
        <div class="notes">
            <h3 class="notes-title">Notes</h3>
            <p class="notes-content">${po.notes}</p>
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
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
        });
        await page.close();
        console.log(`${debugPrefix} PDF generated successfully`);
        return outputPath;
    } catch (error) {
        console.error(`${debugPrefix} PDF Generation Error:`, error && error.stack ? error.stack : error);
        throw error;
    } finally {
        if (browser) {
            try { await browser.close(); } catch (_) {}
        }
    }
};

module.exports = { generatePurchaseOrderPDF };
