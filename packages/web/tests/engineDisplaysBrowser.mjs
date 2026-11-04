import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
const errors = [], writes = [];
const base = { make_id: 1, make: 'Isuzu', model_id: 2, model: 'Elf', chassis: 'NKR', position: 'Front Left', transmission: 'Manual' };
const fitments = [{ ...base, application_id: 1, rule_id: 1, engine_id: 1, engine: '4BC2' }, { ...base, application_id: 2, rule_id: 2, engine_id: 2, engine: '4BE1' }];
const part = { part_id: 1, display_name: 'Fixture filter', internal_sku: 'FX-1', brand_id: 1, group_id: 1, applications: fitments, fitment_rules: fitments };
page.on('pageerror', error => errors.push(error.message));
await page.setRequestInterception(true);
page.on('request', req => {
    const path = new URL(req.url()).pathname;
    if (!path.startsWith('/api/')) return req.continue();
    if (req.method() !== 'GET') writes.push({ path, method: req.method() });
    const respond = data => req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/api/settings') return respond({});
    if (path === '/api/parts/1/applications' || path === '/api/application-search') return respond(fitments);
    if (path === '/api/makes') return respond([{ make_id: 1, make_name: 'Isuzu' }]);
    if (path === '/api/makes/1/models') return respond([{ model_id: 2, model_name: 'Elf' }]);
    if (path === '/api/engines') return respond([{ engine_id: 1, engine_code: '4BC2' }, { engine_id: 2, engine_code: '4BE1' }]);
    return respond([]);
});
try {
    await page.goto(`${process.env.FITMENT_BROWSER_BASE_URL || 'http://localhost:5173'}/tests/fixtures/searchFitmentsBrowser.html`);
    await page.waitForFunction(() => typeof window.mountEngineDisplays === 'function');
    for (const width of [390, 1280]) {
        await page.setViewport({ width, height: 1000 });
        await page.evaluate(data => window.mountEngineDisplays('engine', data), part);
        await page.waitForSelector('[title="4BC2, 4BE1"]');
        assert.equal(await page.$eval('[aria-hidden]', node => node.textContent), '4BC2/E1');
        assert.equal(await page.$eval('.sr-only', node => node.textContent), '4BC2, 4BE1');
        await page.evaluate(data => window.mountEngineDisplays('cleanup', data), part);
        await page.waitForFunction(() => document.body.textContent.includes('Fixture filter'));
        await page.click('button');
        await page.waitForFunction(() => document.body.textContent.includes('4BC2/E1'));
        await page.evaluate(data => window.mountEngineDisplays('manager', data), part);
        await page.waitForFunction(() => document.body.textContent.includes('4BC2/E1'));
        assert.equal(await page.$$eval('button[title="Edit Link Details"]', nodes => nodes.length), 2);
        assert.equal(await page.$$eval('button[title="Unlink"]', nodes => nodes.length), 2);
        await page.evaluate(data => window.mountEngineDisplays('form', data), part);
        await page.waitForSelector('button[aria-label^="Remove Front Left"]');
        assert.equal(await page.$$eval('button[aria-label^="Remove Front Left"]', nodes => nodes.length), 2);
        const labels = await page.$$eval('button[aria-label^="Remove Front Left"]', nodes => nodes.map(node => node.getAttribute('aria-label')));
        assert.ok(labels.some(label => label.includes('4BC2')) && labels.some(label => label.includes('4BE1')));
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    console.log(JSON.stringify({ status: 'pass', viewports: [390, 1280], checks: ['reusable engine label', 'complete tooltip and accessible codes', 'cleanup shorthand', 'manager shorthand', 'individual edit/unlink controls', 'atomic staged labels', 'no writes'], api: 'intercepted browser fixtures' }));
} catch (error) {
    console.error(JSON.stringify({ browserErrors: errors, writes }));
    throw error;
} finally { await browser.close(); }
