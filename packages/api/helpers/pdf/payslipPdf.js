'use strict';
/* global document */

/**
 * Payslip PDF generation, laid out N-up on A4.
 *
 * Philippine practice is to print a whole cutoff's payslips a few to a sheet and
 * guillotine them apart. Every layout is a full-width vertical stack, because
 * full width is what keeps the earnings and deductions columns side by side and
 * readable; a 2x2 grid would force them to wrap.
 *
 * 2 through 4 per sheet are supported; 4 is the default and is the practical
 * floor. Densities were tested against a real slip carrying six deduction lines
 * (SSS, WISP, PhilHealth, Pag-IBIG, withholding tax and an HMO share):
 *   4-up (~70mm) fits it with room to spare.
 *   5-up (~56mm) clipped the HMO line AND the Total Deductions row.
 *   6-up (~47mm) overflowed so badly the net pay printed over the figures.
 * Since slips are cut apart, every row must be the same height — so the
 * density has to suit the TALLEST slip, not the average one.
 *
 * Everything shown is read from the payslip SNAPSHOT, never recomputed, so a
 * reprint years later is byte-identical to the original.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('node:crypto');
const mustache = require('mustache');
const { assertPayslip } = require('../../services/hr/payrollIntegrityService');

const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'templates', 'pdf', 'payslip.html');

const VALID_PER_PAGE = [2, 3, 4];

// No currency symbol on the amounts: the peso glyph renders inconsistently
// across print drivers, and the column is unambiguous in a payslip context.
const money = (v) => (Number(v) || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const trimNum = (v) => {
    const n = Number(v) || 0;
    return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
};

const formatDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' });
};

const quantityLabel = (line, monthly) => {
    if ((monthly && line.component_code === 'BASIC') || line.rate == null || line.quantity == null || Number(line.quantity) === 1) return null;
    const displayedRate = Number(Number(line.rate).toFixed(2));
    const product = Math.round(Number(line.quantity) * displayedRate * 100);
    const amount = Math.round(Math.abs(Number(line.amount)) * 100);
    return `${trimNum(line.quantity)} @ ${money(line.rate)}${product !== amount ? ' (rate rounded)' : ''}`;
};

/**
 * Turns a payslip row plus its lines into the flat shape the template renders.
 * Zero-value lines are dropped — at this size every row costs real space, and a
 * line of zeros tells the reader nothing.
 */
const buildSlip = (payslip, lines, { company, periodLabel, payDate }) => {
    const monthly = payslip.pay_basis === 'monthly';
    const finalPay = payslip.computation_trace?.basicPayModel === 'FINAL_PAY';
    const relevant = lines.filter((l) => Number(l.amount) !== 0);

    const earnings = relevant
        .filter((l) => l.line_type === 'EARNING')
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((l) => ({
            label: l.description,
            // Quantity is only meaningful where it varies (days, OT hours);
            // showing "1 x" on an allowance is noise.
            qty: quantityLabel(l, monthly),
            amount: money(l.amount),
        }));

    const deductions = relevant
        .filter((l) => l.line_type === 'DEDUCTION')
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((l) => ({ label: l.description, amount: money(l.amount) }));

    return {
        company,
        payslip_no: payslip.payslip_no,
        employee_name: payslip.employee_name,
        employee_code: payslip.employee_code,
        position_title: payslip.position_title,
        department_name: payslip.department_name,
        period_label: periodLabel,
        pay_date: formatDate(payDate),
        earnings,
        deductions,
        gross_pay: money(payslip.gross_pay),
        total_deductions: money(payslip.total_deductions),
        net_pay: money(payslip.net_pay),
        days_paid: trimNum(payslip.days_paid),
        overtime_hours: Number(payslip.overtime_hours) > 0 ? trimNum(payslip.overtime_hours) : null,
        daily_rate: money(payslip.daily_rate),
        rate_label: monthly ? 'Equivalent daily rate' : 'Daily rate',
        pay_basis_label: monthly ? 'Monthly salary' : 'Daily pay',
        show_rate_stats: !finalPay,
        salary_note: monthly ? (payslip.salary_model === 'ATTENDANCE'
            ? 'Cutoff salary less unpaid leave, absences and unpaid half-days. Lateness / undertime are paid.'
            : 'Guaranteed cutoff salary less approved unpaid leave. Attendance does not reduce salary.') : null,
        total_employer_contrib: money(payslip.total_employer_contrib),
        show_employer_note: Number(payslip.total_employer_contrib) > 0,
    };
};

/** Splits slips into sheets and flags the last one so it drops its cut rule. */
const paginate = (slips, perPage) => {
    const sheets = [];
    for (let i = 0; i < slips.length; i += perPage) {
        const chunk = slips.slice(i, i + perPage);
        sheets.push({
            perPage,
            slips: chunk.map((s, idx) => ({ ...s, lastInSheet: idx === chunk.length - 1 })),
        });
    }
    return sheets;
};

/**
 * @param {object} input
 * @param {Array} input.payslips   - payroll_payslip rows
 * @param {Map}   input.linesByPayslip - payslip_id -> line rows
 * @param {object} input.company   - { name }
 * @param {string} input.periodLabel
 * @param {string} input.payDate
 * @param {number} [input.perPage=3]
 * @returns {Promise<Buffer>}
 */
const generatePayslipPdf = async ({
    payslips, linesByPayslip, company, periodLabel, payDate, perPage = 4,
}) => {
    const slipsPerPage = VALID_PER_PAGE.includes(Number(perPage)) ? Number(perPage) : 4;

    for (const payslip of payslips) {
        assertPayslip(payslip, linesByPayslip.get(String(payslip.payslip_id)) || linesByPayslip.get(payslip.payslip_id) || []);
    }

    const slips = payslips.map((p) => buildSlip(
        p, linesByPayslip.get(String(p.payslip_id)) || linesByPayslip.get(p.payslip_id) || [],
        { company, periodLabel, payDate }
    ));

    const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    const render = (density) => mustache.render(template, {
        company,
        sheets: paginate(slips, density),
    });

    const outputPath = path.join(os.tmpdir(), `payslips_${randomUUID()}.pdf`);
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium'],
        });
        const page = await browser.newPage();
        // Choose density from the tallest actual slip, not a fixed number of
        // deductions. Never silently clip earnings, deductions or subtotals.
        for (const density of [...VALID_PER_PAGE.filter((n) => n <= slipsPerPage).sort((a, b) => b - a), 1]) {
            await page.setContent(render(density), { waitUntil: 'domcontentloaded' });
            const overflowing = await page.evaluate(() => [...document.querySelectorAll('.col, .slip')]
                .some((col) => col.scrollHeight > col.clientHeight + 1));
            if (density === 1) {
                await page.evaluate(() => {
                    for (const sheet of document.querySelectorAll('.sheet')) {
                        if (sheet.scrollHeight > 281 * 96 / 25.4 + 1) sheet.classList.add('flow-layout');
                    }
                });
            }
            if (!overflowing || density === 1) break;
        }
        await page.pdf({
            path: outputPath,
            printBackground: true,
            format: 'A4',
            // Margins live in the template's @page rule so the grid maths and
            // the PDF margins can never disagree.
            margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
        });
        await page.close();
        return fs.readFileSync(outputPath);
    } finally {
        if (browser) await browser.close();
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
};

module.exports = { generatePayslipPdf, buildSlip, paginate, VALID_PER_PAGE, _money: money, _trimNum: trimNum };
