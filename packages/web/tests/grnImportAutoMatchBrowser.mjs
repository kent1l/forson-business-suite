import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const baseUrl = process.env.GRN_IMPORT_BROWSER_BASE_URL || 'http://localhost:5173';
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const row = (n, values = {}) => ({ row_id: `r${n}`, line_no: n, included: true,
    confirmed_row: { part_id: null, delivered_quantity: '10.0000', return_quantity: '1.0000', cost_price: '100.00', sale_price: '150.00', row_confirmed: false }, ...values });
  const state = { import_id: 'auto-review', status: 'IN_REVIEW', version: 1,
    source_payload: { document: { currency: 'PHP' }, lines: Array.from({ length: 7 }, (_, i) => ({ line_no: i + 1,
      supplier_item_text: i === 6 ? null : `FILTER-${i + 1}`, description: null, raw_text: 'UNUSED RAW RECEIPT' })) },
    review_state: { header: {}, issues: [], rows: [row(1), row(2), row(3), row(4),
      row(5, { confirmed_row: { part_id: 505, part_display_name: 'Existing selection', row_confirmed: true } }), row(6, { included: false }), row(7)] },
    blockers: [],
  };
  const candidateRequests = [];
  const patches = [];
  let activeRequests = 0;
  let maximumRequests = 0;
  let releaseFirstPatch;
  let releaseManualRace;
  let committedVersion;
  let simulateConflict = false;
  let releaseConflict;
  await page.setRequestInterception(true);
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (!path.startsWith('/api/')) return request.continue();
    const respond = (body, status = 200) => request.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.endsWith('/import-capabilities')) return respond({ enabled: true });
    if (path.endsWith('/candidates')) {
      const { row_id, version } = JSON.parse(request.postData());
      candidateRequests.push(row_id);
      activeRequests += 1;
      maximumRequests = Math.max(maximumRequests, activeRequests);
      const part = { part_id: 100 + Number(row_id.slice(1)), display_name: `Catalog ${row_id}`, stock_uom: 'PCS', method: row_id === 'r2' ? 'brand_and_identifier' : 'jev', confidence: 0.97 };
      const answer = { row_id, version, candidates: [part], search_status: 'available', automatic_match: row_id === 'r3' ? null : part };
      const finish = () => { activeRequests -= 1; return respond(answer).catch(() => {}); };
      if (row_id === 'r4') { releaseManualRace = finish; return; }
      setTimeout(finish, 30);
      return;
    }
    if (path.endsWith('/commit')) {
      committedVersion = JSON.parse(request.postData()).version;
      assert.equal(committedVersion, state.version);
      return respond({ grn_id: 9, grn_number: 'TEST-GRN' }, 201);
    }
    if (path === '/api/goods-receipts/imports/auto-review') {
      if (request.method() === 'GET') return respond(state);
      const payload = JSON.parse(request.postData());
      assert.equal(payload.version, state.version, 'Each save must use the latest version');
      assert(payload.actions.length <= 50);
      patches.push(payload);
      if (simulateConflict) {
        simulateConflict = false;
        state.version += 1;
        releaseConflict = () => respond({ message: 'Review changed in another request', version: state.version }, 409);
        return;
      }
      for (const action of payload.actions) {
        if (action.type === 'set_header') Object.assign(state.review_state.header, action.values);
        if (action.type === 'set_row') {
          const target = state.review_state.rows.find(row => row.row_id === action.row_id);
          Object.assign(target.confirmed_row, action.values);
          if (action.values.part_id) target.confirmed_row.part_display_name = `Catalog ${action.values.part_id}`;
        }
      }
      state.version += 1;
      const answer = structuredClone({ import_id: state.import_id, status: state.status, version: state.version, review_state: state.review_state, blockers: [] });
      if (patches.length === 1) { releaseFirstPatch = () => respond(answer); return; }
      return respond(answer);
    }
    return respond([]);
  });
  await page.goto(`${baseUrl}/tests/fixtures/grnImportBrowser.html`);
  await page.waitForFunction(() => typeof window.mountImportReviewHook === 'function');
  await page.evaluate(() => window.mountImportReviewHook('auto-review'));
  await page.waitForFunction(() => window.importReviewHook?.saving);
  assert.equal(patches.length, 1, 'Automatic matching must save without a user click');
  assert.equal(patches[0].actions.length, 2);
  await page.evaluate(() => window.importReviewHook.queueAction({ type: 'set_row', row_id: 'r1', values: { cost_price: '777.00' } }));
  await releaseFirstPatch();
  await page.waitForFunction(() => window.importReviewHook.review?.version === 2);
  assert.equal(await page.evaluate(() => window.importReviewHook.review.review_state.rows[0].confirmed_row.cost_price), '777.00', 'Edits during automatic PATCH must survive its response');
  const raceDeadline = Date.now() + 10000;
  while (!releaseManualRace && Date.now() < raceDeadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(releaseManualRace, 'Automatic pass must reach the remaining rows');
  await page.evaluate(() => window.importReviewHook.queueAction({ type: 'set_row', row_id: 'r4', values: { part_id: 404, stock_uom: 'EA' } }, { part_id: 404, display_name: 'Manual selection' }));
  await releaseManualRace();
  await page.waitForFunction(() => window.importReviewHook.autoMatchProgress.status === 'complete');
  assert.equal(maximumRequests, 2, 'Run at most two candidate lookups concurrently');
  assert.deepEqual(candidateRequests.slice().sort(), ['r1', 'r2', 'r3', 'r4']);
  assert.equal(state.review_state.rows[0].confirmed_row.part_id, 101);
  assert.equal(state.review_state.rows[1].confirmed_row.part_id, 102);
  assert.equal(state.review_state.rows[2].confirmed_row.part_id, null);
  assert.equal(state.review_state.rows[3].confirmed_row.part_id, null, 'An in-flight result must not replace a manual selection');
  assert.equal(await page.evaluate(() => window.importReviewHook.review.review_state.rows[3].confirmed_row.part_id), 404);
  assert.equal(await page.evaluate(() => window.importReviewHook.hasUnsavedChanges), true);
  assert.equal(state.review_state.rows[0].confirmed_row.cost_price, '100.00', 'Automatic saves must not silently save manual edits');
  assert.equal(state.review_state.rows[0].confirmed_row.delivered_quantity, '10.0000');
  assert.equal(state.review_state.rows[0].confirmed_row.return_quantity, '1.0000');
  assert.equal(state.review_state.rows[0].confirmed_row.row_confirmed, false);
  await page.evaluate(() => window.importReviewHook.saveReview());
  assert.equal(state.review_state.rows[0].confirmed_row.cost_price, '777.00');
  assert.equal(state.review_state.rows[3].confirmed_row.part_id, 404);
  await page.evaluate(() => window.importReviewHook.queueAction({ type: 'set_header', values: { currency_reason: 'Confirmed PHP' } }));
  await page.evaluate(() => window.importReviewHook.commitReview());
  assert.equal(committedVersion, state.version, 'Commit after pending edits must use the saved revision');

  const previousCalls = candidateRequests.length;
  await page.evaluate(() => { window.previousReviewHook = window.importReviewHook; window.mountImportReviewHook('auto-review'); });
  await page.waitForFunction(() => window.importReviewHook !== window.previousReviewHook && window.importReviewHook?.autoMatchProgress.status === 'complete');
  assert.deepEqual(candidateRequests.slice(previousCalls), ['r3'], 'Reopening must skip all saved selections, excluded rows and raw-only rows');

  state.review_state.rows.push(row(8));
  state.source_payload.lines.push({ line_no: 8, supplier_item_text: 'FILTER-8' });
  simulateConflict = true;
  await page.evaluate(() => window.mountImportReviewHook('auto-review'));
  const conflictDeadline = Date.now() + 10000;
  while (!releaseConflict && Date.now() < conflictDeadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(releaseConflict);
  await page.evaluate(() => window.importReviewHook.queueAction({ type: 'set_row', row_id: 'r8', values: { cost_price: '888.00' } }));
  await releaseConflict();
  await page.waitForFunction(() => window.importReviewHook.autoMatchProgress.status === 'error');
  assert.equal(await page.evaluate(() => window.importReviewHook.review.review_state.rows.find(row => row.row_id === 'r8').confirmed_row.cost_price), '888.00');
  assert.equal(state.review_state.rows.find(row => row.row_id === 'r8').confirmed_row.part_id, null);
  await page.evaluate(() => window.importReviewHook.retryAutomaticMatching());
  await page.waitForFunction(() => window.importReviewHook.autoMatchProgress.status === 'complete');
  assert.equal(state.review_state.rows.find(row => row.row_id === 'r8').confirmed_row.part_id, 108);
  assert.equal(state.review_state.rows.find(row => row.row_id === 'r8').confirmed_row.cost_price, '100.00');
  await page.evaluate(() => window.importReviewHook.saveReview());
  assert.equal(state.review_state.rows.find(row => row.row_id === 'r8').confirmed_row.cost_price, '888.00');
  assert.deepEqual(errors, []);
  console.log('Passed automatic population/persistence, confidence/no-match handling, concurrency, edit/manual-choice races, reopening, latest-version commit, conflict recovery and retry.');
} finally { await browser.close(); }
