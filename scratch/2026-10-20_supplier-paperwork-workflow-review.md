# Supplier paperwork and receiving workflow review

Date: 2026-10-20 (Asia/Manila). Status: recommendation for discussion; no application/schema implementation in this review.

Implementation follow-up: the user confirmed one primary supplier-document reference with optional classification. See `docs/plans/2026-10-20_supplier-reference-first.md` for the implemented scope and verification; this research review remains historical context.

## Finding and proposed direction

Suppliers send DRs, acknowledgement receipts, sales invoices, packing lists and waybills with item, quantity, price, amount and discount information. The business uses those documents when settling accounts. Mandatory document classification adds work without reliably answering whether stock arrived, whether a debt already exists, or whether payment occurred.

Use a generic supplier reference and optional document description. Preserve the supplier's terminology and original number. Decide financial effects explicitly from the transaction context. This recommendation revises the mandatory typed-entry assumption in sections 3–5 of `docs/plans/2026-10-20_supplier-ap-shared-workflows.md`; it does not claim that plan or its implementation has already changed.

## Current source findings

- GoodsReceiptPage defaults Document Type to delivery_receipt and offers delivery_receipt, invoice and other. Other still displays Delivery Receipt No.
- Its payload supplies the main reference to physical_receipt_no regardless of selected type, and falls back to that same reference for supplier_invoice_no.
- Supplier bill identities and exact matching use supplier + document type + normalized reference. Different types can produce different identity namespaces for the same raw number.
- The posting service registers invoice and delivery identities. Changing only the visible dropdown would leave those semantics and database constraints in place.
- A/P Attach Items already supplies the exact supplier and bill. Document classification should not be necessary to rediscover that association.
- Earlier route corrections remain uncommitted in the workspace. This review introduces only this Markdown file; it does not modify that code further.

## Business model

| Record | Meaning | Creation rule |
|---|---|---|
| Goods receipt | One physical arrival and actual accepted quantities | Post each arrival once, with durable retry protection |
| Supplier payable | One obligation to pay | Explicitly select an existing payable or confirm a new obligation |
| Supplier document/reference | Evidence supplied by a supplier | Associate with receipt/bill/payment as appropriate; adding evidence alone never creates stock/debt/payment |
| Payment | Actual settlement or scheduled instrument under current lifecycle | Record explicitly; document title never marks a bill paid |

A document may serve several purposes. Several documents may support one payable. An invoice may span several arrivals. A statement of account may summarize several existing payables and must not become a second debt. Documents arriving together do not by themselves prove they all belong to one debt.

Keep internal GRN/BILL identifiers distinct from supplier references. Preserve raw text; normalized comparisons must retain punctuation and leading zeroes. Classification can remain unknown until someone has evidence to resolve it.

## Proposed receiving form

```text
Receive Goods
Supplier                  Metro Auto Parts
Supplier reference        [AR-0182                    ]
                          [+ Add another reference]
                          [View / link supplier documents]
Items                     [Actual quantities, prices, discounts]

Payable
(o) Create a new payable from these received goods
( ) Apply to an existing payable
( ) Receive now; billing will be recorded later

New payable               ₱12,500 net of entered discounts
[Post Goods Receipt]
```

This is the standalone layout, not an instruction to silently preselect new debt. Where context does not establish intent, require the user to choose the payable effect before posting. Existing supplier preferences may suggest a mode but must leave its effect visible. Do not claim a received-goods total is the supplier's full invoice total.

For Attach Items, replace the choice with a fixed selected-payable summary: “Receive against BILL-…; no new goods payable.” Preserve existing authorized change/cancel behavior. Never fall back to new debt if the selected payable is stale or invalid.

Reference detail is optional and initially collapsed: original document label (DR, AR, SI, packing list, waybill, custom or unknown), optional series/issuer where needed, and any associated scan. Add references independently; do not require re-entering all supplier paperwork or inventing missing reference numbers. Reuse existing document linking/viewing capabilities; new multi-reference persistence needs explicit implementation.

“Billing later” requires a defined inventory/accrual accounting policy and durable unbilled-receipt visibility. It must not create unbalanced entries, omit the obligation from accounting, or turn a later invoice into a second financial liability. If that accounting path is not supported, keep it as an implementation requirement rather than exposing a nonfunctional option. Backfill keeps its separate reviewed semantics.

## Matching and duplicate protection

1. Search references across the selected supplier's existing bills and receipt evidence, including unknown types. Show exact reference candidates regardless of label; expose type/series differences as review information.
2. Preserve known supplier/type/series identities as evidence. Unknown reference equality is a candidate, not proof. DR 123 and SI 123 may be separate documents; do not silently merge them or block legitimate unrelated transactions through a global supplier+number uniqueness rule.
3. Confirmed aliases to an existing bill must prevent a second debt through either payable-first or receipt-first entry. Adding a later SI to a bill originally entered using an AR/DR updates its evidence; it does not create a new payable.
4. Keep durable intent IDs and transactional checks. With no unique arrival reference, show existing receipts and explicitly confirm another arrival. Repeating an invoice/reference does not automatically mean duplicate stock; some invoices span deliveries.
5. A confirmed delivery identifier can reserve one arrival, subject to existing cancellation/void rules. An unknown document cannot acquire that uniqueness or invoice repeatability merely from a guessed type.
6. Supplier+number collisions across different series/types need targeted clarification only when they occur. Supplier or amount/date similarity alone never authorizes financial association.
7. Replace current typed guards only through a reviewed migration and compatibility strategy. Preserve historical raw fields/identities, autosave/staged drafts, scan matching, cancelled/void handling, supplier merge checks and audit history. Do not relabel all old records or drop uniqueness first.

## Payment experience

Display the supplier's main reference and additional linked references next to internal bill number, original total, adjustments, outstanding and scheduled amount. Permit viewing supporting paperwork before payment. Allocate payment to selected existing debts; a supporting reference is a lookup aid, not another bill.

Example: AR-0182 and waybill WB-77 accompany goods worth ₱12,500. User confirms one payable. Later SI-908 is linked to the same payable. Paying using either reference settles that one debt. A second delivery against SI-908 creates another goods receipt against that same bill, without another liability or automatic payment.

If one later supplier invoice consolidates several previously created payables, show a reconciliation task. Do not implement automatic consolidation or receive-again shortcuts; the previous plan defers that financial correction workflow.

## Interaction and accessibility

Reuse existing React/Tailwind inputs, segmented controls and supplier context cards. Use current light/dark tokens (text-gray-700/dark:text-slate-300; border-gray-200/dark:border-slate-700), existing primary action styling and visible keyboard focus. Avoid new visual systems or animations.

Reference rows need stable labels, keyboard-accessible Add/Remove controls and focus restoration after removal. Announce candidate loading/results and validation errors. Keep entered values on conflict. Display a compact final summary of stock and payable effects before posting. On mobile widths stack reference fields and payable choices in one column.

## Review scenarios before implementation

AR-only, DR-only, SI-only, packing-list-only and waybill-only receiving; several papers for one delivery; repeated invoice across partial deliveries; same number on different document types/series; documents with no number; selected Paid bill; stale/void selected bill; later SI on an already-paid DR-based payable; unbilled receipt later invoiced; consolidated supplier statement; retries/two tabs; historical mixed fields; Paperless association and shared-document tags. Validate actual stock/debt/payment counts, rollback and accounting entries against PostgreSQL, not just form rendering.

## Research references and limits

- BIR RMC 77-2024 digest: https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2077-2024%20Digest.pdf — distinguishes invoices from supplementary/payment documents. Operational acceptance of supplier paperwork does not establish tax invoice eligibility. An acknowledgement title alone must not establish settlement.
- BIR RR 7-2024: https://bir-cdn.bir.gov.ph/BIR/pdf/RR%20No.%207-%202024.pdf — supplementary documents include delivery and acknowledgement receipts.
- Odoo official vendor bill documentation: https://www.odoo.com/documentation/16.0/applications/inventory_and_mrp/purchase/manage_deals/manage.html — illustrates separating receiving from bill control; not a prescribed implementation for Forson.

Verification: source and graph query review; no new browser, API, database or financial writes performed in this review. Prior navigation tests do not verify this proposed redesign. The earlier plan's completion claims are not independent verification of current deployment.
