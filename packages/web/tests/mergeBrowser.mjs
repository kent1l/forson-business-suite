import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const address = server.httpServer.address();
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

const kinds = ['supplier', 'customer', 'brand', 'group'];
const config = kind => ({
    plural: `${kind}s`,
    id: `${kind}_id`,
    name: kind === 'supplier' || kind === 'customer' ? 'display_name' : `${kind}_name`,
    code: `${kind}_code`,
});
const preview = conflicts => ({
    impact: { [`${conflicts ? 'goods_receipt' : 'part'}.${conflicts ? 'supplier_id' : 'brand_id'}`]: 1, parts_reassigned: 1 },
    conflicts: conflicts ? [{ table: 'goods_receipt', reason: 'duplicate receipt', recordIds: [10, 11] }] : [],
    postconditionScope: ['part'],
    previewFingerprint: 'a'.repeat(64),
    previewToken: 'browser-test-token',
});

async function clickText(page, label) {
    await page.waitForFunction(text => [...document.querySelectorAll('button')].some(node => node.textContent.trim() === text), {}, label);
    const clicked = await page.evaluate(text => {
        const node = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text);
        if (!node) return false;
        node.click();
        return true;
    }, label);
    assert.ok(clicked, `button ${label} was present`);
}

async function runCase(kind, stage = 'execute') {
    const cfg = config(kind);
    const page = await browser.newPage();
    const requests = [];
    let conflict = kind === 'supplier';
    let staleOnce = kind === 'customer';
    let previewCount = 0;
    const record = id => ({ [cfg.id]: id, [cfg.name]: id === 1 ? 'Canonical' : 'Duplicate', [cfg.code]: `${kind[0].toUpperCase()}${id}`, part_count: 1, reference_count: 1, is_merged: false });
    const suggestion = {
        suggestion_id: 7, [cfg.id]: 1, [`duplicate_${cfg.id}`]: 2,
        [cfg.name]: 'Canonical', [`duplicate_${cfg.name}`]: 'Duplicate',
        [cfg.code]: `${kind[0].toUpperCase()}1`, [`duplicate_${cfg.code}`]: `${kind[0].toUpperCase()}2`,
        confidence_score: 0.95, detection_method: 'test',
    };
    const operation = {
        operation_id: 9, source_ids: [2], canonical_id: 1, sources: [{ id: 2, name: 'Duplicate' }],
        canonical: { id: 1, name: 'Canonical' }, status: 'active', revertEligible: true,
        started_at: new Date().toISOString(), actor_name: 'Test Actor', impact: { references: {} },
    };
    await page.evaluateOnNewDocument(() => localStorage.setItem('userSession', JSON.stringify({ user: { permission_level_id: 10 }, token: 'test', permissions: [] })));
    await page.setRequestInterception(true);
    page.on('request', request => {
        const url = new URL(request.url());
        if (!url.pathname.startsWith('/api/')) return request.continue();
        const route = url.pathname.slice(5);
        const body = request.postData() ? JSON.parse(request.postData()) : null;
        requests.push({ route, body });
        let result = {};
        let status = 200;
        if (route === `${cfg.plural}/merge-directory`) result = { items: [record(1), record(2)] };
        else if (route === cfg.plural) result = [record(1), record(2)];
        else if (route === `${cfg.plural}/duplicate-suggestions`) result = { suggestions: [suggestion] };
        else if (route === `${cfg.plural}/merge-history`) result = { operations: [operation] };
        else if (route === `${cfg.plural}/merge-preview`) { previewCount += 1; result = preview(conflict); }
        else if (route === `${cfg.plural}/merge`) {
            if (staleOnce) { staleOnce = false; status = 409; result = { message: 'Review changed' }; }
            else result = { result: { mergedIds: [2], partsReassigned: 1 } };
        } else if (route === `${cfg.plural}/merge-history/9/revert`) result = { ok: true };
        if (stage === 'off' && route !== cfg.plural) {
            status = 503;
            result = { message: 'Master-data merge is not enabled at this rollout stage.' };
        }
        request.respond({ status, contentType: 'application/json', headers: { 'X-Master-Data-Merge-Stage': stage }, body: JSON.stringify(result) });
    });
    try {
        await page.goto(`http://127.0.0.1:${address.port}/tests/fixtures/mergeHarness.html?kind=${kind}`);
        if (stage === 'off') {
            await page.waitForFunction(() => document.body.textContent.includes('Duplicate cleanup is not enabled') && !document.body.textContent.includes('Loading directory'));
            assert.equal(await page.evaluate(() => [...document.querySelectorAll('input')].some(input => input.value === 'Canonical')), kind === 'brand' || kind === 'group');
            assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === 'Scan for duplicates')?.disabled), true);
            return;
        }
        await clickText(page, 'Review merge');
        await page.waitForFunction(() => document.body.textContent.includes('The merge checks that no operational references remain'));
        const confirmLabel = kind === 'supplier' || kind === 'customer' ? 'Confirm merge' : 'Merge 1 into canonical';
        if (conflict) {
            const disabled = await page.evaluate(label => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === label)?.disabled, confirmLabel);
            assert.equal(disabled, true, 'conflict disables execution');
            await clickText(page, 'Open records');
            assert.equal(await page.evaluate(() => window.__navigated), 'goods_receipt_history');
            conflict = false;
            await clickText(page, 'Cancel');
            await clickText(page, 'Review merge');
            await page.waitForFunction(() => document.body.textContent.includes('The merge checks that no operational references remain'));
        }
        const disabledBeforeAck = await page.evaluate(label => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === label)?.disabled, confirmLabel);
        assert.equal(disabledBeforeAck, true, 'acknowledgment required');
        await page.evaluate(() => [...document.querySelectorAll('label')].find(node => node.textContent.includes('I understand that historical documents'))?.querySelector('input').click());
        if (stage === 'preview') {
            const disabled = await page.evaluate(label => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === label)?.disabled, confirmLabel);
            assert.equal(disabled, true, 'preview stage keeps execution disabled after acknowledgment');
            assert.equal(await page.evaluate(() => document.body.textContent.includes('Preview mode: you can review duplicates')), true);
            assert.equal(requests.some(item => item.route === `${cfg.plural}/merge`), false);
            return;
        }
        await clickText(page, confirmLabel);
        if (kind === 'customer') {
            await page.waitForFunction(label => {
                const button = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === label);
                return button?.disabled && document.body.textContent.includes('The merge checks that no operational references remain');
            }, {}, confirmLabel);
            assert.ok(previewCount >= 2, 'stale conflict caused a fresh preview');
            const disabledAfterStale = await page.evaluate(label => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === label)?.disabled, confirmLabel);
            assert.equal(disabledAfterStale, true, 'stale preview resets acknowledgment');
            await page.evaluate(() => [...document.querySelectorAll('label')].find(node => node.textContent.includes('I understand that historical documents'))?.querySelector('input').click());
            await clickText(page, confirmLabel);
        }
        await page.waitForFunction(() => !document.body.textContent.includes('I understand that historical documents'));
        const mergeCalls = requests.filter(item => item.route === `${cfg.plural}/merge`);
        assert.ok(mergeCalls.length >= 1);
        for (const call of mergeCalls) {
            assert.equal(call.body.acknowledgeHistoricalDocuments, true);
            assert.equal(call.body.previewFingerprint, 'a'.repeat(64));
            assert.equal(call.body.previewToken, 'browser-test-token');
        }
        await clickText(page, 'Review revert');
        await page.type('textarea', 'Browser verification');
        await clickText(page, 'Confirm revert');
        await page.waitForFunction(() => !document.body.textContent.includes('Reason for reverting'));
        assert.deepEqual(requests.find(item => item.route === `${cfg.plural}/merge-history/9/revert`)?.body, { reason: 'Browser verification' });
    } finally {
        await page.close();
    }
}

try {
    for (const kind of kinds) {
        await runCase(kind);
        process.stdout.write(`${kind} merge browser flow passed\n`);
    }
    for (const kind of ['supplier', 'brand']) {
        await runCase(kind, 'preview');
        process.stdout.write(`${kind} preview-only browser flow passed\n`);
    }
    for (const kind of ['supplier', 'brand']) {
        await runCase(kind, 'off');
        process.stdout.write(`${kind} disabled-stage browser flow passed\n`);
    }
} finally {
    await browser.close();
    await server.close();
}
