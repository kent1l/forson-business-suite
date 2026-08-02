const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');

const fmt = (v) => `₱${(Number(v) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatDate = (d) => (d ? new Date(d).toLocaleDateString('en-US') : 'N/A');

const generateStatementOfAccountPDF = async (customerData, ledgerRows, agingSummary, options = {}) => {
    const debugPrefix = '[SOA-PDF]';
    const templatePath = path.join(__dirname, '../../templates/pdf/statement-of-account.html');
    let html = fs.readFileSync(templatePath, 'utf8');

    const company = options.company || {
        name: 'Forson Auto Parts & Business Suite',
        address: 'Manila, Philippines',
        phone: '+63 2 8123 4567',
        email: 'billing@forson.ph'
    };

    const customerName = customerData.company_name || `${customerData.first_name || ''} ${customerData.last_name || ''}`.trim() || 'Valued Customer';
    
    // Build ledger rows HTML
    const rowsHtml = (ledgerRows || []).map(row => `
        <tr>
            <td>${formatDate(row.date)}</td>
            <td class="font-mono">${row.reference || row.document_number || '-'}</td>
            <td>${row.description || row.event_type || '-'}</td>
            <td class="text-right font-mono">${row.debit_amount ? fmt(row.debit_amount) : '-'}</td>
            <td class="text-right font-mono">${row.credit_amount ? fmt(row.credit_amount) : '-'}</td>
            <td class="text-right font-mono font-bold">${fmt(row.running_balance)}</td>
        </tr>
    `).join('');

    const replacements = {
        '{{company.name}}': company.name,
        '{{company.address}}': company.address,
        '{{company.phone}}': company.phone,
        '{{company.email}}': company.email,
        '{{statement.date}}': formatDate(options.statementDate || new Date()),
        '{{statement.period}}': `${formatDate(options.startDate)} - ${formatDate(options.endDate)}`,
        '{{customer.name}}': customerName,
        '{{customer.company_name}}': customerData.company_name || '',
        '{{customer.address}}': customerData.address || 'N/A',
        '{{customer.phone}}': customerData.phone || 'N/A',
        '{{customer.email}}': customerData.email || 'N/A',
        '{{customer.credit_limit}}': fmt(customerData.credit_limit || 0),
        '{{customer.credit_hold_status}}': customerData.credit_hold ? 'ON HOLD' : 'CLEAR / ACTIVE',
        '{{customer.credit_hold_color}}': customerData.credit_hold ? '#DC2626' : '#059669',
        '{{customer.wallet_balance}}': fmt(customerData.wallet_balance || 0),
        '{{summary.opening_balance}}': fmt(options.openingBalance || 0),
        '{{summary.total_invoiced}}': fmt(options.totalInvoiced || 0),
        '{{summary.total_settled}}': fmt(options.totalSettled || 0),
        '{{summary.net_balance}}': fmt(options.closingBalance || 0),
        '{{ledger_rows}}': rowsHtml || `<tr><td colSpan="6" style="text-align:center;">No transaction activity in selected period.</td></tr>`,
        '{{aging.current}}': fmt(agingSummary?.current || 0),
        '{{aging.days_1_30}}': fmt(agingSummary?.days1to30 || agingSummary?.['1-30'] || 0),
        '{{aging.days_31_60}}': fmt(agingSummary?.days31to60 || agingSummary?.['31-60'] || 0),
        '{{aging.days_61_90}}': fmt(agingSummary?.days61to90 || agingSummary?.['61-90'] || 0),
        '{{aging.days_90_plus}}': fmt(agingSummary?.days90plus || agingSummary?.['90-plus'] || 0),
        '{{aging.total}}': fmt(options.closingBalance || 0)
    };

    Object.entries(replacements).forEach(([key, value]) => {
        html = html.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
    });

    const outDir = options.outputDir || os.tmpdir();
    const safeCustName = String(customerName).replace(/[^A-Za-z0-9_-]/g, '_');
    const outputPath = path.join(outDir, `SOA_${safeCustName}_${Date.now()}.pdf`);

    let browser;
    try {
        const execPath = process.env.PUPPETEER_EXECUTABLE_PATH;
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: execPath || undefined,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium']
        });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        await page.pdf({
            path: outputPath,
            printBackground: true,
            format: 'A4',
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
        });
        await page.close();
        return outputPath;
    } catch (error) {
        console.error(`${debugPrefix} Error generating SOA PDF:`, error);
        throw error;
    } finally {
        if (browser) {
            try { await browser.close(); } catch { /* noop */ }
        }
    }
};

module.exports = { generateStatementOfAccountPDF };
