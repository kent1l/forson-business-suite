import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(process.env.PAYROLL_BROWSER_PACKAGE || import.meta.url);
const puppeteer = require('puppeteer');
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
    const page = await browser.newPage();
    const errors = [];
    const requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const slip = { payslip_id: 1, employee_name: 'Payroll Fixture', payslip_no: 'PS-1', pay_basis: 'monthly', salary_model: 'ATTENDANCE',
        daily_rate: '1150.16', days_paid: '13.125', basic_pay: '15000.00', gross_pay: '16000.00', sss_ee: '500.00', sss_mpf_ee: 0,
        philhealth_ee: '250.00', pagibig_ee: '100.00', withholding_tax: 0, loans_total: 0, other_deductions: '150.00', total_deductions: '1000.00',
        net_pay: '15000.00', total_employer_contrib: 0, period_start: '2026-10-01', period_end: '2026-10-15', pay_date: '2026-10-15', status: 'Computed',
        computation_trace: { earningsModelVersion: 2, monthlySalary: 30000, proratedEntitlement: 15000 }, lines: [
            { line_type: 'EARNING', component_code: 'BASIC', description: 'Basic Pay', quantity: 14, rate: 1150.16, amount: 15000 },
            { line_type: 'EARNING', component_code: 'ALLOWANCE', description: 'Allowance', amount: 1000 },
            { line_type: 'DEDUCTION', component_code: 'SSS_EE', description: 'SSS', amount: 500 },
            { line_type: 'DEDUCTION', component_code: 'PHIC_EE', description: 'PhilHealth', amount: 250 },
            { line_type: 'DEDUCTION', component_code: 'HDMF_EE', description: 'Pag-IBIG', amount: 100 },
            { line_type: 'DEDUCTION', component_code: 'OTHER', description: 'Other Deduction', amount: 150 },
        ] };
    const run = { run_id: 1, run_no: 'PAY-TEST', run_type: 'REGULAR', status: 'Computed', employee_count: 1,
        period_start: slip.period_start, period_end: slip.period_end, total_gross: slip.gross_pay,
        total_deductions: slip.total_deductions, total_net: slip.net_pay, total_employer_contrib: 0 };
    await page.setRequestInterception(true);
    page.on('request', (request) => {
        const path = new URL(request.url()).pathname;
        if (!path.startsWith('/api/')) return request.continue();
        requests.push({ method: request.method(), path });
        let data = [];
        if (path === '/api/payroll/runs') data = [run];
        if (path === '/api/payroll/runs/1') data = run;
        if (path === '/api/payroll/runs/1/payslips' || path === '/api/payroll/me/payslips') data = [slip];
        if (path === '/api/payroll/payslips/1' || path === '/api/payroll/me/payslips/1') data = slip;
        return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    const base = process.env.PAYROLL_BROWSER_BASE_URL || 'http://localhost:5173';
    await page.goto(`${base}/tests/fixtures/payrollAccuracyBrowser.html`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!window.mountPayroll);
    const click = async (label) => page.evaluate((text) => {
        const element = [...document.querySelectorAll('button,td')].find((item) => item.textContent.trim() === text);
        if (!element) throw new Error(`Missing ${text}`);
        element.click();
    }, label);
    for (const width of [1280, 390]) {
        await page.setViewport({ width, height: 900 });
        await page.evaluate(() => window.mountPayroll());
        await page.waitForFunction(() => document.body.textContent.includes('PAY-TEST'));
        await click('PAY-TEST');
        await page.waitForFunction(() => document.body.textContent.includes('View breakdown'));
        let text = await page.evaluate(() => document.body.textContent);
        for (const label of ['Basic', 'Additional Earnings', 'Other Deductions', 'Total Deductions', '13.125', 'Equivalent daily rate']) assert(text.includes(label), label);
        await click('View breakdown');
        await page.waitForFunction(() => document.body.textContent.includes('Net pay = gross pay'));
        text = await page.evaluate(() => document.body.textContent);
        assert(text.includes('Lateness and undertime are paid.'));
        assert(!text.includes('14 @'), 'monthly salary must not appear to equal days × equivalent rate');
        const totals = await page.evaluate(() => [...document.querySelectorAll('.fixed')].map((node) => node.textContent).join(' '));
        assert(totals.includes('₱16,000.00') && totals.includes('₱1,000.00') && totals.includes('₱15,000.00'));
        await page.screenshot({ path: `/tmp/payroll-breakdown-${width}.png`, fullPage: true });
        await page.evaluate(() => document.querySelector('button[aria-label="Close"]').click());
        await page.evaluate(() => window.mountPayroll(true));
        await page.waitForFunction(() => document.body.textContent.includes('Breakdown'));
        await click('Breakdown');
        await page.waitForFunction(() => document.body.textContent.includes('Net pay = gross pay'));
        assert(requests.some((request) => request.path === '/api/payroll/me/payslips/1'));
    }
    assert.deepEqual(errors, []);
    assert(requests.every((request) => request.method === 'GET'), 'display checks must never create payments');
    console.log('PASS payroll browser: desktop/mobile register, all deductions, exact three-decimal DTR days, monthly salary explanation, saved-line totals, employee-scoped breakdown; no writes.');
} finally { await browser.close(); }
