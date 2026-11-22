import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const ok = data => ({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
try {
    for (const [cash, expected, failRefunds] of [[1000, '₱860.00', false], [0, '₱-140.00', false], [1000, 'Unavailable', true]]) {
        const page = await browser.newPage();
        await page.evaluateOnNewDocument(() => {
            localStorage.setItem('userSession', JSON.stringify({ token: 'test', user: { employee_id: 1, permission_level_id: 10 } }));
            localStorage.setItem('salesSummaryCollapsed', 'false');
            sessionStorage.clear();
        });
        await page.setRequestInterception(true);
        const calls = [];
        page.on('request', req => {
            const path = new URL(req.url()).pathname;
            if (!path.startsWith('/api/')) return req.continue();
            calls.push(path);
            if (path === '/api/settings') return req.respond(ok({ DEFAULT_CURRENCY_SYMBOL: '₱', ENABLE_SPLIT_PAYMENTS: 'false' }));
            if (path === '/api/invoices') return req.respond(ok({ rows: [], total: 0 }));
            if (path === '/api/invoices/summary') return req.respond(ok({}));
            if (path === '/api/payments') return req.respond(ok(cash ? [{ amount: cash, tendered_amount: cash + 100, payment_method: 'Cash', payment_status: 'settled', reference: 'PAY-1' }] : []));
            if (path === '/api/payments/refunds-approx') return req.respond(failRefunds
                ? { status: 403, contentType: 'application/json', body: '{}' } : ok({ total_refunds: '140.00' }));
            return req.respond(ok([]));
        });
        await page.goto(`${process.env.CASH_BROWSER_BASE_URL || 'http://localhost:5173'}/tests/fixtures/salesHistoryCashBrowser.html`);
        await page.waitForFunction(value => [...document.querySelectorAll('div')].some(item => item.textContent.trim() === value), {}, expected);
        const value = await page.evaluate(() => {
            const label = [...document.querySelectorAll('div')].find(item => item.textContent.trim() === 'Expected Net Cash');
            return label?.nextElementSibling?.textContent.trim();
        });
        assert.equal(value, expected);
        assert(!calls.some(path => path.startsWith('/api/cash-drawers')), 'Sales History is independent of Cash Box');
        await page.close();
    }

    // Verify POS sales cash + A/R cash collections breakdown and out-of-range POS invoice exclusion
    {
        const page = await browser.newPage();
        await page.evaluateOnNewDocument(() => {
            localStorage.setItem('userSession', JSON.stringify({ token: 'test', user: { employee_id: 1, permission_level_id: 10 } }));
            localStorage.setItem('salesSummaryCollapsed', 'false');
            sessionStorage.clear();
        });
        await page.setRequestInterception(true);
        page.on('request', req => {
            const path = new URL(req.url()).pathname;
            if (!path.startsWith('/api/')) return req.continue();
            if (path === '/api/settings') return req.respond(ok({ DEFAULT_CURRENCY_SYMBOL: '₱', ENABLE_SPLIT_PAYMENTS: 'false' }));
            if (path === '/api/invoices') return req.respond(ok({ rows: [], total: 0 }));
            if (path === '/api/invoices/summary') return req.respond(ok({ active_invoice_numbers: ['INV-1'] }));
            if (path === '/api/payments') return req.respond(ok([
                { amount: 1000, tendered_amount: 1100, payment_method: 'Cash', method_type: 'cash', payment_status: 'settled', collection_type: 'pos_sale', source_table: 'invoice_payments', invoice_number: 'INV-1' },
                { amount: 500, tendered_amount: null, payment_method: 'Cash', method_type: 'cash', payment_status: 'settled', collection_type: 'ar_collection', source_table: 'customer_payment', invoice_number: null },
                { amount: 999, tendered_amount: 999, payment_method: 'Cash', method_type: 'cash', payment_status: 'settled', collection_type: 'pos_sale', source_table: 'invoice_payments', invoice_number: 'INV-OTHER' },
            ]));
            if (path === '/api/payments/refunds-approx') return req.respond(ok({ total_refunds: '140.00' }));
            return req.respond(ok([]));
        });
        await page.goto(`${process.env.CASH_BROWSER_BASE_URL || 'http://localhost:5173'}/tests/fixtures/salesHistoryCashBrowser.html`);
        await page.waitForFunction(value => [...document.querySelectorAll('div')].some(item => item.textContent.trim() === value), {}, '₱1,360.00');
        const value = await page.evaluate(() => {
            const label = [...document.querySelectorAll('div')].find(item => item.textContent.trim() === 'Expected Net Cash');
            return label?.nextElementSibling?.textContent.trim();
        });
        assert.equal(value, '₱1,360.00');
        const bodyText = await page.evaluate(() => document.body.innerText);
        assert(bodyText.includes('POS Sales Cash (Net)'), 'Expected POS Sales Cash (Net) breakdown row');
        assert(bodyText.includes('A/R Cash Collections'), 'Expected A/R Cash Collections breakdown row');
        assert(bodyText.includes('Cash Refunds & Payouts'), 'Expected Cash Refunds & Payouts breakdown row');
        assert(bodyText.includes('A/R Cash: ₱500.00'), 'Expected A/R Cash amount in Collections card');
        await page.close();
    }
    console.log('PASS: Sales History cash minus change and payouts; negative net cash; unavailable refunds; A/R cash collections breakdown; no Cash Box dependency');
} finally { await browser.close(); }
