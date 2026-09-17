# Mobile Smart PO — PRD & Developer Handoff

> **Forson Business Suite** | **PRD-FBS-MPO-001** | **Date:** 2026-09-17 | **Branch:** `master`
> **Status:** Core mobile Smart PO flow implemented; device acceptance and a few resilience refinements remain.

## 0. Status at a Glance

| Item | Status | Reference |
|---|---|---|
| Existing web/API Smart PO parser and named PO drafts | **Implemented** | Existing Smart PO PRD |
| Existing mobile PO creation, editing, or draft UI | **Partially implemented** | §7, §11 |
| V1 delivery: native PDF sharing and text-summary copy | **Implemented; device validation pending** | §7, §8 |
| Automatic email, SMS/WhatsApp delivery, delivery receipts | **Explicitly deferred** | §10 |
| Multi-contact supplier schema | **Explicitly deferred** | §10 |
| V1 inputs: supplier text, paste list, manual catalog search | **Implemented** | §7 |
| Barcode-scanner input | **Explicitly deferred** | §10 |

## 1. For a New Session or Agent Picking This Up

Before implementation:

1. Run `graphify query "purchase orders suppliers mobile receiving smart PO"` and inspect the returned source locations before reading files.
2. Recall hindsight with query `"mobile smart PO supplier text native sharing"` and tags `forson-business-suite`, `mobile-smart-po`.
3. Confirm this document remains accurate against `git status`, `git log --oneline -10`, and the current PO route contracts.
4. Before writing mobile code, read the latest SDK 56 documentation at `https://docs.expo.dev/versions/v56.0.0/`; the app is Expo SDK 56.

When a phase lands:

1. Update §0 and the relevant phase with exact completed/pending work.
2. Retain non-obvious decisions and gotchas using tags `forson-business-suite`, `mobile-smart-po`, and `purchase-order`.
3. Run `graphify update .`.

## 2. Objective

Bring the existing Smart PO capability to the Expo mobile app with a fast, reliable phone-first purchasing flow. A purchaser must be able to create a PO from supplier-provided text, review parsed lines, save a durable PO, share its PDF through installed device apps, copy a concise text summary, and explicitly decide whether to mark it Ordered.

The experience must be operationally safe: sharing a document is not proof that a supplier received it, and the app must never silently advance a PO to Ordered.

## 3. Product Decisions Already Taken

1. **Information architecture:** use the recommended hybrid: a Purchase Inbox paired with a Smart Cart composer. It combines task-oriented PO lists with a focused, cart-like editor.
2. **V1 inputs:** supplier text, multi-line paste list, and manual catalog search. Barcode scanning is a later enhancement, not hidden scope in v1.
3. **V1 supplier delivery:** native sharing of the existing PDF plus copyable text order summary. Do not build server email or direct messaging delivery in v1.
4. **Supplier contacts:** current supplier email, phone, and contact person may appear as optional helpers, but PO sending must not depend on them and no multi-contact model is part of v1.
5. **Status transition:** once the user chooses Share PDF or Copy summary, show a confirmation dialog: **Mark PO as Ordered** or **Not yet**. The selected action, not the share-sheet result, controls the status transition.
6. **Truthful audit language:** if a local event is recorded, call it `share initiated` or `summary copied`; never call it delivered, sent, or received.

## 4. UX Specification

### 4.1 Purchase Inbox

Add a **Smart PO** dashboard module visible only to users with `purchase_orders:view`; show **New Smart PO** only to `purchase_orders:edit` users. The inbox is the mobile operational home, not a duplicate of desktop tables.

- Top segmented control: **Drafts**, **Pending**, **Ordered**.
- Each card: PO number or local draft name, supplier, total, item count, date, status badge, and one primary contextual action.
- Empty state: one sentence explaining the queue plus `Create Smart PO` CTA.
- Pull to refresh; preserve cached loaded data when a refresh fails.
- Pending cards surface `Review & share`; Ordered cards surface `View / receive` and route to the established receiving flow where appropriate.

Use the existing `Screen`, `AppHeader`, `Card`, `StatusBadge`, theme tokens, loading/error/empty states, and permission hooks. Do not create a separate visual language.

### 4.2 Smart Cart Composer

The composer is a full-screen route, not a chat screen or a stack of modal forms.

```
< Smart PO                 Draft saved
Supplier [Select supplier                  >]

Add from supplier text
[ 10 NGK CPR8EA-9 @ 135                 ][+]
Tip: quantity + product + @ unit cost
[Paste list]  [Search catalog]

Items (3)                                      ₱1,350
┌──────────────────────────────────────────────┐
│ NGK CPR8EA-9                         Exact ✓ │
│ 10 PCS × ₱135                         [Edit] │
└──────────────────────────────────────────────┘
[Review PO · 3 items · ₱1,350]
```

- Supplier selection is required before the primary review action, but input text may be entered first while the purchaser is waiting to choose the supplier.
- The supplier-text field accepts one line per request. Pressing `Add` calls the existing `POST /purchase-orders/parse-lines` endpoint.
- A secondary **Paste list** action opens a full-height bottom sheet with one supplier line per row, parses the submitted list with the same endpoint, then presents every returned line for review before adding selected lines to the cart. Preserve the existing API maximum of 50 non-empty lines.
- A secondary **Search catalog** action opens a full-height search sheet backed by the existing parts/power-search capability. Selecting a catalog part opens the same line editor to set quantity and unit cost before it joins the cart. Search does not invoke AI parsing and never creates a catalog item.
- While parsing, retain the typed text, show one inline skeleton row, prevent duplicate submission, then issue selection haptic feedback on a successful resolved addition.
- Parsed lines reuse the established meanings: exact/AI (ready), fuzzy (must confirm), ambiguous (must select), unresolved (may remain a draft/uncataloged line). Do not hide confidence state behind an AI flourish.
- Each line is a compact card with item name, state badge, quantity, unit cost, line total, edit and remove affordances. Quantity and cost edits should use a full-screen or bottom sheet editor with large numeric controls, never cramped inline cells.
- A persistent bottom action displays item count and total. It must stay above the device safe area and keyboard.
- Save local/mobile form state as a debounced server PO draft only after the selected supplier and at least one line exist. Use the existing named PO draft endpoints and keep the current max-five/7-day server policy authoritative.

### 4.3 Review and Delivery

Review is a separate route, ensuring users do not accidentally send incomplete parser output.

- Header: supplier name, optional contact-person/email/phone helper rows if available, expected date, note, total.
- List all lines with exception states visually prominent. Review cannot continue while fuzzy or ambiguous lines are unresolved.
- `Create pending PO` persists the PO through existing `POST /purchase-orders`; success response supplies PO ID and number.
- Once persisted, show the delivery bottom sheet with exactly three choices:
  1. **Share PDF** — downloads the existing PO PDF to an app-local file and opens the native system share sheet.
  2. **Copy order summary** — copies a concise, deterministic plain-text summary to the clipboard and displays confirmation.
  3. **Not now** — return to the pending PO detail without status change.
- After either primary delivery action, show a confirmation dialog: `Mark PO-#### as Ordered?` with **Mark Ordered** (primary) and **Not yet** (secondary). The dialog text must clarify: “This records your purchasing status; sharing does not confirm supplier receipt.”
- On Ordered, call existing `PUT /purchase-orders/:id/status` with `Ordered`; invalidate inbox/open-PO queries and provide Success haptic feedback. On Not yet, keep `Pending` and show the PO detail/inbox.

### 4.4 Accessibility and Interaction Quality

- All icon-only controls need labels; status must be conveyed by text and color.
- Retain 44×44pt minimum hit targets, visible focus/pressed states, dynamic-text-friendly cards, and semantic currency formatting using `en-PH`.
- Use `success`, `warning`, and `danger` theme tokens—not bespoke color literals—for parser and status feedback.
- Use haptics only for successful line addition, destructive removal confirmation, and final Ordered transition; do not buzz for every keystroke.
- Keep action sheets to three choices and avoid scrolling them. Use a bottom sheet for delivery options and a confirmation dialog for status, consistent with mobile platform guidance.

## 5. Architecture and Data Flow

```
Mobile Purchase Inbox
  ├─ GET /purchase-orders?status=…             → list cards
  ├─ GET/POST/PUT/DELETE /purchase-orders/drafts → named draft persistence
  └─ Smart Cart composer
       ├─ GET /suppliers?status=active          → supplier picker
       ├─ POST /purchase-orders/parse-lines     → existing Smart PO resolution
       ├─ POST /purchase-orders                 → Pending PO + PO number
       ├─ GET /purchase-orders/:id/pdf          → authenticated PDF download
       ├─ expo-file-system                      → app-local PDF URI
       ├─ expo-sharing.shareAsync               → native OS share sheet
       ├─ expo-clipboard                         → copied text summary
       └─ PUT /purchase-orders/:id/status       → Ordered only after user decision
```

`expo-sharing` is already installed. Its supported mobile flow accepts a local file URI and opens a system share sheet; local file sharing is Android/iOS-only, so the mobile implementation must feature-detect availability and supply a clear web fallback. No incoming share extension is required for this feature. The PDF endpoint already uses authenticated request middleware and destroys its generated temp server file after download.

### Mobile route proposal

- `packages/mobile/src/app/purchase-orders/_layout.tsx`
- `packages/mobile/src/app/purchase-orders/index.tsx` — inbox
- `packages/mobile/src/app/purchase-orders/new.tsx` — Smart Cart composer
- `packages/mobile/src/app/purchase-orders/[poId].tsx` — persisted PO detail/review/share
- Register `purchase-orders` in `packages/mobile/src/app/_layout.tsx`.

### Suggested component boundaries

- `packages/mobile/src/components/purchase-orders/PurchaseOrderCard.tsx`
- `packages/mobile/src/components/purchase-orders/SupplierPickerSheet.tsx`
- `packages/mobile/src/components/purchase-orders/SupplierTextEntry.tsx`
- `packages/mobile/src/components/purchase-orders/SmartPOLineCard.tsx`
- `packages/mobile/src/components/purchase-orders/LineEditorSheet.tsx`
- `packages/mobile/src/components/purchase-orders/DeliverySheet.tsx`
- `packages/mobile/src/components/purchase-orders/OrderStatusDialog.tsx`
- `packages/mobile/src/utils/purchaseOrderSummary.ts` — pure text generation
- `packages/mobile/src/utils/sharePurchaseOrder.ts` — download/share lifecycle and cleanup

Keep route files orchestration-only. Parser-state conversion and share-file lifecycle must be unit-testable helpers, not inline route code.

## 6. API and Backend Scope

V1 reuses the existing Smart PO and PO APIs. Verify exact existing response shapes before coding and add only minimum API work found necessary during that audit.

Potential required hardening:

- Ensure `GET /purchase-orders/:id/pdf` emits an appropriate PDF content type and a predictable downloadable filename (`PO-<number>.pdf`) so mobile can name/share it reliably.
- Ensure a mobile-safe paginated/all-list contract can load Draft/Pending/Ordered cards without excessive data. Prefer an additive pagination query over duplicating list endpoints.
- Do **not** add mail providers, sender credentials, messaging APIs, recipient tables, or database delivery-event tables for v1.

The existing status route already permits only `Pending → Ordered | Cancelled`; this matches the approved flow. No database migration is expected for v1 unless the API audit reveals a missing non-breaking field needed for existing PO details.

## 7. Implementation Phases

### Phase 1 — Contracts, navigation, and inbox

**As built:** permission-gated dashboard and route stack, segmented Drafts/Pending/Ordered inbox, pull-to-refresh, cached React Query lists, PO/draft deep links, and receiving navigation. The API audit confirmed the existing contracts; PDF responses now set `application/pdf` and an attachment filename.

**Remaining:** targeted API contract tests and component-level inbox/permission tests.

### Phase 2 — Smart Cart + draft resilience

**As built:** supplier picker, supplier-text parser, paste parsing (up to 50 lines), local catalogue search, parser-status cards, line edits/removal, totals, and review guards for ambiguous/unconfirmed fuzzy matches. Explicit server draft save/load and expiry display are included. Creation remains online-only and is not put into the offline outbox.

**Remaining:** selectable pasted-result review, debounced automatic draft save, draft discard UI, and dedicated adaptation/serialization tests.

### Phase 3 — Persist, share, copy, and status confirmation

**As built:** Pending-PO creation, post-success draft deletion, PO detail/review, authenticated cache-only PDF download/share with cleanup, deterministic Clipboard summary, and the explicit Ordered/Not yet confirmation after a completed share action or copy. Neither action claims supplier delivery or receipt. Utility checks cover review guards, totals, and summary output.

**Remaining:** automated native cancellation/download/share/clipboard/status-failure tests and physical-device validation.

### Phase 4 — Acceptance, regression, and release readiness

- Test iOS and Android physical-device sharing to at least one mail app and one messaging app, plus an Android device without a compatible share target.
- Validate light/dark themes, large text, screen reader labels, network failures, token expiry, deleted supplier, five active drafts, zero/one/many-line orders, fuzzy/ambiguous/unresolved parser output, and concurrent web/mobile edits of one Pending PO.
- Run API targeted tests, mobile lint/tests, Android/iOS build checks according to the release runbook, and manually verify receiving after an Ordered PO is created on mobile.

## 8. Acceptance Criteria

- [ ] Only authorized users see the Smart PO module and create action.
- [ ] A purchaser can add a single supplier-text line and sees its real parser resolution state.
- [ ] A purchaser can paste up to 50 supplier lines, review their returned states, and add only selected lines.
- [ ] A purchaser can search an existing catalog part manually, set its quantity and unit cost, and add it without using AI parsing.
- [ ] Fuzzy and ambiguous lines block review/create until resolved; uncataloged lines retain current Smart PO behavior.
- [ ] Draft work restores after leaving/reopening the composer and follows the server’s five-draft, seven-day rules.
- [ ] A successfully created mobile PO is initially Pending.
- [ ] Share PDF opens the operating system’s available-target share UI from a local, valid PDF.
- [ ] Copy order summary copies accurate, readable PO text without requiring supplier contact data.
- [ ] Every post-delivery action prompts to mark Ordered or Not yet.
- [ ] Choosing Not yet leaves the PO Pending; choosing Mark Ordered uses the existing route and changes the inbox state.
- [ ] The app never represents a system share as supplier delivery, receipt, or confirmation.
- [ ] Existing web Smart PO creation and mobile receiving regressions are absent.

## 9. Verification Commands

```bash
# API PO/parser regression suite
npm run -w packages/api test -- --runInBand tests/poLineParser.test.js tests/purchaseOrderParserAI.test.js tests/poCataloging.test.js

# API lint
npm run -w packages/api lint

# Mobile static validation
npm run -w packages/mobile lint
npm run -w packages/mobile test

# Consult and use the project mobile release process before device builds
# See docs/MOBILE_RELEASE_RUNBOOK.md

# Keep graph context current after source/document changes
graphify update .
```

## 10. Explicitly Deferred

| Deferred item | Revisit when |
|---|---|
| Barcode scanning | Shop-floor replenishment is a verified v2 priority. |
| Server-email delivery | A configured outbound mail provider, sender identity, audit requirements, and recipient governance are approved. |
| Direct WhatsApp/SMS integration | A compliant provider and explicit user consent/audit requirements are defined. System share remains the user-mediated alternative. |
| Multiple supplier contacts | Purchasing requires role-based/default recipient lists, not merely optional contact helper data. |
| Delivery/read tracking | A delivery provider and webhook-driven event model are approved; sharing alone cannot provide this. |
| Supplier confirmation workflow | The business defines whether confirmation is manual, portal-based, or message-driven. |

## 11. Files Touched So Far

- `packages/mobile/src/app/purchase-orders/*` — inbox, composer, detail, and permission-gated route stack.
- `packages/mobile/src/components/purchase-orders/*` — supplier, line, and delivery UI.
- `packages/mobile/src/utils/purchaseOrder.ts`, `packages/mobile/src/utils/sharePurchaseOrder.ts` — pure order helpers and secure local PDF sharing.
- `packages/mobile/src/app/_layout.tsx`, `packages/mobile/src/app/index.tsx` — route/dashboard registration.
- `packages/api/routes/purchaseOrderRoutes.js` — PDF content type and attachment filename.
- `packages/api/helpers/pdf/purchaseOrderPdf.js`, `packages/api/templates/pdf/purchase-order.html` — shared web/mobile PO PDF prices, total, optional note, and standard purchasing terms.
- `packages/mobile/tests/purchaseOrder.test.js` — helper test coverage.

## 12. Change Log

| Date | Author / Session | Changes |
|---|---|---|
| 2026-09-17 | Codex + product owner | Finalized v1 mobile Smart PO product decisions and implementation handoff. No application code changed. |
| 2026-09-17 | Codex | Implemented the core mobile flow and recorded the remaining acceptance/device work. |
| 2026-09-17 | Codex | Updated the shared PO PDF with price/total visibility, optional notes, and supplier terms. |
