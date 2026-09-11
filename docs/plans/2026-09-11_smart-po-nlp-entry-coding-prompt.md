# 🤖 Coding-Agent Prompt — Smart PO Natural Language Entry

## Context
This feature adds a two-tier NLP line-entry system to the existing Purchase Order creation flow in `packages/web` and `packages/api`. The current flow uses a `SearchBar` backed by `/power-search/parts` and requires every PO line to have a valid `part_id`. The new system adds: (1) a **quick single-line entry bar** and a **multi-line batch-paste modal**, both parsed by a **modular local regex parser** (Tier-1) with an **AI fallback** (Tier-2, `purchaseOrderParserAI.js` via the existing `llmClient`) for low-confidence or zero-match inputs; (2) **uncataloged PO lines** stored with `part_id = NULL` and `draft_part_data jsonb`; (3) a **Named Draft Shelf** supporting up to 5 concurrent named PO drafts per user; and (4) a **deferred cataloging flow** at Goods Receipt that pre-fills `PartForm` from `draft_part_data` and links the new `part_id` back to the PO line. The existing `SearchBar` + `PartForm` add-part flow is preserved alongside the new NLP entry.

---

## Your Task
Implement the following feature: **Smart PO Natural Language Entry**

Follow the graph-first protocol strictly: query the graph before reading any raw file.

---

## Targeted Files

| # | File | Action |
|---|------|--------|
| 1 | `database/migrations/<ts>_po_uncataloged_lines.sql` | CREATE |
| 2 | `database/migrations/<ts>_draft_transaction_multi.sql` | CREATE |
| 3 | `packages/api/helpers/poLineParser.js` | CREATE |
| 4 | `packages/api/services/ai/features/purchaseOrderParserAI.js` | CREATE |
| 5 | `packages/api/routes/purchaseOrderRoutes.js` | MODIFY |
| 6 | `packages/web/src/components/forms/PONLPBar.jsx` | CREATE |
| 7 | `packages/web/src/components/forms/POBatchPasteModal.jsx` | CREATE |
| 8 | `packages/web/src/components/forms/PODraftShelf.jsx` | CREATE |
| 9 | `packages/web/src/components/forms/PurchaseOrderForm.jsx` | MODIFY |
| 10 | `packages/web/src/pages/GoodsReceiptPage.jsx` | MODIFY |

---

## Data Model Changes

### Migration 1 — `purchase_order_line`
```sql
ALTER TABLE purchase_order_line ALTER COLUMN part_id DROP NOT NULL;
ALTER TABLE purchase_order_line ADD COLUMN custom_item_name varchar(255);
ALTER TABLE purchase_order_line ADD COLUMN unit varchar(50);
ALTER TABLE purchase_order_line ADD COLUMN draft_part_data jsonb;
ALTER TABLE purchase_order_line ADD CONSTRAINT chk_pol_has_item
  CHECK (part_id IS NOT NULL OR custom_item_name IS NOT NULL);
```

### Migration 2 — `draft_transaction` (Named Multi-Draft)
```sql
ALTER TABLE draft_transaction DROP CONSTRAINT draft_transaction_employee_id_transaction_type_key;
ALTER TABLE draft_transaction ADD COLUMN draft_name varchar(100) NOT NULL DEFAULT 'Draft';
ALTER TABLE draft_transaction ADD COLUMN expires_at timestamptz DEFAULT NOW() + INTERVAL '7 days';
ALTER TABLE draft_transaction ADD CONSTRAINT uq_draft_per_user_name
  UNIQUE (employee_id, transaction_type, draft_name);
```
Existing single-draft rows will safely receive `draft_name = 'Draft'`.

---

## API Contract

### POST `/api/purchase-orders/parse-lines`
```
Body:  { lines: string[] }
Response: Array of:
{
  raw: string,
  quantity: number | null,
  cost_price: number | null,
  raw_description: string,
  match_status: "exact" | "fuzzy" | "ambiguous" | "ai" | "unresolved",
  confidence: "HIGH" | "MEDIUM" | "LOW",
  part: { part_id, internal_sku, detail, brand_name, group_name, last_cost } | null,
  candidates: part[] | null,          // when match_status = "ambiguous"
  draft_part_data: { brand, group, detail, unit } | null  // when unresolved
}
```

### PATCH `/api/purchase-orders/:id/lines/:lineId/catalog`
```
Body:   { part_id: number }
Response: { message, po_line_id, part_id }
Side effect: sets part_id, clears draft_part_data on that po_line row
```

### Named Draft Endpoints
```
GET    /api/purchase-orders/drafts              → list user's PO drafts (max 5)
POST   /api/purchase-orders/drafts             → { draft_name?, draft_data }
PUT    /api/purchase-orders/drafts/:draftId    → update draft_data
DELETE /api/purchase-orders/drafts/:draftId    → discard
```

### Modified POST / PUT lines payload
```
lines[]: {
  part_id?:          number | null,
  custom_item_name?: string,         // required when part_id is null
  unit?:             string,         // product packaging size e.g. "1L", "5L"
  draft_part_data?:  object,
  quantity:          number,
  cost_price:        number
}
```

---

## Parser Specification

### Tier-1: `packages/api/helpers/poLineParser.js`

**MUST be a pure module — zero I/O, zero DB, zero AI. Only export: `parse(rawLine)`.**

Token classification table (classify ALL numbers before extracting qty):

| Class | Patterns | Rule |
|---|---|---|
| `PRICE_ANCHOR` | `@ <n>`, `P:<n>`, `<n>/ea`, `SRP <n>` at end | → `cost_price`, strip |
| `ORDER_UNIT` | `pcs`, `bxs`, `box`, `btl`, `set(s)`, `pair(s)`, `roll(s)`, `drum(s)`, `can(s)`, `bag(s)`, `unit(s)`, `ea`, standalone `x` | Explicit qty marker |
| `VOLUME_UNIT` | `mL`, `L`, `liter(s)`, `gal`, `gallon(s)`, `oz`, `fl.oz`, `cc`, `pail(s)`, `qt` | Product size — NOT qty |
| `DIMENSION_UNIT` | `mm`, `cm`, `m`, `in`, `inch`, `ft`, `"`, `'` | Product spec — NOT qty |
| `WEIGHT_UNIT` | `g`, `gram(s)`, `kg`, `lb(s)` | Product spec — NOT qty |
| `FRACTION` | `\d+\/\d+` | Always a dimension — NOT qty |
| `VISCOSITY` | `\d+W[-–]\d+` | Always product grade — NOT qty |

Extraction rules (priority order):
1. Extract `PRICE_ANCHOR` → `cost_price` (strip from string)
2. Classify all number-adjacent tokens using table above
3. `<number> <ORDER_UNIT>` anywhere → `qty = number`, `confidence = HIGH`
4. Leading bare `<whole_int>` followed by non-`PRODUCT_ATTR` token → `qty = int`, `confidence = MEDIUM`
5. Leading token is `PRODUCT_ATTR` class → `qty = null`, `confidence = LOW`
6. Remainder → `raw_description`

**All 9 test cases must pass:**

| Input | qty | cost | raw_description | confidence |
|---|---|---|---|---|
| `10 NGK CPR8EA-9 @ 135` | 10 | 135 | `NGK CPR8EA-9` | HIGH |
| `5 Motul 10W-40 1L @ 280` | 5 | 280 | `Motul 10W-40 1L` | MEDIUM |
| `10 5L Gear Oil @ 450` | 10 | 450 | `5L Gear Oil` | MEDIUM |
| `1 gal Hypoid Gear Oil @ 480` | null | 480 | `1 gal Hypoid Gear Oil` | LOW |
| `3 3/4 brake hose 5pcs @ 35` | 5 | 35 | `3/4 brake hose` | HIGH |
| `35mm timing belt 2x @ 120` | 2 | 120 | `35mm timing belt` | HIGH |
| `Motul 3100 10W-40 1L 5btl @ 265` | 5 | 265 | `Motul 3100 10W-40 1L` | HIGH |
| `10W-30 Gear Oil 4L 3pcs @ 520` | 3 | 520 | `10W-30 Gear Oil 4L` | HIGH |
| `5/8 radiator hose 1m 3pcs @ 85` | 3 | 85 | `5/8 radiator hose 1m` | HIGH |

Write unit tests for all 9 in `packages/api/test/poLineParser.test.js`.

### Tier-2: `purchaseOrderParserAI.js`

Mirror the structure of `expenseParserAI.js`. Use existing `llmClient`, `promptBuilder`, `schemaValidator`.

**AI fallback fires only when:**
- `confidence === LOW`, OR
- power-search returned 0 results, OR
- best search score < 0.6 (configurable constant)

**Prompt must include this explicit instruction:**
> "The `quantity` field is the number of units being ordered — never a product size. Product size specifiers such as `1L`, `5L`, `200mL`, `1 gal`, `35mm`, `3/4"`, `10W-40` are product attributes and belong in `description` and `unit` fields only."

**Output schema:**
```json
{
  "quantity": 10,
  "cost_price": 450,
  "brand": "Motul",
  "group": "Gear Oil",
  "detail": "3100 10W-40",
  "unit": "1L",
  "raw_description": "Motul 3100 10W-40 1L"
}
```

---

## Frontend Specification

### Line States (PurchaseOrderForm + PONLPBar)

Every line in the PO table renders in exactly one of four states:

| State | Visual | Save behavior |
|---|---|---|
| Exact match | ✅ green chip | Ready — no block |
| Fuzzy match | `~` amber chip + Confirm ✓ button | **Blocks Save** until user confirms |
| Ambiguous | ⚠ yellow chip + `[Pick →]` inline dropdown | **Blocks Save** until resolved |
| Uncataloged draft | 🆕 blue "Draft" badge | Non-blocking — shows count warning |

Save PO button: enabled with draft lines but shows `"N uncataloged items — will be formalized at receiving"`.

### PONLPBar (Mode 1 — quick entry)
- Sits above the line table
- On Enter: POST to `parse-lines` with the single line string
- Shows an inline skeleton row while pending
- On response: appends row in correct state; clears input; refocuses

### POBatchPasteModal (Mode 2 — batch paste)
- Triggered by a "Paste List" button
- `<textarea>` — one item per line
- On submit: POST to `parse-lines` with all lines as array
- Shows per-row resolution chips (exact / fuzzy / ambiguous / draft)
- User can accept all or deselect individual rows before appending

### PODraftShelf
- Renders in the PO editor header
- Dropdown lists user's active PO drafts (max 5) with supplier name + line count
- `[+ New]` creates a blank slot; prompts for supplier first if more than 2 drafts exist
- Auto-names: `"Draft — <supplier_name>"` or `"Draft #N"`
- Shows ⚠ banner if selected draft `expires_at < NOW() + 2 days`
- Submitting a PO deletes the draft slot

### GoodsReceiptPage — Deferred Cataloging
- `GET /purchase-orders/:id/lines` already returns null-`part_id` lines — update the GRN load path to handle them (currently assumes all lines have valid part JOIN)
- For each null-`part_id` line: render "Catalog & Receive" pill (yellow, non-blocking until submit)
- Clicking pill: open `PartForm` pre-filled from `draft_part_data` fields (`brand`, `group`, `detail`, `unit`, `cost_price`)
- On `PartForm` save: call `PATCH /purchase-orders/:id/lines/:lineId/catalog` with the new `part_id`
- After catalog: line renders as normal receivable row
- **GRN save is blocked** until all uncataloged lines on the linked PO are either cataloged or explicitly removed from the receipt

---

## Acceptance Criteria

- [ ] `poLineParser.js` is a pure function with zero dependencies
- [ ] All 9 parser test cases pass in `poLineParser.test.js`
- [ ] Quick-entry bar resolves and appends a line in < 2 seconds (network included)
- [ ] Batch paste of 10 lines returns per-row status correctly
- [ ] AI fallback fires only on LOW confidence or zero/below-threshold search
- [ ] PO saves with mix of cataloged and uncataloged lines without server error
- [ ] Fuzzy / ambiguous lines block Save until confirmed
- [ ] Draft badge renders on uncataloged lines; Save shows count warning
- [ ] Draft Shelf supports up to 5 concurrent named drafts per user
- [ ] Draft auto-named from supplier; expiry warning banner at < 2 days
- [ ] Submitting PO deletes its draft slot
- [ ] GRN renders "Catalog & Receive" pill for null-`part_id` lines
- [ ] `PartForm` at GRN pre-filled from `draft_part_data`
- [ ] `PATCH /catalog` updates `part_id`, clears `draft_part_data`
- [ ] GRN save blocked until all uncataloged PO lines are cataloged or removed

---

## Mandatory Constraints

- **Graph-First:** Query the graph before reading any raw file. Do not read `node_modules` or `graphify-out/graph.json` directly.
- **Diff-First:** Output only the necessary diffs. Never output full files unless explicitly asked.
- **Zero-Yapping:** No filler, no boilerplate explanations. Code and diffs only.
- **Do NOT:**
  - Modify `goodsReceiptRoutes.js` beyond the minimum needed to handle null `part_id` lines at GRN load.
  - Inline new business logic inside route handlers — put it in service/helper modules.
  - Add new npm packages without running the `scan_dependencies` skill first.
  - Implement features outside the approved file list without pausing to ask.
  - Touch `expenseParserAI.js`, `llmClient.js`, or other existing AI modules — extend by creating `purchaseOrderParserAI.js` only.

### Cascade Required?
No — no shared god node ownership changes.
