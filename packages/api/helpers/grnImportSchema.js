const crypto = require('crypto');

const MAX_PAYLOAD_BYTES = 1048576; // 1 MiB canonical UTF-8
const MAX_LINES = 200;
const MAX_ISSUES = 400;
const MAX_SOURCES_PER_LINE = 20;

const KNOWN_ISSUE_CODES = new Set([
  'UNREADABLE_VALUE',
  'AMBIGUOUS_VALUE',
  'CONFLICTING_VALUES',
  'SKIPPED_ROW',
  'CROPPED_OR_MISSING_PAGE',
  'TOTAL_MISMATCH',
]);

const ALLOWED_DOCUMENT_TYPES = new Set([
  'delivery_receipt',
  'invoice',
  'packing_list',
  'other',
]);

const ALLOWED_ENRICHMENT_STATUSES = new Set([
  'unresolved',
  'possible_suggestion',
  'verified_suggestion',
]);

const DOCUMENT_ALLOWED_KEYS = new Set([
  'supplier_name',
  'document_type',
  'document_number',
  'document_date',
  'currency',
  'printed_total',
]);

const LINE_ALLOWED_KEYS = new Set([
  'line_no',
  'raw_text',
  'supplier_item_text',
  'description',
  'brand',
  'part_number',
  'supplier_item_code',
  'item_group_hint',
  'quantity',
  'unit',
  'unit_cost',
  'printed_line_total',
  'handwritten_sale_price',
  'receiving_mark',
  'enrichment',
]);

const ENRICHMENT_ALLOWED_KEYS = new Set([
  'status',
  'suggested_brand',
  'suggested_part_number',
  'suggested_description',
  'suggested_group',
  'reason',
  'sources',
]);

const SOURCE_ALLOWED_KEYS = new Set([
  'url',
  'supporting_text',
]);

const ISSUE_ALLOWED_KEYS = new Set([
  'code',
  'line_no',
  'field',
  'message',
]);

const DOCUMENT_SCALAR_FIELDS = new Set([
  'supplier_name',
  'document_type',
  'document_number',
  'document_date',
  'currency',
  'printed_total',
]);

const LINE_SCALAR_FIELDS = new Set([
  'raw_text',
  'supplier_item_text',
  'description',
  'brand',
  'part_number',
  'supplier_item_code',
  'item_group_hint',
  'quantity',
  'unit',
  'unit_cost',
  'printed_line_total',
  'handwritten_sale_price',
  'receiving_mark',
]);

// Bidi formatting controls: \u200E, \u200F, \u202A-\u202E, \u2066-\u2069
const BIDI_REGEX = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
// Disallowed control chars: ASCII 0-31 except \t (9), \n (10), \r (13)
// eslint-disable-next-line no-control-regex
const INVALID_CONTROL_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

function codePointLength(str) {
  if (typeof str !== 'string') return 0;
  return [...str].length;
}

function validateText(str, { maxCodePoints, path, required = false, allowNewlines = true }) {
  if (str === null || str === undefined) {
    if (required) {
      const err = new Error(`Field '${path}' is required.`);
      err.path = path;
      throw err;
    }
    return null;
  }
  if (typeof str !== 'string') {
    const err = new Error(`Field '${path}' must be a string or null.`);
    err.path = path;
    throw err;
  }
  if (BIDI_REGEX.test(str)) {
    const err = new Error(`Field '${path}' contains disallowed bidirectional formatting controls.`);
    err.path = path;
    throw err;
  }
  if (INVALID_CONTROL_REGEX.test(str)) {
    const err = new Error(`Field '${path}' contains invalid control characters.`);
    err.path = path;
    throw err;
  }
  if (!allowNewlines && /[\r\n]/.test(str)) {
    const err = new Error(`Field '${path}' cannot contain newlines.`);
    err.path = path;
    throw err;
  }
  const len = codePointLength(str);
  if (len > maxCodePoints) {
    const err = new Error(`Field '${path}' exceeds maximum length of ${maxCodePoints} characters (received ${len}).`);
    err.path = path;
    throw err;
  }
  return str;
}

// Decimal parser with fixed scale
// Quantity: (0, 99999999.9999], max 4 decimals
// Money: [0, 9999999999.99], max 2 decimals
const DECIMAL_REGEX = /^\d+(\.\d+)?$/;

function parseDecimalString(val, { path, maxDecimals, minVal, maxVal, minExclusive = false, normalizeScale = null }) {
  if (val === null || val === undefined) return null;
  if (typeof val !== 'string') {
    const err = new Error(`Field '${path}' must be a decimal string or null; numbers and other types are rejected.`);
    err.path = path;
    throw err;
  }
  if (!DECIMAL_REGEX.test(val)) {
    const err = new Error(`Field '${path}' must be an unsigned plain decimal string without signs, spaces, or exponents.`);
    err.path = path;
    throw err;
  }
  const parts = val.split('.');
  const intPart = parts[0];
  const fracPart = parts[1] || '';
  if (fracPart.length > maxDecimals) {
    const err = new Error(`Field '${path}' permits at most ${maxDecimals} fractional digits.`);
    err.path = path;
    throw err;
  }

  // Parse to BigInt at maxDecimals scale
  const paddedFrac = fracPart.padEnd(maxDecimals, '0');
  const rawBigInt = BigInt(intPart) * (10n ** BigInt(maxDecimals)) + BigInt(paddedFrac);

  const minBigInt = BigInt(Math.floor(minVal)) * (10n ** BigInt(maxDecimals));
  const maxBigInt = BigInt(Math.floor(maxVal)) * (10n ** BigInt(maxDecimals));

  if (minExclusive) {
    if (rawBigInt <= minBigInt) {
      const err = new Error(`Field '${path}' must be greater than ${minVal}.`);
      err.path = path;
      throw err;
    }
  } else {
    if (rawBigInt < minBigInt) {
      const err = new Error(`Field '${path}' must be at least ${minVal}.`);
      err.path = path;
      throw err;
    }
  }

  if (rawBigInt > maxBigInt) {
    const err = new Error(`Field '${path}' exceeds maximum value of ${maxVal}.`);
    err.path = path;
    throw err;
  }

  // Normalize string output to normalizeScale
  if (normalizeScale != null) {
    const targetPaddedFrac = fracPart.padEnd(normalizeScale, '0').slice(0, normalizeScale);
    return `${BigInt(intPart).toString()}.${targetPaddedFrac}`;
  }

  return val;
}

function parseQuantity(val, path) {
  return parseDecimalString(val, {
    path,
    maxDecimals: 4,
    minVal: 0,
    maxVal: 99999999.9999,
    minExclusive: true,
    normalizeScale: 4,
  });
}

function parseMoney(val, path) {
  return parseDecimalString(val, {
    path,
    maxDecimals: 2,
    minVal: 0,
    maxVal: 9999999999.99,
    minExclusive: false,
    normalizeScale: 2,
  });
}

function parseIsoCalendarDate(val, path) {
  if (val === null || val === undefined) return null;
  if (typeof val !== 'string') {
    const err = new Error(`Field '${path}' must be a string in YYYY-MM-DD format or null.`);
    err.path = path;
    throw err;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val);
  if (!match) {
    const err = new Error(`Field '${path}' must be an ISO calendar date in YYYY-MM-DD format.`);
    err.path = path;
    throw err;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    const err = new Error(`Field '${path}' has an invalid month or day.`);
    err.path = path;
    throw err;
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    const err = new Error(`Field '${path}' is not a valid calendar day.`);
    err.path = path;
    throw err;
  }
  return val;
}

function parseCurrency(val, path) {
  if (val === null || val === undefined) return null;
  if (typeof val !== 'string') {
    const err = new Error(`Field '${path}' must be a 3-letter currency code or null.`);
    err.path = path;
    throw err;
  }
  if (!/^[A-Z]{3}$/.test(val)) {
    const err = new Error(`Field '${path}' must be exactly 3 uppercase letters.`);
    err.path = path;
    throw err;
  }
  return val;
}

function checkDisallowedKeys(obj, allowedKeys, path) {
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      const err = new Error(`Unknown field '${path ? `${path}.${key}` : key}' is not allowed.`);
      err.path = path ? `${path}.${key}` : key;
      throw err;
    }
  }
}

function validateEnrichment(enrichment, path) {
  if (enrichment === null || enrichment === undefined) {
    return {
      status: 'unresolved',
      suggested_brand: null,
      suggested_part_number: null,
      suggested_description: null,
      suggested_group: null,
      reason: null,
      sources: [],
    };
  }
  if (typeof enrichment !== 'object' || Array.isArray(enrichment)) {
    const err = new Error(`Field '${path}' must be an object or null.`);
    err.path = path;
    throw err;
  }
  checkDisallowedKeys(enrichment, ENRICHMENT_ALLOWED_KEYS, path);

  const status = enrichment.status ?? 'unresolved';
  if (!ALLOWED_ENRICHMENT_STATUSES.has(status)) {
    const err = new Error(`Field '${path}.status' must be one of: unresolved, possible_suggestion, verified_suggestion.`);
    err.path = `${path}.status`;
    throw err;
  }

  const suggested_brand = validateText(enrichment.suggested_brand, { maxCodePoints: 255, path: `${path}.suggested_brand` });
  const suggested_part_number = validateText(enrichment.suggested_part_number, { maxCodePoints: 255, path: `${path}.suggested_part_number` });
  const suggested_description = validateText(enrichment.suggested_description, { maxCodePoints: 2000, path: `${path}.suggested_description` });
  const suggested_group = validateText(enrichment.suggested_group, { maxCodePoints: 255, path: `${path}.suggested_group` });
  const reason = validateText(enrichment.reason, { maxCodePoints: 2000, path: `${path}.reason` });

  let sources = [];
  if (enrichment.sources !== undefined && enrichment.sources !== null) {
    if (!Array.isArray(enrichment.sources)) {
      const err = new Error(`Field '${path}.sources' must be an array.`);
      err.path = `${path}.sources`;
      throw err;
    }
    if (enrichment.sources.length > MAX_SOURCES_PER_LINE) {
      const err = new Error(`Field '${path}.sources' exceeds maximum of ${MAX_SOURCES_PER_LINE} sources.`);
      err.path = `${path}.sources`;
      throw err;
    }
    sources = enrichment.sources.map((src, idx) => {
      const srcPath = `${path}.sources[${idx}]`;
      if (typeof src !== 'object' || src === null || Array.isArray(src)) {
        const err = new Error(`Field '${srcPath}' must be an object.`);
        err.path = srcPath;
        throw err;
      }
      checkDisallowedKeys(src, SOURCE_ALLOWED_KEYS, srcPath);
      if (typeof src.url !== 'string') {
        const err = new Error(`Field '${srcPath}.url' must be a valid HTTPS URL string.`);
        err.path = `${srcPath}.url`;
        throw err;
      }
      if (codePointLength(src.url) > 2048) {
        const err = new Error(`Field '${srcPath}.url' exceeds 2048 characters.`);
        err.path = `${srcPath}.url`;
        throw err;
      }
      try {
        const parsed = new URL(src.url);
        if (parsed.protocol !== 'https:') {
          throw new Error('Only HTTPS URLs are allowed');
        }
        if (parsed.username || parsed.password) {
          throw new Error('Embedded credentials are not allowed');
        }
      } catch (e) {
        const err = new Error(`Field '${srcPath}.url' must be a valid absolute HTTPS URL without embedded credentials: ${e.message}`);
        err.path = `${srcPath}.url`;
        throw err;
      }
      const supporting_text = validateText(src.supporting_text, { maxCodePoints: 2000, path: `${srcPath}.supporting_text` });
      return {
        url: src.url,
        supporting_text: supporting_text ?? null,
      };
    });
  }

  return {
    status,
    suggested_brand: suggested_brand ?? null,
    suggested_part_number: suggested_part_number ?? null,
    suggested_description: suggested_description ?? null,
    suggested_group: suggested_group ?? null,
    reason: reason ?? null,
    sources,
  };
}

function validateAndNormalizeExternalPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    const err = new Error('Payload must be a JSON object.');
    err.path = '$';
    throw err;
  }

  // Top level allowlist: exactly 4 fields
  const topKeys = new Set(Object.keys(payload));
  for (const k of ['schema_version', 'document', 'lines', 'extraction_issues']) {
    if (!topKeys.has(k)) {
      const err = new Error(`Top-level field '${k}' is required.`);
      err.path = k;
      throw err;
    }
  }
  for (const k of topKeys) {
    if (!['schema_version', 'document', 'lines', 'extraction_issues'].includes(k)) {
      const err = new Error(`Top-level field '${k}' is not allowed.`);
      err.path = k;
      throw err;
    }
  }

  // schema_version must be integer 1
  if (typeof payload.schema_version !== 'number' || !Number.isInteger(payload.schema_version) || payload.schema_version !== 1) {
    const err = new Error("Field 'schema_version' must be integer 1.");
    err.path = 'schema_version';
    throw err;
  }

  // document
  const doc = payload.document;
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    const err = new Error("Field 'document' must be an object.");
    err.path = 'document';
    throw err;
  }
  checkDisallowedKeys(doc, DOCUMENT_ALLOWED_KEYS, 'document');

  let document_type = doc.document_type ?? null;
  if (document_type !== null) {
    if (typeof document_type !== 'string' || !ALLOWED_DOCUMENT_TYPES.has(document_type)) {
      const err = new Error("Field 'document.document_type' must be null or one of: delivery_receipt, invoice, packing_list, other.");
      err.path = 'document.document_type';
      throw err;
    }
  }

  const normalizedDoc = {
    supplier_name: validateText(doc.supplier_name, { maxCodePoints: 255, path: 'document.supplier_name' }),
    document_type,
    document_number: validateText(doc.document_number, { maxCodePoints: 255, path: 'document.document_number' }),
    document_date: parseIsoCalendarDate(doc.document_date, 'document.document_date'),
    currency: parseCurrency(doc.currency, 'document.currency'),
    printed_total: parseMoney(doc.printed_total, 'document.printed_total'),
  };

  // lines
  if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
    const err = new Error("Field 'lines' must be a non-empty array.");
    err.path = 'lines';
    throw err;
  }
  if (payload.lines.length > MAX_LINES) {
    const err = new Error(`Field 'lines' exceeds maximum of ${MAX_LINES} rows (received ${payload.lines.length}).`);
    err.path = 'lines';
    throw err;
  }

  const normalizedLines = [];
  const lineNumbers = new Set();
  let prevLineNo = 0;

  for (let idx = 0; idx < payload.lines.length; idx++) {
    const line = payload.lines[idx];
    const path = `lines[${idx}]`;
    if (!line || typeof line !== 'object' || Array.isArray(line)) {
      const err = new Error(`Field '${path}' must be an object.`);
      err.path = path;
      throw err;
    }
    checkDisallowedKeys(line, LINE_ALLOWED_KEYS, path);

    if (typeof line.line_no !== 'number' || !Number.isInteger(line.line_no) || line.line_no <= 0 || line.line_no > 10000) {
      const err = new Error(`Field '${path}.line_no' must be a positive integer at most 10,000.`);
      err.path = `${path}.line_no`;
      throw err;
    }
    if (line.line_no <= prevLineNo) {
      const err = new Error(`Field '${path}.line_no' must be strictly increasing (got ${line.line_no} after ${prevLineNo}).`);
      err.path = `${path}.line_no`;
      throw err;
    }
    if (lineNumbers.has(line.line_no)) {
      const err = new Error(`Field '${path}.line_no' (${line.line_no}) is duplicated.`);
      err.path = `${path}.line_no`;
      throw err;
    }
    lineNumbers.add(line.line_no);
    prevLineNo = line.line_no;

    const raw_text = validateText(line.raw_text, { maxCodePoints: 4000, path: `${path}.raw_text` });
    const supplier_item_text = validateText(line.supplier_item_text, { maxCodePoints: 2000, path: `${path}.supplier_item_text` });
    const description = validateText(line.description, { maxCodePoints: 2000, path: `${path}.description` });

    if ((!supplier_item_text || !supplier_item_text.trim()) && (!raw_text || !raw_text.trim()) && (!description || !description.trim())) {
      const err = new Error(`Field '${path}' requires non-blank supplier_item_text, description or raw_text.`);
      err.path = path;
      throw err;
    }

    const brand = validateText(line.brand, { maxCodePoints: 255, path: `${path}.brand` });
    const part_number = validateText(line.part_number, { maxCodePoints: 255, path: `${path}.part_number` });
    const supplier_item_code = validateText(line.supplier_item_code, { maxCodePoints: 255, path: `${path}.supplier_item_code` });
    const item_group_hint = validateText(line.item_group_hint, { maxCodePoints: 255, path: `${path}.item_group_hint` });
    const quantity = parseQuantity(line.quantity, `${path}.quantity`);
    const unit = validateText(line.unit, { maxCodePoints: 20, path: `${path}.unit` });
    const unit_cost = parseMoney(line.unit_cost, `${path}.unit_cost`);
    const printed_line_total = parseMoney(line.printed_line_total, `${path}.printed_line_total`);
    const handwritten_sale_price = parseMoney(line.handwritten_sale_price, `${path}.handwritten_sale_price`);
    const receiving_mark = validateText(line.receiving_mark, { maxCodePoints: 2000, path: `${path}.receiving_mark` });
    const enrichment = validateEnrichment(line.enrichment, `${path}.enrichment`);

    normalizedLines.push({
      line_no: line.line_no,
      raw_text: raw_text ?? null,
      // Keep legacy normalized payloads/hashes unchanged when this optional field is absent.
      ...(line.supplier_item_text !== undefined ? { supplier_item_text } : {}),
      description: description ?? null,
      brand: brand ?? null,
      part_number: part_number ?? null,
      supplier_item_code: supplier_item_code ?? null,
      item_group_hint: item_group_hint ?? null,
      quantity,
      unit: unit?.trim() ? unit : 'pcs',
      unit_cost,
      printed_line_total,
      handwritten_sale_price,
      receiving_mark: receiving_mark ?? null,
      enrichment,
    });
  }

  // extraction_issues
  if (!Array.isArray(payload.extraction_issues)) {
    const err = new Error("Field 'extraction_issues' must be an array.");
    err.path = 'extraction_issues';
    throw err;
  }
  if (payload.extraction_issues.length > MAX_ISSUES) {
    const err = new Error(`Field 'extraction_issues' exceeds maximum of ${MAX_ISSUES} entries.`);
    err.path = 'extraction_issues';
    throw err;
  }

  const normalizedIssues = [];
  for (let idx = 0; idx < payload.extraction_issues.length; idx++) {
    const issue = payload.extraction_issues[idx];
    const path = `extraction_issues[${idx}]`;
    if (!issue || typeof issue !== 'object' || Array.isArray(issue)) {
      const err = new Error(`Field '${path}' must be an object.`);
      err.path = path;
      throw err;
    }
    checkDisallowedKeys(issue, ISSUE_ALLOWED_KEYS, path);

    if (typeof issue.code !== 'string' || !issue.code.trim()) {
      const err = new Error(`Field '${path}.code' must be a non-empty string.`);
      err.path = `${path}.code`;
      throw err;
    }
    if (codePointLength(issue.code) > 64) {
      const err = new Error(`Field '${path}.code' exceeds 64 characters.`);
      err.path = `${path}.code`;
      throw err;
    }

    let line_no = issue.line_no ?? null;
    if (line_no !== null) {
      if (typeof line_no !== 'number' || !Number.isInteger(line_no) || !lineNumbers.has(line_no)) {
        const err = new Error(`Field '${path}.line_no' (${line_no}) must reference a valid source line_no.`);
        err.path = `${path}.line_no`;
        throw err;
      }
    }

    let field = issue.field ?? null;
    if (field !== null) {
      if (typeof field !== 'string') {
        const err = new Error(`Field '${path}.field' must be a string or null.`);
        err.path = `${path}.field`;
        throw err;
      }
      const validScopeFields = line_no === null ? DOCUMENT_SCALAR_FIELDS : LINE_SCALAR_FIELDS;
      if (!validScopeFields.has(field)) {
        const err = new Error(`Field '${path}.field' (${field}) is not a documented scalar in this scope.`);
        err.path = `${path}.field`;
        throw err;
      }
    }

    const message = validateText(issue.message, { maxCodePoints: 2000, path: `${path}.message`, required: true });

    normalizedIssues.push({
      issue_id: crypto.randomUUID(),
      code: issue.code.trim(),
      line_no,
      field,
      message,
    });
  }

  const normalized = {
    schema_version: 1,
    document: normalizedDoc,
    lines: normalizedLines,
    extraction_issues: normalizedIssues,
  };

  // Reconcile totals and generate server-owned TOTAL_MISMATCH warnings
  const reconciliationIssues = performSourceReconciliation(normalized);
  for (const recIssue of reconciliationIssues) {
    normalized.extraction_issues.push(recIssue);
  }

  return normalized;
}

// Fixed-point arithmetic for source reconciliation
function toCents(str) {
  if (!str) return null;
  const parts = str.split('.');
  const intPart = BigInt(parts[0]);
  const fracPart = BigInt((parts[1] || '').padEnd(2, '0').slice(0, 2));
  return intPart * 100n + fracPart;
}

function toQuantityTenThousandths(str) {
  if (!str) return null;
  const parts = str.split('.');
  const intPart = BigInt(parts[0]);
  const fracPart = BigInt((parts[1] || '').padEnd(4, '0').slice(0, 4));
  return intPart * 10000n + fracPart;
}

function performSourceReconciliation(normalized) {
  const issues = [];

  // 1. Line-level quantity × unit_cost vs printed_line_total
  for (const line of normalized.lines) {
    if (line.quantity && line.unit_cost && line.printed_line_total) {
      const q = toQuantityTenThousandths(line.quantity); // scale 4
      const c = toCents(line.unit_cost); // scale 2
      const printedTotalCents = toCents(line.printed_line_total); // scale 2

      // q * c has scale 6 (10^6). To round half-up to cents (scale 2), divide by 10^4 (10000)
      const productScale6 = q * c;
      const roundedCents = (productScale6 + 5000n) / 10000n;

      if (roundedCents !== printedTotalCents) {
        const expectedFormatted = `${(roundedCents / 100n).toString()}.${(roundedCents % 100n).toString().padStart(2, '0')}`;
        issues.push({
          issue_id: crypto.randomUUID(),
          code: 'TOTAL_MISMATCH',
          line_no: line.line_no,
          field: 'printed_line_total',
          message: `Calculated total (${line.quantity} × ${line.unit_cost} = ${expectedFormatted}) does not match printed line total (${line.printed_line_total}).`,
          source: 'server_reconciliation',
        });
      }
    }
  }

  // 2. Document-level sum of printed_line_totals vs printed_total
  if (normalized.document.printed_total) {
    const docPrintedCents = toCents(normalized.document.printed_total);
    const allLinesHavePrintedTotal = normalized.lines.every(l => l.printed_line_total != null);
    if (allLinesHavePrintedTotal) {
      let sumLinesCents = 0n;
      for (const line of normalized.lines) {
        sumLinesCents += toCents(line.printed_line_total);
      }
      if (sumLinesCents !== docPrintedCents) {
        const sumFormatted = `${(sumLinesCents / 100n).toString()}.${(sumLinesCents % 100n).toString().padStart(2, '0')}`;
        issues.push({
          issue_id: crypto.randomUUID(),
          code: 'TOTAL_MISMATCH',
          line_no: null,
          field: 'printed_total',
          message: `Sum of printed line totals (${sumFormatted}) does not match document printed total (${normalized.document.printed_total}).`,
          source: 'server_reconciliation',
        });
      }
    }
  }

  return issues;
}

// Recursive deterministic key-sorting
function sortObjectKeys(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }
  const sorted = {};
  const keys = Object.keys(obj).sort();
  for (const k of keys) {
    sorted[k] = sortObjectKeys(obj[k]);
  }
  return sorted;
}

function computePayloadHash(normalizedPayload, initialContext) {
  const root = {
    payload: normalizedPayload,
    context: initialContext || {},
  };
  const canonicalJson = JSON.stringify(sortObjectKeys(root));
  return crypto.createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}

module.exports = {
  MAX_PAYLOAD_BYTES,
  MAX_LINES,
  MAX_ISSUES,
  KNOWN_ISSUE_CODES,
  ALLOWED_DOCUMENT_TYPES,
  ALLOWED_ENRICHMENT_STATUSES,
  validateAndNormalizeExternalPayload,
  computePayloadHash,
  sortObjectKeys,
};
