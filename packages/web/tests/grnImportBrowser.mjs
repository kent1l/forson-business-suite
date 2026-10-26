import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const baseUrl = process.env.GRN_IMPORT_BROWSER_BASE_URL || 'http://localhost:5173';
console.log(`Connecting to browser test runner with base URL: ${baseUrl}...`);

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', msg => {
    console.log(`[PAGE LOG ${msg.type()}]`, msg.text());
  });
  page.on('pageerror', e => {
    errors.push(e.message);
    console.error('Page error:', e.message);
  });

  await page.setRequestInterception(true);

  // Mock API states
  let featureEnabled = true;
  const createdParts = [];
  const catalogNames = { 10: 'Catalog oil filter element', 20: 'Catalog air filter', 30: 'Existing oil filter', 501: 'Automatically found filter' };
  let requireDuplicateResolution = false;
  let savedImportedDraft = null;
  let inReviewImports = [
    {
      import_id: 'e1000000-0000-0000-0000-000000000001',
      status: 'IN_REVIEW',
      version: 2,
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      supplier_document_no: 'INV-9901',
      line_count: 3,
    },
  ];

  const mockReviewDetail = {
    import_id: 'e1000000-0000-0000-0000-000000000001',
    status: 'IN_REVIEW',
    version: 2,
    created_by_employee_id: 1,
    source_payload: {
      document: {
        supplier_name: 'Toyota Genuine Parts',
        supplier_document_no: 'INV-9901',
        document_date: '2026-10-20',
        currency: 'PHP',
      },
      lines: [
        {
          line_no: 1,
          raw_text: '5 PCS TOYOTA 04152-YZZA6 OIL FILTER @250.00',
          supplier_item_text: 'TOYOTA 04152-YZZA6 OIL FILTER',
          brand: 'TOYOTA',
          part_number: '04152-YZZA6',
          description: 'Oil Filter Element',
          quantity: '5.00',
          unit_cost: '250.00',
          line_total: '1250.00',
        },
        {
          line_no: 2,
          raw_text: 'TOYOTA NEW-123 AIR FILTER',
          brand: 'TOYOTA',
          part_number: 'NEW-123',
          description: 'Air filter',
          item_group_hint: 'FILTERS',
          unit: 'PCS',
          quantity: '3.0000',
          unit_cost: '150.00',
        },
        { line_no: 3, supplier_item_text: 'TOYOTA AUTO-501 FILTER', description: 'Automatic filter', quantity: '4.0000', unit_cost: '111.00' },
      ],
    },
    review_state: {
      header: {
        supplier_id: 1,
        supplier_document_no: 'INV-9901',
        supplier_document_type: 'invoice',
        receipt_date: '2026-10-20',
        confirmed_currency: 'PHP',
        header_confirmed: true,
      },
      rows: [
        {
          row_id: 'r_1',
          line_no: 1,
          included: true,
          brand: 'TOYOTA',
          part_number: '04152-YZZA6',
          description: 'Oil Filter Element',
          raw_text: 'TOYOTA 04152-YZZA6 OIL FILTER',
          confirmed_row: {
            part_id: 10,
            part_display_name: catalogNames[10],
            delivered_quantity: '5.00',
            cost_price: '250.00',
            stock_uom: 'PCS',
            sale_price: '400.00',
            row_confirmed: true,
          },
        },
        {
          row_id: 'r_2',
          line_no: 2,
          included: true,
          confirmed_row: {
            part_id: null,
            delivered_quantity: '3.0000',
            return_quantity: '1.0000',
            cost_price: '150.00',
            sale_price: '225.00',
            row_confirmed: false,
          },
        },
        { row_id: 'r_3', line_no: 3, included: true, confirmed_row: {
          part_id: null, delivered_quantity: '4.0000', return_quantity: '0.0000', cost_price: '111.00', sale_price: null, row_confirmed: false,
        } },
      ],
      issues: [{ issue_id: 'annotation-note', code: 'AMBIGUOUS_VALUE', line_no: null, field: null, message: "Handwritten numbers '180' and '1000' appear near lines 5 and 6; their intended line association and meaning (e.g. operational temperature spec vs. retail price) are ambiguous, so handwritten_sale_price is set to null.", resolved: false }],
    },
    blockers: [],
  };

  page.on('request', req => {
    const url = new URL(req.url());
    const path = url.pathname;
    if (!path.startsWith('/api/')) return req.continue();
    console.log(`[REQ] ${req.method()} ${path}`);

    const respond = (data, status = 200) => {
      console.log(`[RESP ${status}] ${path}`);
      return req.respond({ status, contentType: 'application/json', body: JSON.stringify(data) });
    };

    if (path === '/api/goods-receipts/import-capabilities') {
      return respond({
        enabled: featureEnabled,
        schema_version: 1,
        limits: {
          max_source_payload_bytes: 1048576,
          max_lines: 500,
        },
      });
    }

    if (path === '/api/suppliers') {
      return respond([{ supplier_id: 1, supplier_name: 'Toyota Genuine Parts' }]);
    }
    if (path === '/api/brands') return respond([{ brand_id: 1, brand_name: 'TOYOTA' }]);
    if (path === '/api/groups') return respond([{ group_id: 1, group_name: 'FILTERS' }]);
    if (path === '/api/parts' && req.method() === 'POST') {
      const payload = JSON.parse(req.postData());
      createdParts.push(payload);
      if (requireDuplicateResolution) {
        if (!payload.jev_confirmation) {
          return respond({
            duplicate_resolution_required: true,
            decision_token: 'duplicate-test-token',
            duplicate: { part_id: 30, detail: 'Existing oil filter', confidence: 0.98, measurement_unit: 'EA' },
          }, 409);
        }
        assert.equal(payload.jev_confirmation.action, 'use_existing');
        return respond({ part_id: 30, display_name: catalogNames[30], measurement_unit: 'EA', existing: true });
      }
      return respond({ part_id: 20, ...payload, display_name: catalogNames[20] }, 201);
    }
    if (path === '/api/purchase-orders/open') return respond([]);
    if (path.startsWith('/api/drafts/')) return respond(req.method() === 'GET' ? { data: null } : { ok: true });

    if (path === '/api/goods-receipts/imports' && req.method() === 'GET') {
      return respond({ items: inReviewImports });
    }

    if (path === '/api/goods-receipts/imports' && req.method() === 'POST') {
      return respond(
        {
          import_id: 'e1000000-0000-0000-0000-000000000001',
          status: 'IN_REVIEW',
          version: 1,
          review_state: mockReviewDetail.review_state,
        },
        201
      );
    }

    if (path === '/api/goods-receipts/imports/e1000000-0000-0000-0000-000000000001' && req.method() === 'GET') {
      return respond(mockReviewDetail);
    }

    if (path === '/api/goods-receipts/imports/e1000000-0000-0000-0000-000000000001' && req.method() === 'PATCH') {
      for (const action of JSON.parse(req.postData()).actions) {
        if (action.type === 'set_row') {
          const row = mockReviewDetail.review_state.rows.find(row => row.row_id === action.row_id);
          const cr = row.confirmed_row;
          const changedMatch = ['part_id', 'stock_uom', 'units_per_source_unit'].some(field => field in action.values && action.values[field] !== cr[field]);
          const source = mockReviewDetail.source_payload.lines.find(line => line.line_no === row.line_no);
          const origins = new Set(cr.ai_filled_fields || ['delivered_quantity', 'cost_price'].filter(field => cr[field] === source[field === 'cost_price' ? 'unit_cost' : 'quantity']));
          for (const field of Object.keys(action.values)) {
            if (action.origin === 'automatic_match' && ['part_id', 'stock_uom'].includes(field)) origins.add(field);
            else origins.delete(field);
          }
          Object.assign(cr, action.values, { ai_filled_fields: [...origins], row_confirmed: changedMatch ? false : cr.row_confirmed });
          row.confirmed_row.part_display_name = catalogNames[row.confirmed_row.part_id];
        }
        if (action.type === 'confirm_row') mockReviewDetail.review_state.rows.find(row => row.row_id === action.row_id).confirmed_row.row_confirmed = true;
        if (action.type === 'confirm_header') mockReviewDetail.review_state.header.header_confirmed = true;
      }
      mockReviewDetail.version += 1;
      const { import_id, status, version, review_state, blockers } = mockReviewDetail;
      return respond({ import_id, status, version, review_state, blockers });
    }

    if (path === '/api/goods-receipts/imports/e1000000-0000-0000-0000-000000000001/candidates') {
      const { row_id, query } = JSON.parse(req.postData());
      if (row_id === 'r_3') {
        const part = { part_id: 501, display_name: catalogNames[501], stock_uom: 'PCS', method: 'jev', confidence: 0.98 };
        return respond({ row_id, version: mockReviewDetail.version, candidates: [part], automatic_match: part,
          search_status: 'available', ai_status: 'available', verification: { status: 'match', part_id: 501, confidence: 0.98 } });
      }
      if (row_id === 'r_2') {
        return respond({ row_id: 'r_2', version: mockReviewDetail.version, candidates: [], search_status: 'available', verification: { status: 'no_candidates' } });
      }
      if (query === 'offline') return respond({ message: 'Search unavailable' }, 503);
      const response = {
        row_id: 'r_1',
        version: mockReviewDetail.version,
        ai_status: 'available',
        search_status: 'available',
        verification: { status: query === 'no match' ? 'no_match' : query === 'uncertain' ? 'uncertain' : 'match', confidence: 0.96, part_id: 10 },
        candidates: [
          {
            part_id: 10,
            internal_sku: 'TOY-04152',
            stock_uom: 'PCS',
            part_number: '04152-YZZA6',
            brand_name: 'TOYOTA',
            group_name: 'FILTERS',
            display_name: query === 'slow' ? 'Stale result that must not replace new search' : catalogNames[10],
            part_numbers: ['04152-YZZA6'],
            match_evidence: { identifier: true, brand: true, group: true },
            jev_verification: query === 'no match' || query === 'uncertain' ? null : { status: 'recommended', confidence: 0.96 },
            match_reason: 'exact_identifier',
            evidence_class: 'exact',
            score: 1.0,
            last_cost: 245.0,
          },
        ],
      };
      if (query === 'slow') {
        setTimeout(() => respond(response).catch(() => {}), 1000);
        return;
      }
      return respond(response);
    }

    if (path === '/api/goods-receipts/imports/e1000000-0000-0000-0000-000000000001/commit') {
      mockReviewDetail.status = 'COMMITTED';
      return respond(
        {
          import_id: 'e1000000-0000-0000-0000-000000000001',
          grn_id: 99,
          grn_number: 'GRN-202610-0099',
          workflow_status: 'Draft',
        },
        201
      );
    }

    if (path === '/api/goods-receipts/99') {
      return respond({
        grn_id: 99,
        grn_number: 'GRN-202610-0099',
        supplier_id: 1,
        supplier_document_no: 'INV-9901',
        supplier_invoice_no: 'INV-9901',
        workflow_status: 'Draft',
        import_provenance: {
          import_id: 'e1000000-0000-0000-0000-000000000001',
          status: 'COMMITTED',
        },
      });
    }

    if (path === '/api/goods-receipts/99/draft' && req.method() === 'PUT') {
      savedImportedDraft = JSON.parse(req.postData());
      return respond({ grn_id: 99, workflow_status: 'Draft' });
    }

    if (path === '/api/goods-receipts/99/lines') {
      return respond([
        {
          grn_line_id: 1,
          line_uuid: 'l1000000-0000-0000-0000-000000000001',
          part_id: 10,
          part_number: '04152-YZZA6',
          display_name: 'Oil Filter Element',
          quantity: 5,
          cost_price: 250,
          sale_price: null,
        },
      ]);
    }

    return respond([]);
  });

  // TEST 1: Feature Disabled
  console.log('Test 1: Verification when capability is disabled...');
  featureEnabled = false;
  await page.goto(`${baseUrl}/tests/fixtures/grnImportBrowser.html`);
  await page.waitForFunction(() => typeof window.mountGoodsReceipt === 'function');
  await page.evaluate(() => window.mountGoodsReceipt());
  await page.waitForSelector('h1');

  let importBtn = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).some(b =>
      b.textContent.includes('Import extracted JSON')
    );
  });
  assert.equal(importBtn, false, 'Import button should not appear when capability is disabled');
  console.log('✓ Feature flag off correctly hides import button');

  // TEST 2: Feature Enabled & Dialog Open
  console.log('Test 2: Verification when capability is enabled...');
  featureEnabled = true;
  await page.evaluate(() => window.mountGoodsReceipt());
  await page.waitForFunction(() => {
    return Array.from(document.querySelectorAll('button')).some(b =>
      b.textContent.includes('Import extracted JSON')
    );
  });
  console.log('✓ Import button appears when feature is enabled');

  // Click Import extracted JSON
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b =>
      b.textContent.includes('Import extracted JSON')
    );
    btn?.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('Import Extracted Document JSON'));
  console.log('✓ Import dialog opened successfully');

  // Verify Copy Prompt button & tooltip on hover
  const copyPromptBtnHandle = await page.evaluateHandle(() =>
    Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Copy Prompt'))
  );
  const copyPromptExists = await copyPromptBtnHandle.evaluate(el => Boolean(el));
  assert.equal(copyPromptExists, true, 'Copy Prompt button should be present in import dialog');
  await copyPromptBtnHandle.hover();
  const tooltipVisible = await page.evaluate(() => {
    const tip = document.getElementById('grn-copy-prompt-tooltip');
    return tip && tip.getAttribute('aria-hidden') === 'false' && tip.textContent.includes('extraction prompt');
  });
  assert.equal(tooltipVisible, true, 'Tooltip should be visible on hover and describe the Copy Prompt button');
  await page.evaluate(() => {
    window.__copiedClipboardText = null;
    navigator.clipboard.writeText = async (text) => {
      window.__copiedClipboardText = text;
    };
  });
  await copyPromptBtnHandle.click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('Copied!')));
  const copiedPromptText = await page.evaluate(() => window.__copiedClipboardText);
  assert.equal(copiedPromptText?.includes('"schema_version": 1'), true, 'Copied prompt should contain Schema v1 extraction instructions');
  console.log('✓ Copy Prompt button and hover tooltip verified');

  // TEST 3: Syntax error handling preserves text
  console.log('Test 3: Syntax error handling and text preservation...');
  const badJson = '{"broken": json without quotes';
  await page.focus('textarea');
  await page.keyboard.type(badJson);

  // Click "Import and Review" button in dialog
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b =>
      b.textContent.includes('Import and Review')
    );
    btn?.click();
  });

  await page.waitForFunction(() => document.body.innerText.includes('Malformed JSON syntax'));
  const currentText = await page.evaluate(() => document.querySelector('textarea')?.value);
  assert.equal(currentText, badJson, 'Malformed text should be preserved in textarea');
  console.log('✓ Malformed syntax correctly reports error and preserves text');

  // TEST 4: Saved reviews tab
  console.log('Test 4: Saved Reviews tab navigation...');
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b =>
      b.textContent.includes('Saved Reviews')
    );
    btn?.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('INV-9901'));
  console.log('✓ Saved reviews tab displays in-review imports');

  // TEST 5: Resume saved review into drawer
  console.log('Test 5: Resume review into Drawer...');
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b =>
      b.textContent.trim() === 'Resume'
    );
    btn?.click();
  });
  await new Promise(r => setTimeout(r, 1000));
  const pageText = await page.evaluate(() => document.body.innerText);
  console.log('PAGE TEXT AFTER RESUME:', pageText);

  await page.waitForFunction(() => document.body.innerText.includes('Review Extracted Document'));
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === 'Catalog oil filter element'));
  assert.equal(await page.evaluate(() => document.body.innerText.includes('Part ID:')), false);
  assert.equal(await page.$eval('details', el => el.open), false, 'Informational uncertainty notes should stay collapsed');
  assert.equal(await page.$$eval('button', buttons => buttons.some(button => button.textContent.trim() === 'Resolve Issue')), false);
  assert.equal(await page.$eval('#sale-r_3', el => el.value), '', 'Unknown sale price stays blank');
  console.log('✓ Review drawer mounted with row data and nonblocking uncertainty note');
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === 'Automatically found filter'));
  await page.waitForFunction(() => document.body.innerText.includes('1 automatically matched'));
  assert.equal(mockReviewDetail.review_state.rows.find(row => row.row_id === 'r_3').confirmed_row.part_id, 501);
  assert.equal(await page.evaluate(() => document.body.innerText.includes('Select Catalog Item')), false);
  assert.equal(mockReviewDetail.review_state.rows.find(row => row.row_id === 'r_3').confirmed_row.cost_price, '111.00');
  console.log('✓ Review opening automatically finds, displays and saves a strong catalog match without opening the picker');
  await page.setViewport({ width: 1440, height: 1000 });
  assert.equal(await page.$eval('.max-w-7xl', el => el.getBoundingClientRect().width), 1280);
  await page.setViewport({ width: 390, height: 844 });
  assert.equal(await page.$eval('.max-w-7xl', el => el.getBoundingClientRect().width), 390);
  await page.setViewport({ width: 1440, height: 1000 });
  assert.equal(await page.$eval('[data-import-row="r_2"] button[title="Select a catalog part first"]', el => el.disabled), true);
  assert.equal(await page.$eval('#catalog-r_3', el => el.dataset.aiFilled), 'true');
  assert.equal(await page.$eval('#cost-r_3', el => el.dataset.aiFilled), 'true');
  assert.equal(await page.evaluate(() => document.body.innerText.includes('Auto-matched ·')), false);
  await page.$eval('[data-import-row="r_3"]', row => Array.from(row.querySelectorAll('button')).find(button => button.textContent.trim() === 'Confirm Row').click());
  await page.waitForFunction(() => document.querySelector('[data-import-row="r_3"]').innerText.includes('Confirmed') && !document.body.innerText.includes('Saving…'));
  assert.equal(mockReviewDetail.review_state.rows[2].confirmed_row.row_confirmed, true, 'Confirm Row saves without a separate Save Review click');
  await page.focus('#cost-r_3');
  await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
  await page.keyboard.type('112.00');
  assert.equal(await page.$eval('#cost-r_3', el => el.hasAttribute('data-ai-filled')), false, 'Manual edits remove AI highlight');
  assert.equal(await page.$eval('[data-import-row="r_3"]', el => el.innerText.includes('Confirmed')), true, 'Price edits must retain match confirmation');
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'Save Review').click());
  await page.waitForFunction(() => !document.body.innerText.includes('Unsaved changes') && !document.body.innerText.includes('Saving…'));
  assert.equal(mockReviewDetail.review_state.rows[2].confirmed_row.row_confirmed, true);
  assert.equal(await page.$eval('#cost-r_3', el => el.hasAttribute('data-ai-filled')), false);
  await page.screenshot({ path: '/tmp/grn-import-review-desktop.png' });
  await page.setViewport({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.querySelector('.max-w-7xl').scrollWidth <= 390), true, 'Review must fit a phone viewport');
  await page.screenshot({ path: '/tmp/grn-import-review-mobile.png' });
  await page.setViewport({ width: 1440, height: 1000 });
  console.log('✓ Confirmation saves immediately; unmatched items require selection; price edits preserve confirmation and remove AI highlight');

  // TEST 6: Candidate Matching Drawer
  console.log('Test 6: Part candidate drawer lookup...');
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b =>
      b.textContent.trim() === 'Catalog oil filter element'
    );
    btn?.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('Select Catalog Item'));
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.z-60 div')).some(div => div.textContent === 'Catalog oil filter element'));
  console.log('✓ Candidate matching drawer returned ranked candidate');
  await page.waitForFunction(() => document.body.innerText.includes('Jev recommends · 96%'));
  assert(await page.$eval('.z-60', el => el.innerText.includes('Cleaned Supplier Text') && el.innerText.includes('TOYOTA 04152-YZZA6 OIL FILTER')));
  assert.equal(await page.evaluate(() => document.body.innerText.includes('5 PCS TOYOTA') || document.body.innerText.includes('Raw Text')), false, 'Original raw text must not be displayed');
  const searchFor = async text => {
    const input = await page.$('.z-60 input[type="text"]');
    await input.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await input.type(text);
  };
  await searchFor('no match');
  await page.waitForFunction(() => document.body.innerText.includes('Jev found no reliable match'));
  assert.equal(await page.$eval('.z-60', el => el.innerText.includes('Jev recommends ·')), false);
  await searchFor('uncertain');
  await page.waitForFunction(() => document.body.innerText.includes('Jev is uncertain'));
  await searchFor('offline');
  await page.waitForFunction(() => document.body.innerText.includes('Catalog search is unavailable'));
  assert.equal(await page.$eval('.z-60', el => el.innerText.includes('No matching catalog items found.')), false);
  const slowRequest = page.waitForRequest(request => request.url().endsWith('/candidates') && JSON.parse(request.postData() || '{}').query === 'slow');
  await searchFor('slow');
  await slowRequest;
  await searchFor('newest');
  await page.waitForFunction(() => document.body.innerText.includes('Jev recommends · 96%'));
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(await page.$eval('.z-60', el => el.innerText.includes('Stale result')), false);
  console.log('✓ Cleaned item evidence only, Jev recommendation/no-match/uncertainty, search failures and late-response protection');

  // Select candidate
  await page.evaluate(() => {
    const item = Array.from(document.querySelectorAll('.z-60 div')).find(d =>
      d.textContent === 'Catalog oil filter element'
    );
    item?.click();
  });
  await page.waitForFunction(() => !document.body.innerText.includes('Select Catalog Item'));

  console.log('Test 6b: Create a catalog part for an unmatched import line...');
  const clickButton = async (label) => {
    const handle = await page.evaluateHandle(label => Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === label), label);
    const button = handle.asElement();
    assert.ok(button, `Missing button: ${label}`);
    await button.click();
    await handle.dispose();
  };
  await clickButton('Create Part');
  await page.waitForSelector('input[name="detail"]');
  assert.equal(await page.$eval('input[name="detail"]', el => el.value), 'AIR FILTER');
  assert.equal(await page.$eval('textarea[name="part_numbers_string"]', el => el.value), 'NEW-123');
  await clickButton('Cancel');
  await page.waitForFunction(() => document.body.innerText.includes('Review Extracted Document'));
  assert.equal(createdParts.length, 0, 'Cancelling must not create a part');

  await clickButton('Select Catalog Part…');
  await page.waitForFunction(() => document.body.innerText.includes('No matching catalog items found.'));
  assert.equal(await page.$$eval('section[aria-label="Supplier item text for line 2"]', els => els.length), 2);
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).filter(button => button.textContent.trim() === 'Create Part').at(-1).click());
  await page.waitForSelector('input[name="detail"]');
  await clickButton('Save');
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === 'Catalog air filter'));
  assert.equal(createdParts.length, 1);
  assert.equal(Number(createdParts[0].brand_id), 1);
  assert.equal(Number(createdParts[0].group_id), 1);
  assert.equal(createdParts[0].measurement_unit, 'PCS');
  assert.equal(createdParts[0].last_cost, '150.00');
  assert.equal(createdParts[0].last_sale_price, '225.00');
  await clickButton('Save Review');
  await page.waitForFunction(() => !document.body.innerText.includes('Unsaved changes'));
  const createdRow = mockReviewDetail.review_state.rows.find(row => row.row_id === 'r_2');
  assert(await page.$eval('section[aria-label="Supplier item text for line 1"]', el => el.innerText.includes('Cleaned Supplier Text') && el.innerText.includes('TOYOTA 04152-YZZA6 OIL FILTER') && !el.innerText.includes('5 PCS')), 'Saving must preserve cleaned item evidence without showing original raw text');
  assert.equal(createdRow.confirmed_row.part_id, 20);
  assert.equal(createdRow.confirmed_row.stock_uom, 'PCS');
  assert.equal(createdRow.confirmed_row.delivered_quantity, '3.0000');
  assert.equal(createdRow.confirmed_row.return_quantity, '1.0000');
  assert.equal(createdRow.confirmed_row.cost_price, '150.00');
  assert.equal(createdRow.confirmed_row.row_confirmed, false);
  console.log('✓ Create and cancel work from unmatched rows and empty search; receiving values are preserved');

  console.log('Test 6c: Reuse an existing part through duplicate resolution...');
  requireDuplicateResolution = true;
  await clickButton('Catalog oil filter element');
  await page.waitForFunction(() => document.body.innerText.includes('Select Catalog Item'));
  await clickButton('Create Part');
  await page.waitForSelector('input[name="detail"]');
  await clickButton('Save');
  await page.waitForFunction(() => document.body.innerText.includes('Duplicate Part Check'));
  await clickButton('Use existing part');
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === 'Existing oil filter'));
  await clickButton('Save Review');
  await page.waitForFunction(() => !document.body.innerText.includes('Unsaved changes'));
  assert.equal(mockReviewDetail.review_state.rows[0].confirmed_row.part_id, 30);
  assert.equal(await page.evaluate(() => document.body.innerText.includes('Part ID:')), false);
  console.log('✓ Duplicate resolution stays accessible and links the existing part with its stock unit');

  // TEST 7: Commit to GRN Draft & Provenance badge
  console.log('Test 7: Commit review to GRN draft...');
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b =>
      b.textContent.includes('Continue to GRN Draft')
    );
    btn?.click();
  });

  await page.waitForFunction(() => document.body.innerText.includes('GRN-202610-0099'));
  await page.waitForFunction(() => document.body.innerText.includes('Imported JSON'));
  await page.waitForSelector('input[aria-label="Sale price for Oil Filter Element"]');
  assert.equal(await page.$eval('input[aria-label="Sale price for Oil Filter Element"]', el => el.value), '', 'Imported null sale price must not display a calculated default');
  await page.type('input[aria-label="Sale price for Oil Filter Element"]', '450');
  await page.$eval('input[aria-label="Sale price for Oil Filter Element"]', el => el.blur());
  assert.equal(await page.$eval('input[aria-label="Sale price for Oil Filter Element"]', el => el.value), '450');
  await page.focus('input[aria-label="Sale price for Oil Filter Element"]');
  await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.$eval('input[aria-label="Sale price for Oil Filter Element"]', el => el.blur());
  assert.equal(await page.$eval('input[aria-label="Sale price for Oil Filter Element"]', el => el.value), '', 'Clearing an imported price preserves null rather than changing to 0');
  const draftSaved = page.waitForResponse(response => response.url().endsWith('/99/draft') && response.request().method() === 'PUT');
  await clickButton('Update draft');
  await draftSaved;
  assert.equal(savedImportedDraft.lines[0].sale_price, null, 'Saving from the draft UI must send null for an unknown sale price');
  console.log('✓ Staged GRN loaded with Imported JSON provenance badge and unknown sale price still blank');

  console.log('Test 8: Part creation requires permission...');
  mockReviewDetail.status = 'IN_REVIEW';
  mockReviewDetail.review_state.rows[1].confirmed_row.part_id = null;
  await page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem('userSession'));
    session.user.permission_level_id = 2;
    session.permissions = session.permissions.filter(permission => permission !== 'parts:create');
    localStorage.setItem('userSession', JSON.stringify(session));
    window.mountGoodsReceipt({ import_id: 'e1000000-0000-0000-0000-000000000001' });
  });
  await page.waitForFunction(() => document.body.innerText.includes('Review Extracted Document'));
  assert.equal(await page.$$eval('button', buttons => buttons.some(button => button.textContent.trim() === 'Create Part')), false);
  await clickButton('Select Catalog Part…');
  await page.waitForFunction(() => document.body.innerText.includes('No matching catalog items found.'));
  assert.equal(await page.$$eval('button', buttons => buttons.some(button => button.textContent.trim() === 'Create Part')), false);
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log('✓ Users without parts:create see no create option on rows or in catalog search');

  console.log('All Browser End-to-End Tests Passed!');
} finally {
  await browser.close();
}
