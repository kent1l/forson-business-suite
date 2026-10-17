'use strict';
/* global document */

const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const { PDFDocument } = require('pdf-lib');
const launch = puppeteer.launch.bind(puppeteer);
let inspected;
// Instrument the real browser immediately before printing; calculations and
// layout remain real. This catches clipping that a PDF byte-count cannot.
puppeteer.launch = async (...args) => {
    const browser = await launch(...args);
    const newPage = browser.newPage.bind(browser);
    browser.newPage = async () => {
        const page = await newPage();
        const pdf = page.pdf.bind(page);
        page.pdf = async (options) => {
            inspected = await page.evaluate(() => [...document.querySelectorAll('.slip')].map((slip) => ({
                sheet: slip.closest('.sheet').className,
                rows: slip.querySelectorAll('tr').length,
                visible: [...slip.querySelectorAll('.col')].every((col) => col.scrollHeight <= col.clientHeight + 1),
                text: slip.textContent,
            })));
            return pdf(options);
        };
        return page;
    };
    return browser;
};
const { generatePayslipPdf } = require('../helpers/pdf/payslipPdf');

async function main() {
    for (const [earningsCount, deductionCount, expectedDensity] of [[1, 1, 'up-4'], [30, 20, 'up-1'], [150, 20, 'flow-layout']]) {
        const lines = [
            ...Array.from({ length: earningsCount }, (_, index) => ({ line_type: 'EARNING', component_code: 'EXTRA', description: `Earning ${index + 1}`, amount: 1, sort_order: 10 })),
            ...Array.from({ length: deductionCount }, (_, index) => ({ line_type: 'DEDUCTION', component_code: 'OTHER_DEDUCTION', description: `Deduction ${index + 1}`, amount: .5, sort_order: 40 })),
        ];
        const slip = { payslip_id: 1, employee_name: 'Layout Fixture', payslip_no: 'LAYOUT', pay_basis: 'monthly',
            salary_model: 'ATTENDANCE', daily_rate: 1150.16, days_paid: 13.125,
            allowances_taxable: earningsCount, gross_pay: earningsCount, other_deductions: deductionCount / 2,
            total_deductions: deductionCount / 2, net_pay: earningsCount - deductionCount / 2 };
        const buffer = await generatePayslipPdf({ payslips: [slip], linesByPayslip: new Map([[1, lines]]),
            company: { name: 'Layout Test' }, periodLabel: '2026-10-01 to 2026-10-15', payDate: '2026-10-15', perPage: 4 });
        assert(inspected.every((view) => view.visible));
        assert(inspected[0].sheet.includes(expectedDensity), JSON.stringify(inspected[0]));
        for (const label of [`Earning ${earningsCount}`, `Deduction ${deductionCount}`, 'Gross Pay', 'Total Deductions', 'Net Pay', 'Equivalent daily rate', '13.125']) {
            assert(inspected[0].text.includes(label), label);
        }
        assert.equal(inspected[0].rows, earningsCount + deductionCount + 2);
        const pages = (await PDFDocument.load(buffer)).getPageCount();
        assert(earningsCount < 150 ? pages === 1 : pages > 1);
    }
    console.log('PASS real Chromium PDF: compact slip, automatic density reduction, multi-page long slip, every earning/deduction/subtotal and exact day fraction visible.');
}
main().catch((error) => { console.error(error.stack); process.exitCode = 1; });
