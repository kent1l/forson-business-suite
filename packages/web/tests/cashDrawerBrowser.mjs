import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const admin = { employee_id: 1, permission_level_id: 10, permissions: [] };
const cashier = { employee_id: 2, permission_level_id: 20, permissions: ['cash_drawer:view'] };
const manager = { employee_id: 3, permission_level_id: 21, permissions: ['cash_drawer:view', 'cash_drawer:open', 'cash_drawer:review'] };
const session = (status = 'CLOSED', id = 9) => ({
    session_id: id, session_code: `CD-${id}`, drawer_id: 1, business_date: '2026-10-08',
    custodian_id: 1, custodian_name: 'Test Custodian', opening_amount: '100.00',
    expected: '100.00', total_in: '0.00', total_out: '0.00', version: 3,
    last_sequence: 0, status, latest_count: status === 'CLOSING' ? {
        count_id: 17, kind: 'CLOSING', status: 'SUBMITTED', cutoff_sequence: 0,
        expected: '100.00', counted: '100.00', variance: '0.00',
    } : null,
    close_snapshot: status === 'CLOSED' ? {
        expected: '100.00', counted: '100.00', variance: '0.00',
        retained_actual: '100.00', retained_ledger: '100.00',
    } : null,
});
const ok = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function scenario(label, { rows = [], active = null, user = admin, mobile = false, failCustody = false, failClose = false } = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width: mobile ? 390 : 1280, height: 850 });
    await page.setRequestInterception(true);
    const calls = [];
    page.on('request', request => {
        const url = new URL(request.url());
        if (!url.pathname.startsWith('/api/cash-drawers')) return request.continue();
        calls.push(`${request.method()} ${url.pathname}${url.search}`);
        const path = url.pathname;
        if (request.method() === 'POST' && path.endsWith('/handover-ack')) return request.respond(ok({ data: { token: 'a'.repeat(64), expires_in_seconds: 300 } }));
        if (request.method() === 'POST' && path.endsWith('/close') && failClose) return request.abort('failed');
        if (path.includes('/requests/')) return request.respond(ok({ data: { status_code: 201, response: { data: {} } } }));
        if (path === '/api/cash-drawers') return request.respond(ok({ data: [
            { drawer_id: 1, name: 'Main Counter', hardware_mode: 'MANUAL_CASH_BOX', session_id: active?.session_id, status: active?.status },
            { drawer_id: 2, name: 'Second Box', hardware_mode: 'MANUAL_CASH_BOX' },
        ] }));
        if (path === '/api/cash-drawers/custodians' || path === '/api/cash-drawers/employees')
            return request.respond(ok({ data: [{ employee_id: 1, name: 'Test Custodian' }, { employee_id: 2, name: 'Recipient' }] }));
        if (path === '/api/cash-drawers/sessions') {
            const drawerRows = url.searchParams.get('drawer_id') === '2' ? [] : rows;
            const pageNumber = Number(url.searchParams.get('page') || 1);
            return request.respond(ok({ data: pageNumber > 1 ? [] : drawerRows, page: pageNumber, total: drawerRows.length + (drawerRows.length ? 50 : 0) }));
        }
        if (/\/sessions\/\d+\/movements$/.test(path)) return request.respond(ok({ data: [], total: 0 }));
        if (/\/sessions\/\d+\/counts$/.test(path)) return request.respond(ok({ data: active?.latest_count ? [active.latest_count] : [], total: active?.latest_count ? 1 : 0 }));
        if (/\/sessions\/\d+\/custody$/.test(path)) return request.respond(failCustody ? { status: 500, body: '{}' } : ok({ transfers: [], advances: [] }));
        if (/\/sessions\/\d+\/approvals$/.test(path)) return request.respond(ok({ data: [] }));
        if (/\/sessions\/\d+\/activity$/.test(path)) return request.respond(ok({ data: [], total: 0 }));
        if (/\/sessions\/\d+$/.test(path)) return request.respond(ok({ data: active || rows[0] }));
        return request.respond(ok({ data: [] }));
    });
    await page.goto('http://localhost:5173/tests/fixtures/cashDrawerBrowser.html');
    await page.waitForFunction(() => typeof window.mountCashDrawer === 'function');
    await page.evaluate(data => window.mountCashDrawer(data), user);
    await page.waitForSelector('h1');
    await page.waitForFunction(() => document.body.textContent.includes('History'));
    const clickHistory = async () => {
        await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].find(button => button.textContent === 'History').click());
        await page.waitForFunction(() => document.body.textContent.includes('Session history'));
    };
    if (!rows.length && !active) {
        await page.waitForFunction(() => document.body.textContent.includes('No session open.'));
        await clickHistory();
        await page.waitForFunction(() => document.body.textContent.includes('No sessions match these filters'));
        assert.equal(await page.$('form input[type="date"]'), null, 'opening form stays hidden until chosen');
        if (user === admin || user.permissions?.includes('cash_drawer:open')) {
            await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Open cash box').click());
            await page.waitForSelector('form input[type="date"]');
        } else {
            assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Open cash box')), false);
        }
    } else {
        await clickHistory();
        await page.waitForFunction(() => document.body.textContent.includes('CD-9'));
        await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'View').click());
        await page.waitForFunction(() => document.body.textContent.includes('Immutable close:') || document.body.textContent.includes('Session remains active.'));
        if (failCustody) assert.match(await page.evaluate(() => document.body.textContent), /Some detail could not load|Some cash box data could not load/);
        await page.evaluate(() => { const status = [...document.querySelectorAll('label')].find(label => label.textContent.includes('Status')); status?.querySelector('select')?.dispatchEvent(new Event('change', { bubbles: true })); });
        assert(calls.some(call => call.includes('/sessions?')));
        if (active?.status === 'CLOSING' && failClose) {
            await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].find(button => button.textContent === 'Today').click());
            await page.evaluate(() => [...document.querySelectorAll('input[type="checkbox"]')].find(input => input.parentElement?.textContent.includes('checked the source'))?.click());
            const button = text => page.evaluate(t => [...document.querySelectorAll('button')].find(item => item.textContent === t)?.click(), text);
            await button('Continue to final count');
            await button('Continue to variance review');
            await button('Continue to handover');
            await page.evaluate(() => {
                const inputs = [...document.querySelectorAll('input')];
                const set = (label, value) => {
                    const input = [...document.querySelectorAll('label')].find(node => node.textContent.includes(label))?.querySelector('input,select');
                    const setter = Object.getOwnPropertyDescriptor(input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set;
                    setter.call(input, value);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                };
                void inputs;
                set('Final handover amount', '10.00');
                set('Destination', 'Safe');
                set('Recipient', '2');
                set('Acknowledgment evidence', 'Signed');
                set('Recipient password', 'sensitive-password');
            });
            await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Authenticate recipient' && !button.disabled));
            await button('Authenticate recipient');
            await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Review close' && !button.disabled));
            const stored = await page.evaluate(() => JSON.stringify(sessionStorage));
            assert(!stored.includes('sensitive-password'));
            await button('Review close');
            await button('Confirm close');
            await page.waitForFunction(() => document.body.textContent.includes('Retry pending request with original key'));
            const pending = await page.evaluate(() => Object.entries(sessionStorage).find(([key]) => key.includes('cash-box-write:'))?.[1]);
            assert(pending && !pending.includes('sensitive-password') && !pending.includes('ack_token'));
        }
    }
    process.stdout.write(`PASS browser ${label}\n`);
    return page;
}

try {
    const first = await scenario('desktop first use');
    await first.close();
    const mobile = await scenario('mobile first use', { mobile: true });
    await mobile.close();
    const restricted = await scenario('restricted view role', { user: cashier });
    await restricted.close();
    const managerView = await scenario('manager opening permission', { user: manager });
    await managerView.close();
    const closed = await scenario('closed history without new opening', { rows: [session()] });
    await closed.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Next' && !button.disabled));
    await closed.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Next')?.click());
    await closed.waitForFunction(() => document.body.textContent.includes('Page 2 of'));
    await closed.evaluate(() => {
        const picker = document.querySelector('select[aria-label="Drawer"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(picker, '2');
        picker.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await closed.waitForFunction(() => document.body.textContent.includes('No sessions match these filters'));
    assert.equal(await closed.evaluate(() => document.body.textContent.includes('CD-9')), false);
    process.stdout.write('PASS browser history pagination and drawer switch\n');
    await closed.close();
    const open = await scenario('open state and partial failure', { rows: [session('OPEN')], active: session('OPEN'), failCustody: true });
    await open.close();
    const closing = await scenario('closing state', { rows: [session('CLOSING')], active: session('CLOSING') });
    await closing.close();
    const lost = await scenario('secret-free lost close response', { rows: [session('CLOSING')], active: session('CLOSING'), failClose: true });
    await lost.reload();
    await lost.waitForFunction(() => typeof window.mountCashDrawer === 'function');
    await lost.evaluate(data => window.mountCashDrawer(data), admin);
    await lost.waitForFunction(() => document.body.textContent.includes('Retry pending request with original key'));
    await lost.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Retry pending request with original key').click());
    await lost.waitForFunction(() => !document.body.textContent.includes('Retry pending request with original key'));
    assert.equal(await lost.evaluate(() => Object.keys(sessionStorage).some(key => key.startsWith('cash-box-write:'))), false);
    process.stdout.write('PASS browser reload reconciles lost close response\n');
    await lost.close();
    const source = await browser.newPage();
    let sourcePosts = 0;
    await source.setRequestInterception(true);
    source.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (path === '/api/payments') { sourcePosts += 1; return request.abort('failed'); }
        if (path.startsWith('/api/cash-drawers/requests/')) return request.respond(ok({ data: { status_code: 201, response: { payment_id: 42 } } }));
        if (path.startsWith('/api/')) return request.respond(ok({ data: [] }));
        return request.continue();
    });
    await source.goto('http://localhost:5173/tests/fixtures/cashDrawerBrowser.html');
    await source.waitForFunction(() => !!window.cashApi);
    await source.evaluate(() => localStorage.setItem('userSession', JSON.stringify({ user: { employee_id: 1 }, token: 'fixture-token' })));
    await source.evaluate(async () => { try { await window.cashApi.post('/payments', { cash_session_id: 1, amount: '1.00' }); } catch { /* lost response */ } });
    const pendingSource = await source.evaluate(() => sessionStorage.getItem('cash-source-pending:1'));
    assert(pendingSource && JSON.parse(pendingSource).body.includes('1.00'));
    assert.equal(sourcePosts, 1);
    const differentPayload = await source.evaluate(async () => {
        try { await window.cashApi.post('/payments', { cash_session_id: 1, amount: '2.00' }); return ''; }
        catch (error) { return error.message; }
    });
    assert.match(differentPayload, /Resolve the previous cash payment/);
    assert.equal(sourcePosts, 1);
    await source.reload();
    await source.waitForFunction(() => !!window.cashApi);
    const replayed = await source.evaluate(async () => (await window.cashApi.post('/payments', { cash_session_id: 1, amount: '1.00' })).data);
    assert.equal(replayed.payment_id, 42);
    assert.equal(sourcePosts, 1, 'reconciliation must avoid a replacement source write');
    assert.equal(await source.evaluate(() => sessionStorage.getItem('cash-source-pending:1')), null);
    const storageFailure = await source.evaluate(async () => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (key.startsWith('cash-source-pending:')) throw new Error('Storage unavailable');
            return original.call(this, key, value);
        };
        try { await window.cashApi.post('/payments', { cash_session_id: 1, amount: '3.00' }); return ''; }
        catch (error) { return error.message; }
        finally { Storage.prototype.setItem = original; }
    });
    assert.match(storageFailure, /Browser storage is unavailable/);
    assert.equal(sourcePosts, 1);
    process.stdout.write('PASS browser source lost response reconciles after reload\n');
    await source.close();
} finally {
    await browser.close();
}
