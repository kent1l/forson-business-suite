import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
const errors = [], mutations = [];
page.on('pageerror', error => errors.push(error.message));
const fitment = { make: 'Isuzu', make_id: 1, model: 'Elf', model_id: 2, chassis: 'NKR', transmission: 'Manual', year_start: 1990, year_end: 1995 };
const part = {
    part_id: 1, display_name: 'Fixture oil filter', internal_sku: 'TEST-1', stock_on_hand: 10, last_sale_price: 100, measurement_unit: 'PC',
    applications: ['Uncompressed stale index label'],
    fitment_rules: [{ ...fitment, position: 'Front Left', engine: '4BC2' }, { ...fitment, position: 'Front Left', engine: '4BE1' }, { ...fitment, position: 'Rear Right', engine: '4BE1', chassis: 'NPR', transmission: 'Automatic' }, { make: 'Isuzu', make_id: 1, model: 'Elf', model_id: 2 }],
};
await page.setRequestInterception(true);
page.on('request', req => {
    const url = new URL(req.url()), path = url.pathname;
    if (!path.startsWith('/api/')) return req.continue();
    if (req.method() !== 'GET') mutations.push({ method: req.method(), path });
    const respond = data => req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/api/settings') return respond({ PAYMENT_METHODS: 'Cash', DEFAULT_CURRENCY_SYMBOL: '₱' });
    if (path === '/api/power-search/parts') return respond([part]);
    if (path === '/api/parts') return respond({ data: [part], total: 1, page: 1, pageSize: 25 });
    if (path === '/api/parts/1') return respond(part);
    if (path === '/api/drafts/po') return respond({ data: [] });
    return respond([]);
});
const placeholders = {
    pos: 'Scan or search (Ctrl+F)...',
    invoice: 'Search by part name, SKU, or application (Ctrl+F)... (Enter to scan barcode/SKU)',
    power: 'Search by SKU, Name, Part Number, Brand, or Application...',
    receive: 'Search by part name or SKU...',
    purchase: 'Search for parts to add...',
};
try {
    await page.goto(`${process.env.FITMENT_BROWSER_BASE_URL || 'http://localhost:5173'}/tests/fixtures/searchFitmentsBrowser.html`);
    await page.waitForFunction(() => typeof window.mountSearchFitments === 'function');
    for (const width of [390, 1280]) {
        await page.setViewport({ width, height: 1000 });
        for (const kind of ['pos', 'invoice', 'power', 'parts', 'receive', 'purchase']) {
            await page.evaluate(mode => window.mountSearchFitments(mode), kind);
            if (kind !== 'parts') {
                const selector = `input[placeholder="${placeholders[kind]}"]`;
                await page.waitForSelector(selector);
                await page.type(selector, 'filter');
            }
            await page.waitForSelector('.part-fitment-text');
            const rendered = await page.$eval('.part-fitment-text', node => ({
                visible: node.querySelector('[aria-hidden]').textContent,
                full: node.title,
                accessible: node.querySelector('.sr-only').textContent,
                width: node.getBoundingClientRect().width,
            }));
            assert.ok(rendered.visible.includes('4BC2/E1'), `${kind} at ${width}: ${rendered.visible}`);
            assert.ok(rendered.visible.startsWith('Front Left · Isuzu Elf'));
            assert.ok(rendered.full.startsWith('Front Left · Isuzu Elf'));
            assert.ok(rendered.visible.includes('Rear Right · Isuzu Elf'));
            assert.ok(rendered.visible.includes('4BE1 · Chassis: NPR · 90-95 · Automatic'));
            assert.ok(!rendered.visible.includes('stale'));
            assert.ok(!/not specified|\(\)/i.test(rendered.visible + rendered.full));
            assert.ok(rendered.full.includes('4BC2, 4BE1') && rendered.full.includes('1990-1995'));
            assert.equal(rendered.accessible, rendered.full);
            assert.ok(rendered.width > 40, `${kind} at ${width}: fitment text should have room (${rendered.width}px)`);
            if (kind === 'pos' && width === 1280) await page.screenshot({ path: '/tmp/search-fitments-pos.png', fullPage: true });
        }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(mutations, []);
    console.log(JSON.stringify({ status: 'pass', viewports: [390, 1280], pages: ['POS', 'Invoicing', 'Power Search', 'Parts', 'Goods Receipt', 'Purchase Order'], checks: ['shared shorthand', 'separate contexts', 'structured data preferred', 'full codes in tooltip and accessible text', 'search remains read-only'], api: 'intercepted fixtures; PostgreSQL verified separately' }));
} catch (error) {
    await page.screenshot({ path: '/tmp/search-fitments-failure.png', fullPage: true });
    console.error(JSON.stringify({ browserErrors: errors, mutations }));
    throw error;
} finally { await browser.close(); }
