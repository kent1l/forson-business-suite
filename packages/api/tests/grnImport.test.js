const {
  validateAndNormalizeExternalPayload,
  computePayloadHash,
} = require('../helpers/grnImportSchema');
const {
  computeRowDigest,
  computeHeaderDigest,
  checkExactConversion,
  calculateBlockers,
  initializeReviewState,
  findSupplierFuzzy,
} = require('../services/grnImportService');

describe('GRN External JSON Ingestion - Schema and Rules', () => {
  const conformingExample = {
    schema_version: 1,
    document: {
      supplier_name: 'Example Supplier',
      document_type: 'delivery_receipt',
      document_number: 'DR-00127',
      document_date: '2026-10-20',
      currency: 'PHP',
      printed_total: '250.00',
    },
    lines: [
      {
        line_no: 1,
        raw_text: '2 PCS OIL FILTER 125.00 250.00',
        description: 'OIL FILTER',
        brand: null,
        part_number: null,
        supplier_item_code: null,
        item_group_hint: null,
        quantity: '2.0000',
        unit: 'PCS',
        unit_cost: '125.00',
        printed_line_total: '250.00',
        handwritten_sale_price: null,
        receiving_mark: null,
        enrichment: {
          status: 'unresolved',
          suggested_brand: null,
          suggested_part_number: null,
          suggested_description: null,
          suggested_group: null,
          reason: null,
          sources: [],
        },
      },
    ],
    extraction_issues: [],
  };

  test('validates conforming example cleanly', () => {
    const normalized = validateAndNormalizeExternalPayload(conformingExample);
    expect(normalized.schema_version).toBe(1);
    expect(normalized.document.supplier_name).toBe('Example Supplier');
    expect(normalized.document.document_number).toBe('DR-00127');
    expect(normalized.document.printed_total).toBe('250.00');
    expect(normalized.lines).toHaveLength(1);
    expect(normalized.lines[0].quantity).toBe('2.0000');
    expect(normalized.lines[0].unit_cost).toBe('125.00');
    expect(normalized.lines[0].printed_line_total).toBe('250.00');
    expect(normalized.extraction_issues).toHaveLength(0);
  });

  test.each([undefined, null, '', '   '])('defaults missing or blank JSON unit %p to pcs', unit => {
    const payload = structuredClone(conformingExample);
    if (unit === undefined) delete payload.lines[0].unit;
    else payload.lines[0].unit = unit;
    const normalized = validateAndNormalizeExternalPayload(payload);
    expect(normalized.lines[0].unit).toBe('pcs');
    expect(initializeReviewState(normalized, {}).rows[0].confirmed_row.stock_uom).toBe('pcs');
  });

  test.each([
    ['BOX', 'box'],
    ['PC/s', 'pcs'],
    ['PC/S', 'pcs'],
    ['PCS', 'pcs'],
    ['pc', 'pcs'],
    ['EA', 'pcs'],
    ['SET/S', 'set'],
    ['BTL', 'btl'],
  ])('normalizes explicit JSON unit %p to canonical UOM %p', (rawUnit, expectedUnit) => {
    const payload = structuredClone(conformingExample);
    payload.lines[0].unit = rawUnit;
    expect(validateAndNormalizeExternalPayload(payload).lines[0].unit).toBe(expectedUnit);
  });

  test.each([undefined, null, '', '   '])('missing stock UOM %p does not block a confirmed catalog match', stockUom => {
    const normalized = validateAndNormalizeExternalPayload(conformingExample);
    const state = initializeReviewState(normalized, { supplier_id: 5 });
    const cr = state.rows[0].confirmed_row;
    cr.part_id = 101;
    cr.stock_uom = stockUom;
    cr.row_confirmed = true;
    cr.row_confirmation_digest = computeRowDigest({
      supplierId: 5, currency: 'PHP', partId: 101, stockUom: 'pcs', unitsPerSourceUnit: '1.0000',
    });
    state.header.receipt_date = '2026-10-20';
    state.header.header_confirmed = true;
    state.header.header_confirmation_digest = computeHeaderDigest(state.header);
    expect(calculateBlockers(state, normalized)).toEqual([]);
  });

  test('accepts optional cleaned supplier identity without altering legacy payload shape or hash', () => {
    const legacy = validateAndNormalizeExternalPayload(conformingExample);
    expect(legacy.lines[0]).not.toHaveProperty('supplier_item_text');
    const payload = structuredClone(conformingExample);
    payload.lines[0].supplier_item_text = 'OIL FILTER 04152-YZZA6';
    const normalized = validateAndNormalizeExternalPayload(payload);
    expect(normalized.lines[0].supplier_item_text).toBe('OIL FILTER 04152-YZZA6');
    expect(normalized.lines[0].raw_text).toBe(conformingExample.lines[0].raw_text);
    expect(computePayloadHash(normalized, {})).not.toBe(computePayloadHash(legacy, {}));
    delete normalized.lines[0].supplier_item_text;
    expect(computePayloadHash(normalized, {})).toBe(computePayloadHash(legacy, {}));
  });

  test('accepts cleaned item text without original raw text or description', () => {
    const payload = structuredClone(conformingExample);
    delete payload.lines[0].raw_text;
    delete payload.lines[0].description;
    payload.lines[0].supplier_item_text = 'OIL FILTER 04152-YZZA6';
    expect(validateAndNormalizeExternalPayload(payload).lines[0].supplier_item_text).toBe('OIL FILTER 04152-YZZA6');
  });

  test.each([42, {}, 'x'.repeat(2001), 'OIL\u202eFILTER'])('rejects invalid supplier_item_text: %p', value => {
    const payload = structuredClone(conformingExample);
    payload.lines[0].supplier_item_text = value;
    expect(() => validateAndNormalizeExternalPayload(payload)).toThrow(/supplier_item_text/);
  });

  test('rejects missing top-level fields', () => {
    const missing = { ...conformingExample };
    delete missing.extraction_issues;
    expect(() => validateAndNormalizeExternalPayload(missing)).toThrow(/extraction_issues.*required/i);
  });

  test('rejects unknown top-level and nested fields (path-aware allowlist)', () => {
    const hostileTop = { ...conformingExample, approved_by: 'hacker' };
    expect(() => validateAndNormalizeExternalPayload(hostileTop)).toThrow(/approved_by.*not allowed/i);

    const hostileDoc = {
      ...conformingExample,
      document: { ...conformingExample.document, tax_id: '123' },
    };
    expect(() => validateAndNormalizeExternalPayload(hostileDoc)).toThrow(/document\.tax_id.*not allowed/i);

    const hostileLine = {
      ...conformingExample,
      lines: [{ ...conformingExample.lines[0], discount_override: '10' }],
    };
    expect(() => validateAndNormalizeExternalPayload(hostileLine)).toThrow(/lines\[0\]\.discount_override.*not allowed/i);
  });

  test('rejects JSON numbers for quantity and money fields (must be decimal strings)', () => {
    const numQty = {
      ...conformingExample,
      lines: [{ ...conformingExample.lines[0], quantity: 2.5 }],
    };
    expect(() => validateAndNormalizeExternalPayload(numQty)).toThrow(/decimal string or null/i);

    const numCost = {
      ...conformingExample,
      lines: [{ ...conformingExample.lines[0], unit_cost: 125.0 }],
    };
    expect(() => validateAndNormalizeExternalPayload(numCost)).toThrow(/decimal string or null/i);

    const numDocTotal = {
      ...conformingExample,
      document: { ...conformingExample.document, printed_total: 250.0 },
    };
    expect(() => validateAndNormalizeExternalPayload(numDocTotal)).toThrow(/decimal string or null/i);
  });

  test('rejects invalid decimal formatting (negative, signs, commas, exponents, whitespace)', () => {
    const makeWithCost = (c) => ({
      ...conformingExample,
      lines: [{ ...conformingExample.lines[0], unit_cost: c }],
    });

    expect(() => validateAndNormalizeExternalPayload(makeWithCost('-125.00'))).toThrow(/unsigned plain decimal/i);
    expect(() => validateAndNormalizeExternalPayload(makeWithCost('+125.00'))).toThrow(/unsigned plain decimal/i);
    expect(() => validateAndNormalizeExternalPayload(makeWithCost('1,125.00'))).toThrow(/unsigned plain decimal/i);
    expect(() => validateAndNormalizeExternalPayload(makeWithCost('1.25e2'))).toThrow(/unsigned plain decimal/i);
    expect(() => validateAndNormalizeExternalPayload(makeWithCost(' 125.00 '))).toThrow(/unsigned plain decimal/i);
    expect(() => validateAndNormalizeExternalPayload(makeWithCost('125.001'))).toThrow(/at most 2 fractional digits/i);
  });

  test('rejects zero or negative quantities', () => {
    const zeroQty = {
      ...conformingExample,
      lines: [{ ...conformingExample.lines[0], quantity: '0.0000' }],
    };
    expect(() => validateAndNormalizeExternalPayload(zeroQty)).toThrow(/greater than 0/i);
  });

  test('rejects non-increasing or duplicate line_no', () => {
    const nonInc = {
      ...conformingExample,
      lines: [
        { ...conformingExample.lines[0], line_no: 5 },
        { ...conformingExample.lines[0], line_no: 3 },
      ],
    };
    expect(() => validateAndNormalizeExternalPayload(nonInc)).toThrow(/strictly increasing/i);
  });

  test('rejects invalid control characters and bidirectional formatting controls', () => {
    const bidiPayload = {
      ...conformingExample,
      document: { ...conformingExample.document, supplier_name: 'Supplier \u200E LLC' },
    };
    expect(() => validateAndNormalizeExternalPayload(bidiPayload)).toThrow(/bidirectional/i);

    const controlPayload = {
      ...conformingExample,
      document: { ...conformingExample.document, supplier_name: 'Supplier \x07 Bell' },
    };
    expect(() => validateAndNormalizeExternalPayload(controlPayload)).toThrow(/invalid control/i);
  });

  test('rejects invalid calendar dates', () => {
    const badDate = {
      ...conformingExample,
      document: { ...conformingExample.document, document_date: '2026-02-30' },
    };
    expect(() => validateAndNormalizeExternalPayload(badDate)).toThrow(/not a valid calendar day/i);
  });

  test('reconciliation detects line total mismatch (quantity × unit_cost vs printed_line_total)', () => {
    const mismatchLine = {
      ...conformingExample,
      lines: [
        {
          ...conformingExample.lines[0],
          quantity: '2.0000',
          unit_cost: '100.00',
          printed_line_total: '250.00', // 2 * 100 = 200 != 250
        },
      ],
      document: {
        ...conformingExample.document,
        printed_total: '250.00',
      },
    };
    const normalized = validateAndNormalizeExternalPayload(mismatchLine);
    const lineMismatch = normalized.extraction_issues.find(
      (i) => i.code === 'TOTAL_MISMATCH' && i.line_no === 1,
    );
    expect(lineMismatch).toBeDefined();
    expect(lineMismatch.field).toBe('printed_line_total');
  });

  test('reconciliation detects document total mismatch (sum of lines vs printed_total)', () => {
    const mismatchDoc = {
      ...conformingExample,
      lines: [
        {
          ...conformingExample.lines[0],
          quantity: '2.0000',
          unit_cost: '125.00',
          printed_line_total: '250.00',
        },
      ],
      document: {
        ...conformingExample.document,
        printed_total: '300.00', // lines sum to 250 != 300
      },
    };
    const normalized = validateAndNormalizeExternalPayload(mismatchDoc);
    const docMismatch = normalized.extraction_issues.find(
      (i) => i.code === 'TOTAL_MISMATCH' && i.line_no === null,
    );
    expect(docMismatch).toBeDefined();
    expect(docMismatch.field).toBe('printed_total');
  });

  test('reconciliation handles half-up cents rounding correctly', () => {
    // 3 * 33.33 = 99.99
    const matching = {
      ...conformingExample,
      lines: [
        {
          ...conformingExample.lines[0],
          quantity: '3.0000',
          unit_cost: '33.33',
          printed_line_total: '99.99',
        },
      ],
      document: {
        ...conformingExample.document,
        printed_total: '99.99',
      },
    };
    const normalized = validateAndNormalizeExternalPayload(matching);
    const mismatches = normalized.extraction_issues.filter((i) => i.code === 'TOTAL_MISMATCH');
    expect(mismatches).toHaveLength(0);
  });

  test('payload hash is deterministic across key ordering and binds validated context', () => {
    const payloadA = { ...conformingExample };
    const payloadB = {
      extraction_issues: [],
      lines: conformingExample.lines,
      schema_version: 1,
      document: conformingExample.document,
    };
    const normA = validateAndNormalizeExternalPayload(payloadA);
    const normB = validateAndNormalizeExternalPayload(payloadB);

    const context1 = { context_id: 'c1', supplier_id: 10 };
    const context2 = { context_id: 'c1', supplier_id: 10 };
    const context3 = { context_id: 'c1', supplier_id: 20 };

    const hashA = computePayloadHash(normA, context1);
    const hashB = computePayloadHash(normB, context2);
    const hashC = computePayloadHash(normA, context3);

    expect(hashA).toBe(hashB);
    expect(hashA).not.toBe(hashC);
  });

  test('exact conversion math: verifies exact stock uom conversion and catches inexact fractions', () => {
    // 2 BOX @ 10 PCS/BOX, 500.00/BOX -> 20.0000 PCS, 50.00/PCS
    const exact = checkExactConversion('2.0000', '500.00', '10.0000');
    expect(exact.ok).toBe(true);
    expect(exact.convertedDeliveredQty).toBe('20.0000');
    expect(exact.convertedUnitCost).toBe('50.00');

    // Inexact cost: 100.00 / 3 PCS/BOX -> cannot be represented in cents
    const inexact = checkExactConversion('2.0000', '100.00', '3.0000');
    expect(inexact.ok).toBe(false);
    expect(inexact.error).toMatch(/Unit cost cannot be exactly represented/i);
  });

  test('blocker calculation: catches unconfirmed items, currency blockers, and completeness errors', () => {
    const normalized = validateAndNormalizeExternalPayload(conformingExample);
    const state = initializeReviewState(normalized, {});

    // Initial state has missing supplier, unconfirmed currency, unconfirmed header, unconfirmed row, unselected part
    let blockers = calculateBlockers(state, normalized);
    expect(blockers.some((b) => b.code === 'SUPPLIER_REQUIRED')).toBe(true);
    expect(blockers.some((b) => b.code === 'RECEIPT_DATE_REQUIRED')).toBe(true);
    expect(blockers.some((b) => b.code === 'PART_REQUIRED')).toBe(true);
    expect(blockers.some((b) => b.code === 'ROW_CONFIRMATION_REQUIRED')).toBe(true);

    // SKIPPED_ROW blocks document unconditionally
    state.issues.push({
      issue_id: 'iss-1',
      code: 'SKIPPED_ROW',
      line_no: null,
      field: null,
      message: 'Page 2 skipped',
      resolved: false,
    });
    blockers = calculateBlockers(state, normalized);
    expect(blockers.some((b) => b.code === 'SKIPPED_ROW')).toBe(true);
  });

  test('confirmation digest invalidation: changing supplier or currency invalidates digests', () => {
    const headerParams = {
      supplierId: 5,
      supplierDocumentNo: 'DR-100',
      supplierDocumentType: 'delivery_receipt',
      supplierInvoiceNo: null,
      billId: null,
      anotherDeliveryConfirmed: false,
      confirmedCurrency: 'PHP',
      receiptDate: '2026-10-20',
      isBackfill: false,
    };
    const rowParams = {
      supplierId: 5,
      currency: 'PHP',
      partId: 101,
      stockUom: 'PCS',
      unitsPerSourceUnit: '1.0000',
      deliveredQuantity: '2.0000',
      returnQuantity: '0.0000',
      costPrice: '125.00',
      costKind: 'priced',
      salePrice: null,
    };

    const hDigest1 = computeHeaderDigest(headerParams);
    const rDigest1 = computeRowDigest(rowParams);

    // Changing supplierId changes both digests
    const hDigest2 = computeHeaderDigest({ ...headerParams, supplierId: 6 });
    const rDigest2 = computeRowDigest({ ...rowParams, supplierId: 6 });
    expect(hDigest1).not.toBe(hDigest2);
    expect(rDigest1).not.toBe(rDigest2);

    // Ordinary receipt edits preserve the confirmed catalog match.
    const rDigest3 = computeRowDigest({ ...rowParams, deliveredQuantity: '3.0000' });
    expect(rDigest1).toBe(rDigest3);
    expect(rDigest1).toBe(computeRowDigest({ ...rowParams, costPrice: null, costKind: 'unknown', salePrice: '500.00', returnQuantity: '1.0000' }));
    expect(rDigest1).not.toBe(computeRowDigest({ ...rowParams, partId: 102 }));
    expect(rDigest1).not.toBe(computeRowDigest({ ...rowParams, stockUom: 'BOX' }));
  });
  test('missing prices and financial extraction issues are advisory; catalog identity remains strict', () => {
    const normalized = validateAndNormalizeExternalPayload(conformingExample);
    const state = initializeReviewState(normalized, {});
    const cr = state.rows[0].confirmed_row;
    cr.cost_price = null;
    cr.cost_kind = 'unknown';
    state.issues = [
      { issue_id: 'cost', code: 'UNREADABLE_VALUE', field: 'unit_cost', line_no: 1, resolved: false },
      { issue_id: 'sale', code: 'AMBIGUOUS_VALUE', field: 'handwritten_sale_price', line_no: 1, resolved: false },
      { issue_id: 'total', code: 'TOTAL_MISMATCH', field: 'printed_total', line_no: null, resolved: false },
      { issue_id: 'identity', code: 'CONFLICTING_VALUES', field: 'part_number', line_no: 1, resolved: false },
    ];
    const blockers = calculateBlockers(state, normalized);
    expect(blockers.filter(b => ['cost', 'sale', 'total'].includes(b.issue_id))).toEqual([]);
    expect(blockers.some(b => b.issue_id === 'identity')).toBe(false); // Match selection/confirmation validate identity directly.
    expect(blockers.some(b => b.code === 'PART_REQUIRED')).toBe(true);
    expect(blockers.some(b => b.code === 'ROW_CONFIRMATION_REQUIRED')).toBe(true);
    expect(blockers.some(b => b.code.startsWith('COST_'))).toBe(false);
    cr.cost_price = '-1';
    expect(calculateBlockers(state, normalized).some(b => b.code === 'INVALID_PRICE')).toBe(true);
  });

  test.each(['AMBIGUOUS_VALUE', 'UNREADABLE_VALUE', 'CONFLICTING_VALUES', 'UNCLASSIFIED_NOTE'])(
    '%s notes without a field do not block or manufacture a price', code => {
      const payload = structuredClone(conformingExample);
      payload.lines[0].handwritten_sale_price = null;
      payload.extraction_issues = [
        { code, line_no: null, field: null, message: "Handwritten numbers '180' and '1000' appear near lines 5 and 6; their intended line association and meaning (e.g. operational temperature spec vs. retail price) are ambiguous, so handwritten_sale_price is set to null." },
        { code, line_no: 1, field: null, message: 'Unknown annotation; leave it null.' },
      ];
      const normalized = validateAndNormalizeExternalPayload(payload);
      const before = structuredClone(normalized);
      const state = initializeReviewState(normalized, { supplier_id: 5 });
      const cr = state.rows[0].confirmed_row;
      cr.part_id = 101;
      cr.stock_uom = 'PCS';
      cr.row_confirmed = true;
      cr.row_confirmation_digest = computeRowDigest({ supplierId: 5, currency: 'PHP', partId: 101, stockUom: 'PCS', unitsPerSourceUnit: '1.0000' });
      state.header.receipt_date = '2026-10-20';
      state.header.header_confirmed = true;
      state.header.header_confirmation_digest = computeHeaderDigest(state.header);
      expect(calculateBlockers(state, normalized)).toEqual([]);
      expect(normalized).toEqual(before);
      expect(normalized.lines[0].handwritten_sale_price).toBeNull();
      expect(cr.sale_price).toBeNull();
      expect(state.issues.every(issue => !issue.resolved)).toBe(true);
    });

  describe('currency parsing fallback', () => {
    test.each([
      [null, 'PHP'],
      [undefined, 'PHP'],
      ['', 'PHP'],
      ['   ', 'PHP'],
      ['php', 'PHP'],
      ['PHP', 'PHP'],
      ['  php  ', 'PHP'],
      ['₱', 'PHP'],
      ['PESOS', 'PHP'],
      [123, 'PHP'],
      ['USD', 'USD'],
      ['usd', 'USD'],
      ['JPY', 'JPY'],
    ])('parses currency %p as %p', (input, expected) => {
      const payload = structuredClone(conformingExample);
      payload.document.currency = input;
      const normalized = validateAndNormalizeExternalPayload(payload);
      expect(normalized.document.currency).toBe(expected);
    });
  });

  describe('supplier matching and review state', () => {
    test('auto-matched supplier populates header.supplier_id and ai_filled_fields without locking', () => {
      const normalized = validateAndNormalizeExternalPayload(conformingExample);
      const state = initializeReviewState(normalized, {}, 42);
      expect(state.header.supplier_id).toBe(42);
      expect(state.header.context_locked_supplier_id).toBeNull();
      expect(state.header.ai_filled_fields).toContain('supplier_id');
    });

    test('explicit context supplier overrides matched supplier and locks context', () => {
      const normalized = validateAndNormalizeExternalPayload(conformingExample);
      const state = initializeReviewState(normalized, { supplier_id: 99 }, 42);
      expect(state.header.supplier_id).toBe(99);
      expect(state.header.context_locked_supplier_id).toBe(99);
      expect(state.header.ai_filled_fields).not.toContain('supplier_id');
    });

    test('findSupplierFuzzy handles empty or invalid name', async () => {
      const mockClient = { query: jest.fn() };
      expect(await findSupplierFuzzy(mockClient, null)).toBeNull();
      expect(await findSupplierFuzzy(mockClient, '')).toBeNull();
      expect(await findSupplierFuzzy(mockClient, '   ')).toBeNull();
      expect(mockClient.query).not.toHaveBeenCalled();
    });

    test('findSupplierFuzzy returns exact match when found', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValueOnce({
          rows: [{ supplier_id: 10, supplier_name: 'Toyota Genuine Parts' }],
        }),
      };
      const result = await findSupplierFuzzy(mockClient, 'Toyota Genuine Parts');
      expect(result).toEqual({ supplier_id: 10, supplier_name: 'Toyota Genuine Parts' });
      expect(mockClient.query).toHaveBeenCalledTimes(1);
    });

    test('findSupplierFuzzy falls back to fuzzy search when exact match fails', async () => {
      const mockClient = {
        query: jest
          .fn()
          .mockResolvedValueOnce({ rows: [] }) // exact match returns empty
          .mockResolvedValueOnce({
            rows: [{ supplier_id: 10, supplier_name: 'Toyota Motor Philippines', score: 0.8 }],
          }),
      };
      const result = await findSupplierFuzzy(mockClient, 'Toyota');
      expect(result).toEqual({ supplier_id: 10, supplier_name: 'Toyota Motor Philippines', score: 0.8 });
      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });

    test('findSupplierFuzzy returns null when fuzzy score is below threshold', async () => {
      const mockClient = {
        query: jest
          .fn()
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({
            rows: [{ supplier_id: 99, supplier_name: 'Unrelated Company', score: 0.1 }],
          }),
      };
      const result = await findSupplierFuzzy(mockClient, 'Zzz Completely Unrelated');
      expect(result).toBeNull();
    });
  });

});
