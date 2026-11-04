import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
const errors = [], requests = [];
const combinations = [
    { application_id: 1, make_id: 1, model_id: 11, make: 'Isuzu', model: 'Elf', chassis: 'NKR', engine_id: 101, engine: '4BC2', transmission: 'Manual', drivetrain: '2WD', market: 'PH', variant: 'GL', year_start: 1990, year_end: 1995, linked_parts_count: 3, row_version: 7 },
    { application_id: 2, make_id: 1, model_id: 11, make: 'Isuzu', model: 'Elf', chassis: 'NPR', engine_id: 102, engine: '4BE1', transmission: 'Automatic', year_start: 2000, year_end: 2005, linked_parts_count: 0, row_version: 2 },
];
let rows = structuredClone(combinations), empty = false, failList = false;
page.on('pageerror', error => errors.push(error.message));
await page.setRequestInterception(true);
page.on('request', req => {
    const url = new URL(req.url()), path = url.pathname;
    if (!path.startsWith('/api/')) return req.continue();
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    requests.push({ path, method: req.method(), body, params: Object.fromEntries(url.searchParams) });
    const respond = (data, status = 200) => req.respond({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/api/applications' && req.method() === 'GET') {
        if (failList) return respond({ message: 'Fixture unavailable' }, 500);
        return respond({ data: empty ? [] : [{ group_key: 'model:11', make: 'Isuzu', model: 'Elf', combinations: rows }], page: 1, pageSize: 25, total: empty ? 0 : 1 });
    }
    if (path === '/api/applications/2' && req.method() === 'PUT') return respond({ ...rows[1], ...body });
    if (path === '/api/applications/2' && req.method() === 'DELETE') { rows = rows.filter(row => row.application_id !== 2); return respond({ message: 'Deleted' }); }
    if (path === '/api/makes') return respond([{ make_id: 1, make_name: 'Isuzu' }]);
    if (path === '/api/makes/1/models') return respond([{ model_id: 11, model_name: 'Elf' }]);
    if (path === '/api/engines') return respond([{ engine_id: 101, engine_code: '4BC2' }, { engine_id: 102, engine_code: '4BE1' }]);
    return respond([]);
});

const clickText = async text => page.evaluate(value => {
    const button = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === value);
    if (!button) throw Error(`Missing button: ${value}`);
    button.click();
}, text);

try {
    await page.goto(`${process.env.FITMENT_BROWSER_BASE_URL || 'http://localhost:5173'}/tests/fixtures/applicationModelsBrowser.html`);
    await page.waitForFunction(() => typeof window.mountApplications === 'function');
    for (const width of [390, 1280]) {
        rows = structuredClone(combinations);
        await page.setViewport({ width, height: 1000 });
        await page.evaluate(() => window.mountApplications(true));
        await page.waitForSelector('button[aria-label="Show combinations for Isuzu Elf"]');
        assert.equal(await page.$$eval('table > tbody > tr', nodes => nodes.length), 1);
        assert.deepEqual(await page.$$eval('table > thead > tr > th', nodes => nodes.slice(0, 4).map(node => node.textContent.trim())), ['Make', 'Model', 'Engine', 'Chassis']);
        assert.ok(await page.evaluate(() => document.body.textContent.includes('4BC2/E1')));
        assert.ok(!(await page.evaluate(() => document.body.textContent)).includes('Not specified'));
        assert.ok(await page.evaluate(() => document.body.textContent.includes('1 model group')));
        await page.focus('button[aria-label="Show combinations for Isuzu Elf"]');
        await page.keyboard.press('Enter');
        await page.waitForSelector('button[aria-label="Edit combination 2"]');
        const entryText = await page.$eval('button[aria-label="Edit combination 2"]', button => button.closest('tr').textContent);
        assert.ok(entryText.includes('NPR') && entryText.includes('4BE1') && entryText.includes('Automatic'));
        assert.ok(!entryText.includes('Manual'));
        assert.ok(!/not specified/i.test(await page.evaluate(() => document.body.textContent)));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (width === 1280) await page.screenshot({ path: '/tmp/application-models-expanded.png', fullPage: true });
        await page.click('button[aria-label="Edit combination 2"]');
        await page.waitForFunction(() => document.body.textContent.includes('Edit Vehicle Combination'));
        await clickText('Save');
        await page.waitForFunction(() => !document.body.textContent.includes('Edit Vehicle Combination'));
        const save = requests.filter(req => req.method === 'PUT').at(-1);
        assert.equal(save.path, '/api/applications/2');
        assert.equal(save.body.expected_version, 2);
        assert.equal(save.body.engine_id, 102);
        await page.waitForSelector('button[aria-label="Delete combination 2"]');
        await page.click('button[aria-label="Delete combination 2"]');
        await clickText('Delete');
        await page.waitForFunction(() => !document.querySelector('button[aria-label="Edit combination 2"]'));
        // Re-mount as a viewer and verify management actions are absent.
        await page.evaluate(() => window.mountApplications(false));
        await page.waitForSelector('button[aria-label="Show combinations for Isuzu Elf"]');
        await page.click('button[aria-label="Show combinations for Isuzu Elf"]');
        assert.equal(await page.$$eval('button[aria-label^="Edit combination"], button[aria-label^="Delete combination"]', nodes => nodes.length), 0);
        assert.ok(!(await page.evaluate(() => document.body.textContent)).includes('Add Combination'));
    }
    rows = Array.from({ length: 8 }, (_, index) => ({
        ...combinations[0], application_id: index + 10, chassis: `CHASSIS-${index}`, engine: `ENGINE-${index}`,
    }));
    await page.evaluate(() => window.mountApplications(true));
    await page.waitForSelector('button[aria-label="Show all chassis for Isuzu Elf"]');
    assert.equal(await page.$$eval('table > tbody > tr', nodes => nodes.length), 1);
    await page.click('button[aria-label="Show all chassis for Isuzu Elf"]');
    await page.waitForSelector('button[aria-label="Edit combination 17"]');
    assert.equal(await page.$$eval('table table > tbody > tr', nodes => nodes.length), 8);
    assert.ok(await page.evaluate(() => document.body.textContent.includes('CHASSIS-7')));
    empty = true;
    await page.evaluate(() => window.mountApplications(true));
    await page.waitForFunction(() => document.body.textContent.includes('No vehicle applications yet'));
    failList = true;
    await page.evaluate(() => window.mountApplications(false));
    await page.waitForSelector('[role="alert"]');
    assert.ok(requests.filter(req => req.path === '/api/applications').every(req => req.params.groupBy === 'model'));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'pass', viewports: [390, 1280], checks: ['one model row', 'engine shorthand', 'keyboard expansion', 'exact pairings', 'versioned editing', 'individual deletion', 'viewer permissions', 'long summary disclosure', 'no page overflow', 'empty and error states'], api: 'intercepted contract fixtures; PostgreSQL checked separately' }));
} catch (error) {
    console.error(JSON.stringify({ browserErrors: errors, requests: requests.slice(-5), url: page.url() }));
    throw error;
} finally { await browser.close(); }
