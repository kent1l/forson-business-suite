# Supplier Document JSON — External Vision Assistant Prompt

> Companion to the [final GRN JSON ingestion plan](2026-10-20_grn-external-json-ingestion.final.md), §4.
> Authoritative extraction prompt for external vision models (Gemini, Claude, ChatGPT) to produce conforming Schema v1 JSON for Forson Business Suite Goods Receipt ingestion.

Copy the prompt below into your vision assistant with all pages of one supplier document attached. Do not mix separate documents into one extraction.

When importing the response, copy the complete JSON from its opening `{` through its closing `}`, including both braces. If the assistant provides a JSON file, download it and use FBS's file upload to avoid partial copying.

```text
Extract the attached scanned auto-parts supplier document for import into an FBS Goods Receipt (GRN) draft.

Work in two strict passes:
1. TRANSCRIBE what the document visibly says, including printed text and warehouse handwriting.
2. RESEARCH product identity on the internet where useful. Keep research strictly isolated in enrichment.

Return ONLY one valid JSON object in the exact structure below. Do NOT add markdown code fences (no ```json or ```). Do NOT add introductory text, commentary, or approval instructions.
The first non-whitespace character MUST be { and the last MUST be }. Include the enclosing braces: never start with just "schema_version": 1. Return the object itself, not a quoted/escaped JSON string, multiple objects, or a partial fragment. Do not include comments, trailing commas, ellipses, or omitted sections.

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
      "vehicle_applications": null,
      "position": null,
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
        "suggested_vehicle_applications": null,
        "reason": null,
        "sources": []
      }
    }
  ],
  "extraction_issues": []
}

TRANSCRIPTION RULES
- Fill document fields and line fields OUTSIDE enrichment ONLY from visible ink on the scan. Never fill them from internet results or assumptions. Use null when absent or illegible.
- Preserve every visible item row from every supplied page in its original sequence. Assign unique, strictly increasing integer line_no values (1, 2, 3...). Do not merge rows that appear to describe the same part; keep separate receipt rows distinct.
- CRITICAL - SOURCE IMAGE ROW ORDER: The lines array MUST follow the item rows exactly as they appear in the source image, from top to bottom within each item table. Across multiple pages, follow the document's visible page numbering; if none is visible, use the supplied image order. Continue line_no sequentially across pages, without restarting at 1. If the reading order is ambiguous, report an AMBIGUOUS_VALUE issue rather than silently inventing an order.
- Never sort or regroup lines by brand, part number, description, item group, price, or research results. Keep each row's identity, quantity, unit, cost, total, handwriting, and enrichment attached to that SAME source row. Research must never move an item to another row or exchange identities between rows. Preserve duplicate items as separate rows in their original positions.
- CRITICAL - DECIMAL STRINGS ONLY: Quantities, unit costs, line totals, and document totals MUST be plain unsigned decimal strings or null (e.g. "4", "4.0000", "3750.00", "13500.00", "23868.00"). NEVER output raw JSON numbers for quantities or money. Numbers are strictly allowed ONLY as integers for schema_version and line_no. Do not use commas, currency symbols (₱, $), negative signs, or exponent notation. Quantity permits up to 4 decimal places; money permits up to 2 decimal places. A printed zero amount is "0.00", not null.
- DOCUMENT TYPE ENUM: document_type must be null or one of: "delivery_receipt", "invoice", "packing_list", "other". Map Delivery Receipts (DR), Acknowledgement Receipts (AR), and Delivery Orders to "delivery_receipt". Map Sales Invoices (SI), Commercial Invoices, and Official Receipts (OR) to "invoice". Map Packing Lists to "packing_list". Use "other" for any other or ambiguous title.
- ESCAPING QUOTES: All double quotes inside string values (e.g. inch marks like 8\" or quoted brands like \"COMPACT\") MUST be escaped with a backslash (\"). Unescaped double quotes will corrupt the JSON syntax.
- This applies to EVERY string, including supplier_item_text, description, suggested_description, reason, supporting_text, receiving_mark, and issue messages. Valid JSON examples: "description": "HOSE LONG 5\" (1PC/BOX)" and "suggested_description": "Wheel Cylinder (11/16\")". Escape backslashes as \\ and literal line breaks as \n inside strings. Use ordinary ASCII double quotes as JSON delimiters. If a serialization tool is available, build the data object and serialize it with JSON.stringify or an equivalent JSON serializer rather than manually assembling JSON text.
- supplier_item_text is the cleaned receipt wording used for automatic catalog matching and Jev verification. description is the concise part detail used when creating a catalog part: name the product and include only distinguishing features that no other field captures, such as material, size, or design. Never repeat in description anything captured in another field: brand, part number, supplier item code, item_group_hint (the product group or category name), position, vehicle_applications, unit, prices or quantities. For example, "BENDIX DB123 FRONT CERAMIC BRAKE PAD SET" becomes brand "BENDIX", part_number "DB123", position "FRONT", item_group_hint "Brake Pads" and description "CERAMIC SET"; do not write "BRAKE PAD" in description when the group already says so. supplier_item_text is exempt: it keeps the full cleaned wording, including position, for catalog matching. Neither field may include web-discovered details or inferred specs. Do not output the full uncleaned line as raw_text; that legacy field is neither displayed nor used for matching.
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
- Actively research each distinct item using its visible brand, part number, and identifying specifications, via web search and, where a page-reading tool exists, by opening pages. Prefer official manufacturer catalogs and product pages; use reputable distributor listings as secondary evidence. Search results and their snippets are acceptable evidence when they come from your search tool and show the exact brand and/or full part number, a manufacturer catalog match, or an application table. A snippet is weaker than a fully read page: do not infer anything the snippet text does not state. Opening a page is optional unless you have a page-reading tool and the snippet is insufficient.
- Put ALL web-derived findings in enrichment. Never change a transcribed field based on web research. Never use the internet to fill missing receipt numbers, dates, quantities, supplier costs, totals, or handwritten values.
- Check brand, the full part number including suffixes, dimensions, model/application, pack size, and orientation wherever available. Distinguish an exact product identity from an OEM cross-reference, compatible replacement, or merely similar item. An OEM reference alone does not verify the printed aftermarket brand. If sources materially disagree, explain the conflict in reason and leave unsupported suggested fields null.
- Set enrichment.status to:
  - "verified_suggestion" only when the exact visible brand/manufacturer AND full part number match an official manufacturer catalog or product page (read in full, or shown in an official-domain search snippet that states the match), the proposed identity is supported there, and there is no material conflict. Distributor, marketplace, or aggregator results never qualify for "verified_suggestion" on their own, however many agree;
  - "possible_suggestion" when evidence is relevant but incomplete, such as a reputable distributor listing or snippet, a partial identifier, a cross-reference, or no official manufacturer confirmation;
  - "unresolved" when no search result supports the item, results contradict each other, or the results are unreliable. Decide per item: one failed lookup must not downgrade the other items.
- For each search result or page you relied on (max 20 per line), add an object to sources:
  {"url": "https://actual-url-returned-by-search", "supporting_text": "what the page or snippet states that supports the suggestion; begin with 'Snippet:' if you saw only the search snippet, or 'Page:' if you read the page"}
  (Remember to escape any double quotes inside supporting_text).
- CRITICAL - PLAIN URL STRINGS ONLY: sources[].url must be the actual page's absolute HTTPS URL, at most 2,048 characters, with no embedded username or password. Put the URL directly inside the JSON string. Correct: "url": "https://example.com/product". Incorrect: "url": "[https://example.com/product](https://example.com/product)". Never wrap URLs in Markdown links, angle brackets, HTML, backticks, or citation markers. These formatting rules apply inside JSON strings as well as outside the JSON object.
- supporting_text must faithfully quote or describe the page or snippet text you actually saw and identify which suggestion it supports; never describe content you did not see. Every URL must be one your search tool returned or a page you opened: never a guessed, reconstructed, or remembered URL. Retain usable source URLs so a reviewer can independently inspect the research.
- Explain the evidence or uncertainty briefly in reason. Do not invent URLs, quotes, visits, or numerical confidence scores. Do not claim fitment or interchangeability without separate explicit evidence.
- If web search is unavailable, or no search result supports an item, preserve its transcription, set enrichment.status to "unresolved", leave unsupported suggested fields null, and return sources: []. Explain the limitation in reason. Never add placeholder or fabricated sources to fill the array. Do not fail the extraction merely because internet research failed.

- POSITION: line.position is the installation position of the part on the vehicle as printed on the document, using only these words, combined when needed (e.g. "FRONT LEFT"): FRONT, REAR, LEFT, RIGHT, UPPER, LOWER, INNER, OUTER, CENTER. Map RH to RIGHT, LH to LEFT, FR to FRONT, RR to REAR only when the context shows they are positions. Use null when the document states no position; never infer position from the part type or from web results. FBS applies it to the part's vehicle fitments. Keep it out of description.
- VEHICLE APPLICATIONS (two sources, never mixed):
  - line.vehicle_applications = vehicle fitments read from the supplier document itself (description, notes, any vehicle column, handwriting), as one plain-text string such as "Toyota Hilux 2KD-FTV 2005-2015; Mitsubishi L200 4D56". Separate combinations with semicolons. You may expand obvious abbreviations when the context makes them unambiguous (e.g. "HLX" to Hilux), but never infer fitment from the part category or from web results. Use null when the document states no vehicle. This field does NOT depend on web research: fill it even when browsing is unavailable or fails. Maximum 2000 characters.
  - enrichment.suggested_vehicle_applications = ADDITIONAL or confirming fitments found by web research, only when explicitly stated for this exact part number or product in a page or search snippet that you cite in sources. Use it to verify, extend or contradict line.vehicle_applications; use null when there is no such evidence. If the web evidence contradicts the document's fitment, report a CONFLICTING_VALUES issue with field "vehicle_applications" and keep the document's value unchanged.
  - FBS parses both strings into vehicle fitments; document-derived fitments are trusted more than web-derived ones.

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
2. document_type is null or one of "delivery_receipt", "invoice", "packing_list", "other".
3. All internal double quotes within strings (such as 8\" or \"COMPACT\") are escaped with backslashes.
4. Compare the lines array against the source images row by row: the first output item matches the first source item, the second matches the second, and so on through all pages. No rows were skipped, merged, sorted, or exchanged. Each row's quantities, prices, annotations, and research remain attached to its own item identity, and line_no increases sequentially across pages.
5. All web research is strictly confined inside enrichment. line.vehicle_applications contains only fitments visible on the document and is filled even when web research failed.
6. Every sources[].url is a plain absolute HTTPS URL without Markdown wrappers, citation markers, or embedded credentials, and was returned by your search tool or opened by you. Use sources: [] when no usable evidence was inspected.
7. Every research suggestion is supported by its cited page or search-snippet text; cross-references and compatibility claims are not represented as exact product verification. Uncertainty and material conflicts are stated in reason.
8. The complete output starts with { and ends with }, includes every required section and both enclosing braces, and contains exactly one JSON object. There is no surrounding prose, code fence, trailing comma, or double-encoded JSON string.
9. Recheck inch marks and quoted text in EVERY string, including research evidence and issue messages. Internal double quotes must appear as \" in the returned JSON text; no unescaped inch marks may terminate a value early.
10. If a JSON parser is available, parse the EXACT final output, including any file contents supplied, and confirm the parsed value is an object, not a string or array. Correct any errors and repeat the check before returning it. Without a parser, check syntax carefully but do not claim parser validation. Return only the complete JSON object with plain URL values and no Markdown formatting.
```

FBS validates the output against the final contract; this prompt is not a substitute for server validation. A new payload version requires updating both the plan/schema and prompt together.

The optional `supplier_item_text` field extends schema v1. Older v1 JSON remains accepted and can use its cleaned description for matching. Raw-only rows require manual catalog search; original raw text is not a matching fallback. A nonblank supplier_item_text is sufficient when description and raw_text are omitted. Omitting the field preserves legacy normalized payload hashes.
