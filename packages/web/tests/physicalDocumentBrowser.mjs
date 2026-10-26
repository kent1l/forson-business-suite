import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

// docker exec -i forson_backend_dev node --input-type=module < packages/web/tests/physicalDocumentBrowser.mjs
const baseUrl = process.env.RECEIPT_BROWSER_BASE_URL || 'http://forson_frontend_dev:5173';
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', req => {
        const path = new URL(req.url()).pathname;
        if (!path.startsWith('/api/')) return req.continue();
        const respond = data => req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
        if (path === '/api/physical-documents/options') return respond({
            series: [{ series_id: 1, prefix: 'SI', method: 'HIGHEST_PLUS_ONE' }],
            choices: [{ key: '1', series_id: 1, recording_method: 'PAPER', label: 'SI' }],
            policy: { default_choice: '1' },
        });
        if (path === '/api/physical-documents/suggestion') return respond({
            canonical_reference: 'SI-100', suggestion_token: 'fixture-token',
        });
        return respond([]);
    });
    await page.goto(`${baseUrl}/tests/fixtures/physicalDocumentBrowser.html`);
    await page.waitForFunction(() => document.querySelector('input[type="text"]')?.value === 'SI-100');
    const edit = async number => {
        const input = await page.$('input[type="text"]');
        await input.click({ clickCount: 3 });
        await input.type(number);
        await input.press('Tab');
        await page.waitForSelector('[role="dialog"]');
    };
    const clickButton = async text => page.evaluate(text => {
        [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text).click();
    }, text);

    await edit('101');
    await page.click('input[value="SPOILED_SUGGESTION"]');
    await clickButton('Continue');
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    const confirmed = await page.evaluate(() => ({
        value: window.physicalDocumentValue,
        input: document.querySelector('input[type="text"]').value,
        classes: document.querySelector('input[type="text"]').className,
        status: document.querySelector('[role="status"]').textContent.trim(),
    }));
    assert.equal(confirmed.input, 'SI-101');
    assert.equal(confirmed.value.suggestion_token, 'fixture-token');
    assert.equal(confirmed.value.exception.spoiled_reference, 'SI-100');
    assert.equal(confirmed.value.exception.entered_reference, 'SI-101');
    assert.ok(!confirmed.classes.includes('amber'));
    assert.equal(confirmed.status, 'Suggested receipt SI-100 will be marked spoiled at checkout.');
    // Returning to the receipt field must retain the already confirmed override.
    await page.click('input[type="text"]');
    await page.keyboard.press('Tab');
    assert.equal(await page.$('[role="dialog"]'), null);

    await edit('102');
    await clickButton('Go back (Esc)');
    await page.waitForFunction(() => document.querySelector('input[type="text"]')?.value === 'SI-100');
    assert.equal(await page.evaluate(() => window.physicalDocumentValue.exception), null);
    assert.equal(await page.$('[role="status"]'), null);
    assert.deepEqual(errors, []);
    console.log('Receipt override browser checks passed: replacement remains normal, original spoilage is explicit, cancel restores suggestion.');
} finally {
    await browser.close();
}
