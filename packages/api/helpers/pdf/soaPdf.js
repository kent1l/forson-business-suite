'use strict';

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');

const fmt = (v) => `₱${(Number(v) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatDate = (d) => (d ? new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: '2-digit' }) : '—');

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

    const customerName = customerData.company_name
        || `${customerData.first_name || ''} ${customerData.last_name || ''}`.trim()
        || 'Valued Customer';

    // Build ledger rows HTML — now includes type label, due date, and payment channel sub-row detail
    const rowsHtml = (ledgerRows || []).map(row => {
        const typeLabel = row.type_label || row.event_type || '-';
        const descParts = [row.description || typeLabel];
        if (row.due_date) descParts.push(`Due: ${formatDate(row.due_date)}`);
        if (row.payment_channel) descParts.push(`Via: ${row.payment_channel.toUpperCase()}`);
        if (row.invoice_terms) descParts.push(`Terms: ${row.invoice_terms}`);
        if (row.cn_number) descParts.push(`CN: ${row.cn_number}`);

        const descHtml = `<span style="font-size:10px;font-weight:600;color:#1E293B;">${typeLabel}</span>`
            + (descParts.length > 1
                ? `<br/><span style="font-size:9px;color:#64748B;">${descParts.slice(1).join(' &nbsp;|&nbsp; ')}</span>`
                : '');

        const debitBold = row.debit_amount ? ' font-bold' : '';
        const creditColor = row.credit_amount ? ' color:#059669;' : '';

        return `
        <tr>
            <td>${formatDate(row.date)}</td>
            <td class="font-mono">${row.reference || row.document_number || '-'}</td>
            <td>${descHtml}</td>
            <td class="text-right font-mono${debitBold}">${row.debit_amount ? fmt(row.debit_amount) : '—'}</td>
            <td class="text-right font-mono" style="${creditColor}">${row.credit_amount ? fmt(row.credit_amount) : '—'}</td>
            <td class="text-right font-mono font-bold">${fmt(row.running_balance)}</td>
        </tr>`;
    }).join('');

    // Pending cheques footnote — shown below the ledger table
    const pendingTotal = parseFloat(options.pendingChequeTotal || 0);
    const pendingCount = options.pendingChequeCount || 0;
    const pendingChequeNote = pendingTotal > 0
        ? `<div style="margin-top:8px;padding:8px 12px;background:#FFF7ED;border:1px solid #FED7AA;border-radius:4px;font-size:10px;color:#92400E;">
             <strong>⏳ Pending Cheques:</strong> ${pendingCount} cheque(s) totalling <strong>${fmt(pendingTotal)}</strong> have been received but not yet cleared.
             These are committed against invoice balances but are <em>not yet reflected in the cash AR balance above</em> until bank clearance.
           </div>`
        : '';

    // Aging \u2014 agingSummary uses snake_case column names from the SQL query
    const agingCurrent   = agingSummary?.current        || agingSummary?.['current']       || 0;
    const aging1to30     = agingSummary?.days_1_30      || agingSummary?.['days1to30']      || 0;
    const aging31to60    = agingSummary?.days_31_60     || agingSummary?.['days31to60']     || 0;
    const aging61to90    = agingSummary?.days_61_90     || agingSummary?.['days61to90']     || 0;
    const aging90plus    = agingSummary?.days_90_plus   || agingSummary?.['days90plus']     || 0;
    const agingTotal     = parseFloat(agingCurrent) + parseFloat(aging1to30) + parseFloat(aging31to60) + parseFloat(aging61to90) + parseFloat(aging90plus);

    const replacements = {
        '{{company.name}}':              company.name,
        '{{company.address}}':           company.address,
        '{{company.phone}}':             company.phone,
        '{{company.email}}':             company.email,
        '{{statement.date}}':            formatDate(options.statementDate || new Date()),
        '{{statement.period}}':          `${formatDate(options.startDate)} – ${formatDate(options.endDate)}`,
        '{{customer.name}}':             customerName,
        '{{customer.company_name}}':     customerData.company_name || '',
        '{{customer.address}}':          customerData.address || 'N/A',
        '{{customer.phone}}':            customerData.phone || 'N/A',
        '{{customer.email}}':            customerData.email || 'N/A',
        '{{customer.credit_limit}}':     fmt(customerData.credit_limit || 0),
        '{{customer.credit_hold_status}}': customerData.credit_hold ? `ON HOLD${customerData.credit_hold_reason ? ' — ' + customerData.credit_hold_reason : ''}` : 'CLEAR / ACTIVE',
        '{{customer.credit_hold_color}}': customerData.credit_hold ? '#DC2626' : '#059669',
        '{{customer.wallet_balance}}':   fmt(customerData.wallet_balance || 0),
        '{{customer.payment_terms}}':    customerData.payment_terms || 'N/A',
        '{{summary.opening_balance}}':   fmt(options.openingBalance || 0),
        '{{summary.total_invoiced}}':    fmt(options.totalInvoiced || 0),
        '{{summary.total_settled}}':     fmt(options.totalSettled || 0),
        '{{summary.net_balance}}':       fmt(options.closingBalance || 0),
        '{{ledger_rows}}':               rowsHtml || `<tr><td colSpan="6" style="text-align:center;color:#94A3B8;">No transaction activity in the selected period.</td></tr>`,
        '{{pending_cheque_note}}':       pendingChequeNote,
        '{{aging.current}}':             fmt(agingCurrent),
        '{{aging.days_1_30}}':           fmt(aging1to30),
        '{{aging.days_31_60}}':          fmt(aging31to60),
        '{{aging.days_61_90}}':          fmt(aging61to90),
        '{{aging.days_90_plus}}':        fmt(aging90plus),
        '{{aging.total}}':               fmt(agingTotal),
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
