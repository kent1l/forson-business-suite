'use strict';

/**
 * Collection Acknowledgement Receipt.
 *
 * FBS does not generate an Official Receipt and this is not one. The OR is a
 * pre-printed, BIR-registered book; `physical_receipt_no` is a number torn off
 * it. This document references that number rather than replacing it.
 *
 * The reason it exists at all is the concession. When a customer settles ₱12,800
 * with ₱12,000 in cash and ₱800 forgiven, three figures have to be legible and
 * un-confusable on one sheet:
 *
 *   * ₱12,800 credited to the account — what the invoice was closed for
 *   * ₱800 conceded — a balance forgiven, not money
 *   * ₱12,000 received in cash — and this is the only one the BIR OR may show
 *
 * Getting that wrong is not a cosmetic error. An OR that shows ₱12,800 received
 * declares ₱800 of receipts that never arrived. So the concession row is tinted,
 * labelled, kept out of the received total, and the received total is printed on
 * its own in a box that says what it is.
 *
 * Follows the puppeteer → pdf-lib pattern of soaPdf.js.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const fmt = (v) => `₱${(Number(v) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

const formatDate = (d) => (d
    ? new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: '2-digit' })
    : '—');

/** Template text is data from the database; none of it may become markup. */
const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

async function stampFooter(pdfDoc, companyName, reference) {
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const totalPages = pdfDoc.getPageCount();
    const leftText = `${companyName ? companyName + '   •   ' : ''}Collection Acknowledgement (${reference || '—'})`;

    for (let i = 0; i < totalPages; i++) {
        const page = pdfDoc.getPage(i);
        const { width } = page.getSize();
        const leftMargin = 34;
        const rightMargin = width - 34;

        page.drawLine({
            start: { x: leftMargin, y: 36 },
            end: { x: rightMargin, y: 36 },
            thickness: 0.75,
            color: rgb(0.88, 0.91, 0.94),
        });
        page.drawText(leftText, { x: leftMargin, y: 22, size: 8.5, font, color: rgb(0.39, 0.45, 0.54) });

        const pageStr = `Page ${i + 1} of ${totalPages}`;
        page.drawText(pageStr, {
            x: rightMargin - fontBold.widthOfTextAtSize(pageStr, 8.5),
            y: 22,
            size: 8.5,
            font: fontBold,
            color: rgb(0.20, 0.25, 0.33),
        });
    }
}

/**
 * @param {object} data
 * @param {object} data.company        { name, address, phone, email, tin }
 * @param {object} data.customer       { name, address, tin }
 * @param {object} data.payment        { reference, date, method_name, physical_receipt_no, received_by }
 * @param {Array}  data.applications   [{ invoice_number, particulars, amount }] — the invoices settled
 * @param {Array}  data.concessions    [{ adjustment_no, label, notes, amount }]
 * @param {number} [data.withheld]     tax withheld at source, if any
 * @param {number} data.cash           the money actually received
 * @param {object} [options]           { outputDir }
 */
async function generateCollectionReceiptPDF(data, options = {}) {
    const templatePath = path.join(__dirname, '..', '..', 'templates', 'pdf', 'collection-receipt.html');
    let html = fs.readFileSync(templatePath, 'utf8');

    const company = data.company || {};
    const customer = data.customer || {};
    const payment = data.payment || {};
    const applications = data.applications || [];
    const concessions = data.concessions || [];

    const cash = round2(data.cash);
    const withheld = round2(data.withheld);
    const concessionTotal = round2(concessions.reduce((s, c) => s + Number(c.amount || 0), 0));
    const credited = round2(applications.reduce((s, a) => s + Number(a.amount || 0), 0));

    const companyMeta = [company.address, company.phone, company.email, company.tin ? `TIN ${company.tin}` : null]
        .filter(Boolean).join('   •   ');
    const customerMeta = [customer.address, customer.tin ? `TIN ${customer.tin}` : null]
        .filter(Boolean).join('   •   ');

    const applicationRows = applications.map(a => `
        <tr>
            <td class="mono bold">${esc(a.invoice_number || '—')}</td>
            <td>${esc(a.particulars || 'Invoice settled')}</td>
            <td class="text-right mono">${fmt(a.amount)}</td>
        </tr>`).join('');

    // Printed as their own rows, immediately after the invoices they close, and
    // never folded into an invoice line. A reader has to be able to point at the
    // forgiven amount separately from the amount collected.
    const concessionRows = concessions.map(c => `
        <tr class="concession">
            <td class="mono bold">${esc(c.adjustment_no || '—')}</td>
            <td>
                ${esc(c.label || 'Settlement concession')}${c.notes ? ` &mdash; ${esc(c.notes)}` : ''}
                <span class="tag">NOT AN AMOUNT RECEIVED — BALANCE FORGIVEN</span>
            </td>
            <td class="text-right mono">${fmt(c.amount)}</td>
        </tr>`).join('');

    const emptyRow = applications.length === 0 && concessions.length === 0
        ? `<tr><td colspan="3" style="text-align:center;color:#94A3B8;">Nothing was applied to an invoice by this collection.</td></tr>`
        : '';

    const withholdingTotalRow = withheld > 0
        ? `<tr><td>Tax withheld at source</td><td class="text-right mono">${fmt(withheld)}</td></tr>`
        : '';
    const concessionTotalRow = concessionTotal > 0
        ? `<tr><td style="color:var(--concession-color);">Concession granted</td><td class="text-right mono" style="color:var(--concession-color);">${fmt(concessionTotal)}</td></tr>`
        : '';

    const orNote = payment.physical_receipt_no
        ? `<div class="or-note">Covered by Official Receipt No. <span class="or-no">${esc(payment.physical_receipt_no)}</span>,
             which shows the amount received in cash and nothing else.</div>`
        : `<div class="or-note">No Official Receipt number was recorded against this collection.</div>`;

    const footerNote = concessionTotal > 0
        ? 'A concession is a balance forgiven so an account can be settled. It is not money received, is not a refund, '
          + 'and carries no adjustment to output VAT: the sale stands at its full value for VAT and for revenue, and only '
          + 'its collectability changed. It can be reversed, in which case both this document and its reversal remain on '
          + 'the customer&rsquo;s statement.'
        : 'This acknowledgement records how a collection was applied across the customer&rsquo;s open invoices. '
          + 'It does not replace the Official Receipt.';

    const replacements = {
        '{{company.name}}':        esc(company.name || 'Collection Acknowledgement'),
        '{{company.meta}}':        esc(companyMeta),
        '{{customer.name}}':       esc(customer.name || 'Customer'),
        '{{customer.meta}}':       esc(customerMeta),
        '{{receipt.reference}}':   esc(payment.reference || '—'),
        '{{receipt.date}}':        formatDate(payment.date),
        '{{receipt.received_by}}': esc(payment.received_by || '—'),
        '{{application_rows}}':    applicationRows + concessionRows + emptyRow,
        '{{withholding_total_row}}': withholdingTotalRow,
        '{{concession_total_row}}':  concessionTotalRow,
        '{{totals.cash}}':         fmt(cash),
        '{{totals.credited}}':     fmt(credited),
        '{{or_note}}':             orNote,
        '{{footer_note}}':         footerNote,
    };

    Object.entries(replacements).forEach(([key, value]) => {
        html = html.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
    });

    const outDir = options.outputDir || os.tmpdir();
    const safeName = String(customer.name || 'Customer').replace(/[^A-Za-z0-9_-]/g, '_');
    const outputPath = path.join(outDir, `COLLECTION_${safeName}_${Date.now()}.pdf`);

    let browser;
    try {
        const execPath = process.env.PUPPETEER_EXECUTABLE_PATH;
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: execPath || undefined,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium'],
        });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        await page.pdf({
            path: outputPath,
            printBackground: true,
            format: 'A4',
            margin: { top: '12mm', right: '12mm', bottom: '18mm', left: '12mm' },
        });
        await page.close();

        const pdfDoc = await PDFDocument.load(fs.readFileSync(outputPath));
        await stampFooter(pdfDoc, company.name, payment.reference);
        fs.writeFileSync(outputPath, await pdfDoc.save());

        return outputPath;
    } catch (error) {
        console.error('[collectionReceiptPdf] Error generating collection receipt:', error);
        throw error;
    } finally {
        if (browser) {
            try { await browser.close(); } catch { /* the PDF is already written */ }
        }
    }
}

module.exports = { generateCollectionReceiptPDF };
