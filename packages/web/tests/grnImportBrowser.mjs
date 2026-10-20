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
  let inReviewImports = [
    {
      import_id: 'e1000000-0000-0000-0000-000000000001',
      status: 'IN_REVIEW',
      version: 2,
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      supplier_document_no: 'INV-9901',
      line_count: 2,
    },
  ];

  const mockReviewDetail = {
    import_id: 'e1000000-0000-0000-0000-000000000001',
    status: 'IN_REVIEW',
    version: 2,
    created_by_employee_id: 1,
    source_payload: {
      header: {
        supplier_name: 'Toyota Genuine Parts',
        supplier_document_no: 'INV-9901',
        document_date: '2026-10-20',
        currency: 'PHP',
      },
      lines: [
        {
          line_no: 1,
          brand: 'TOYOTA',
          part_number: '04152-YZZA6',
          description: 'Oil Filter Element',
          quantity: '5.00',
          unit_cost: '250.00',
          line_total: '1250.00',
        },
      ],
    },
    review_state: {
      header: {
        supplier_id: 1,
        supplier_document_no: 'INV-9901',
        supplier_document_type: 'invoice',
        receipt_date: '2026-10-20',
        currency: 'PHP',
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
            quantity: '5.00',
            unit_cost: '250.00',
            sale_price: '400.00',
            row_confirmed: true,
          },
        },
      ],
      issues: [],
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
      mockReviewDetail.version += 1;
      return respond(mockReviewDetail);
    }

    if (path === '/api/goods-receipts/imports/e1000000-0000-0000-0000-000000000001/candidates') {
      return respond({
        row_id: 'r_1',
        version: mockReviewDetail.version,
        ai_status: 'available',
        candidates: [
          {
            part_id: 10,
            internal_sku: 'TOY-04152',
            stock_uom: 'PCS',
            part_number: '04152-YZZA6',
            brand_name: 'TOYOTA',
            group_name: 'FILTERS',
            display_name: 'Oil Filter Element',
            match_reason: 'exact_identifier',
            evidence_class: 'exact',
            score: 1.0,
            last_cost: 245.0,
          },
        ],
      });
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
          sale_price: 400,
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
  await page.waitForFunction(() => document.body.innerText.includes('Part ID: 10'));
  console.log('✓ Review drawer mounted with row data');

  // TEST 6: Candidate Matching Drawer
  console.log('Test 6: Part candidate drawer lookup...');
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b =>
      b.textContent.includes('Part ID:') || b.textContent.includes('Select Catalog Part')
    );
    btn?.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('Select Catalog Item'));
  await page.waitForFunction(() => document.body.innerText.includes('Oil Filter Element'));
  console.log('✓ Candidate matching drawer returned ranked candidate');

  // Select candidate
  await page.evaluate(() => {
    const item = Array.from(document.querySelectorAll('div')).find(d =>
      d.textContent.includes('Oil Filter Element') && d.textContent.includes('TOYOTA')
    );
    item?.click();
  });

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
  console.log('✓ Staged GRN loaded with Imported JSON provenance badge');

  console.log('All Browser End-to-End Tests Passed!');
} finally {
  await browser.close();
}
