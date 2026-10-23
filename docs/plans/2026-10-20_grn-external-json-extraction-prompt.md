# Supplier Document JSON — External Vision Assistant Prompt

> Companion to the [final GRN JSON ingestion plan](2026-10-20_grn-external-json-ingestion.final.md), §4.
> Authoritative extraction prompt for external vision models (Gemini, Claude, ChatGPT) to produce conforming Schema v1 JSON for Forson Business Suite Goods Receipt ingestion.

Copy the prompt below into your vision assistant with all pages of one supplier document attached. Do not mix separate documents into one extraction.

```text
Extract the attached scanned auto-parts supplier document for import into an FBS Goods Receipt (GRN) draft.

Work in two strict passes:
1. TRANSCRIBE what the document visibly says, including printed text and warehouse handwriting.
2. RESEARCH product identity on the internet where useful. Keep research strictly isolated in enrichment.

Return ONLY one valid JSON object in the exact structure below. Do NOT add markdown code fences (no ```json or ```). Do NOT add introductory text, commentary, or approval instructions.

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

TRANSCRIPTION RULES
- Fill document fields and line fields OUTSIDE enrichment ONLY from visible ink on the scan. Never fill them from internet results or assumptions. Use null when absent or illegible.
- Preserve every visible item row from every supplied page in its original sequence. Assign unique, strictly increasing integer line_no values (1, 2, 3...). Do not merge rows that appear to describe the same part; keep separate receipt rows distinct.
- CRITICAL - DECIMAL STRINGS ONLY: Quantities, unit costs, line totals, and document totals MUST be plain unsigned decimal strings or null (e.g. "4", "4.0000", "3750.00", "13500.00", "23868.00"). NEVER output raw JSON numbers for quantities or money. Numbers are strictly allowed ONLY as integers for schema_version and line_no. Do not use commas, currency symbols (₱, $), negative signs, or exponent notation. Quantity permits up to 4 decimal places; money permits up to 2 decimal places. A printed zero amount is "0.00", not null.
- DOCUMENT TYPE ENUM: document_type must be null or one of: "delivery_receipt", "invoice", "packing_list", "other". Map Delivery Receipts (DR), Acknowledgement Receipts (AR), and Delivery Orders to "delivery_receipt". Map Sales Invoices (SI), Commercial Invoices, and Official Receipts (OR) to "invoice". Map Packing Lists to "packing_list". Use "other" for any other or ambiguous title.
- ESCAPING QUOTES: All double quotes inside string values (e.g. inch marks like 8\" or quoted brands like \"COMPACT\") MUST be escaped with a backslash (\"). Unescaped double quotes will corrupt the JSON syntax.
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
2. document_type is null or one of "delivery_receipt", "invoice", "packing_list", "other".
3. All internal double quotes within strings (such as 8\" or \"COMPACT\") are escaped with backslashes.
4. No item rows were skipped or merged.
5. All web research is strictly confined inside enrichment.
6. Every sources[].url is a plain absolute HTTPS URL without Markdown wrappers, citation markers, or embedded credentials, and refers to a page actually opened and inspected. Use sources: [] when no usable evidence was inspected.
7. Every research suggestion is supported by its cited page content; cross-references and compatibility claims are not represented as exact product verification. Uncertainty and material conflicts are stated in reason.
8. Output is raw, valid JSON with no markdown formatting, including inside URL values. If a JSON parser is available, parse the final output and correct syntax errors before returning it.
```

FBS validates the output against the final contract; this prompt is not a substitute for server validation. A new payload version requires updating both the plan/schema and prompt together.

The optional `supplier_item_text` field extends schema v1. Older v1 JSON remains accepted and can use its cleaned description for matching. Raw-only rows require manual catalog search; original raw text is not a matching fallback. A nonblank supplier_item_text is sufficient when description and raw_text are omitted. Omitting the field preserves legacy normalized payload hashes.
