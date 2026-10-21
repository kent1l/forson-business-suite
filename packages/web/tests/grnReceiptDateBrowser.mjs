import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const baseUrl = process.env.GRN_IMPORT_BROWSER_BASE_URL || 'http://localhost:5173';
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

try {
    for (const timezone of ['Asia/Manila', 'UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
        const page = await browser.newPage();
        await page.emulateTimezone(timezone);
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));
        let scratch = null;
        let header = null;
        let savedPayload = null;
        const lines = [{ part_id: 10, display_name: 'Date test part', quantity: 1, cost_price: 100, sale_price: 150 }];

        await page.setRequestInterception(true);
        page.on('request', async req => {
            const path = new URL(req.url()).pathname;
            if (!path.startsWith('/api/')) return req.continue();
            const respond = data => req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
            if (path === '/api/settings') return respond({});
            if (path === '/api/suppliers') return respond([{ supplier_id: 1, supplier_name: 'Date test supplier' }]);
            if (path === '/api/goods-receipts/import-capabilities') return respond({ enabled: false });
            if (path === '/api/drafts/goods-receipt') {
                if (req.method() === 'POST') scratch = JSON.parse(req.postData()).data;
                if (req.method() === 'DELETE') scratch = null;
                return respond({ data: scratch });
            }
            if ((path === '/api/goods-receipts/drafts' && req.method() === 'POST')
                || (path === '/api/goods-receipts/99/draft' && req.method() === 'PUT')) {
                savedPayload = JSON.parse(req.postData());
                header = {
                    ...savedPayload, grn_id: 99, grn_number: 'GRD-DATE-99', workflow_status: 'Draft',
                    // Match the UTC timestamp serialized by node-postgres/Express.
                    receipt_date: savedPayload.receipt_date ? new Date(savedPayload.receipt_date).toISOString() : header?.receipt_date,
                };
                return respond({ grn_id: 99, grn_number: header.grn_number });
            }
            if (path === '/api/goods-receipts/99') return respond(header);
            if (path === '/api/goods-receipts/99/lines') return respond(lines);
            return respond([]);
        });

        const mount = async (state = {}) => {
            await page.goto(`${baseUrl}/tests/fixtures/grnImportBrowser.html`);
            await page.waitForFunction(() => typeof window.mountGoodsReceipt === 'function');
            await page.evaluate(state => window.mountGoodsReceipt(state), state);
            await page.waitForSelector('input[type="date"]');
        };
        const dateValue = () => page.$eval('input[type="date"]', el => el.value);
        const setDate = value => page.$eval('input[type="date"]', (el, value) => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }, value);
        const save = async label => {
            const response = page.waitForResponse(res => res.url().includes('/goods-receipts/') && ['POST', 'PUT'].includes(res.request().method()));
            await page.evaluate(label => {
                const button = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === label);
                if (!button || button.disabled) throw new Error('Draft save button is unavailable');
                button.click();
            }, label);
            await response;
            await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(el => el.textContent.includes('Saving…')));
        };

        // Dates alone must trigger automatic form saving and survive a refresh.
        await mount();
        const autoSaved = page.waitForResponse(res => res.url().includes('/drafts/goods-receipt')
            && res.request().method() === 'POST' && JSON.parse(res.request().postData()).data.receiptDate === '2026-01-01');
        await setDate('2026-01-01');
        await autoSaved;
        assert.equal(scratch.receiptDate, '2026-01-01');
        await mount();
        await page.waitForFunction(() => document.querySelector('input[type="date"]').value === '2026-01-01');

        // Recover a full scratch draft, including its backfill flag, then stage it.
        scratch = { selectedSupplier: '1', lines, receiptDate: '2026-01-01', isBackfill: true, physicalReceiptNo: 'DR-DATE-99' };
        await mount();
        await page.waitForFunction(() => document.querySelector('input[type="date"]').value === '2026-01-01');
        await save('Save as draft');
        assert.equal(savedPayload.receipt_date, '2026-01-01T00:00:00+08:00');
        assert.equal(savedPayload.is_backfill, true);

        // An unrelated scratch draft must never overwrite the staged date.
        for (let cycle = 0; cycle < 3; cycle += 1) {
            scratch = { receiptDate: '2025-12-01', isBackfill: false };
            await mount({ grnId: 99 });
            await page.waitForFunction(() => document.body.innerText.includes('GRD-DATE-99'));
            assert.equal(await dateValue(), '2026-01-01');
            await save('Update draft');
            assert.equal(savedPayload.receipt_date, '2026-01-01T00:00:00+08:00');
            assert.equal(header.receipt_date, '2025-12-31T16:00:00.000Z');
        }

        // Intentionally changing the date still works and persists on reopening.
        await setDate('2024-02-29');
        await save('Update draft');
        await mount({ grnId: 99 });
        await page.waitForFunction(() => document.body.innerText.includes('GRD-DATE-99'));
        assert.equal(await dateValue(), '2024-02-29');
        assert.deepEqual(errors, []);
        await page.close();
        console.log(`PASS: GRN received date autosave, staging, repeated reopening, and editing in ${timezone}`);
    }
} finally {
    await browser.close();
}
