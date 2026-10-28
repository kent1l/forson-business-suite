import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
// Run in backend container: docker exec -i forson_backend_dev node --input-type=module < packages/web/tests/receiptMonitorBrowser.mjs
const baseUrl = process.env.RECEIPT_BROWSER_BASE_URL || 'http://forson_frontend_dev:5173';
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
    const page = await browser.newPage();
    const errors = [], mutations = [], reads = [];
    page.on('pageerror', err => errors.push(err.message));
    let flag = null, fail = false, delay = false;
    const row = (n, status = 'NO_RECORD') => ({ reference: `SI-${n}`, serial_number: String(n), status, sources: [], candidates: [],
        follow_up_id: n === 1 ? flag?.id : null, follow_up_reason: n === 1 ? flag?.reason : null,
        ...(status === 'SPOILED' ? { state: 'SPOILED', registry_id: n, version: 2 } : {}) });
    await page.setRequestInterception(true);
    page.on('request', async req => {
        const url = new URL(req.url()), path = url.pathname;
        if (!path.startsWith('/api/')) return req.continue();
        const respond = (data, status = 200) => req.respond({ status, contentType: 'application/json', body: JSON.stringify(data) });
        if (path === '/api/settings') return respond({});
        if (req.method() === 'POST') {
            const body = JSON.parse(req.postData()); mutations.push({ path, body });
            if (path.endsWith('/follow-up')) flag = body.resolve ? null : { id: 9, reason: body.reason };
            return respond({ message: 'Saved' }, 201);
        }
        if (path === '/api/settings/physical-document-monitor') {
            reads.push(Object.fromEntries(url.searchParams));
            if (fail) return respond({ message: 'Monitor temporarily unavailable' }, 500);
            if (url.searchParams.get('series_id') === '2') return respond({ needs_bounds: true, total: '0', items: [] });
            if (url.searchParams.get('series_id') === '3') return respond({ total: '1', items: [{ ...row(1), reference: 'OT-1' }] });
            if (delay) await new Promise(resolve => setTimeout(resolve, 300));
            if (url.searchParams.get('status') === 'VOIDED') return respond({ total: '0', items: [] });
            if (url.searchParams.get('status') === 'SPOILED') return respond({ total: '1', items: [row(40, 'SPOILED')] });
            if (url.searchParams.get('page') === '2') return respond({ total: '26', items: [row(26)] });
            return respond({ total: '26', items: [row(1), row(2, 'SPOILED'), { ...row(3, 'ISSUED'), state: 'VOIDED', sources: [{ type: 'INVOICE', id: 7, role: 'HISTORICAL' }] }] });
        }
        if (path.endsWith('/history')) return respond([{ event_id: 1, event_type: 'FOLLOW_UP', reason: 'Missing paper', actor_name: 'Test Cashier', created_at: new Date().toISOString() }]);
        if (path.endsWith('/transaction')) return respond({ source_type: 'INVOICE', source_id: 7, number: 'INV-7', customer_name: 'Test Customer', amount: '123.00', status: 'Unpaid',
            physical_receipt_no: null, physical_document_registry_id: null, physical_receipt_version: 1, recording_method: 'PAPER' });
        if (path === '/api/invoices/7/receipt-control') return respond({ invoice: { invoice_id: 7, status: 'Unpaid', invoice_number: 'INV-7', total_amount: 123 }, history: [], series: [] });
        return respond([]);
    });
    const mount = async permissions => {
        await page.goto(`${baseUrl}/tests/fixtures/receiptMonitorBrowser.html`);
        await page.waitForFunction(() => typeof window.mountMonitor === 'function');
        await page.evaluate(perms => window.mountMonitor(perms), permissions || null);
        await page.waitForSelector('select');
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
    const waitText = text => page.waitForFunction(text => document.body.textContent.includes(text), {}, text);
    await mount(); await field('Series', '2'); await waitText('Set both the minimum');
    await field('Series', '1'); await waitText('SI-1');
    await click('Next'); await waitText('SI-26'); assert.equal(reads.at(-1).page, '2');
    await field('Status', 'SPOILED'); await waitText('SI-40'); assert.equal(reads.at(-1).page, '1'); assert.equal(reads.at(-1).status, 'SPOILED');
    await click('Correct spoilage'); assert.equal(await page.evaluate(() => window.corrected.registry_id), 40);
    await field('Status', 'VOIDED'); await waitText('No numbers match this status.');
    await field('Status', 'ALL'); await waitText('SI-1');
    await click('Mark spoiled'); assert.equal(await page.evaluate(() => window.spoiled.reference), 'SI-1');
    await click('Flag for follow-up'); await field('Reason', 'Paper missing from booklet'); await click('Save follow-up'); await waitText('Follow-up: Paper missing');
    await click('Resolve follow-up'); await field('Reason', 'Paper found and checked'); await click('Resolve follow-up');
    await page.waitForFunction(() => !document.body.textContent.includes('Follow-up: Paper missing'));
    assert.equal(mutations.at(-1).body.expected_event_id, 9); assert.equal(mutations.at(-1).body.resolve, true);
    await click('View history'); await waitText('Test Cashier'); await page.keyboard.press('Escape');
    await click('Verify and link transaction'); await field('Transaction ID', '7'); await click('Inspect transaction'); await waitText('Test Customer');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Link verified receipt').disabled), true);
    await page.click('input[type=checkbox]'); await field('Reconciliation reason', 'Verified paper and transaction'); await click('Link verified receipt');
    await page.waitForFunction(() => !document.body.textContent.includes('Reconciliation reason'));
    assert.equal(mutations.at(-1).body.verified, true); assert.equal(mutations.at(-1).body.expected_version, 1);
    await click('INVOICE #7'); await waitText('Test Customer'); await click('View invoice / receipt correction and void actions'); await waitText('Items Sold');
    await page.keyboard.press('Escape');
    await mount(['settings:edit']); await field('Series', '1'); await waitText('SI-1');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('Verify and link'))), false);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'INVOICE #7')), false);
    fail = true; await field('Series', '3'); await waitText('Monitor temporarily unavailable'); fail = false; await click('Retry'); await waitText('OT-1');
    delay = true; await field('Series', '1'); await field('Series', '3'); await waitText('OT-1');
    await new Promise(resolve => setTimeout(resolve, 450));
    assert.equal(await page.evaluate(() => document.body.textContent.includes('SI-1')), false);
    assert.deepEqual(errors, []);
    console.log('Receipt monitor browser tests passed: selection, bounds, paging, filtering, actions, follow-up, history, reconciliation, invoice navigation, permissions, retry and stale responses.');
} finally { await browser.close(); }
