import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

// Run in the backend container (Chromium and puppeteer are bundled there):
// docker exec -i forson_backend_dev node --input-type=module < packages/web/tests/receiptActionsBrowser.mjs
const baseUrl = process.env.RECEIPT_BROWSER_BASE_URL || 'http://forson_frontend_dev:5173';
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1000 });
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    const initial = { invoice_id: 1, invoice_number: 'INV-TEST-1', employee_id: 1, customer_id: 1,
        employee_first_name: 'Test', employee_last_name: 'Cashier', status: 'Unpaid',
        invoice_date: new Date().toISOString(), physical_receipt_no: 'SI-10', recording_method: 'PAPER',
        physical_document_series_id: 1, physical_document_registry_id: 10, physical_receipt_version: 1,
        total_amount: '100.00', amount_paid: '0.00' };
    let invoice = { ...initial };
    let history = [];
    let payments = [{ payment_id: 7, method_name: 'Cash', payment_status: 'pending', amount_paid: '100.00' }];
    const mutations = [];
    const series = [{ series_id: 1, type_id: 1, name: 'Sales booklet', prefix: 'SI',
        controlled_category: 'SALES_INVOICE', is_active: true, type_active: true, sales_eligible: true }];
    await page.setRequestInterception(true);
    page.on('request', async req => {
        const path = new URL(req.url()).pathname;
        if (!path.startsWith('/api/')) return req.continue();
        const respond = data => req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
        const method = req.method();
        const body = req.postData() ? JSON.parse(req.postData()) : null;
        if (['PUT', 'POST', 'DELETE', 'PATCH'].includes(method)) mutations.push({ path, method, body });
        if (path === '/api/settings') return respond({ ENABLE_SALES_CORRECTIONS: 'true' });
        if (path === '/api/invoices/1/receipt-control') return respond({ invoice, series, history });
        if (path === '/api/invoices/1/lines-with-refunds') return respond([{ invoice_line_id: 1, part_id: 1, quantity: 1, quantity_refunded: 0, sale_price: 100, display_name: 'Test part' }]);
        if (path === '/api/invoices/1/payments') return respond(payments);
        if (path === '/api/invoices/1/physical-receipt-no') {
            const old = invoice.physical_receipt_no;
            invoice = { ...invoice, ...body, physical_document_series_id: body.series_id, physical_receipt_version: invoice.physical_receipt_version + 1 };
            history = [{ event_id: 1, event_type: 'REFERENCE_EDITED', original_suggestion: old, submitted_reference: body.physical_receipt_no,
                reason: body.reason, actor_name: 'Test Cashier', created_at: new Date().toISOString() }];
            return respond(invoice);
        }
        if (path === '/api/invoices/payments/7/settle') {
            payments = [{ ...payments[0], payment_status: 'settled' }];
            return respond({ message: 'Payment settled' });
        }
        if (path === '/api/invoices/1' && method === 'DELETE') {
            invoice = { ...invoice, status: 'Cancelled' };
            return respond({ message: 'Invoice voided' });
        }
        if (path === '/api/sales-corrections/preview') return respond({ invoice, proposal: { automatic: true, resolution: 'CANCEL_ONLY' } });
        if (path === '/api/sales-corrections') return respond({ case: { correction_case_id: 3, state: 'PENDING_APPROVAL' } });
        if (path === '/api/sales-corrections/3/approve') return respond({ case: { correction_case_id: 3, state: 'COMPLETED' } });
        if (path === '/api/physical-documents/options') return respond({
            series, choices: [{ key: '1', series_id: 1, recording_method: 'PAPER', label: 'SI', prefix: 'SI' }, { key: 'NOTEBOOK', recording_method: 'NOTEBOOK', label: 'Notebook' }],
            policy: { default_choice: '1' },
        });
        if (path === '/api/physical-documents/suggestion') return respond({ series_id: 1, canonical_reference: 'SI-12', suggestion_token: 'test-token' });
        return respond([]);
    });
    const mount = async permissions => {
        await page.goto(`${baseUrl}/tests/fixtures/receiptActionsBrowser.html`);
        await page.waitForFunction(() => typeof window.mountReceiptDetails === 'function');
        await page.evaluate((inv, perms) => window.mountReceiptDetails(inv, perms), invoice, permissions || null);
        await page.waitForFunction(() => document.body.textContent.includes('Items Sold'));
    };
    const click = async text => {
        await page.waitForFunction(text => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === text && !b.disabled), {}, text);
        await page.evaluate(text => [...document.querySelectorAll('button')].reverse().find(b => b.textContent.trim() === text && !b.disabled).click(), text);
    };
    const field = async (label, value) => page.evaluate((label, value) => {
        const node = [...document.querySelectorAll('label')].find(el => el.firstChild?.textContent.trim() === label);
        if (!node) throw new Error(`Missing field: ${label}`);
        const input = node.querySelector('input,textarea,select');
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set.call(input, value);
        input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    }, label, value);

    await mount();
    await click('Edit Receipt No.');
    await page.waitForFunction(() => [...document.querySelectorAll('label')].some(l => l.textContent.includes('What happened to the original')));
    assert.equal(await page.$eval('form button[type=submit]', el => el.disabled), true);
    await field('Corrected physical receipt number', 'SI-11');
    await field('What happened to the original paper receipt?', 'SPOILED');
    await field('Reason', 'Paper damaged during writing');
    await click('Save receipt correction');
    await page.waitForFunction(() => window.receiptRefreshes > 0 && document.body.textContent.includes('SI-11'));
    assert.equal(mutations.at(-1).body.paper_outcome, 'SPOILED');
    assert.equal(mutations.at(-1).body.expected_version, 1);
    await page.waitForSelector('summary');
    await page.click('summary');
    await page.waitForFunction(() => document.body.textContent.includes('Paper damaged during writing'));

    await click('Mark Settled');
    await page.waitForFunction(() => document.body.textContent.includes('Settled') && ![...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Mark Settled'));
    assert.equal(mutations.at(-1).path, '/api/invoices/payments/7/settle');
    assert.equal(mutations.at(-1).method, 'PUT');
    assert.equal(invoice.physical_receipt_no, 'SI-11');

    await click('Exchange Items');
    await page.waitForFunction(() => document.body.textContent.includes('Replacement receipt'));
    assert.ok(await page.evaluate(() => document.body.textContent.includes('SI-11')), 'exchange receives the refreshed original receipt');
    await mount();
    await click('Change Date');
    await page.waitForFunction(() => document.body.textContent.includes('Change Date —'));
    await mount();
    await click('Process Refund');
    await page.waitForFunction(() => document.body.textContent.includes('Refund Payout Method:'));
    assert.equal(invoice.physical_receipt_no, 'SI-11');

    await mount();
    await click('Correct & Restart');
    await page.waitForFunction(() => [...document.querySelectorAll('label')].some(l => l.textContent.includes('Describe the mistake')));
    await field('Describe the mistake', 'Wrong item selected');
    await click('Create correction case');
    await click('Approve and execute');
    await page.waitForFunction(() => document.body.textContent.includes('Confirm Correct & Restart'));
    await field('What happened to the original paper receipt?', 'VOIDED');
    await click('Approve and execute');
    await page.waitForFunction(() => window.receiptClosed);
    assert.equal(mutations.at(-1).body.receipt_decision.paper_outcome, 'VOIDED');

    await mount(['invoicing:create', 'invoice:edit_receipt_no']);
    await click('Edit Receipt No.');
    await page.waitForSelector('form select');
    assert.equal(await page.evaluate(() => !!document.querySelector('option[value="UNUSED"]')), false);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Void Invoice')), false);

    await mount();
    await click('Void Invoice');
    await page.waitForSelector('form select');
    await field('What happened to the original paper receipt?', 'VOIDED');
    await field('Reason', 'Customer cancelled the transaction');
    await click('Confirm void');
    await page.waitForFunction(() => window.receiptClosed);
    assert.equal(mutations.at(-1).method, 'DELETE');
    assert.equal(mutations.at(-1).body.paper_outcome, 'VOIDED');
    await mount();
    for (const name of ['Edit Receipt No.', 'Void Invoice', 'Correct & Restart', 'Exchange Items', 'Process Refund', 'Mark Settled']) {
        assert.equal(await page.evaluate(name => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === name), name), false, `${name} hidden after void`);
    }
    assert.deepEqual(errors, []);
    console.log('Sales History browser checks passed: receipt edit/history, payment settlement, exchange, date, refund, restart, permissions, void, and cancelled actions.');
} finally { await browser.close(); }
