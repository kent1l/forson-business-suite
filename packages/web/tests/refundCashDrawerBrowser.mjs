import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const ok = data => ({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
async function scenario(type, drawers) {
    const page = await browser.newPage();
    page.on('pageerror', error => console.error(error.message));
    await page.evaluateOnNewDocument(() => {
        localStorage.setItem('userSession', JSON.stringify({ token: 'browser-test', user: { employee_id: 1, permission_level_id: 10 } }));
        sessionStorage.clear(); // Reproduces never having visited Cash Box.
    });
    const posts = [];
    let drawerCalls = 0;
    await page.setRequestInterception(true);
    page.on('request', req => {
        const path = new URL(req.url()).pathname;
        if (!path.startsWith('/api/')) return req.continue();
        if (req.method() === 'POST') {
            posts.push({ path, body: JSON.parse(req.postData()), key: req.headers()['idempotency-key'] });
            return req.respond({ status: 422, contentType: 'application/json', body: '{"message":"Captured browser payload"}' });
        }
        if (path === '/api/cash-drawers') { drawerCalls++; return req.respond(ok({ data: drawers })); }
        if (path === '/api/settings') return req.respond(ok({ DEFAULT_CURRENCY_SYMBOL: '₱' }));
        if (path === '/api/payment-methods/enabled') return req.respond(ok([]));
        if (path.endsWith('/lines-with-refunds')) return req.respond(ok([{ invoice_line_id: 1, part_id: 1, quantity: 1, quantity_refunded: 0, sale_price: 100, tax_rate_snapshot: 0, discount_amount: 0, display_name: 'Original item' }]));
        if (path === '/api/power-search/parts') return req.respond(ok([{ part_id: 2, display_name: 'Replacement item', last_sale_price: 60, tax_rate_percentage: 0 }]));
        return req.respond(ok([]));
    });
    await page.goto(`${process.env.CASH_BROWSER_BASE_URL || 'http://localhost:5173'}/tests/fixtures/refundCashDrawerBrowser.html`);
    await page.waitForFunction(() => typeof window.mountCorrection === 'function');
    await page.evaluate(t => window.mountCorrection(t), type);
    await page.waitForSelector('input[type="checkbox"]');
    await page.click('input[type="checkbox"]');
    if (type === 'exchange') {
        await page.type('input[placeholder="Search replacement part…"]', 'Replacement');
        await page.waitForSelector('#exchange-part-search-results li');
        await page.click('#exchange-part-search-results li');
    }
    if (!await page.evaluate(() => window.cashBoxEnabled)) {
        assert.equal(await page.evaluate(() => window.cashBoxNavItems.some(item => item.page === 'cash_drawer')), false);
        assert.equal(await page.evaluate(() => document.body.textContent.includes('Select an open cash drawer')), false);
        const submit = type === 'refund' ? 'Confirm Refund' : 'Process Exchange';
        await page.waitForFunction(text => ![...document.querySelectorAll('button')].find(button => button.textContent.trim() === text)?.disabled, {}, submit);
        const sent = page.waitForResponse(response => response.request().method() === 'POST');
        await page.evaluate(text => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text).click(), submit);
        await sent;
        assert.equal(posts.length, 1);
        assert.equal(posts[0].body.cash_session_id, undefined);
        assert.equal(drawerCalls, 0);
        await page.close();
        return;
    }
    await page.waitForFunction(() => document.querySelectorAll('select option').length >= 1 && !document.body.textContent.includes('Loading cash drawers…'));
    const submitText = type === 'refund' ? 'Confirm Refund' : 'Process Exchange';
    const disabled = () => page.evaluate(text => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text)?.disabled, submitText);
    if (drawers.filter(item => item.status === 'OPEN').length !== 1) {
        assert.equal(await disabled(), true, 'ambiguous or absent drawer blocks submission');
    }
    if (!drawers.some(item => item.status === 'OPEN')) {
        assert.equal(posts.length, 0);
        await page.close();
        return;
    }
    const select = await page.$('select');
    if (type === 'refund') {
        const selects = await page.$$('select');
        await selects[1].select('22');
    } else await select.select('22');
    await page.waitForFunction(text => ![...document.querySelectorAll('button')].find(button => button.textContent.trim() === text)?.disabled, {}, submitText);
    const sent = page.waitForResponse(response => response.request().method() === 'POST');
    await page.evaluate(text => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text).click(), submitText);
    await sent;
    assert.equal(posts.length, 1);
    assert.equal(posts[0].body.cash_session_id, '22');
    assert.match(posts[0].key, /^[0-9a-f-]{36}$/);
    if (type === 'exchange') assert.equal(posts[0].body.downgrade_disposition, 'cash_payout');
    await page.close();
}
try {
    for (const type of ['refund', 'exchange']) {
        await scenario(type, [{ session_id: 22, name: 'Main Counter', status: 'OPEN' }]);
        await scenario(type, [{ session_id: 21, name: 'First', status: 'OPEN' }, { session_id: 22, name: 'Second', status: 'OPEN' }]);
        await scenario(type, [{ session_id: 22, name: 'Closing', status: 'CLOSING' }]);
    }
    console.log('PASS: refund/exchange respect the Cash Box rollout flag; disabled mode hides navigation and drawer selection and submits without a drawer');
} finally { await browser.close(); }
