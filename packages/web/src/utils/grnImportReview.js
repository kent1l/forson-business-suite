const UOM_ALIASES = {
  pc: 'pcs', pcs: 'pcs', pce: 'pcs', pces: 'pcs', piece: 'pcs', pieces: 'pcs', ea: 'pcs', each: 'pcs', unit: 'pcs', units: 'pcs',
  set: 'set', sets: 'set',
  bx: 'box', bxs: 'box', box: 'box', boxes: 'box',
  btl: 'btl', btls: 'btl', bottle: 'btl', bottles: 'btl',
  pr: 'pair', prs: 'pair', pair: 'pair', pairs: 'pair',
  rl: 'roll', rls: 'roll', roll: 'roll', rolls: 'roll',
  can: 'can', cans: 'can',
  bg: 'bag', bgs: 'bag', bag: 'bag', bags: 'bag',
  drm: 'drum', drum: 'drum', drums: 'drum',
  pail: 'pail', pails: 'pail',
  pk: 'pack', pks: 'pack', pkg: 'pack', pkgs: 'pack', pack: 'pack', packs: 'pack',
  kit: 'kit', kits: 'kit',
  assy: 'assy', assembly: 'assy', assemblies: 'assy',
  ft: 'ft', feet: 'ft', foot: 'ft',
  m: 'm', mtr: 'm', mtrs: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm',
  cm: 'cm', centimeter: 'cm', centimeters: 'cm',
  mm: 'mm', millimeter: 'mm', millimeters: 'mm',
  in: 'in', inch: 'in', inches: 'in',
  yd: 'yd', yds: 'yd', yard: 'yd', yards: 'yd',
  l: 'l', ltr: 'l', ltrs: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml',
  gal: 'gal', gals: 'gal', gallon: 'gal', gallons: 'gal',
  qt: 'qt', qts: 'qt', quart: 'qt', quarts: 'qt',
  pt: 'pt', pts: 'pt', pint: 'pt', pints: 'pt',
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  dz: 'doz', doz: 'doz', dozen: 'doz', dozens: 'doz',
  cs: 'case', case: 'case', cases: 'case',
  ctn: 'ctn', ctns: 'ctn', crt: 'ctn', carton: 'ctn', cartons: 'ctn',
  tb: 'tube', tube: 'tube', tubes: 'tube',
  sht: 'sheet', sheet: 'sheet', sheets: 'sheet',
};

export function normalizeUom(value, fallback = 'pcs') {
  if (typeof value !== 'string') return fallback;
  const cleaned = value
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\.+$/g, '')
    .replace(/(?:\/|\()e?s\)?$/g, '')
    .trim();
  if (!cleaned || !/[a-z]/.test(cleaned)) return fallback;
  return UOM_ALIASES[cleaned] || cleaned;
}

export function stripJsonCodeFence(text) {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

// Cosmetic provenance only; matching and confirmation remain server decisions.
export function aiFilledRowFields(row, sourceLine = {}) {
  const cr = row.confirmed_row || {};
  return cr.ai_filled_fields || [
    cr.delivered_quantity != null && cr.delivered_quantity === sourceLine.quantity && 'delivered_quantity',
    cr.cost_price != null && cr.cost_price === sourceLine.unit_cost && 'cost_price',
    cr.automatic_match && 'part_id', cr.automatic_match && 'stock_uom',
  ].filter(Boolean);
}

export function aiFilledHeaderFields(header, sourceDocument = {}) {
  return header.ai_filled_fields || Object.entries({
    supplier_document_no: 'document_number',
    supplier_document_type: 'document_type',
    confirmed_currency: 'currency',
    supplier_id: 'supplier_name',
  })
    .filter(([field, source]) => header[field] && header[field] === sourceDocument[source]).map(([field]) => field);
}

export function applyImportAction(review, action, selectedPart = null) {
  if (!review?.review_state) return review;
  const state = { ...review.review_state };
  if (action.type === 'set_header') {
    state.header = { ...state.header, ...action.values, header_confirmed: false,
      ai_filled_fields: aiFilledHeaderFields(state.header, review.source_payload?.document)
        .filter(field => !Object.hasOwn(action.values, field)),
    };
    if (['supplier_id', 'confirmed_currency'].some(field => Object.hasOwn(action.values, field)
      && action.values[field] !== review.review_state.header[field])) {
      state.rows = state.rows.map(row => ({ ...row, confirmed_row: { ...row.confirmed_row, row_confirmed: false } }));
    }
  } else if (action.type === 'set_row') {
    state.rows = state.rows.map(row => {
      if (row.row_id !== action.row_id) return row;
      const origins = new Set(aiFilledRowFields(row, review.source_payload?.lines?.find(line => line.line_no === row.line_no)));
      for (const field of Object.keys(action.values)) {
        if (action.origin === 'automatic_match' && ['part_id', 'stock_uom'].includes(field)) origins.add(field);
        else origins.delete(field);
      }
      const normalizedValues = Object.hasOwn(action.values, 'stock_uom') || action.values.part_id !== undefined
        ? {
            ...action.values,
            stock_uom: normalizeUom(
              action.values.stock_uom?.trim()
                || selectedPart?.stock_uom?.trim()
                || selectedPart?.measurement_unit?.trim()
                || row.confirmed_row.stock_uom
                || 'pcs'
            ),
          }
        : action.values;
      const changedMatch = ['part_id', 'stock_uom', 'units_per_source_unit']
        .some(field => Object.hasOwn(normalizedValues, field) && normalizedValues[field] !== row.confirmed_row[field]);
      return {
        ...row,
        confirmed_row: {
          ...row.confirmed_row, ...normalizedValues,
          ai_filled_fields: [...origins],
          row_confirmed: changedMatch ? false : row.confirmed_row.row_confirmed,
          ...(action.values.part_id !== undefined ? {
            part_display_name: selectedPart?.display_name || selectedPart?.detail || selectedPart?.internal_sku || null,
            automatic_match: selectedPart?.automatic_match || null,
          } : {}),
        },
      };
    });
  } else if (action.type === 'set_inclusion') {
    state.rows = state.rows.map(row => row.row_id !== action.row_id ? row : {
      ...row, included: action.included, exclusion_reason: action.reason || null,
      confirmed_row: { ...row.confirmed_row, row_confirmed: action.included ? false : row.confirmed_row.row_confirmed },
    });
  }
  return { ...review, review_state: state };
}

export function importRowMatchKey(review, row) {
  const source = review.source_payload?.lines?.find(line => line.line_no === row.line_no) || {};
  return JSON.stringify([row.row_id, source.supplier_item_text || source.description || '',
    source.brand, source.part_number, source.item_group_hint, row.corrections]);
}

export function canAutomaticallyMatch(review, row) {
  const source = review.source_payload?.lines?.find(line => line.line_no === row.line_no);
  return row.included && !row.confirmed_row?.part_id && !row.confirmed_row?.row_confirmed
    && Boolean(source?.supplier_item_text?.trim() || source?.description?.trim());
}

export const GRN_EXTRACTION_PROMPT = `Extract the attached scanned auto-parts supplier document for import into an FBS Goods Receipt (GRN) draft.

Work in two strict passes:
1. TRANSCRIBE what the document visibly says, including printed text and warehouse handwriting.
2. RESEARCH product identity on the internet where useful. Keep research strictly isolated in enrichment.

Return ONLY one valid JSON object enclosed in a single \`\`\`json ... \`\`\` markdown code block for easy copy and paste. Do NOT add any introductory text, commentary, or approval instructions before or after the code block.
Inside the \`\`\`json code block, the first non-whitespace character MUST be { and the last MUST be }. Include the enclosing braces: never start with just "schema_version": 1. Return the object itself, not a quoted/escaped JSON string, multiple objects, or a partial fragment. Do not include comments, trailing commas, ellipses, or omitted sections.

\`\`\`json
{
  "schema_version": 1,
  "document": {
    "supplier_name": null,
    "document_type": null,
    "document_number": null,
    "document_date": null,
    "currency": null,
    "printed_total": null
  },
  "lines": [
    {
      "line_no": 1,
      "supplier_item_text": null,
      "description": null,
      "brand": null,
      "part_number": null,
      "supplier_item_code": null,
      "item_group_hint": null,
      "quantity": null,
      "unit": null,
      "unit_cost": null,
      "printed_line_total": null,
      "handwritten_sale_price": null,
      "receiving_mark": null,
      "enrichment": {
        "status": "unresolved",
        "suggested_brand": null,
        "suggested_part_number": null,
        "suggested_description": null,
        "suggested_group": null,
        "reason": null,
        "sources": []
      }
    }
  ],
  "extraction_issues": []
}
\`\`\`

TRANSCRIPTION RULES
- Fill document fields and line fields OUTSIDE enrichment ONLY from visible ink on the scan. Never fill them from internet results or assumptions. Use null when absent or illegible.
- Preserve every visible item row from every supplied page in its original sequence. Assign unique, strictly increasing integer line_no values (1, 2, 3...). Do not merge rows that appear to describe the same part; keep separate receipt rows distinct.
- CRITICAL - SOURCE IMAGE ROW ORDER: The lines array MUST follow the item rows exactly as they appear in the source image, from top to bottom within each item table. Across multiple pages, follow the document's visible page numbering; if none is visible, use the supplied image order. Continue line_no sequentially across pages, without restarting at 1. If the reading order is ambiguous, report an AMBIGUOUS_VALUE issue rather than silently inventing an order.
- Never sort or regroup lines by brand, part number, description, item group, price, or research results. Keep each row's identity, quantity, unit, cost, total, handwriting, and enrichment attached to that SAME source row. Research must never move an item to another row or exchange identities between rows. Preserve duplicate items as separate rows in their original positions.
- CRITICAL - DECIMAL STRINGS ONLY: Quantities, unit costs, line totals, and document totals MUST be plain unsigned decimal strings or null (e.g. "4", "4.0000", "3750.00", "13500.00", "23868.00"). NEVER output raw JSON numbers for quantities or money. Numbers are strictly allowed ONLY as integers for schema_version and line_no. Do not use commas, currency symbols (₱, $), negative signs, or exponent notation. Quantity permits up to 4 decimal places; money permits up to 2 decimal places. A printed zero amount is "0.00", not null.
- DOCUMENT TYPE ENUM: document_type must be null or one of: "delivery_receipt", "invoice", "packing_list", "other". Map Delivery Receipts (DR), Acknowledgement Receipts (AR), and Delivery Orders to "delivery_receipt". Map Sales Invoices (SI), Commercial Invoices, and Official Receipts (OR) to "invoice". Map Packing Lists to "packing_list". Use "other" for any other or ambiguous title.
- STANDARD UOM (unit): Normalize unit to a standard lowercase UOM code so equivalent labels remain consistent. Map "PC", "PCS", "PC/S", "PC/s", "PCE", "EA", "EACH", "PIECE", "PIECES", "UNIT", "UNITS" to "pcs". Map "SET", "SETS", "SET/S", "SET/s" to "set". Map "BOX", "BOXES", "BX", "BXS" to "box". Map "BTL", "BTLS", "BTL/S", "BOTTLE", "BOTTLES" to "btl". Map "PR", "PAIR", "PAIRS" to "pair"; "RL", "ROLL", "ROLLS" to "roll"; "CAN", "CANS" to "can"; "BG", "BAG", "BAGS" to "bag"; "DRM", "DRUM", "DRUMS" to "drum"; "PAIL", "PAILS" to "pail"; "PK", "PKG", "PACK", "PACKS" to "pack"; "KIT", "KITS" to "kit"; "ASSY", "ASSEMBLY" to "assy"; "FT", "FEET", "FOOT" to "ft"; "M", "MTR", "METER", "METERS" to "m"; "L", "LTR", "LITER", "LITERS" to "l"; "ML" to "ml"; "GAL", "GALLON" to "gal"; "QT", "QUART" to "qt"; "KG", "KILO", "KILOS" to "kg"; "G", "GM", "GRAM", "GRAMS" to "g"; "DOZ", "DZ", "DOZEN" to "doz"; "CS", "CASE" to "case"; "CTN", "CARTON" to "ctn"; "TUBE" to "tube"; "SHEET" to "sheet". Use null when no unit is printed on the row (FBS defaults null to "pcs"). Never output mixed-case or slash-plural variants like "PC/s", "PC/S", "PCS", or "SET/S".
- ESCAPING QUOTES: All double quotes inside string values (e.g. inch marks like 8\\" or quoted brands like \\"COMPACT\\") MUST be escaped with a backslash (\\"). Unescaped double quotes will corrupt the JSON syntax.
- This applies to EVERY string, including supplier_item_text, description, suggested_description, reason, supporting_text, receiving_mark, and issue messages. Valid JSON examples: "description": "HOSE LONG 5\\" (1PC/BOX)" and "suggested_description": "Wheel Cylinder (11/16\\")". Escape backslashes as \\\\ and literal line breaks as \\n inside strings. Use ordinary ASCII double quotes as JSON delimiters. If a serialization tool is available, build the data object and serialize it with JSON.stringify or an equivalent JSON serializer rather than manually assembling JSON text.
- supplier_item_text is the cleaned receipt wording used for automatic catalog matching and Jev verification. description is an optional cleaned product description for compatibility. Neither field may include web-discovered details or inferred specs. Do not output the full uncleaned line as raw_text; that legacy field is neither displayed nor used for matching.
- supplier_item_text is the compact identifying text for THIS item, derived only from its visible receipt wording. Retain printed brand, manufacturer part number, product/model, dimensions, grade, size, pack size, vehicle/application codes and orientation where they identify the product. Remove the row number, ordered/delivered/returned quantities, purchase units used only for counting, costs, totals, discounts, tax, selling-price handwriting, check marks and other receiving annotations. Do NOT remove identifying numbers such as 10W-40, 1L bottle size, 3/4 inch, RH/LH or model/part codes. Example: receipt wording "2 PCS TOYOTA 04152-YZZA6 OIL FILTER @125.00 TOTAL 250.00 ✓" becomes supplier_item_text "TOYOTA 04152-YZZA6 OIL FILTER". Use null if a faithful item identity cannot be isolated; report ambiguity rather than inventing an identity. FBS uses this cleaned text and extracted identity fields for catalog matching and Jev verification. Limit this field to 2,000 characters.
- Populate brand, part_number, supplier_item_code, and item_group_hint outside enrichment ONLY when explicitly printed or visibly identifiable on the physical page.
- Keep document_number, part_number, and supplier_item_code as strings. Preserve letters, leading zeros, hyphens, and other meaningful punctuation.
- document_date is the date printed on the supplier document in YYYY-MM-DD format (only when unambiguous). Do not use the date goods physically arrived. Currency is a 3-letter uppercase code (e.g. "PHP") only when unambiguous; otherwise null.
- Put printed supplier cost in unit_cost. Put clearly handwritten intended retail/selling prices in handwritten_sale_price (as a decimal string). Never confuse the two.
- Describe warehouse annotations (ticks, checks, circles, stamps) literally in receiving_mark (e.g., "Check mark (✓) over quantity"). A check mark does not prove physical acceptance.
- If handwriting conflicts with printed text, leave disputed structured values null if unclear and report the conflicting wording in a CONFLICTING_VALUES issue. Do not mix receiving annotations or transaction amounts into supplier_item_text.
- Never output FBS internal identifiers: no part_id, supplier_id, po_id, grn_id, accepted_quantity, or approval/status keys.

INTERNET RESEARCH RULES
- Research product identity only: manufacturer/brand, part number, product description, and likely item group. Search using clues visible on the scan.
- When browsing is available, actively research each distinct item using its visible brand, part number, and identifying specifications. Prefer official manufacturer catalogs and product pages; use reputable distributor listings as secondary evidence. Search results are leads, not inspected sources: open the relevant pages and read the supporting content before making a suggestion.
- Put ALL web-derived findings in enrichment. Never change a transcribed field based on web research. Never use the internet to fill missing receipt numbers, dates, quantities, supplier costs, totals, or handwritten values.
- Check brand, the full part number including suffixes, dimensions, model/application, pack size, and orientation wherever available. Distinguish an exact product identity from an OEM cross-reference, compatible replacement, or merely similar item. An OEM reference alone does not verify the printed aftermarket brand. If sources materially disagree, explain the conflict in reason and leave unsupported suggested fields null.
- Set enrichment.status to:
  - "verified_suggestion" only when an exact visible brand/manufacturer AND part number match an accessible official manufacturer catalog or product page, the proposed identity is supported there, and there is no material conflict;
  - "possible_suggestion" when evidence is relevant but incomplete, such as a reputable distributor listing, partial identifier, cross-reference, or lack of official OEM confirmation;
  - "unresolved" when sources are inaccessible, contradictory, unreliable, or insufficient.
- For each source actually opened and inspected, add an object to sources (max 20 per line):
  {"url": "https://actual-page-url", "supporting_text": "specific text on the page supporting the suggestion"}
  (Remember to escape any double quotes inside supporting_text).
- CRITICAL - PLAIN URL STRINGS ONLY: sources[].url must be the actual page's absolute HTTPS URL, at most 2,048 characters, with no embedded username or password. Put the URL directly inside the JSON string. Correct: "url": "https://example.com/product". Incorrect: "url": "[https://example.com/product](https://example.com/product)". Never wrap URLs in Markdown links, angle brackets, HTML, backticks, or citation markers. These formatting rules apply inside JSON strings as well as outside the JSON object.
- supporting_text must faithfully describe or briefly quote content actually inspected on that page and identify which suggestion it supports. Do not present search snippets, an unvisited link, or a guessed URL as verified evidence. Retain usable source URLs so a reviewer can independently inspect the research.
- Explain the evidence or uncertainty briefly in reason. Do not invent URLs, quotes, visits, or numerical confidence scores. Do not claim fitment or interchangeability without separate explicit evidence.
- If browsing is unavailable or no usable evidence can be inspected for an item, preserve its transcription, set enrichment.status to "unresolved", leave unsupported suggested fields null, and return sources: []. Explain the research limitation in reason. Never add placeholder or fabricated sources to fill the array. Do not fail the extraction merely because internet research failed.

EXTRACTION ISSUE RULES
Report uncertainties and discrepancies as structured objects in extraction_issues:
{
  "code": "TOTAL_MISMATCH",
  "line_no": 1,
  "field": "printed_line_total",
  "message": "Printed line total (13,500.00) does not match quantity (4) * unit cost (3,750.00 = 15,000.00); variance is explained by handwritten 10% discount."
}

- code MUST be one of these exact 6 values:
  - UNREADABLE_VALUE: Text is physically illegible or obscured.
  - AMBIGUOUS_VALUE: Text could be multiple values (e.g. printed "185" or "195").
  - CONFLICTING_VALUES: Handwriting contradicts printed text, or multiple conflicting references appear.
  - SKIPPED_ROW: An item row is visibly present on the document but unextractable or skipped.
  - CROPPED_OR_MISSING_PAGE: Margins appear cut off, or page numbering indicates missing pages.
  - TOTAL_MISMATCH: Line math (quantity * unit_cost != printed_line_total) or document total sum does not balance.
- line_no is the affected item's line_no, or null for a document/page-level issue.
- field is the affected JSON field name, or null.
- message is a short factual explanation. Do not recommend posting or approval actions.
- Return [] if no issue is detected.

FINAL QUALITY CONTROL
Before returning the JSON, verify:
1. Every quantity, unit cost, line total, and document total is a DECIMAL STRING (e.g. "4", "3750.00"), NOT a JSON number.
2. document_type is null or one of "delivery_receipt", "invoice", "packing_list", "other", and every line unit is null or a standardized lowercase UOM code (e.g. "pcs", "set", "box", "btl").
3. All internal double quotes within strings (such as 8\\" or \\"COMPACT\\") are escaped with backslashes.
4. Compare the lines array against the source images row by row: the first output item matches the first source item, the second matches the second, and so on through all pages. No rows were skipped, merged, sorted, or exchanged. Each row's quantities, prices, annotations, and research remain attached to its own item identity, and line_no increases sequentially across pages.
5. All web research is strictly confined inside enrichment.
6. Every sources[].url is a plain absolute HTTPS URL without Markdown wrappers, citation markers, or embedded credentials, and refers to a page actually opened and inspected. Use sources: [] when no usable evidence was inspected.
7. Every research suggestion is supported by its cited page content; cross-references and compatibility claims are not represented as exact product verification. Uncertainty and material conflicts are stated in reason.
8. The complete output is enclosed in a single \`\`\`json ... \`\`\` code block with no surrounding prose before or after it. Inside the code block, the content starts with { and ends with }, includes every required section and both enclosing braces, and contains exactly one JSON object with no trailing comma or double-encoded JSON string.
9. Recheck inch marks and quoted text in EVERY string, including research evidence and issue messages. Internal double quotes must appear as \\" in the returned JSON text; no unescaped inch marks may terminate a value early.
10. If a JSON parser is available, parse the EXACT JSON content inside the code block and confirm the parsed value is an object, not a string or array. Correct any errors and repeat the check before returning it. Without a parser, check syntax carefully but do not claim parser validation. Return only the single \`\`\`json ... \`\`\` code block containing the complete JSON object with plain URL values.`;

