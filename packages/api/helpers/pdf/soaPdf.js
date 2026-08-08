'use strict';

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { generateReceiptConsolidationPDF } = require('./receiptConsolidationPdf');

const fmt = (v) => `₱${(Number(v) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;


const formatDate = (d) => (d ? new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: '2-digit' }) : '—');


async function stampGlobalFooter(pdfDoc, companyName, statementNumber) {
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const totalPages = pdfDoc.getPageCount();

    const leftText = `${companyName ? companyName + '   •   ' : ''}Statement of Account (${statementNumber || 'SOA'})`;

    for (let i = 0; i < totalPages; i++) {
        const page = pdfDoc.getPage(i);
        const { width } = page.getSize();

        const leftMargin = 28.35; // 10mm
        const rightMargin = width - 28.35;
        const lineY = 36;
        const textY = 22;

        page.drawLine({
            start: { x: leftMargin, y: lineY },
            end: { x: rightMargin, y: lineY },
            thickness: 0.75,
            color: rgb(0.88, 0.91, 0.94),
        });

        page.drawText(leftText, {
            x: leftMargin,
            y: textY,
            size: 8.5,
            font: font,
            color: rgb(0.39, 0.45, 0.54),
        });

        const pageStr = `Page ${i + 1} of ${totalPages}`;
        const pageStrWidth = fontBold.widthOfTextAtSize(pageStr, 8.5);
        page.drawText(pageStr, {
            x: rightMargin - pageStrWidth,
            y: textY,
            size: 8.5,
            font: fontBold,
            color: rgb(0.20, 0.25, 0.33),
        });
    }
}


const generateStatementOfAccountPDF = async (customerData, ledgerRows, agingSummary, options = {}) => {
    const debugPrefix = '[SOA-PDF]';
    const templatePath = path.join(__dirname, '../../templates/pdf/statement-of-account.html');
    let html = fs.readFileSync(templatePath, 'utf8');

    const company = options.company || {};
    const companyName = company.name || 'Statement of Account';

    // 1. Company Header Line 1 (Address & TIN)
    const headerLine1Parts = [];
    if (company.address) headerLine1Parts.push(company.address);
    if (company.tin) {
        const rawTin = String(company.tin).replace(/^TIN:\s*/i, '');
        if (rawTin) headerLine1Parts.push(`TIN: ${rawTin}`);
    }
    const companyHeaderLine1Html = headerLine1Parts.length > 0
        ? `<p>${headerLine1Parts.join(' &nbsp;|&nbsp; ')}</p>`
        : '';

    // 2. Company Header Line 2 (Phone, Email, Website)
    const headerLine2Parts = [];
    if (company.phone) headerLine2Parts.push(`Phone: ${company.phone}`);
    if (company.email) headerLine2Parts.push(`Email: ${company.email}`);
    if (company.website) headerLine2Parts.push(`Web: ${company.website}`);
    const companyHeaderLine2Html = headerLine2Parts.length > 0
        ? `<p>${headerLine2Parts.join(' &nbsp;|&nbsp; ')}</p>`
        : '';

    // 3. Customer Info Block Details
    const custCodeTinParts = [`Account Code: <strong style="font-family:monospace;">CUST-${customerData.customer_id || '0'}</strong>`];
    if (customerData.tin || customerData.tax_id) {
        custCodeTinParts.push(`TIN: <strong>${customerData.tin || customerData.tax_id}</strong>`);
    }
    const custCodeTinHtml = `<p>${custCodeTinParts.join(' &nbsp;|&nbsp; ')}</p>`;

    const custAddressHtml = customerData.address ? `<p>Billing Address: ${customerData.address}</p>` : '';

    const custContactParts = [];
    if (customerData.phone) custContactParts.push(`Phone: ${customerData.phone}`);
    if (customerData.email) custContactParts.push(`Email: ${customerData.email}`);
    const custContactHtml = custContactParts.length > 0 ? `<p>${custContactParts.join(' &nbsp;|&nbsp; ')}</p>` : '';

    const custSinceHtml = (customerData.date_created || customerData.created_at)
        ? `<p style="font-size: 9px; color: #64748B; margin-top: 2px;">Member Since: ${formatDate(customerData.date_created || customerData.created_at)}</p>`
        : '';

    // 4. Remittance & Payment Instructions Block
    const bankParts = [];
    if (company.bank_name && company.bank_account) {
        bankParts.push(`Bank: <strong>${company.bank_name}</strong> | Account #: <strong>${company.bank_account}</strong>`);
    } else if (company.bank_name) {
        bankParts.push(`Bank: <strong>${company.bank_name}</strong>`);
    } else if (company.bank_account) {
        bankParts.push(`Account #: <strong>${company.bank_account}</strong>`);
    }

    const payableLine = companyName
        ? `Please make checks payable to <strong>${companyName}</strong>${bankParts.length > 0 ? ' or transfer directly to:' : '.'}`
        : (bankParts.length > 0 ? 'Please transfer directly to:' : '');

    const bankLine = bankParts.length > 0 ? `<br/>${bankParts.join('<br/>')}` : '';
    const emailLine = company.email ? `<br/>For billing inquiries & official proof of transfers, email: <strong>${company.email}</strong>.` : '';

    const remittanceAdviceHtml = `<div>
        <strong>Remittance Advice & Payment Instructions:</strong><br/>
        ${payableLine}${bankLine}${emailLine}
    </div>`;

    const customerName = customerData.company_name
        || `${customerData.first_name || ''} ${customerData.last_name || ''}`.trim()
        || 'Valued Customer';

    const statementNumber = options.statementNumber || `SOA-${customerData.customer_id || '0'}-${Date.now().toString().slice(-6)}`;

    // Build ledger rows HTML — bank SOA includes Opening Balance row at the start of the table
    const itemRows = (ledgerRows || []).map(row => {
        const typeLabel = row.type_label || row.event_type || '-';
        const descParts = [row.description || typeLabel];
        if (row.payment_channel) descParts.push(`Via: ${row.payment_channel.toUpperCase()}`);
        if (row.invoice_terms) descParts.push(`Terms: ${row.invoice_terms}`);
        if (row.cn_number) descParts.push(`CN: ${row.cn_number}`);

        const descHtml = `<span style="font-size:10px;font-weight:600;color:#1E293B;">${typeLabel}</span>`
            + (descParts.length > 1
                ? `<br/><span style="font-size:9px;color:#64748B;">${descParts.slice(1).join(' &nbsp;|&nbsp; ')}</span>`
                : '');

        const debitBold = row.debit_amount ? ' font-bold' : '';
        const creditColor = row.credit_amount ? ' color:#059669;' : '';

        const primaryDoc = row.primary_ref || row.physical_receipt_no || '-';
        const subDoc = row.sub_ref || null;

        const docCellHtml = subDoc
            ? `<div class="font-mono font-bold" style="font-size:10px;color:#0F172A;">${primaryDoc}</div><div class="font-mono" style="font-size:8.5px;color:#64748B;font-weight:normal;margin-top:1px;">${subDoc}</div>`
            : `<div class="font-mono font-bold" style="font-size:10px;color:#0F172A;">${primaryDoc}</div>`;



        return `
        <tr>
            <td>${formatDate(row.date)}</td>
            <td>${formatDate(row.due_date)}</td>
            <td>${docCellHtml}</td>
            <td>${descHtml}</td>
            <td class="text-right font-mono${debitBold}">${row.debit_amount ? fmt(row.debit_amount) : '—'}</td>
            <td class="text-right font-mono" style="${creditColor}">${row.credit_amount ? fmt(row.credit_amount) : '—'}</td>
            <td class="text-right font-mono font-bold">${fmt(row.running_balance)}</td>
        </tr>`;
    });

    // Opening Balance row as first line item in the details table
    const openingBalanceRow = `
    <tr style="background-color: #F8FAFC; font-weight: 600;">
        <td>${formatDate(options.startDate)}</td>
        <td>—</td>
        <td class="font-mono">—</td>
        <td><span style="font-size:10px;font-weight:700;color:#1E293B;">OPENING BALANCE BROUGHT FORWARD</span></td>
        <td class="text-right font-mono">—</td>
        <td class="text-right font-mono">—</td>
        <td class="text-right font-mono font-bold">${fmt(options.openingBalance || 0)}</td>
    </tr>`;

    const rowsHtml = openingBalanceRow + itemRows.join('');

    // Pending cheques breakdown table — shown below the main ledger table
    const pendingTotal = parseFloat(options.pendingChequeTotal || 0);
    const pendingCount = options.pendingChequeCount || 0;
    const pendingItems = options.pendingCheques || [];

    let pendingChequeSection = '';
    if (pendingTotal > 0) {
        const itemRowsHtml = pendingItems.map(item => `
            <tr>
                <td>${formatDate(item.cheque_date)}</td>
                <td class="font-mono">${item.reference_number || '-'}</td>
                <td>${item.payment_method_name || 'Bank Instrument'}</td>
                <td class="text-center"><span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:9px;font-weight:600;background:#FEF3C7;color:#92400E;">${item.pdc_status}</span></td>
                <td class="text-right font-mono font-bold">${fmt(item.amount)}</td>
            </tr>
        `).join('');

        pendingChequeSection = `
        <div style="margin-top:16px;padding:12px;background:#FFF7ED;border:1px solid #FED7AA;border-radius:6px;">
            <div style="font-size:11px;font-weight:700;color:#92400E;margin-bottom:6px;display:flex;justify-content:space-between;">
                <span>⏳ FLOATING COLLECTIONS / UNCLEARED DEPOSITS (${pendingCount} Items)</span>
                <span>Total: ${fmt(pendingTotal)}</span>
            </div>
            <p style="font-size:9.5px;color:#78350F;margin:0 0 8px 0;">
                The following cheques have been received and committed against invoices, but remain pending bank clearance. They will be added to cash balances upon clearance.
            </p>
            <table style="margin-bottom:0;background:#FFF;">
                <thead>
                    <tr style="background:#FFEDD5;">
                        <th style="font-size:9px;color:#92400E;">Maturity Date</th>
                        <th style="font-size:9px;color:#92400E;">Cheque / Ref #</th>
                        <th style="font-size:9px;color:#92400E;">Drawee Bank</th>
                        <th style="font-size:9px;color:#92400E;text-align:center;">Status</th>
                        <th style="font-size:9px;color:#92400E;text-align:right;">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemRowsHtml}
                </tbody>
            </table>
        </div>`;
    }

    // Aging — agingSummary uses snake_case column names from the SQL query
    const agingCurrent   = agingSummary?.current        || agingSummary?.['current']       || 0;
    const aging1to30     = agingSummary?.days_1_30      || agingSummary?.['days1to30']      || 0;
    const aging31to60    = agingSummary?.days_31_60     || agingSummary?.['days31to60']     || 0;
    const aging61to90    = agingSummary?.days_61_90     || agingSummary?.['days61to90']     || 0;
    const aging90plus    = agingSummary?.days_90_plus   || agingSummary?.['days90plus']     || 0;
    const agingTotal     = parseFloat(agingCurrent) + parseFloat(aging1to30) + parseFloat(aging31to60) + parseFloat(aging61to90) + parseFloat(aging90plus);

    const replacements = {
        '{{company.name}}':              companyName,
        '{{company.header_line1_html}}': companyHeaderLine1Html,
        '{{company.header_line2_html}}': companyHeaderLine2Html,
        '{{statement.number}}':          statementNumber,
        '{{statement.date}}':            formatDate(options.statementDate || new Date()),
        '{{statement.period}}':          `${formatDate(options.startDate)} – ${formatDate(options.endDate)}`,
        '{{customer.id}}':               `CUST-${customerData.customer_id || '0'}`,
        '{{customer.name}}':             customerName,
        '{{customer.code_tin_html}}':    custCodeTinHtml,
        '{{customer.address_html}}':     custAddressHtml,
        '{{customer.contact_html}}':     custContactHtml,
        '{{customer.since_html}}':       custSinceHtml,
        '{{customer.credit_limit}}':     fmt(customerData.credit_limit || 0),
        '{{customer.credit_hold_status}}': customerData.credit_hold ? `ON HOLD${customerData.credit_hold_reason ? ' — ' + customerData.credit_hold_reason : ''}` : 'CLEAR / ACTIVE',
        '{{customer.credit_hold_color}}': customerData.credit_hold ? '#DC2626' : '#059669',
        '{{customer.wallet_balance}}':   fmt(customerData.wallet_balance || 0),
        '{{customer.payment_terms}}':    customerData.payment_terms || company.default_terms || '30 Days Net',
        '{{summary.opening_balance}}':   fmt(options.openingBalance || 0),
        '{{summary.total_invoiced}}':    fmt(options.totalInvoiced || 0),
        '{{summary.total_settled}}':     fmt(options.totalSettled || 0),
        '{{summary.net_balance}}':       fmt(options.closingBalance || 0),
        '{{ledger_rows}}':               rowsHtml,
        '{{pending_cheque_note}}':       pendingChequeSection,
        '{{aging.current}}':             fmt(agingCurrent),
        '{{aging.days_1_30}}':           fmt(aging1to30),
        '{{aging.days_31_60}}':          fmt(aging31to60),
        '{{aging.days_61_90}}':          fmt(aging61to90),
        '{{aging.days_90_plus}}':        fmt(aging90plus),
        '{{aging.total}}':               fmt(agingTotal),
        '{{remittance_advice_html}}':    remittanceAdviceHtml,
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
            margin: { top: '10mm', right: '10mm', bottom: '18mm', left: '10mm' }
        });

        await page.close();

        const mainPdfBytes = fs.readFileSync(outputPath);
        const mainPdfDoc = await PDFDocument.load(mainPdfBytes);

        if (options.includePaperlessReceipts && Array.isArray(options.receiptItems) && options.receiptItems.length > 0) {
            try {
                const receiptsPdfBuffer = await generateReceiptConsolidationPDF(options.receiptItems, { returnBuffer: true });
                const receiptsPdfDoc = await PDFDocument.load(receiptsPdfBuffer);

                const copiedPages = await mainPdfDoc.copyPages(receiptsPdfDoc, receiptsPdfDoc.getPageIndices());
                copiedPages.forEach(p => mainPdfDoc.addPage(p));
            } catch (mergeErr) {
                console.error(`${debugPrefix} Warning: Failed to append Paperless receipt pages:`, mergeErr.message);
            }
        }

        // Stamp global footer on ALL pages (SOA text + receipt attachments) with total page count
        await stampGlobalFooter(mainPdfDoc, companyName, statementNumber);

        const finalPdfBytes = await mainPdfDoc.save();
        fs.writeFileSync(outputPath, finalPdfBytes);

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
