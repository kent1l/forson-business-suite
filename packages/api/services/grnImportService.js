const crypto = require('crypto');
const { manilaDateString } = require('../helpers/manilaDate');
const grnCosting = require('./grnCostingService');
const { createGrnDraft } = require('./grnDraftService');
const {
  validateAndNormalizeExternalPayload,
  computePayloadHash,
  MAX_PAYLOAD_BYTES,
  MAX_LINES,
  MAX_ISSUES,
  KNOWN_ISSUE_CODES,
} = require('../helpers/grnImportSchema');

const MAX_REVIEW_JSON_BYTES = 4194304; // 4 MiB

function isFeatureEnabled() {
  return process.env.GRN_JSON_IMPORT_ENABLED === 'true';
}

function getImportCapabilities() {
  return {
    enabled: isFeatureEnabled(),
    schema_version: 1,
    optional_line_fields: ['supplier_item_text'],
    limits: {
      max_payload_bytes: MAX_PAYLOAD_BYTES,
      max_lines: MAX_LINES,
      max_issues: MAX_ISSUES,
      max_sources_per_line: 20,
    },
  };
}

function computeRowDigest({
  supplierId,
  currency,
  partId,
  stockUom,
  unitsPerSourceUnit,
  deliveredQuantity,
  returnQuantity,
  costPrice,
  costKind,
  salePrice,
}) {
  const content = JSON.stringify({
    supplierId: supplierId || null,
    currency: currency || null,
    partId: partId || null,
    stockUom: stockUom || null,
    unitsPerSourceUnit: unitsPerSourceUnit || '1.0000',
    deliveredQuantity: deliveredQuantity || null,
    returnQuantity: returnQuantity || '0.0000',
    costPrice: costPrice || null,
    costKind: costKind || null,
    salePrice: salePrice || null,
  });
  return crypto.createHash('sha256').update(content).digest('hex');
}

function computeHeaderDigest({
  supplierId,
  supplierDocumentNo,
  supplierDocumentType,
  supplierInvoiceNo,
  billId,
  anotherDeliveryConfirmed,
  confirmedCurrency,
  receiptDate,
  isBackfill,
}) {
  const content = JSON.stringify({
    supplierId: supplierId || null,
    supplierDocumentNo: supplierDocumentNo || null,
    supplierDocumentType: supplierDocumentType || 'other',
    supplierInvoiceNo: supplierInvoiceNo || null,
    billId: billId || null,
    anotherDeliveryConfirmed: !!anotherDeliveryConfirmed,
    confirmedCurrency: confirmedCurrency || null,
    receiptDate: receiptDate || null,
    isBackfill: !!isBackfill,
  });
  return crypto.createHash('sha256').update(content).digest('hex');
}

function checkExactConversion(sourceDeliveredQtyStr, sourceUnitCostStr, factorStr) {
  if (!factorStr || Number(factorStr) <= 0) {
    return { ok: false, error: 'Factor must be greater than zero.' };
  }
  const factorParts = factorStr.split('.');
  const factorInt = BigInt(factorParts[0]) * 10000n + BigInt((factorParts[1] || '').padEnd(4, '0').slice(0, 4));

  let convertedDeliveredQty = null;
  if (sourceDeliveredQtyStr) {
    const qParts = sourceDeliveredQtyStr.split('.');
    const qInt = BigInt(qParts[0]) * 10000n + BigInt((qParts[1] || '').padEnd(4, '0').slice(0, 4));
    const prod = qInt * factorInt;
    if (prod % 10000n !== 0n) {
      return { ok: false, error: 'Delivered quantity cannot be exactly represented at 4 decimal places with this factor.' };
    }
    const stockQtyInt = prod / 10000n;
    const whole = stockQtyInt / 10000n;
    const frac = (stockQtyInt % 10000n).toString().padStart(4, '0');
    convertedDeliveredQty = `${whole}.${frac}`;
  }

  let convertedUnitCost = null;
  if (sourceUnitCostStr) {
    const cParts = sourceUnitCostStr.split('.');
    const cCents = BigInt(cParts[0]) * 100n + BigInt((cParts[1] || '').padEnd(2, '0').slice(0, 2));
    // cCents / (factorInt / 10000n) = (cCents * 10000n) / factorInt
    const num = cCents * 10000n;
    if (num % factorInt !== 0n) {
      return { ok: false, error: 'Unit cost cannot be exactly represented at 2 decimal places with this factor.' };
    }
    const costCents = num / factorInt;
    const whole = costCents / 100n;
    const frac = (costCents % 100n).toString().padStart(2, '0');
    convertedUnitCost = `${whole}.${frac}`;
  }

  return {
    ok: true,
    convertedDeliveredQty,
    convertedUnitCost,
  };
}

function calculateBlockers(reviewState, sourcePayload) {
  const blockers = [];
  const header = reviewState.header || {};
  const rows = reviewState.rows || [];
  const issues = reviewState.issues || [];

  // 1. Completeness checks: SKIPPED_ROW or CROPPED_OR_MISSING_PAGE
  for (const issue of issues) {
    if (issue.code === 'SKIPPED_ROW' || issue.code === 'CROPPED_OR_MISSING_PAGE') {
      blockers.push({
        scope: 'document',
        field: null,
        code: issue.code,
        message: `Extraction has ${issue.code} issue. Document cannot be imported in MVP. Please re-extract or abandon.`,
      });
    }
  }

  // 2. Currency check
  const sourceCurrency = sourcePayload?.document?.currency;
  if (sourceCurrency && sourceCurrency !== 'PHP') {
    blockers.push({
      scope: 'header',
      field: 'currency',
      code: 'NON_PHP_CURRENCY',
      message: `Source document currency is ${sourceCurrency}. Only PHP is supported for commit.`,
    });
  } else if (!header.confirmed_currency || header.confirmed_currency !== 'PHP') {
    blockers.push({
      scope: 'header',
      field: 'confirmed_currency',
      code: 'PHP_CONFIRMATION_REQUIRED',
      message: 'Currency must be explicitly confirmed as PHP.',
    });
  } else if (!sourceCurrency) {
    // Unknown source currency requires reason of min 5 chars
    if (!header.currency_reason || header.currency_reason.trim().length < 5) {
      blockers.push({
        scope: 'header',
        field: 'currency_reason',
        code: 'CURRENCY_REASON_REQUIRED',
        message: 'Unknown source currency requires an explanation of at least 5 characters.',
      });
    }
  }

  // 3. Header fields
  if (!header.supplier_id) {
    blockers.push({
      scope: 'header',
      field: 'supplier_id',
      code: 'SUPPLIER_REQUIRED',
      message: 'Supplier must be selected.',
    });
  }
  if (!header.supplier_document_no || !header.supplier_document_no.trim()) {
    blockers.push({
      scope: 'header',
      field: 'supplier_document_no',
      code: 'DOCUMENT_NUMBER_REQUIRED',
      message: 'Supplier document number is required.',
    });
  }
  if (!header.receipt_date) {
    blockers.push({
      scope: 'header',
      field: 'receipt_date',
      code: 'RECEIPT_DATE_REQUIRED',
      message: 'Receipt date must be confirmed.',
    });
  } else {
    const todayManila = manilaDateString();
    if (header.receipt_date > todayManila) {
      blockers.push({
        scope: 'header',
        field: 'receipt_date',
        code: 'RECEIPT_DATE_FUTURE',
        message: 'Receipt date cannot be in the future.',
      });
    }
  }

  // Header confirmation
  const expectedHeaderDigest = computeHeaderDigest(header);
  if (!header.header_confirmed || header.header_confirmation_digest !== expectedHeaderDigest) {
    blockers.push({
      scope: 'header',
      field: 'header_confirmed',
      code: 'HEADER_CONFIRMATION_REQUIRED',
      message: 'Header details must be explicitly confirmed.',
    });
  }

  // 4. Rows
  const includedRows = rows.filter(r => r.included);
  if (includedRows.length === 0) {
    blockers.push({
      scope: 'document',
      field: 'rows',
      code: 'AT_LEAST_ONE_ROW_REQUIRED',
      message: 'At least one line item must be included.',
    });
  }

  const excludedRows = rows.filter(r => !r.included);
  for (const row of excludedRows) {
    if (!row.exclusion_reason || row.exclusion_reason.trim().length < 5) {
      blockers.push({
        scope: 'row',
        row_id: row.row_id,
        line_no: row.line_no,
        field: 'exclusion_reason',
        code: 'EXCLUSION_REASON_REQUIRED',
        message: `Line ${row.line_no}: Exclusion requires a reason of at least 5 characters.`,
      });
    }
  }

  for (const row of includedRows) {
    const cr = row.confirmed_row || {};
    if (!cr.part_id) {
      blockers.push({
        scope: 'row',
        row_id: row.row_id,
        line_no: row.line_no,
        field: 'part_id',
        code: 'PART_REQUIRED',
        message: `Line ${row.line_no}: Catalog part must be selected.`,
      });
    }
    if (!cr.stock_uom) {
      blockers.push({
        scope: 'row',
        row_id: row.row_id,
        line_no: row.line_no,
        field: 'stock_uom',
        code: 'STOCK_UOM_REQUIRED',
        message: `Line ${row.line_no}: Stock UOM is missing.`,
      });
    }
    const factor = cr.units_per_source_unit || '1.0000';
    if (!factor || Number(factor) <= 0) {
      blockers.push({
        scope: 'row',
        row_id: row.row_id,
        line_no: row.line_no,
        field: 'units_per_source_unit',
        code: 'INVALID_FACTOR',
        message: `Line ${row.line_no}: Unit conversion factor must be greater than zero.`,
      });
    }

    // Delivered and return quantities
    if (!cr.delivered_quantity || Number(cr.delivered_quantity) <= 0) {
      blockers.push({
        scope: 'row',
        row_id: row.row_id,
        line_no: row.line_no,
        field: 'delivered_quantity',
        code: 'DELIVERED_QUANTITY_REQUIRED',
        message: `Line ${row.line_no}: Delivered quantity must be greater than zero.`,
      });
    }
    const returnQtyNum = Number(cr.return_quantity || '0');
    const deliveredQtyNum = Number(cr.delivered_quantity || '0');
    if (returnQtyNum < 0 || returnQtyNum > deliveredQtyNum) {
      blockers.push({
        scope: 'row',
        row_id: row.row_id,
        line_no: row.line_no,
        field: 'return_quantity',
        code: 'INVALID_RETURN_QUANTITY',
        message: `Line ${row.line_no}: Return quantity must be between 0 and delivered quantity.`,
      });
    }
    if (returnQtyNum > 0) {
      if (!cr.rejection_reason || !grnCosting.REJECTION_REASONS.includes(cr.rejection_reason)) {
        blockers.push({
          scope: 'row',
          row_id: row.row_id,
          line_no: row.line_no,
          field: 'rejection_reason',
          code: 'REJECTION_REASON_REQUIRED',
          message: `Line ${row.line_no}: Rejection reason is required for returned items.`,
        });
      }
    }

    // Cost classification
    if (!cr.cost_kind || !['priced', 'free', 'unknown'].includes(cr.cost_kind)) {
      blockers.push({
        scope: 'row',
        row_id: row.row_id,
        line_no: row.line_no,
        field: 'cost_kind',
        code: 'COST_KIND_REQUIRED',
        message: `Line ${row.line_no}: Cost must be classified as priced, free, or unknown.`,
      });
    } else if (cr.cost_kind === 'priced') {
      if (cr.cost_price === null || cr.cost_price === undefined || Number(cr.cost_price) <= 0) {
        blockers.push({
          scope: 'row',
          row_id: row.row_id,
          line_no: row.line_no,
          field: 'cost_price',
          code: 'COST_PRICE_REQUIRED',
          message: `Line ${row.line_no}: Priced line item requires a positive unit cost.`,
        });
      }
    } else if (cr.cost_kind === 'free') {
      if (cr.cost_price !== '0.00' && Number(cr.cost_price) !== 0) {
        blockers.push({
          scope: 'row',
          row_id: row.row_id,
          line_no: row.line_no,
          field: 'cost_price',
          code: 'FREE_COST_PRICE_MUST_BE_ZERO',
          message: `Line ${row.line_no}: Free goods must have cost price of 0.00.`,
        });
      }
    } else if (cr.cost_kind === 'unknown') {
      if (!cr.cost_reason || cr.cost_reason.trim().length < 5) {
        blockers.push({
          scope: 'row',
          row_id: row.row_id,
          line_no: row.line_no,
          field: 'cost_reason',
          code: 'COST_REASON_REQUIRED',
          message: `Line ${row.line_no}: Unknown cost requires an explanation of at least 5 characters.`,
        });
      }
    }

    // Row confirmation
    const expectedRowDigest = computeRowDigest({
      supplierId: header.supplier_id,
      currency: header.confirmed_currency,
      partId: cr.part_id,
      stockUom: cr.stock_uom,
      unitsPerSourceUnit: cr.units_per_source_unit,
      deliveredQuantity: cr.delivered_quantity,
      returnQuantity: cr.return_quantity,
      costPrice: cr.cost_price,
      costKind: cr.cost_kind,
      salePrice: cr.sale_price,
    });
    if (!cr.row_confirmed || cr.row_confirmation_digest !== expectedRowDigest) {
      blockers.push({
        scope: 'row',
        row_id: row.row_id,
        line_no: row.line_no,
        field: 'row_confirmed',
        code: 'ROW_CONFIRMATION_REQUIRED',
        message: `Line ${row.line_no}: Line item must be explicitly confirmed.`,
      });
    }
  }

  // 5. Issues resolution
  const includedLineNos = new Set(includedRows.map(r => r.line_no));
  for (const issue of issues) {
    if (issue.resolved) continue;

    const isHeaderScope = issue.line_no === null;
    const isIncludedRow = issue.line_no !== null && includedLineNos.has(issue.line_no);

    if (isHeaderScope || isIncludedRow) {
      if (['UNREADABLE_VALUE', 'AMBIGUOUS_VALUE', 'CONFLICTING_VALUES'].includes(issue.code)) {
        blockers.push({
          scope: isHeaderScope ? 'header' : 'row',
          line_no: issue.line_no,
          issue_id: issue.issue_id,
          field: issue.field,
          code: issue.code,
          message: `Unresolved issue '${issue.code}': ${issue.message}. Explanation or correction required.`,
        });
      } else if (issue.code === 'TOTAL_MISMATCH') {
        const hasExplanation = reviewState.total_warning_explanations?.[issue.issue_id];
        if (!hasExplanation || hasExplanation.trim().length < 5) {
          blockers.push({
            scope: isHeaderScope ? 'header' : 'row',
            line_no: issue.line_no,
            issue_id: issue.issue_id,
            field: issue.field,
            code: 'TOTAL_MISMATCH_EXPLANATION_REQUIRED',
            message: `Total mismatch (${issue.message}) requires a reviewed explanation of at least 5 characters.`,
          });
        }
      } else if (!KNOWN_ISSUE_CODES.has(issue.code)) {
        // Unknown issue code requires resolution
        blockers.push({
          scope: isHeaderScope ? 'header' : 'row',
          line_no: issue.line_no,
          issue_id: issue.issue_id,
          field: issue.field,
          code: 'UNKNOWN_ISSUE_REQUIRES_RESOLUTION',
          message: `Issue '${issue.code}': ${issue.message}. Explanation required.`,
        });
      }
    }
  }

  return blockers;
}

function initializeReviewState(normalizedPayload, initialContext) {
  const doc = normalizedPayload.document || {};
  const header = {
    supplier_id: initialContext.supplier_id || null,
    supplier_document_no: doc.document_number || null,
    supplier_document_type: ['delivery_receipt', 'invoice', 'other'].includes(doc.document_type) ? doc.document_type : 'other',
    supplier_invoice_no: null,
    bill_id: initialContext.bill_id || null,
    another_delivery_confirmed: false,
    confirmed_currency: doc.currency === 'PHP' ? 'PHP' : null,
    currency_reason: null,
    receipt_date: null,
    is_backfill: false,
    context_locked_supplier_id: initialContext.supplier_id || null,
    context_locked_bill_id: initialContext.bill_id || null,
    header_confirmed: false,
    header_confirmation_digest: null,
  };

  const rows = normalizedPayload.lines.map((line) => {
    const rowId = crypto.randomUUID();
    return {
      row_id: rowId,
      line_no: line.line_no,
      included: true,
      exclusion_reason: null,
      corrections: {},
      confirmed_row: {
        part_id: null,
        stock_uom: null,
        units_per_source_unit: '1.0000',
        delivered_quantity: line.quantity || null,
        return_quantity: '0.0000',
        rejection_reason: null,
        cost_price: line.unit_cost || null,
        cost_kind: line.unit_cost ? (line.unit_cost === '0.00' ? 'free' : 'priced') : null,
        cost_reason: null,
        sale_price: null,
        row_confirmed: false,
        row_confirmation_digest: null,
      },
    };
  });

  const issues = normalizedPayload.extraction_issues.map(iss => ({
    ...iss,
    resolved: false,
    resolution_reason: null,
  }));

  const reviewState = {
    header,
    rows,
    issues,
    document_id: null,
    resolution_events: [],
    total_warning_explanations: {},
  };

  return reviewState;
}

async function validateInitialContext(client, context = {}) {
  const validated = {
    context_id: context.context_id || null,
  };

  if (context.supplier_id) {
    const supId = Number(context.supplier_id);
    const { rows } = await client.query(
      'SELECT supplier_id, is_active FROM supplier WHERE supplier_id = $1',
      [supId]
    );
    if (!rows.length || !rows[0].is_active) {
      const err = new Error(`Supplier ${supId} does not exist or is inactive.`);
      err.statusCode = 400;
      throw err;
    }
    validated.supplier_id = supId;
  }

  if (context.bill_id) {
    const bId = Number(context.bill_id);
    const { rows } = await client.query(
      'SELECT bill_id, supplier_id, status FROM supplier_bill WHERE bill_id = $1',
      [bId]
    );
    if (!rows.length || rows[0].status === 'Void') {
      const err = new Error(`Bill ${bId} does not exist or is voided.`);
      err.statusCode = 400;
      throw err;
    }
    if (validated.supplier_id && rows[0].supplier_id !== validated.supplier_id) {
      const err = new Error(`Bill ${bId} does not belong to supplier ${validated.supplier_id}.`);
      err.statusCode = 400;
      throw err;
    }
    validated.bill_id = bId;
    if (!validated.supplier_id) {
      validated.supplier_id = rows[0].supplier_id;
    }
  }

  return validated;
}

async function createImport(client, employeeId, { request_key, payload, context = {} }) {
  if (!isFeatureEnabled()) {
    const err = new Error('External JSON import is currently disabled.');
    err.statusCode = 503;
    err.code = 'GRN_IMPORT_DISABLED';
    throw err;
  }

  if (!request_key || typeof request_key !== 'string') {
    const err = new Error('request_key UUID is required.');
    err.statusCode = 400;
    throw err;
  }

  const normalizedPayload = validateAndNormalizeExternalPayload(payload);
  const validatedContext = await validateInitialContext(client, context);
  const payloadHash = computePayloadHash(normalizedPayload, validatedContext);

  // Check for existing import with this (created_by_employee_id, request_key)
  const { rows: existingRows } = await client.query(
    `SELECT import_id, status, version, payload_hash, review_state, source_payload, purged_at
     FROM grn_import_review
     WHERE created_by_employee_id = $1 AND request_key = $2`,
    [employeeId, request_key]
  );

  if (existingRows.length > 0) {
    const existing = existingRows[0];
    if (existing.payload_hash !== payloadHash) {
      const err = new Error('request_key already exists with a different payload or context.');
      err.statusCode = 409;
      err.code = 'REQUEST_KEY_PAYLOAD_MISMATCH';
      throw err;
    }
    // Replay: return 200
    const blockers = existing.review_state
      ? calculateBlockers(existing.review_state, existing.source_payload)
      : [];
    return {
      status: 200,
      data: {
        import_id: existing.import_id,
        status: existing.status,
        version: existing.version,
        review_state: existing.review_state,
        issues: existing.review_state?.issues || [],
        blockers,
      },
    };
  }

  // Create new review
  const reviewState = initializeReviewState(normalizedPayload, validatedContext);
  const blockers = calculateBlockers(reviewState, normalizedPayload);
  const lifecycleEvents = [{
    event: 'CREATED',
    actor_id: employeeId,
    timestamp: new Date().toISOString(),
    version: 1,
  }];

  const { rows: [created] } = await client.query(
    `INSERT INTO grn_import_review (
       created_by_employee_id, status, schema_version, source_payload,
       payload_hash, initial_context, review_state, lifecycle_events,
       request_key, version
     )
     VALUES ($1, 'IN_REVIEW', 1, $2, $3, $4, $5, $6, $7, 1)
     RETURNING import_id, status, version, created_at`,
    [
      employeeId,
      JSON.stringify(normalizedPayload),
      payloadHash,
      JSON.stringify(validatedContext),
      JSON.stringify(reviewState),
      JSON.stringify(lifecycleEvents),
      request_key,
    ]
  );

  return {
    status: 201,
    data: {
      import_id: created.import_id,
      status: created.status,
      version: created.version,
      review_state: reviewState,
      issues: reviewState.issues,
      blockers,
    },
  };
}

async function getImports(client, employeeId, { status = 'IN_REVIEW', limit = 20, cursor = null } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 50));
  let query = `
    SELECT import_id, status, version, schema_version, created_at, updated_at,
           committed_at, abandoned_at, grn_id,
           (review_state->'header'->>'supplier_document_no') as supplier_document_no,
           (review_state->'header'->>'supplier_id') as supplier_id,
           jsonb_array_length(review_state->'rows') as line_count
    FROM grn_import_review
    WHERE created_by_employee_id = $1
  `;
  const params = [employeeId];

  if (status && status !== 'all') {
    params.push(status);
    query += ` AND status = $${params.length}`;
  }

  if (cursor) {
    try {
      const decoded = Buffer.from(cursor, 'base64').toString('utf8');
      const [cursorUpdated, cursorId] = JSON.parse(decoded);
      params.push(cursorUpdated, cursorId);
      query += ` AND (updated_at, import_id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
    } catch {
      // Ignore malformed cursor
    }
  }

  query += ` ORDER BY updated_at DESC, import_id DESC LIMIT $${params.length + 1}`;
  params.push(safeLimit + 1);

  const { rows } = await client.query(query, params);
  const hasMore = rows.length > safeLimit;
  const items = hasMore ? rows.slice(0, safeLimit) : rows;

  let nextCursor = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1];
    nextCursor = Buffer.from(JSON.stringify([last.updated_at, last.import_id])).toString('base64');
  }

  return {
    items,
    next_cursor: nextCursor,
  };
}

// Resolve labels from the catalog without storing them as confirmed import facts.
async function withCatalogPartNames(client, reviewState) {
  const partIds = [...new Set((reviewState?.rows || []).map(row => row.confirmed_row?.part_id).filter(Boolean))];
  if (partIds.length === 0) return reviewState;

  const { rows: parts } = await client.query(
    `SELECT part_id, COALESCE(NULLIF(display_name, ''), NULLIF(detail, ''), internal_sku) AS display_name
     FROM parts_view WHERE part_id = ANY($1::int[])`,
    [partIds]
  );
  const names = new Map(parts.map(part => [part.part_id, part.display_name]));
  return {
    ...reviewState,
    rows: reviewState.rows.map(row => ({
      ...row,
      confirmed_row: {
        ...row.confirmed_row,
        part_display_name: names.get(row.confirmed_row?.part_id) || null,
      },
    })),
  };
}

async function getImportById(client, employeeId, importId, userPermissions = []) {
  const { rows } = await client.query(
    `SELECT ir.*,
            gr.grn_number, gr.workflow_status as grn_workflow_status
     FROM grn_import_review ir
     LEFT JOIN goods_receipt gr ON gr.grn_id = ir.grn_id
     WHERE ir.import_id = $1`,
    [importId]
  );

  if (rows.length === 0) {
    const err = new Error('Import review not found.');
    err.statusCode = 404;
    throw err;
  }

  const review = rows[0];
  const isCreator = review.created_by_employee_id === employeeId;
  const canPost = userPermissions.includes('goods_receipt:post');

  // Reader authorization check: creator, or post permission for committed
  if (!isCreator && (!canPost || review.status !== 'COMMITTED')) {
    const err = new Error('Import review not found.');
    err.statusCode = 404;
    throw err;
  }

  if (review.purged_at) {
    return {
      import_id: review.import_id,
      status: review.status,
      version: review.version,
      purged_at: review.purged_at,
      lifecycle_events: review.lifecycle_events,
    };
  }

  const blockers = review.review_state
    ? calculateBlockers(review.review_state, review.source_payload)
    : [];

  return {
    import_id: review.import_id,
    status: review.status,
    version: review.version,
    source_payload: review.source_payload,
    review_state: await withCatalogPartNames(client, review.review_state),
    commit_snapshot: review.commit_snapshot,
    lifecycle_events: review.lifecycle_events,
    grn_id: review.grn_id,
    grn_number: review.grn_number,
    workflow_status: review.grn_workflow_status,
    created_at: review.created_at,
    updated_at: review.updated_at,
    committed_at: review.committed_at,
    abandoned_at: review.abandoned_at,
    issues: review.review_state?.issues || [],
    blockers,
  };
}

async function patchImport(client, employeeId, importId, { version, actions }) {
  if (!isFeatureEnabled()) {
    const err = new Error('External JSON import is currently disabled.');
    err.statusCode = 503;
    err.code = 'GRN_IMPORT_DISABLED';
    throw err;
  }

  if (!Array.isArray(actions) || actions.length === 0 || actions.length > 50) {
    const err = new Error('Actions must be an array of 1 to 50 items.');
    err.statusCode = 400;
    throw err;
  }

  // Row lock
  const { rows } = await client.query(
    'SELECT * FROM grn_import_review WHERE import_id = $1 FOR UPDATE',
    [importId]
  );
  if (rows.length === 0) {
    const err = new Error('Import review not found.');
    err.statusCode = 404;
    throw err;
  }
  const review = rows[0];

  if (review.created_by_employee_id !== employeeId) {
    const err = new Error('Import review not found.');
    err.statusCode = 404;
    throw err;
  }

  if (review.status !== 'IN_REVIEW') {
    const err = new Error(`Import review is ${review.status} and cannot be modified.`);
    err.statusCode = 409;
    throw err;
  }

  if (review.version !== version) {
    const err = new Error(`Version conflict: current version is ${review.version}, request had ${version}.`);
    err.statusCode = 409;
    err.version = review.version;
    throw err;
  }

  const reviewState = review.review_state;
  const header = reviewState.header;
  const rowsList = reviewState.rows;
  const issuesList = reviewState.issues;

  for (let aIdx = 0; aIdx < actions.length; aIdx++) {
    const action = actions[aIdx];
    if (!action || typeof action !== 'object' || !action.type) {
      const err = new Error(`Action at index ${aIdx} is missing 'type'.`);
      err.statusCode = 400;
      throw err;
    }

    switch (action.type) {
      case 'set_header': {
        const values = action.values || {};
        // Disallow modifying context-locked fields
        if (header.context_locked_supplier_id && values.supplier_id !== undefined && values.supplier_id !== header.context_locked_supplier_id) {
          const err = new Error('Supplier is locked by navigation context.');
          err.statusCode = 400;
          throw err;
        }
        if (header.context_locked_bill_id && values.bill_id !== undefined && values.bill_id !== header.context_locked_bill_id) {
          const err = new Error('Bill is locked by navigation context.');
          err.statusCode = 400;
          throw err;
        }

        const supplierChanged = values.supplier_id !== undefined && values.supplier_id !== header.supplier_id;
        const currencyChanged = values.confirmed_currency !== undefined && values.confirmed_currency !== header.confirmed_currency;

        if (values.supplier_id !== undefined) header.supplier_id = values.supplier_id;
        if (values.supplier_document_no !== undefined) header.supplier_document_no = values.supplier_document_no;
        if (values.supplier_document_type !== undefined) header.supplier_document_type = values.supplier_document_type;
        if (values.supplier_invoice_no !== undefined) header.supplier_invoice_no = values.supplier_invoice_no;
        if (values.bill_id !== undefined) header.bill_id = values.bill_id;
        if (values.another_delivery_confirmed !== undefined) header.another_delivery_confirmed = !!values.another_delivery_confirmed;
        if (values.confirmed_currency !== undefined) header.confirmed_currency = values.confirmed_currency;
        if (values.currency_reason !== undefined) header.currency_reason = values.currency_reason;
        if (values.receipt_date !== undefined) header.receipt_date = values.receipt_date;
        if (values.is_backfill !== undefined) header.is_backfill = !!values.is_backfill;

        // Invalidate header confirmation
        header.header_confirmed = false;
        header.header_confirmation_digest = null;

        // If supplier or currency changed, invalidate all row confirmations
        if (supplierChanged || currencyChanged) {
          for (const r of rowsList) {
            r.confirmed_row.row_confirmed = false;
            r.confirmed_row.row_confirmation_digest = null;
          }
        }
        break;
      }

      case 'set_row': {
        const { row_id, values = {}, reason } = action;
        const row = rowsList.find(r => r.row_id === row_id);
        if (!row) {
          const err = new Error(`Row '${row_id}' not found.`);
          err.statusCode = 400;
          throw err;
        }

        const cr = row.confirmed_row;
        let requiresReconfirm = false;

        if (values.part_id !== undefined && values.part_id !== cr.part_id) {
          cr.part_id = values.part_id;
          requiresReconfirm = true;
        }
        if (values.stock_uom !== undefined && values.stock_uom !== cr.stock_uom) {
          cr.stock_uom = values.stock_uom;
          requiresReconfirm = true;
        }
        if (values.units_per_source_unit !== undefined && values.units_per_source_unit !== cr.units_per_source_unit) {
          cr.units_per_source_unit = values.units_per_source_unit;
          requiresReconfirm = true;
        }
        if (values.delivered_quantity !== undefined && values.delivered_quantity !== cr.delivered_quantity) {
          cr.delivered_quantity = values.delivered_quantity;
          requiresReconfirm = true;
        }
        if (values.return_quantity !== undefined && values.return_quantity !== cr.return_quantity) {
          cr.return_quantity = values.return_quantity;
          requiresReconfirm = true;
        }
        if (values.rejection_reason !== undefined) {
          cr.rejection_reason = values.rejection_reason;
        }
        if (values.cost_price !== undefined && values.cost_price !== cr.cost_price) {
          cr.cost_price = values.cost_price;
          requiresReconfirm = true;
        }
        if (values.cost_kind !== undefined && values.cost_kind !== cr.cost_kind) {
          cr.cost_kind = values.cost_kind;
          requiresReconfirm = true;
        }
        if (values.cost_reason !== undefined) {
          cr.cost_reason = values.cost_reason;
        }
        if (values.sale_price !== undefined && values.sale_price !== cr.sale_price) {
          cr.sale_price = values.sale_price;
          requiresReconfirm = true;
        }

        // Check if there are corrections to source facts
        if (values.corrected_facts) {
          for (const [k, newVal] of Object.entries(values.corrected_facts)) {
            if (!reason || reason.trim().length < 5) {
              const err = new Error('Correction to source fact requires a reason of at least 5 characters.');
              err.statusCode = 400;
              throw err;
            }
            row.corrections[k] = {
              old_value: row[k],
              new_value: newVal,
              reason: reason.trim(),
              actor_id: employeeId,
              timestamp: new Date().toISOString(),
            };
          }
        }

        if (requiresReconfirm) {
          cr.row_confirmed = false;
          cr.row_confirmation_digest = null;
        }
        break;
      }

      case 'set_inclusion': {
        const { row_id, included, reason } = action;
        const row = rowsList.find(r => r.row_id === row_id);
        if (!row) {
          const err = new Error(`Row '${row_id}' not found.`);
          err.statusCode = 400;
          throw err;
        }
        if (!included && (!reason || reason.trim().length < 5)) {
          const err = new Error('Row exclusion requires a reason of at least 5 characters.');
          err.statusCode = 400;
          throw err;
        }
        row.included = !!included;
        row.exclusion_reason = included ? null : reason.trim();
        if (included) {
          // Re-inclusion requires fresh confirmation
          row.confirmed_row.row_confirmed = false;
          row.confirmed_row.row_confirmation_digest = null;
        }
        break;
      }

      case 'confirm_row': {
        const { row_id } = action;
        const row = rowsList.find(r => r.row_id === row_id);
        if (!row) {
          const err = new Error(`Row '${row_id}' not found.`);
          err.statusCode = 400;
          throw err;
        }
        const cr = row.confirmed_row;
        cr.row_confirmation_digest = computeRowDigest({
          supplierId: header.supplier_id,
          currency: header.confirmed_currency,
          partId: cr.part_id,
          stockUom: cr.stock_uom,
          unitsPerSourceUnit: cr.units_per_source_unit,
          deliveredQuantity: cr.delivered_quantity,
          returnQuantity: cr.return_quantity,
          costPrice: cr.cost_price,
          costKind: cr.cost_kind,
          salePrice: cr.sale_price,
        });
        cr.row_confirmed = true;
        break;
      }

      case 'confirm_header': {
        header.header_confirmation_digest = computeHeaderDigest(header);
        header.header_confirmed = true;
        break;
      }

      case 'resolve_issue': {
        const { issue_id, reason } = action;
        if (!reason || reason.trim().length < 5) {
          const err = new Error('Issue resolution requires a reason of at least 5 characters.');
          err.statusCode = 400;
          throw err;
        }
        const issue = issuesList.find(iss => iss.issue_id === issue_id);
        if (!issue) {
          const err = new Error(`Issue '${issue_id}' not found.`);
          err.statusCode = 400;
          throw err;
        }
        if (issue.code === 'SKIPPED_ROW' || issue.code === 'CROPPED_OR_MISSING_PAGE') {
          const err = new Error(`Issue '${issue.code}' cannot be resolved manually; completeness issues block the import.`);
          err.statusCode = 400;
          throw err;
        }
        issue.resolved = true;
        issue.resolution_reason = reason.trim();
        reviewState.resolution_events.push({
          issue_id,
          reason: reason.trim(),
          actor_id: employeeId,
          timestamp: new Date().toISOString(),
        });
        break;
      }

      case 'explain_total_warning': {
        const { issue_id, explanation } = action;
        if (!explanation || explanation.trim().length < 5) {
          const err = new Error('Total warning explanation requires at least 5 characters.');
          err.statusCode = 400;
          throw err;
        }
        reviewState.total_warning_explanations[issue_id] = explanation.trim();
        break;
      }

      case 'link_document': {
        const { document_id } = action;
        reviewState.document_id = document_id ? Number(document_id) : null;
        break;
      }

      case 'unlink_document': {
        reviewState.document_id = null;
        break;
      }

      default: {
        const err = new Error(`Unknown action type '${action.type}'.`);
        err.statusCode = 400;
        throw err;
      }
    }
  }

  // Check reviewState serialized size
  const serializedState = JSON.stringify(reviewState);
  if (Buffer.byteLength(serializedState, 'utf8') > MAX_REVIEW_JSON_BYTES) {
    const err = new Error('Review state exceeds 4 MiB limit.');
    err.statusCode = 400;
    throw err;
  }

  const blockers = calculateBlockers(reviewState, review.source_payload);
  const nextVersion = review.version + 1;

  await client.query(
    `UPDATE grn_import_review
     SET review_state = $1,
         document_id = $2,
         version = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE import_id = $4`,
    [serializedState, reviewState.document_id, nextVersion, importId]
  );

  return {
    import_id: importId,
    status: review.status,
    version: nextVersion,
    review_state: await withCatalogPartNames(client, reviewState),
    issues: reviewState.issues,
    blockers,
  };
}

async function abandonImport(client, employeeId, importId, { version, reason }) {
  const { rows } = await client.query(
    'SELECT * FROM grn_import_review WHERE import_id = $1 FOR UPDATE',
    [importId]
  );
  if (rows.length === 0) {
    const err = new Error('Import review not found.');
    err.statusCode = 404;
    throw err;
  }
  const review = rows[0];

  if (review.created_by_employee_id !== employeeId) {
    const err = new Error('Import review not found.');
    err.statusCode = 404;
    throw err;
  }

  if (review.status === 'ABANDONED') {
    // Exact replay if version matches
    if (review.version === version) {
      return {
        import_id: review.import_id,
        status: review.status,
        version: review.version,
        abandoned_at: review.abandoned_at,
      };
    }
    const err = new Error('Import review is already abandoned.');
    err.statusCode = 409;
    throw err;
  }

  if (review.status !== 'IN_REVIEW') {
    const err = new Error(`Cannot abandon review in state '${review.status}'.`);
    err.statusCode = 409;
    throw err;
  }

  if (review.version !== version) {
    const err = new Error(`Version conflict: current is ${review.version}, request had ${version}.`);
    err.statusCode = 409;
    err.version = review.version;
    throw err;
  }

  const events = review.lifecycle_events || [];
  events.push({
    event: 'ABANDONED',
    actor_id: employeeId,
    reason: reason || 'User abandoned review',
    timestamp: new Date().toISOString(),
    version: review.version + 1,
  });

  const nextVersion = review.version + 1;
  await client.query(
    `UPDATE grn_import_review
     SET status = 'ABANDONED',
         abandoned_at = CURRENT_TIMESTAMP,
         lifecycle_events = $1,
         version = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE import_id = $3`,
    [JSON.stringify(events), nextVersion, importId]
  );

  return {
    import_id: importId,
    status: 'ABANDONED',
    version: nextVersion,
  };
}

async function commitImport(client, employeeId, importId, { version }) {
  if (!isFeatureEnabled()) {
    const err = new Error('External JSON import is currently disabled.');
    err.statusCode = 503;
    err.code = 'GRN_IMPORT_DISABLED';
    throw err;
  }

  // Row lock
  const { rows } = await client.query(
    `SELECT ir.*, gr.grn_number, gr.workflow_status
     FROM grn_import_review ir
     LEFT JOIN goods_receipt gr ON gr.grn_id = ir.grn_id
     WHERE ir.import_id = $1 FOR UPDATE OF ir`,
    [importId]
  );
  if (rows.length === 0) {
    const err = new Error('Import review not found.');
    err.statusCode = 404;
    throw err;
  }
  const review = rows[0];

  if (review.created_by_employee_id !== employeeId) {
    const err = new Error('Import review not found.');
    err.statusCode = 404;
    throw err;
  }

  if (review.status === 'COMMITTED') {
    // If version matches commit_review_version, replay!
    if (review.commit_review_version === version) {
      return {
        status: 200,
        data: {
          import_id: review.import_id,
          grn_id: review.grn_id,
          grn_number: review.grn_number,
          workflow_status: review.workflow_status,
        },
      };
    }
    const err = new Error('Import review already committed with a different version.');
    err.statusCode = 409;
    throw err;
  }

  if (review.status !== 'IN_REVIEW') {
    const err = new Error(`Cannot commit review with status '${review.status}'.`);
    err.statusCode = 409;
    throw err;
  }

  if (review.version !== version) {
    const err = new Error(`Version conflict: current version is ${review.version}, request had ${version}.`);
    err.statusCode = 409;
    err.version = review.version;
    throw err;
  }

  const reviewState = review.review_state;
  const blockers = calculateBlockers(reviewState, review.source_payload);
  if (blockers.length > 0) {
    const err = new Error('Review has unresolved blockers.');
    err.statusCode = 422;
    err.code = 'REVIEW_BLOCKERS_REMAIN';
    err.blockers = blockers;
    throw err;
  }

  const header = reviewState.header;
  const includedRows = reviewState.rows.filter(r => r.included);

  // 1. Verify supplier is still active
  const { rows: supRows } = await client.query(
    'SELECT supplier_id, is_active FROM supplier WHERE supplier_id = $1',
    [header.supplier_id]
  );
  if (!supRows.length || !supRows[0].is_active) {
    const err = new Error('Supplier is no longer active.');
    err.statusCode = 422;
    throw err;
  }

  // 2. Verify parts and stock UOMs are active
  const partIds = includedRows.map(r => r.confirmed_row.part_id);
  const { rows: partRows } = await client.query(
    'SELECT part_id, is_active, measurement_unit FROM part WHERE part_id = ANY($1::int[])',
    [partIds]
  );
  const partMap = new Map(partRows.map(p => [p.part_id, p]));
  for (const r of includedRows) {
    const pid = r.confirmed_row.part_id;
    const p = partMap.get(pid);
    if (!p || !p.is_active) {
      const err = new Error(`Part ${pid} on line ${r.line_no} is no longer active in catalog.`);
      err.statusCode = 422;
      throw err;
    }
    if (p.measurement_unit && r.confirmed_row.stock_uom && p.measurement_unit !== r.confirmed_row.stock_uom) {
      const err = new Error(`Part ${pid} UOM changed to '${p.measurement_unit}', does not match confirmed '${r.confirmed_row.stock_uom}'.`);
      err.statusCode = 422;
      throw err;
    }
  }

  // 3. Convert lines to shared draft lines format
  const draftLines = [];
  for (const r of includedRows) {
    const cr = r.confirmed_row;
    draftLines.push({
      line_uuid: r.row_id, // Seed server UUID with import row_id
      part_id: cr.part_id,
      quantity: Number(cr.delivered_quantity),
      cost_price: Number(cr.cost_price || 0),
      sale_price: cr.sale_price != null ? Number(cr.sale_price) : null,
      return_quantity: Number(cr.return_quantity || 0),
      rejection_reason: cr.rejection_reason || null,
      is_free_goods: cr.cost_kind === 'free',
      override_freight_amount: null,
      line_discount_percent: null,
      line_discount_amount: null,
    });
  }

  // 4. Compute costing
  const costing = grnCosting.computeCosting({
    lines: draftLines,
    freightAmount: 0,
    freightMethod: grnCosting.METHOD_A,
    freightCosts: [],
    overallDiscountPercent: null,
    overallDiscountAmount: null,
  });

  // Verify total payable does not overflow
  if (costing.total_payable > 9999999999.99) {
    const err = new Error('Receipt total payable exceeds supported limit.');
    err.statusCode = 422;
    throw err;
  }

  // 5. Create GRN draft via shared service
  const draftHeader = {
    supplier_id: header.supplier_id,
    received_by: employeeId,
    po_id: null,
    receipt_date: header.receipt_date,
    is_backfill: !!header.is_backfill,
    supplier_document_no: header.supplier_document_no,
    supplier_document_type: header.supplier_document_type || 'other',
    supplier_invoice_no: header.supplier_invoice_no || null,
    physical_receipt_no: null,
    bill_id: header.bill_id || null,
    another_delivery_confirmed: !!header.another_delivery_confirmed,
    freight_amount: 0,
    freight_allocation_method: grnCosting.METHOD_A,
    freight_supplier_id: null,
    freight_costs: [],
    overall_discount_percent: null,
    overall_discount_amount: null,
    sync_retail_prices: true,
  };

  const draftResult = await createGrnDraft(client, {
    header: draftHeader,
    lines: draftLines,
    costing,
    employeeId,
    isImportCommit: true,
    lineIdentityVersion: 1,
  });

  // 6. Freeze commit snapshot
  const commitSnapshot = {
    header: { ...header },
    lines: reviewState.rows.map(r => ({
      row_id: r.row_id,
      line_no: r.line_no,
      included: r.included,
      exclusion_reason: r.exclusion_reason,
      confirmed_row: r.included ? { ...r.confirmed_row } : null,
    })),
    committed_at: new Date().toISOString(),
  };

  const lifecycleEvents = review.lifecycle_events || [];
  lifecycleEvents.push({
    event: 'COMMITTED',
    actor_id: employeeId,
    grn_id: draftResult.grn_id,
    timestamp: new Date().toISOString(),
    version: review.version + 1,
  });

  const nextVersion = review.version + 1;

  await client.query(
    `UPDATE grn_import_review
     SET status = 'COMMITTED',
         grn_id = $1,
         commit_snapshot = $2,
         committed_at = CURRENT_TIMESTAMP,
         commit_review_version = $3,
         version = $3,
         lifecycle_events = $4,
         updated_at = CURRENT_TIMESTAMP
     WHERE import_id = $5`,
    [
      draftResult.grn_id,
      JSON.stringify(commitSnapshot),
      nextVersion,
      JSON.stringify(lifecycleEvents),
      importId,
    ]
  );

  return {
    status: 201,
    data: {
      import_id: importId,
      grn_id: draftResult.grn_id,
      grn_number: draftResult.grn_number,
      workflow_status: 'Draft',
    },
  };
}

module.exports = {
  isFeatureEnabled,
  getImportCapabilities,
  computeRowDigest,
  computeHeaderDigest,
  checkExactConversion,
  calculateBlockers,
  initializeReviewState,
  validateInitialContext,
  createImport,
  getImports,
  getImportById,
  patchImport,
  abandonImport,
  commitImport,
};
