import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
// Run in backend container: docker exec -i forson_backend_dev node --input-type=module < packages/web/tests/receiptMonitorBrowser.mjs
const baseUrl = process.env.RECEIPT_BROWSER_BASE_URL || 'http://forson_frontend_dev:5173';
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const errors = [], mutations = [], reads = [], spoilageReads = [];
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
        if (path === '/api/settings/physical-document-types') return respond([]);
        if (path === '/api/settings/physical-document-selection-policies' || path === '/api/tax-rates') return respond([]);
        if (path === '/api/settings/physical-document-series') return respond([
            { series_id: 1, name: 'Booklet', prefix: 'SI', min_serial: '1', max_serial: '60' },
            { series_id: 2, name: 'Unbounded', prefix: 'UB' },
        ]);
        if (req.method() === 'POST') {
            const body = JSON.parse(req.postData()); mutations.push({ path, body });
            if (path.endsWith('/follow-up')) flag = body.resolve ? null : { id: 9, reason: body.reason };
            return respond({ message: 'Saved' }, 201);
        }
        if (path === '/api/settings/physical-document-spoilage') {
            spoilageReads.push(Object.fromEntries(url.searchParams));
            if (fail) return respond({ message: 'Spoilage temporarily unavailable' }, 500);
            if (delay) await new Promise(resolve => setTimeout(resolve, 300));
            if (url.searchParams.get('search') === 'nomatch') return respond({ total: 0, items: [] });
            const prefix = url.searchParams.get('series_id') === '2' ? 'UB' : 'SI';
            const spoiledRow = n => ({ registry_id: n, canonical_full_reference: `${prefix}-${n}`, series_id: prefix === 'UB' ? 2 : 1,
                series_name: prefix === 'UB' ? 'Unbounded' : 'Booklet', prefix, state: 'SPOILED', version: 2,
                spoiled_at: '2026-10-28T02:30:00Z', actor_name: 'Test Cashier', spoilage_reason: 'Paper damaged during printing',
                spoilage_notes: 'Verified against the original booklet.' });
            return respond({ total: 11, items: url.searchParams.get('page') === '2' ? [spoiledRow(50)] : Array.from({ length: 10 }, (_, i) => spoiledRow(40 + i)) });
        }
        if (path === '/api/settings/physical-document-monitor') {
            reads.push(Object.fromEntries(url.searchParams));
            if (fail) return respond({ message: 'Monitor temporarily unavailable' }, 500);
            if (url.searchParams.get('series_id') === '2') return respond({ needs_bounds: true, total: '0', items: [] });
            if (url.searchParams.get('series_id') === '3') return respond({ total: '1', items: [{ ...row(1), reference: 'OT-1' }] });
            if (delay) await new Promise(resolve => setTimeout(resolve, 300));
            if (url.searchParams.get('search') === '26') return respond({ total: '1', items: [row(26)] });
            if (url.searchParams.get('search') === 'nomatch') return respond({ total: '0', items: [] });
            if (url.searchParams.get('status') === 'VOIDED') return respond({ total: '0', items: [] });
            if (url.searchParams.get('status') === 'SPOILED') return respond({ total: '1', items: [row(40, 'SPOILED')] });
            if (url.searchParams.get('page') === '2') return respond({ total: '26', items: [row(26)] });
            return respond({ total: '26', items: [row(1), row(2, 'SPOILED'), { ...row(3, 'VOIDED'), state: 'VOIDED', sources: [{ type: 'INVOICE', id: 7, role: 'HISTORICAL' }] }] });
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
        await page.waitForFunction(text => [...document.querySelectorAll('button')].some(b => (b.getAttribute('aria-label') === text || b.textContent.trim() === text) && !b.disabled), {}, text);
        await page.evaluate(text => [...document.querySelectorAll('button')].reverse().find(b => (b.getAttribute('aria-label') === text || b.textContent.trim() === text) && !b.disabled).click(), text);
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
    await field('Search receipt numbers', '26'); await waitText('Showing 1–1 of 1 numbers');
    assert.equal(reads.at(-1).search, '26'); assert.equal(reads.at(-1).page, '1');
    await click('Clear search'); await waitText('SI-1');
    await page.click('button[aria-label="Sort by Reference"]');
    await page.waitForFunction(() => document.querySelector('th[aria-sort="descending"]'));
    assert.equal(reads.at(-1).sortBy, 'reference'); assert.equal(reads.at(-1).sortOrder, 'desc');
    await page.click('button[aria-label="Sort by Status"]');
    await page.waitForFunction(() => document.querySelectorAll('th')[1]?.getAttribute('aria-sort') === 'ascending');
    assert.equal(reads.at(-1).sortBy, 'status');
    await page.hover('button[aria-label="View history"]');
    assert.equal(await page.$eval('button[aria-label="View history"]', el => el.title), 'View history');
    assert.equal(await page.$eval('button[aria-label="View history"]', el => el.textContent.trim()), '');
    await field('Search receipt numbers', 'nomatch'); await waitText('No numbers match the current filters.');
    await click('Clear search'); await waitText('SI-1');

    await field('Status', 'SPOILED'); await waitText('SI-40');
    assert.equal(spoilageReads.at(-1).page, '1'); assert.equal(spoilageReads.at(-1).pageSize, '10');
    await waitText('Paper damaged during printing'); await waitText('Verified against the original booklet.');
    await click('Correct / Unspoil'); assert.equal(await page.evaluate(() => window.corrected.registry_id), 49);
    assert.equal(await page.evaluate(() => window.corrected.version), 2);
    await click('Next'); await waitText('SI-50');
    await field('Search spoiled receipts', 'paper'); await waitText('SI-40');
    assert.equal(spoilageReads.at(-1).page, '1'); assert.equal(spoilageReads.at(-1).search, 'paper');
    await field('From date', '2026-10-01'); await page.waitForFunction(() => document.querySelector('table'));
    await field('To date', '2026-10-28'); await page.waitForFunction(() => document.querySelector('table'));
    await page.click('button[aria-label="Sort by Reason / Notes"]'); await page.waitForFunction(() => document.querySelector('th[aria-sort="ascending"]'));
    assert.equal(spoilageReads.at(-1).sortBy, 'reason'); assert.equal(spoilageReads.at(-1).date_from, '2026-10-01');
    assert.equal(spoilageReads.at(-1).date_to, '2026-10-28');
    await click('Clear filters'); await waitText('All series');
    await page.waitForFunction(() => document.querySelector('table'));
    assert.equal(spoilageReads.at(-1).series_id, undefined); assert.equal(spoilageReads.at(-1).search, undefined);
    assert.equal(spoilageReads.at(-1).date_from, undefined); assert.equal(spoilageReads.at(-1).date_to, undefined);
    await field('Search spoiled receipts', 'nomatch'); await waitText('No spoiled receipts match');
    await click('Clear filters'); await waitText('SI-40');
    // Spoilage remains available for unbounded series and history uses the row's series.
    await field('Series', '2'); await waitText('UB-40'); await click('View history'); await waitText('Test Cashier');
    await page.click('button[aria-label="Close"]');
    await field('Series', '1'); await waitText('SI-40');
    await field('Status', 'VOIDED'); await waitText('No numbers match the current filters.');
    await field('Status', 'ALL'); await waitText('SI-1');
    await click('Mark spoiled'); assert.equal(await page.evaluate(() => window.spoiled.reference), 'SI-1');
    await click('Flag for follow-up'); await field('Reason', 'Paper missing from booklet'); await click('Save follow-up'); await waitText('Follow-up: Paper missing');
    await click('Resolve follow-up'); await field('Reason', 'Paper found and checked'); await click('Resolve follow-up');
    await page.waitForFunction(() => !document.body.textContent.includes('Follow-up: Paper missing'));
    assert.equal(mutations.at(-1).body.expected_event_id, 9); assert.equal(mutations.at(-1).body.resolve, true);
    await click('View history'); await waitText('Test Cashier'); await page.click('button[aria-label="Close"]');
    await click('Verify and link transaction'); await field('Transaction ID', '7'); await click('Inspect transaction'); await waitText('Test Customer');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Link verified receipt').disabled), true);
    await page.click('input[type=checkbox]'); await field('Reconciliation reason', 'Verified paper and transaction'); await click('Link verified receipt');
    await page.waitForFunction(() => !document.body.textContent.includes('Reconciliation reason'));
    assert.equal(mutations.at(-1).body.verified, true); assert.equal(mutations.at(-1).body.expected_version, 1);
    await click('Invoice #7'); await waitText('Test Customer'); await click('View invoice / receipt correction and void actions'); await waitText('Items Sold');
    await page.click('button[aria-label="Close"]');
    await mount(['settings:edit']); await field('Series', '1'); await waitText('SI-1');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].some(b => b.getAttribute('aria-label') === 'Verify and link transaction')), false);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Invoice #7')), false);
    fail = true; await field('Series', '3'); await waitText('Monitor temporarily unavailable'); fail = false; await click('Retry'); await waitText('OT-1');
    delay = true; await field('Series', '1'); await field('Series', '3'); await waitText('OT-1');
    await new Promise(resolve => setTimeout(resolve, 450));
    assert.equal(await page.evaluate(() => document.body.textContent.includes('SI-1')), false);
    // Exercise the real settings parent: one monitor tab, shared spoilage forms and refresh.
    delay = false;
    await page.evaluate(() => window.mountDocumentSettings());
    await click('Series Monitor'); await waitText('Choose a series to review');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Spoiled Paper')), false);
    await click('Review spoiled paper across all series'); await waitText('SI-40');
    await click('Mark Spoiled Number'); await waitText('Record Spoiled Receipt Number');
    await page.click('button[aria-label="Close"]');
    await click('Correct / Unspoil'); await waitText('Correct Spoiled Reference: SI-49');
    const previousReads = spoilageReads.length;
    await page.type('#spoil-correction-reason', 'Paper inspected and verified undamaged');
    await click('Confirm Correction');
    await page.waitForFunction(() => !document.body.textContent.includes('Correct Spoiled Reference:'));
    await page.waitForFunction(() => document.querySelector('table'));
    assert.equal(mutations.at(-1).body.expected_version, 2);
    assert.equal(spoilageReads.length > previousReads, true);
    // Review responsive layout and dark mode; table overflow must stay inside its container.
    await page.screenshot({ path: '/tmp/receipt-monitor-spoiled-desktop.png', fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: '/tmp/receipt-monitor-spoiled-mobile.png', fullPage: true });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await new Promise(resolve => setTimeout(resolve, 400));
    await page.screenshot({ path: '/tmp/receipt-monitor-spoiled-dark.png', fullPage: true });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.setViewport({ width: 1280, height: 900 });
    await field('Status', 'ALL'); await field('Series', '1'); await waitText('SI-1');
    await page.screenshot({ path: '/tmp/receipt-monitor-range-desktop.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log('Receipt monitor browser tests passed: range search/sort before pagination, labeled action icons, unified spoilage filters/sort/paging/history/corrections, settings integration, responsive layout, range actions, follow-up, reconciliation, permissions, retry and stale responses.');
} finally { await browser.close(); }
