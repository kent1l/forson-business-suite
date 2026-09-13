# Smart PO Natural Language Entry — PRD & Developer Handoff

> **Forson Business Suite** | **PRD-FBS-PO-001** | **Version:** 1.3
> **Date:** 2026-09-11 | **Branch:** `master`
> **Status:** Complete, with the catalog-prefill hardening implemented on 2026-09-13. All 196 migrations are applied; focused PO/parser/catalog tests pass (20/20), and the web production build compiles.

---

## 0. Status at a Glance

Read this first. It is the only section that changes often — update it as phases land.

| Item | Status | Reference |
|---|---|---|
| Migration 1 — `purchase_order_line` nullable `part_id` + `draft_part_data` | **Applied** | §6.1 |
| Migration 2 — `draft_transaction` named multi-draft schema | **Applied** | §6.2 |
| `poLineParser.js` — Tier-1 pure regex parser + unit tests | **Implemented — parser and catalog tests pass (20/20)** | §6.3 |
| `purchaseOrderParserAI.js` — Tier-2 AI fallback feature module | **Implemented — live smoke verified** | §6.4 |
| `purchaseOrderRoutes.js` — `parse-lines`, `catalog`, draft endpoints | **Implemented — live smoke verified** | §6.5 |
| `PONLPBar.jsx` — Quick single-line entry bar (Mode 1) | **Implemented — build verified** | §6.6 |
| `POBatchPasteModal.jsx` — Multi-line batch paste modal (Mode 2) | **Implemented — build verified** | §6.6 |
| `PODraftShelf.jsx` — Named multi-draft switcher | **Implemented — build verified** | §6.6 |
| `PurchaseOrderForm.jsx` — Integrate all new components | **Implemented — build verified** | §6.6 |
| `GoodsReceiptPage.jsx` — Deferred cataloging flow | **Implemented — atomic create/link and prefill verified** | §6.7 |
| Catalog text normalization | **Implemented — PO suggestions and receipt-created part text use uppercase** | §3.6 |
| Catalog authorization and duplicate guard | **Implemented — requires `goods_receipt:create` + `parts:create`** | §3.5 |
| Parser disambiguation rules (sizes vs. dims vs. order qty) | **Decided & verified** | §4, §5 |
| Multi-draft Named Draft Shelf (max 5, 7-day expiry) | **Decided & verified** | §3.4 |
| Option A: nullable `part_id` + `draft_part_data` (no dummy parts) | **Decided & verified** | §3.1 |
| GRN blocks save until all uncataloged lines cataloged or removed | **Decided & verified** | §3.5 |

**Ready for next phase?** Implementation is complete. A manual browser acceptance pass of the revised create-mode catalog modal remains advisable before release; automated coverage, lint, build, and migration status are verified.

---

## 1. For a New Session or Agent Picking This Up

This document is the durable source of truth. The interactive planning conversation lives only in session memory and will not be available to you. Read this document fully before writing any code.

**Before starting:**
1. Run `graphify query "purchaseOrderRoutes PurchaseOrderForm"` and `graphify query "gemini ai assistant"` for a live view of the PO and AI service topology. File references in this document can drift — trust a fresh graph query over old prose.
2. Call hindsight `recall` with query `"smart PO NLP purchase order parser"`, tags `["forson-business-suite", "po_nlp", "purchase_order"]`.
3. Confirm §0's status table is accurate against `git log --oneline -10` before trusting it.

**When you finish a phase or make a non-obvious decision:**
1. Update §0 Status at a Glance and the relevant phase section.
2. Retain new architectural decisions/gotchas to hindsight, tagged `["forson-business-suite", "po_nlp", "purchase_order"]`.
3. Run `graphify update .` so the next query reflects your changes.

---

## 2. Business Objective & Operational Value

### The Problem
PO creation is optimized for computer/desktop use and requires every line item to be pre-existing in the parts catalog. Users working from supplier quotes (often received via WhatsApp or text) must manually search for each item and open a "New Part" modal for anything not yet in the catalog — breaking the flow. There is also no way to draft multiple POs for different suppliers simultaneously.

### The Solution
A two-tier NLP line-entry system that:
1. Accepts raw natural-language item text (e.g. `"10 NGK CPR8EA-9 @ 135"`, `"5 Motul 10W-40 1L @ 280"`) via a quick-entry bar (Mode 1) or multi-line batch paste (Mode 2).
2. Locally parses the text (Tier-1 regex, zero latency) to extract quantity, cost, and a cleaned description — then searches the catalog.
3. Falls back to AI (Tier-2, Gemini via `llmClient`) only when the local parser produces low confidence or the search returns no useful match.
4. Allows saving PO lines for items not in the catalog yet (`part_id = NULL`, `draft_part_data jsonb`) — these are formalized at Goods Receipt time with a pre-filled `PartForm`.
5. Supports a **Named Draft Shelf** — up to 5 concurrent named PO drafts per user, auto-named from the supplier, with a 7-day expiry policy.

---

## 3. Decisions Already Taken (do not relitigate)

### 3.1 Database Strategy — Option A: Nullable `part_id`
`purchase_order_line.part_id` is made nullable. Uncataloged lines carry `custom_item_name` (varchar), `unit` (the purchase/stock UOM such as `PCS`, `BTL`, or `BOX`), and versioned `draft_part_data` JSON. Product packaging such as `1L` is stored as `pack_size`, not conflated with stock UOM. A CHECK constraint ensures `part_id IS NOT NULL OR custom_item_name IS NOT NULL`. **No dummy rows are inserted into the `part` table.**

### 3.2 Tier-1 / Tier-2 Parser Boundary
`poLineParser.js` is a pure function — zero I/O, zero DB, zero AI — upgradable independently. AI fallback fires only when:
- `confidence === LOW`, OR
- Power-search returned 0 results, OR
- Best search score < 0.6 (configurable constant)

### 3.3 Line State and Save Button Behavior
- **Exact match** (green ✅): ready, no block.
- **Fuzzy match** (amber `~` + Confirm button): **blocks Save** until confirmed.
- **Ambiguous** (yellow ⚠ + `[Pick →]`): **blocks Save** until resolved.
- **Uncataloged draft** (blue 🆕 badge): non-blocking; Save shows count warning.

### 3.4 Named Draft Shelf — Multi-Draft POs
- Max **5 concurrent drafts per user**.
- Auto-named `"Draft — <supplier_name>"` or `"Draft #N"`.
- **7-day expiry** — warning banner when < 2 days remain.
- Submitting a PO auto-deletes its draft slot.
- `draft_transaction` UNIQUE changes from `(employee_id, transaction_type)` to `(employee_id, transaction_type, draft_name)`.

### 3.5 Deferred Cataloging at Goods Receipt
When loading a PO with null-`part_id` lines in `GoodsReceiptPage`, each such line shows a "Catalog & Receive" pill for users with `parts:create`. Clicking opens `PartForm` in explicit create mode, pre-filled from `draft_part_data`; it never fetches `/parts/undefined/applications`. `POST /purchase-orders/:id/lines/:lineId/catalog` creates the part and links it to the PO line in one database transaction. Both `goods_receipt:create` and `parts:create` are required. An exact active duplicate (same brand, group, and normalized detail) is reused and linked instead of creating another part. **GRN save is blocked** until all uncataloged lines are cataloged or removed from the receipt.

### 3.6 Catalog Text and Draft Metadata
Catalog-facing parser output is normalized to collapsed-whitespace uppercase. The original input remains unchanged in `draft_part_data.source_text` for audit. The stored schema is versioned and separates `pack_size` from `purchase_uom`:

`{ schema_version, source_text, parsed_by, confidence, brand, brand_id, group, group_id, detail, pack_size, purchase_uom }`

AI brand/group names are resolved to existing database IDs by case-insensitive exact match. Unresolved names remain visible as pre-filled combobox text so the receiver can choose or create the correct master value.

---

## 4. Architecture

```
User types raw text (e.g. "10 5L Gear Oil @ 450")
                     │
       ┌─────────────┴──────────────┐
       ▼                            ▼
[Tier 1: poLineParser.js]    [Power-search /power-search/parts]
Pure regex, zero deps         Existing trigram search
Extract: qty, cost, desc
       │
       ├── HIGH/MEDIUM confidence + search hit → exact or fuzzy match
       ├── LOW confidence ──────────────────────────────────┐
       └── search score < 0.6 ──────────────────────────── │
                                                            ▼
                                           [Tier 2: purchaseOrderParserAI.js]
                                           via llmClient (Gemini)
                                           Returns: brand, group, detail,
                                                    pack_size, purchase_uom
                                                            │
                         ┌──────────────┬──────────────────┤
                         ▼              ▼                  ▼
                   [AI match]   [Ambiguous]     [Uncataloged]
                   Auto-select  Inline picker   part_id=null
                   or suggest   to resolve      draft_part_data stored
```

### Key Existing Files (query graphify before reading raw)
- `packages/api/services/ai/features/expenseParserAI.js` — template for `purchaseOrderParserAI.js`
- `packages/web/src/components/forms/PurchaseOrderForm.jsx` (414 lines) — receives all new UI
- `packages/api/routes/purchaseOrderRoutes.js` (372 lines) — receives new endpoints
- `packages/web/src/pages/GoodsReceiptPage.jsx` — receives deferred cataloging flow

---

## 5. Parser Disambiguation Rules (Critical)

Product size specifiers and dimension specs **must never be parsed as order quantity.**

### Token Classification Table

| Class | Patterns | Rule |
|---|---|---|
| `PRICE_ANCHOR` | `@ <n>`, `P:<n>`, `<n>/ea`, `SRP <n>` at end | → `cost_price`, strip |
| `ORDER_UNIT` | `pcs`, `bxs`, `box`, `btl`, `set(s)`, `pair(s)`, `roll(s)`, `drum(s)`, `can(s)`, `bag(s)`, `unit(s)`, `ea`, standalone `x` | Explicit qty → `confidence = HIGH` |
| `VOLUME_UNIT` | `mL`, `L`, `liter(s)`, `gal`, `gallon(s)`, `oz`, `fl.oz`, `cc`, `pail(s)`, `qt` | Product size — **NOT qty** |
| `DIMENSION_UNIT` | `mm`, `cm`, `m`, `in`, `inch`, `ft`, `"`, `'` | Product spec — **NOT qty** |
| `WEIGHT_UNIT` | `g`, `gram(s)`, `kg`, `lb(s)` | Product weight — **NOT qty** |
| `FRACTION` | `\d+\/\d+` e.g. `3/4`, `1/2`, `5/8` | Always a dimension — **NOT qty** |
| `VISCOSITY` | `\d+W[-–]\d+` e.g. `10W-40`, `80W-90` | Always product grade — **NOT qty** |

### Extraction Priority Order
1. Extract `PRICE_ANCHOR` → `cost_price` (strip)
2. Classify all number-adjacent tokens per table
3. `<number> <ORDER_UNIT>` anywhere → `qty = number`, `confidence = HIGH`
4. Leading bare `<whole_int>` + non-PRODUCT_ATTR next → `qty = int`, `confidence = MEDIUM`
5. Leading token is PRODUCT_ATTR class → `qty = null`, `confidence = LOW` (AI fires)
6. Remainder → `raw_description`

### Required Test Matrix (all 9 must pass in `poLineParser.test.js`)

| Input | qty | cost | raw_description | confidence |
|---|---|---|---|---|
| `10 NGK CPR8EA-9 @ 135` | 10 | 135 | `NGK CPR8EA-9` | HIGH |
| `5 Motul 10W-40 1L @ 280` | 5 | 280 | `MOTUL 10W-40 1L` | MEDIUM |
| `10 5L Gear Oil @ 450` | 10 | 450 | `5L GEAR OIL` | MEDIUM |
| `1 gal Hypoid Gear Oil @ 480` | null | 480 | `1 GAL HYPOID GEAR OIL` | LOW |
| `3 3/4 brake hose 5pcs @ 35` | 5 | 35 | `3/4 BRAKE HOSE` | HIGH |
| `35mm timing belt 2x @ 120` | 2 | 120 | `35MM TIMING BELT` | HIGH |
| `Motul 3100 10W-40 1L 5btl @ 265` | 5 | 265 | `MOTUL 3100 10W-40 1L` | HIGH |
| `10W-30 Gear Oil 4L 3pcs @ 520` | 3 | 520 | `10W-30 GEAR OIL 4L` | HIGH |
| `5/8 radiator hose 1m 3pcs @ 85` | 3 | 85 | `5/8 RADIATOR HOSE 1M` | HIGH |

---

## 6. Implementation Phases

### Phase 1 (6.1) — Migration: `purchase_order_line` — APPLIED
```sql
ALTER TABLE purchase_order_line ALTER COLUMN part_id DROP NOT NULL;
ALTER TABLE purchase_order_line ADD COLUMN custom_item_name varchar(255);
ALTER TABLE purchase_order_line ADD COLUMN unit varchar(50);
ALTER TABLE purchase_order_line ADD COLUMN draft_part_data jsonb;
ALTER TABLE purchase_order_line ADD CONSTRAINT chk_pol_has_item
  CHECK (part_id IS NOT NULL OR custom_item_name IS NOT NULL);
```
⚠ Brief table lock on `purchase_order_line`. Schedule for low-traffic window on production.

### Phase 2 (6.2) — Migration: `draft_transaction` Named Multi-Draft — APPLIED
```sql
ALTER TABLE draft_transaction DROP CONSTRAINT draft_transaction_employee_id_transaction_type_key;
ALTER TABLE draft_transaction ADD COLUMN draft_name varchar(100) NOT NULL DEFAULT 'Draft';
ALTER TABLE draft_transaction ADD COLUMN expires_at timestamptz DEFAULT NOW() + INTERVAL '7 days';
ALTER TABLE draft_transaction ADD CONSTRAINT uq_draft_per_user_name
  UNIQUE (employee_id, transaction_type, draft_name);
```
Existing rows safely receive `draft_name = 'Draft'` — idempotent.

### Phase 3 (6.3) — `packages/api/helpers/poLineParser.js` + Unit Tests — IMPLEMENTED
- Pure function module. Only public export: `parse(rawLine) → { quantity, cost_price, raw_description, order_unit, pack_size, confidence }`
- Catalog-facing descriptions, UOMs, and pack sizes are uppercase; order UOM aliases are canonicalized (`btl` → `BTL`, `box` → `BOX`, `ea` → `PCS`).
- Internal: `tokenize()`, `extractPrice()`, `classifyNumbers()`, `extractQuantity()`, `buildRawDescription()`
- Unit tests at `packages/api/tests/poLineParser.test.js` — all 9 cases from §5 must pass (the live Jest config only matches `tests/**`)
- Zero dependencies — upgradable without touching any other file

### Phase 4 (6.4) — `packages/api/services/ai/features/purchaseOrderParserAI.js` — IMPLEMENTED
- Mirror structure of `expenseParserAI.js`
- AI fallback fires only: `confidence === LOW` OR score < 0.6 OR 0 search results
- Prompt explicitly separates ordered quantity, product `pack_size`, and `purchase_uom`; product sizes must never become quantity.
- Output schema: `{ quantity, cost_price, brand, group, detail, pack_size, purchase_uom, raw_description }`
- Unresolved lines persist a versioned, uppercase draft snapshot and validated brand/group IDs when exact master-data matches exist.

### Phase 5 (6.5) — Purchase-order endpoints — IMPLEMENTED, AUTOMATED VERIFIED

**`POST /api/purchase-orders/parse-lines`**
- Body: `{ lines: string[] }`
- Per line: `poLineParser.parse()` → power-search → AI fallback if needed
- Response per line: `{ raw, quantity, cost_price, raw_description, match_status, confidence, part, candidates, draft_part_data }`
- `match_status`: `"exact"` / `"fuzzy"` / `"ambiguous"` / `"ai"` / `"unresolved"`

**`POST /api/purchase-orders/:id/lines/:lineId/catalog`**
- Body: reviewed `PartForm` values
- Requires both `goods_receipt:create` and `parts:create`
- Locks the PO line, reuses an exact active duplicate when found, otherwise creates the part, links `part_id`, and clears `draft_part_data` in one transaction
- Returns the enriched created part

The older `PATCH` endpoint remains available for linking an already-existing active part, but the Goods Receipt creation flow no longer uses it.

**Named Draft CRUD**
- `GET /api/purchase-orders/drafts` — list user's PO drafts (by `employee_id`, `transaction_type = 'po'`)
- `POST /api/purchase-orders/drafts` — `{ draft_name?, draft_data }`; reject if ≥ 5 active
- `PUT /api/purchase-orders/drafts/:draftId` — update data + refresh `expires_at`
- `DELETE /api/purchase-orders/drafts/:draftId` — discard

**Modified POST/PUT `purchase-orders`**
- `lines[]` now accepts: `part_id?: number|null`, `custom_item_name?: string`, `unit?: string`, `draft_part_data?: object`, `quantity`, `cost_price`
- `GET /purchase-orders/:id/lines` — return null-`part_id` lines with `draft_part_data`

⚠ Business logic in service/helper modules — route handlers stay thin.

### Phase 6 (6.6) — Frontend Components — IMPLEMENTED, BUILD VERIFIED

**`PONLPBar.jsx`** (Mode 1)
- Input bar above PO line table; on Enter: `POST parse-lines` with single string
- Skeleton row while pending; appends result in correct state; clears + refocuses

**`POBatchPasteModal.jsx`** (Mode 2)
- "Paste List" button → modal → `<textarea>` one item per line
- On submit: `POST parse-lines` with all lines → per-row chips → user accepts/tweaks → appends to table

**`PODraftShelf.jsx`**
- PO editor header dropdown; lists drafts with supplier + line count
- `[+ New]` creates blank slot; auto-names from supplier; ⚠ banner if expiry < 2 days
- Submitting PO auto-deletes draft slot

**`PurchaseOrderForm.jsx`** (modify)
- Integrate `PONLPBar`, `POBatchPasteModal`, `PODraftShelf`
- Handle four line states (§3.3); replace `useDraft('po', ...)` with multi-draft API
- Save: enabled with draft lines + count warning; blocked on unconfirmed fuzzy/ambiguous
- ⚠ Already 414 lines — all new UI **must** be in separate component files

### Phase 7 (6.7) — `GoodsReceiptPage.jsx` Deferred Cataloging — IMPLEMENTED, BUILD VERIFIED
- Update GRN PO load path to handle null `part_id` (currently assumes all lines have valid JOIN)
- Render "Catalog & Receive" pill for each null-`part_id` line
- Clicking pill: open `PartForm` pre-filled from `draft_part_data`
- `PartForm` now has separate `initialValues` (create) and `part` (edit) contracts; application lookup and Manage Applications require a real `part_id`.
- Existing brand/group IDs are selected automatically. Unresolved uppercase names seed the create-enabled comboboxes.
- Product `pack_size` is appended to detail when needed; `purchase_uom` fills `measurement_unit`.
- On save: atomic `POST /catalog` → line re-renders as a normal receivable row.
- **GRN save blocked** until all uncataloged lines cataloged or removed from receipt

---

## 7. Explicitly Deferred

- **Mobile (`packages/mobile`):** No mobile PO NLP entry in this phase.
- **Parser confidence tuning:** 0.6 threshold is a starting constant; tuning deferred to follow-up.
- **Draft expiry notifications:** Banner only — no push/email alert.
- **Manager override for draft expiry:** No hard-block; banner is informational only.

---

## 8. Files to Create / Modify

| # | File | Action |
|---|------|--------|
| 1 | `database/migrations/<ts>_po_uncataloged_lines.sql` | CREATE |
| 2 | `database/migrations/<ts>_draft_transaction_multi.sql` | CREATE |
| 3 | `packages/api/helpers/poLineParser.js` | CREATE |
| 4 | `packages/api/tests/poLineParser.test.js` | CREATE (live Jest test root) |
| 5 | `packages/api/services/ai/features/purchaseOrderParserAI.js` | CREATE |
| 6 | `packages/api/routes/purchaseOrderRoutes.js` | MODIFY |
| 7 | `packages/web/src/components/forms/PONLPBar.jsx` | CREATE |
| 8 | `packages/web/src/components/forms/POBatchPasteModal.jsx` | CREATE |
| 9 | `packages/web/src/components/forms/PODraftShelf.jsx` | CREATE |
| 10 | `packages/web/src/components/forms/PurchaseOrderForm.jsx` | MODIFY |
| 11 | `packages/web/src/pages/GoodsReceiptPage.jsx` | MODIFY |
| 12 | `packages/api/tests/purchaseOrderParserAI.test.js` | CREATE |
| 13 | `packages/api/routes/draftRoutes.js` | MODIFY (compatibility with new unique key) |
| 14 | `packages/api/routes/partRoutes.js` | MODIFY (shared part creation + atomic PO catalog endpoint) |
| 15 | `packages/api/tests/poCataloging.test.js` | CREATE (transaction, uppercase, and permission coverage) |
| 16 | `packages/web/src/components/forms/PartForm.jsx` | MODIFY (separate create initial values from edit record) |
| 17 | `packages/web/src/components/ui/Combobox.jsx` | MODIFY (seed unresolved suggested names) |

---

## 9. Verification Commands

```bash
# Parser and atomic catalog tests
npm run -w packages/api test -- --runInBand tests/poCataloging.test.js tests/poLineParser.test.js tests/purchaseOrderParserAI.test.js

# Migration status
npm run -w packages/api migrate:status -- --host localhost
# When host credentials are unavailable:
docker compose exec -T backend node scripts/migrate.js status

# Smoke test parse-lines endpoint
curl -X POST http://localhost:3001/api/purchase-orders/parse-lines \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"lines": ["10 NGK CPR8EA-9 @ 135", "5 Motul 10W-40 1L @ 280", "1 gal Hypoid Gear Oil @ 480"]}'

# Web lint
npm run -w packages/web lint

# Web production compile without touching the root-owned local dist directory
cd packages/web && npm exec vite -- build --outDir /tmp/forson-smart-po-web-build --emptyOutDir

# Update graphify after implementation
graphify update .
```

As verified on 2026-09-13: the focused parser/fallback/catalog suites pass 20/20; API lint and targeted web lint have no errors; the Vite production bundle compiles; and the running backend reports 196 applied migrations with none pending. The full API run reached 69 passing suites / 1,034 passing tests; five unrelated database-backed suites (26 tests) could not authenticate using the host's default `postgres` credentials. Earlier authenticated smoke tests for parse-lines, draft CRUD, uncataloged PO save, and the original deferred catalog flow passed; the revised create-mode modal should receive a final browser acceptance pass before release.

---

## 10. Change Log

| Date | Author / Session | Changes |
|---|---|---|
| 2026-09-11 | Antigravity AI & Lead Dev | Initial PRD — planning complete. Nothing built. Full feature design, parser rules, multi-draft design, GRN flow, and coding-agent prompt all finalized. |
| 2026-09-13 | Codex | Implemented all seven phases in the working tree. Parser tests and API syntax/lint pass; web production bundle compiles. Both migrations remain pending and authenticated runtime smoke tests remain outstanding. Updated legacy draft upsert for compatibility with the new three-column unique constraint. |
| 2026-09-13 | Antigravity AI | Verified implementation end-to-end. Applied migrations 20260913_01 and 20260913_02 to dev database, executed live authenticated smoke tests for parse-lines, draft shelf, PO save with uncataloged lines, and deferred cataloging. Patched PO PDF route to support uncataloged lines and hardened PurchaseOrderForm and GoodsReceiptPage line key handling. All 16 parser tests pass, web build compiles, lint passes. |
| 2026-09-13 | Codex | Hardened deferred cataloging: explicit `PartForm` create initial values, structured uppercase draft metadata, separate pack size/purchase UOM, server-resolved brand/group IDs, seeded unresolved names, exact-duplicate reuse, combined permission gate, and atomic part-create/PO-link transaction. Added focused catalog transaction tests; 20/20 pass. |
