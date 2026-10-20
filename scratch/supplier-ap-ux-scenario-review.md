# Supplier A/P workflow: UX scenario review

Date: 2026-10-20 (Asia/Manila)
Scope: planning only. Based on the existing workflow proposal; no additional source audit or application changes.

## Recommended user-facing model

The supplier account is a contextual entry point into existing forms. Keep one Goods Receipt form, one payment form, and one receipt detail/document viewer. A supplier-level entry presets the supplier; a bill-level entry additionally presets the bill. The destination form always names the supplier and, when applicable, the bill.

Use **Goods Receipts** for the supplier account tab. Inside receipt details, distinguish **Supplier invoice**, **Delivery receipt**, **Goods receipt number**, and **View supplier document**. “Supplier receipt” alone is too ambiguous: it might mean the supplier's invoice scan, a delivery slip, or Forson's internal receiving record. One tab can show receiving records and their source documents without creating a second document management workflow.

```text
Metro Auto Parts                            [Record Payment]
Outstanding: ₱18,500     Scheduled: ₱0        [Receive Goods]

Bills | Goods Receipts | Payments | Ledger

BILL-202610-0001          Supplier invoice: SI-008912
Bill total: ₱18,500       Open: ₱18,500
Goods receipts: 2        [View receipts] [Attach Items] [Pay This Bill]
```

Retain existing page styles and existing visible labels when necessary for compatibility. Prefer **Receive Goods** over **Attach Items** in a later consistent wording update: it describes inventory movement. If retaining Attach Items, add helper text “Open Goods Receipt for this bill.” Do not add both competing row actions for the same receiving task.

## Scenario matrix

| Scenario | Simplest safe interaction | Correctness requirement |
|---|---|---|
| Ordinary bill-first receipt | Attach Items opens the shared form, supplier and bill fixed. Review summary already identifies the bill; final action says Receive & Link. | Opening, saving, and submitting a draft do not move stock. Posting receives once against the selected payable. |
| Supplier-level receiving | Receive Goods presets supplier; payable association is within the form rather than a separate wizard. | No invented bill target. Explicitly disclose whether posting uses an existing payable or creates one. |
| Independent receipt with exact supplier invoice match | One inline suggestion with supplier, invoice reference, internal bill, amount, and status; one Use this bill action. | Do not silently link. Revalidate at posting. Matching is supplier + document type + reference, not amount alone. |
| No invoice number or different DR number | Optional separate delivery reference; Find existing bill stays available. Do not require an invented invoice number to enter a genuine delivery. | DR-00456 must not be treated as invoice SI-008912. No inference from similar amounts. |
| Several matching bills | Compact candidate list ordered by relevance/date; show dates and original references. | Require deliberate selection. Do not pick the first result. |
| Partial delivery | Same form. Show previous goods value, this delivery, and invoice difference in a collapsed summary. No extra delivery mode selector. | Repeated invoice reference can be legitimate across several receipts; it is not a blanket duplicate-receipt rejection. Value equality does not prove all goods arrived. |
| Fully paid bill before delivery | Allow Receive Goods against the paid bill and show “Bill already paid” in the context card. This is a real receiving scenario, not a duplicate payment scenario. | Implement only after receipt and independently created bill lifecycles are decoupled, including return/void behavior. Receiving must not reopen the debt or change payment history. |
| Supplier-level payment | Shared payment form with supplier fixed, available bills visible, amount deliberately entered. | Pending cheque allocations reduce available amount; existing cheque lifecycle stays intact. |
| Pay This Bill | Same form with that bill selected and available amount suggested; brief allocation summary. | Do not allow default auto-allocation to pay other bills. If fully scheduled, explain “Already covered by pending payment” and offer View payment. |
| Multiple tabs or drafts | Resume draft for the same context. If another draft exists, explain its supplier/bill and offer Resume or Start separate draft. | Do not overwrite a draft, rebind it to another bill, or make two tabs share one mutable local storage entry. Posting rechecks stale records. |
| Wrong supplier chosen | Supplier fixed for contextual entries. Escape through Back to supplier account or start a new unrelated receipt. | Server validates supplier, bill, PO, and candidate receipt association. Never silently update selected bill when supplier changes. |
| Duplicate submission or network timeout | Keep form and show existing result once known; retry safely. | Idempotent posting and payment creation; disabled submit alone is insufficient. |
| Possible duplicate supplier paperwork | Inline “A receipt with this reference exists” with View/Resume; show delivery/date context. | Do not confuse a repeated invoice on a partial delivery with a duplicate physical receipt. Do not strip punctuation/leading zeroes for decisive matching. |
| Existing receipt already has a payable | Show linked bill and View bill. Do not offer posted receipt reassignment in the initial scope. | Do not post inventory again or simply overwrite the old liability association. Correction/consolidation is a deferred, separate audited workflow. |
| Missing scanned document | Receipt details show “No supplier document attached” and permitted existing upload action. | Missing scan does not make the receipt disappear and should not invent a new required accounting document rule. |
| User without receiving/posting permissions | Read-only receipt information; show existing draft/review actions only if authorized. | AP access does not imply inventory posting authority. Server enforces every action, including direct links. |
| Bill changed or voided in another tab | Retain entered lines; inline explanation and Refresh bill / Back actions. | Failed validation must not fall back to creating a new bill, reallocate payment, or lose entered data. |

## Keep the interaction small

1. Do not add a route-choice dialog before opening shared forms. The clicked action already expresses intent.
2. Do not add another confirmation solely because a form came from supplier A/P. Show association and posting/payment effects in the existing review/summary. Use a focused warning only when a conflict or material excess requires a decision.
3. Defer posted receipt reassignment. Receipt sections initially offer **View receipt** and existing draft **Resume** actions. Do not tease users with a broad Link existing receipt action that is mostly ineligible; future reconciliation needs a dedicated design.
4. Context should occupy one compact card: supplier, linked bill, supplier invoice, and relevant amount. Do not repeat both a long breadcrumb and a separate multi-line Origin panel.
5. The default primary action follows existing permissions: Post/Receive for authorized users or Submit for review for preparers. Save draft is secondary. Never show three equally prominent completion buttons.
6. Return to the same supplier and tab, focusing the refreshed record. A toast with View receipt/View payment is enough; do not introduce an additional completion page if the established form uses a toast/modal closure.
7. Show **Outstanding**, **Scheduled payment**, and goods value comparison separately. Avoid “Remaining” without a noun; it could mean unpaid money, unreceived goods, or unallocated cash.
8. Keep payment amount distinct from receipt value. Fully paid invoices can still await goods, while fully received invoices can remain unpaid.

## Visual and accessibility behavior

Use the existing light/dark tokens and existing Headless UI controls. The context card can reuse `rounded-lg border p-4`; amounts remain right-aligned. No gradients, animations, new fonts, or separate design system are needed for this task.

Preserve keyboard focus on modal close and route return. Errors appear inline and in a summary when multiple fields fail; focus the first actionable error. Match search has Loading, No match, One match, and Multiple matches states communicated in text. Announce asynchronous match/error/completion updates accessibly. Do not clear an accepted bill selection because matching refreshes in the background.

## Hard constraints versus preferences

**Hard constraints:** one inventory movement per posting; no duplicate liability; supplier/target integrity; no payment to unintended bills; preserved cheque lifecycle; server permissions and fresh-state validation; safe retries; preserved drafts/data; safe paid receiving and decoupled return/void side effects. Reference matching must preserve original document text and avoid unsafe normalization collisions.

**Preferences:** Record Payment prominence in A/P; tab label Goods Receipts; a compact context card; one-click explicit match adoption; return toast versus separate confirmation screen. These can follow current product conventions without changing correctness.

## Reference input with progressive disclosure

The primary group can remain one **Supplier document** input: a type selector and a number. Document types are Invoice, Delivery receipt, or Other. Keep the existing field placement and input behavior; show the optional related invoice only when a delivery/other document is selected or through **Add invoice reference**.

```text
Supplier document     [Delivery receipt v]   [DR-00456        ]
Related invoice       [SI-008912            ]  Optional

Matching bill: BILL-202610-0001 · ₱18,500    [Use this bill]
```

Invoice mode stores its number as invoice matching metadata. Delivery receipt mode stores its number as the physical delivery identity and can carry a separate related invoice. For invoice-only partial deliveries, the same invoice can occur on multiple internal GRNs; leave the separate physical delivery number blank rather than fabricating a supplier reference or appending a suffix. A generated internal GRN always identifies the receiving event.

The parent source audit identified supplier-scoped uniqueness of `physical_receipt_no`. Retain that physical-document uniqueness, but stop copying invoice references into that field for the new model. This is a backend reference-model and legacy-data task, not merely relabeling the input. Legacy mixed references must not become exact-match authority without confirmed document type. If a genuine delivery reference repeats, show the existing receipt and review context rather than allowing another stock posting by default.

Parent audit additionally identified draft writes losing `bill_id`, partials blocked by current invoice uniqueness, and receipt voiding that can void the entire linked payable. These are release blockers for the streamlined UX and must be corrected before contextual routes are enabled.

## Joint resolution: invoice-only partial deliveries

Deliberated with the receipt integrity review agent. Support genuine invoice-only partial deliveries in the initial scope if durable receiving-intent idempotency is delivered with them. Do not force a fictitious delivery reference or append suffixes to supplier numbers.

When a supplier invoice already appears on a draft or posted receipt, display the existing GRNs, dates, line summaries, and values inline. **Resume** or **View receipt** is the ordinary path. A secondary **Record another delivery** action explicitly acknowledges another physical arrival and creates a separate durable receiving intent. Saving, retrying, and posting the same intent cannot receive stock twice. The same supplier invoice can legitimately belong to several such intents. A repeated actual delivery document reference remains blocked.

This is not a guarantee against a user entering the same invoice-only arrival as two new deliveries: without a unique physical reference, the system cannot establish that identity mathematically. The visible prior-receipt summary, deliberate additional-delivery acknowledgement, permissions, audit history, and idempotency reduce that risk without preventing legitimate partials. Do not promise automatic duplicate prevention from invoice matching alone.

The same invoice scan can be viewed from every associated goods receipt. Source-document association and Paperless tagging must be shared-aware: retain the Recorded tag while any active posted receipt references that supplier document, including related invoice associations on receipts with a separate delivery reference. Voiding one sibling must not untag it. Prefer the label **Recorded in N goods receipts** and show drafts as **In progress** separately; neither label claims that all ordered goods arrived. Preserve historical physical-reference text and existing Paperless links; unknown legacy document types remain unclassified until verified rather than silently becoming invoice matching authority.

## Guidance used

The recommendations to expose a reviewable financial summary and preserve a deliberate submit action are informed by the [GOV.UK check answers pattern](https://design-system.service.gov.uk/patterns/check-answers/) and [W3C guidance on financial/data error prevention](https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html). They support the interaction approach; project-specific accounting policies require the separate source and lifecycle review.
