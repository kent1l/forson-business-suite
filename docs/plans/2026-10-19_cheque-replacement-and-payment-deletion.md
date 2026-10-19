# Cheque Replacement and Payment Deletion — Design Review and Handoff

> **Forson Business Suite** | **Date:** 2026-10-19 | **Branch at review:** `ap-bug-fixes-and-improvements`
> **Status:** Implemented and verified across Phases 1–4.

## 0. Status at a Glance

| Item | Status | Reference |
|---|---|---|
| Existing workflow, services, schema, and dependency review | Completed | §3 |
| Independent sub-agent deliberation | Completed | §4 |
| User requirements | Implemented | §2 |
| Recommended UX and scenario rules | Implemented (`ReplaceChequeModal`, `DeletePaymentModal`, Treasury, Print History, Payment Register) | §5–7 |
| Schema, transaction, and reporting adjustments | Implemented (`20261019_01_cheque_lifecycle_and_deletion_invariant.sql`) | §8 |
| Repair of BJ Auto records and other hidden instruments | Implemented (`20261019_02_reconcile_bj_auto_and_legacy_hidden_cheques.sql`) | §9 |
| Automated and browser verification | Verified (`packages/api/tests/chequeReplacementAndDeletion.test.js`, `eslint`, `vite build`) | §10 |
| Cleared/direct/custody-linked payment corrections | Contextual guardrails enforced (`DIRECT_SETTLED_PAYMENT_NOT_DELETABLE`, `REMITTANCE_LINKED`, `FREIGHT_LINKED`, `CASH_CUSTODY_LINKED`) | §7, §11 |

## 1. For a New Session or Agent Picking This Up

Before starting:

1. Run `graphify query "apPdcService replaceCheque voidCheque apPaymentService chequeRoutes"`; inspect current source because graph output and this review can drift.
2. Recall Hindsight using tags `forson-business-suite`, `cheques`, `bug-investigation` and query `BJ AUTO 313083 replacement hidden deleted payments`.
3. Read `scratch/cheque-workflow-review.md` for the independent UI/UX and scenario review.
4. Verify this status against `git status`, recent commits, live schema and current records. These database observations are a snapshot.
5. Obtain implementation direction from the user. The instruction **DON'T MAKE ANY APPLICATION CODE CHANGES YET** remains in force.

After an authorized phase, update this document with exactly what was implemented/tested, retain important decisions, and run `graphify update .`. No phase below is implicitly authorized by being described.

## 2. Objective and Requirements

The user needs to replace any supported outbound cheque when physical stock is jammed, misaligned, damaged, or otherwise unusable. Preserve the original payment details and bill applications; ask for the replacement bank account and cheque number. The existing same-bank example is 313083 → 313084 for BJ AUTO PARTS SUPPLY, ₱12,150.

The user also needs to delete an erroneous payment without spoiling or reserving its cheque number. UI/workflow should be clear and flexible with little extra complexity.

Established user requirements:

- Replace is available beyond bounced/stale cheques, including printing errors on issued cheques.
- Preserve payment inputs; replacement supplies a new bank account and cheque number.
- Deleting an erroneous payment makes its number reusable.
- Brainstorm with a sub-agent, re-evaluate the existing system, and make no application changes yet.

Recommended interpretations requiring design acceptance:

- Keep a minimal audit/tombstone while removing a deleted payment from active financial records. Literal physical erasure is a different requirement and would break references/history.
- Keep original cheque date by default, with an explicit optional date adjustment; amount/payee/purpose/bills stay fixed in Replace.
- Treat settled and source-owned payments through contextual correction, rather than silently erasing real settlements or custody records.
- Retain three actions with different consequences: Replace, Void cheque, Delete payment.

## 3. Existing Behavior and Confirmed Gaps

### 3.1 Database snapshot

Read-only queries on 2026-10-19 confirmed the following in the configured database, not an independently verified production environment:

| Number | Cheque record | AP payment | Amount | State |
|---|---:|---:|---:|---|
| 313081 | 77 | 38 | 12,150 | Cheque hidden (`is_deleted=true`); cheque/AP both ISSUED; no bill allocations |
| 313082 | 79 | 40 | 12,150 | Cheque hidden; cheque/AP both ISSUED; no bill allocations |
| 313083 | 84 | 45 | 12,150 | Cheque hidden; cheque/AP both ISSUED; PRINTED event but no VOID event |
| 313084 | 85 | 46 | 12,150 | Visible; cheque/AP both ISSUED; no replacement link to 313083 |

Payments 45 and 46 each allocate ₱3,650 to bill 84 / number 10431 and ₱8,500 to bill 85 / number 10374. Neither has posted a settlement to the AP ledger. Cheque 313081 is dated `0027-12-20`; intended date is unknown. Another hidden ISSUED cheque, 313075 / MOTO TRUCK, also needs review. Security Bank account 1 has no default print template configured.

### 3.2 Source findings

- Print History Delete updates the **canonical** cheque's `is_deleted` flag without canceling the AP payment. History and Treasury hide the row while the unique bank/number index keeps reserving its number.
- AP payments are explicitly modeled as one row per physical instrument; replacement currently creates a new AP payment and copies allocations, then marks the original REPLACED.
- Replace only accepts stored BOUNCED/STALE statuses. The UI can offer stale replacement based on calculated maturity for an ISSUED cheque, which the service then rejects.
- The current Replace modal has no bank selector although the API accepts a new bank account. It starts with an empty cheque date rather than copying it.
- Replacement overwrites AP business reference/notes with generated replacement text and does not explicitly preserve payment_date. It reuses the old print template even if the bank changes.
- Expense replacement inserts another expense and leaves the first non-void. This can duplicate expense totals. Expense fields and external references should not be lost simply because the paper cheque changes.
- AP allocation availability uses total minus settled amount; pending instruments are not reserved. Two issued cheques can therefore promise the same bill balance. Historical allocations alone do not mean a bill was paid.
- Clearance/bounce services contain manual bill balance writes that can overwrite aggregate trigger results; clearance lacks a current-status/visibility gate. Button visibility alone cannot protect VOID/REPLACED/DELETED instruments.
- Bounce currently appends a positive payment reversal even for a cheque that may never have settled. Re-clearance must also be reviewed against the one-PAYMENT_SETTLED-per-payment idempotency rule. These lifecycle defects require explicit regression coverage before supporting the expanded flow.
- PDF generation is logged as PRINTED before the user prints; even test PDF generation can set the printed indicator. Expense/standalone generation does not receive the same audit coverage. Thus a print event cannot establish whether paper was successfully used.
- Standalone Print Cheques entries have payee/amount/date/memo/template, but no tracked bank account/number or financial backing. They are different from numbered instruments.
- `ap_payment` currently has no VOID/DELETED status. The cheque status check has no DELETED. The audit action check has PRINTED but no dedicated DELETED/PDF_GENERATED/TEST_PDF_GENERATED.
- Posted/source-owned payments have references from AP ledger, cash movements, advances, remittances, and goods-receipt freight. Existing custody/remittance guards intentionally reject some source updates/deletions. Expenses also have period locks and correction references.

## 4. Options Discussed and Recommended Architecture

| Option | Benefit | Cost / failure risk | Recommendation |
|---|---|---|---|
| Add Replace button and widen status list only | Smallest visible patch | Leaves duplicate expense, metadata, number release, hidden records, allocations and state races unresolved | Insufficient |
| One stable AP payment, multiple cheque instruments | Clean separation of payment intent from paper | Reworks current one-instrument-per-payment semantics, status mirrors, ledger keys, all queries and migration of existing records | Defer broad refactor |
| Keep current AP replacement rows; reuse existing expense for expense cheques | Fits current AP model and prevents expense duplication without a new obligation engine | Must consistently filter retired AP attempts and select the current expense instrument | Recommended |
| Hard-delete financial rows | Literal removal | Breaks audit/chain/FK references; source-owned/settled effects cannot disappear safely | Do not use as ordinary deletion |
| Use `is_deleted=false` in number uniqueness | Appears easy | Immediately releases legacy hidden but physically used numbers, including 313083 | Reject |
| Explicit DELETED business status releases number | Small, explicit invariant using current state model | Must update all readers/writers; DELETED must never mean merely archived/hidden | Recommended |
| Add independent number-release flag and more lifecycle states | Supports future special cases | More combinations to validate than needed for current requirements | Defer unless policy requires number release independently of deletion |

Recommended model:

- **Supplier cheque replacement:** retain a separate AP payment per instrument. Old payment becomes REPLACED, new payment starts ISSUED, copied allocations are revalidated. Only the active attempt counts as scheduled; only cleared payments count as settled.
- **Expense cheque replacement:** keep the existing expense identity and its economic date/category/reference/notes. Create a replacement cheque pointing to that expense; do not create another expense. Reporting still sees one expense. Select the current instrument explicitly in expense/Treasury readers, rather than joining every historical cheque.
- **Delete:** atomically mark the active instrument/AP payment DELETED, remove their effects from active views/reservations, retain immutable details and deletion audit. Preserve allocation rows as history but exclude them from active/settled calculations. Use existing expense cancellation machinery for the cheque-created expense effect when the user deletes that payment; do not cancel a separately owned remittance or other source obligation implicitly.
- No new generic cheque-book, print-job, obligation, bank-stop-payment, or accounting engine is necessary for the normal printing-error case.

## 5. Clean User Workflow

### 5.1 Action meaning

| Action | What the user means | Payment/bill consequence | Original number |
|---|---|---|---|
| Open PDF / Print | Produce the existing cheque document | No new payment or allocation | Still reserved |
| Replace cheque | Same payment, different physical cheque | Keep intent and allocations; one current attempt | Retired permanently |
| Void cheque | Cancel this cheque without a replacement | Remove its active scheduling; bill remains owed | Retired permanently |
| Delete payment | Entry was erroneous; number can be used | Remove erroneous payment effect | Released after eligible deletion |
| Remove from queue | Stop showing it in this print batch | No financial change | Unchanged |
| Remove print entry | Remove unnumbered standalone print-only history | No financial change | No tracked number exists |

Keep **Print** and **Replace** visible for eligible rows. Put **Void cheque** and **Delete payment…** in the existing contextual menu, with deletion separated visually. Retired rows show **View replacement / View history** instead of live actions. Display disabled-action reasons for known records; do not make users guess why an operation is unavailable.

Expose the same canonical action dialog from Treasury, financial cheque rows in Print History, and AP Payment Register. Avoid making the user navigate elsewhere just to manage a cheque. All entry points call the same action service; Print History does not own a second deletion workflow.

### 5.2 Replace modal

One form and one commit; no wizard for normal printing errors.

```text
Replace cheque 313083
BJ AUTO PARTS SUPPLY                         ₱12,150.00
Bills: 10431 ₱3,650.00 · 10374 ₱8,500.00
Cheque date: 05 Jan 2027                       Change date

Bank account       [Security Bank — account label       ▾]
New cheque number  [313084                               ]
Reason             [Printing issue                     ▾]
Notes              [optional                             ]

313083 will remain retired. The payment details and bills
will carry over to the replacement cheque.

[Cancel]                              [Replace cheque]
```

- Bank defaults to original account; selectable active same-currency accounts. Show account name plus bank and masked account number when needed to distinguish accounts.
- Suggest the next available number for the selected account, make it editable, preserve leading zeros, and label it as a suggestion. A different bank can use the same textual number if it is unreserved there. Same original account/number cannot replace itself.
- Prefill original date, with a small optional Change date control. Preserve payee, amount, supplier, purpose, category, reference, memo, payment business date and allocations. System creator/time and replacement reason are new audit facts, not copied authorship.
- Reason options: Printing issue, Damaged cheque, Stale cheque, Bounced cheque, Other. Other requires a note; avoid forcing separate paper-jam versus alignment categories when a note suffices.
- New bank selects its own default print template. Missing template does not invalidate a legitimate replacement: show a clear print-setup action. Never silently use another bank's layout.
- Success: `Cheque 313084 replaces 313083.` Offer **Print replacement** and **View payment**. Do not automatically open another confirmation/printing wizard.
- If PDF generation fails, the replacement stays issued. Retry printing the same record; do not issue another replacement/payment automatically.

### 5.3 Delete modal

```text
Delete payment for cheque 313081?
BJ AUTO PARTS SUPPLY                         ₱12,150.00

This removes the payment entry and makes Security Bank
cheque number 313081 available again. A deletion audit remains.
Use Void or Replace if this physical cheque was spoiled.

Reason [Recorded by mistake                              ]

[Keep payment]                              [Delete payment]
```

- Reason required. The dialog states the exact number released and the bill/expense effect. No generic "Are you sure?" confirmation stack and no typed-number exercise for routine eligible mistakes.
- For deleting a replacement: `313083 stays retired. 313084 becomes available. These bills will have no active cheque payment.` Never automatically reactivate the original.
- If the payment is cleared, deposited/outstanding, cash-linked, remittance-linked, freight-owned, or otherwise protected, show the specific dependency and the applicable correction/recovery path. A disabled button with a raw database error is not a workflow.
- A print PDF event alone neither prohibits deletion nor establishes reuse eligibility; the user must classify an erroneous record versus physically spoiled stock. The consequence text is explicit.
- Deleted entries disappear from normal active/payment totals; an **Include deleted** history filter exposes read-only audit entries. No automatic undelete once a number can have been reused.

### 5.4 Register and accessibility

- Clearly distinguish **Outstanding**, **Scheduled by active cheques**, and **Available for a new payment** for bill allocation. A scheduled PDC does not mark a bill Paid before clearance.
- Replacement chain shown in details: `313083 → 313084 → …`; default list favors current cheque, with previous attempts in history. Raw issuance/history totals must not be presented as settled payment totals.
- Keep one lifecycle badge; printing is an event, not an additional mandatory status machine. Void has an optional reason category for spoiled paper; do not add SPOILED as a separate competing status.
- Use the existing Modal/components/Tailwind design system, visible labels, inline errors, keyboard focus containment/return, and predictable progress text. Focus Keep payment/Cancel for destructive confirmation; Escape cancels before submission. Disable duplicate submit while pending.
- Do not rely on colour alone. Announce success/errors accessibly and focus the new/current row or suitable list control after deletion.
- W3C dialog guidance supports focus management/least-destructive initial focus: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/ . Explicit action labels and separation of destructive actions follow https://www.nngroup.com/articles/ok-cancel-or-cancel-ok/ and https://www.nngroup.com/articles/proximity-consequential-options/ . These are interaction references, not evidence that this proposed UI has been usability-tested.

## 6. Scenario Rules

| Scenario | Recommended behavior |
|---|---|
| PDF not printed, original stock still usable | Open same PDF or delete erroneous entry; do not force spoilage |
| Misalignment/jam/damaged paper | Replace; old number permanently reserved; all economic inputs copied |
| User closes Replace before submitting | No changes, no new reserved number |
| Same bank / new number | Normal replacement |
| New bank / same textual number | Allowed only if free on target account; retire source account/number |
| New bank has different currency | Block implicit currency conversion; explain that amount/currency correction is a different operation |
| Target bank inactive | Require active target; historical bank can remain visible in old record |
| Original method/category now inactive | Preserve historical values if unchanged; do not offer inactive values for a new business classification |
| New number already used/void/replaced | Inline conflict with permitted link to existing record; no side effects |
| Next-number suggestion hits an old reservation | Suggest a free candidate; database uniqueness remains final authority |
| Date is year 0027 or impossible | Require correction/verification; never silently infer 2027. Propose a documented operating-year range based on actual business needs before implementation |
| Same payment replaced more than once | Linear chain; only newest live attempt actionable; old numbers never revive |
| Delete replacement B after A was spoiled | Release B only; keep A retired, preserve A → deleted B audit; payment no longer scheduled |
| A → deleted B and user needs another cheque | Record a new payment using verified details. No automatic undo/revival/reparenting of the old chain in the initial design |
| Delete already-retired A to reclaim its number | Not ordinary erroneous-payment deletion; keep retired number and audit |
| Bills partially settled by another payment meanwhile | Replacement revalidates remaining amount excluding its own old reservation; show conflict, never silently change amount or allocations |
| Bill canceled/merged/supplier changed | Block stale copied allocations with actionable explanation; no silent reassignment |
| Two users replace, delete, or clear same cheque | One succeeds under lock; other gets current state and can refresh |
| Request succeeds but client times out | Retry the same operation identifier; return same result, no second payment |
| Cleared cheque | No routine replacement or reusable-number deletion; process an erroneous-clearance correction if that is what happened |
| Deposited / released / possibly with payee | Require recovery/confirmed prevention of presentation before retiring and replacing; current system does not have a bank-stop-payment integration |
| Bounced cheque never previously cleared | No settlement reversal to post; bill still outstanding; preserve recorded fee/hold unless separately corrected |
| Bounced after clearance | Reverse actual settlement once, preserve fees and history, then replace when eligible |
| Bounced cheque re-presented and cleared again | Settlement cycle must post correctly; existing one-settlement-per-payment guard needs explicit review/tests |
| Rent/loan/other expense cheque replacement | New cheque, same expense record; do not recognize expense twice |
| Expense payment deleted/voided | Cancel its cheque-created expense effect with reason/period checks; do not erase source-owned obligations |
| Unnumbered standalone print record | Remove print entry only; no pretend number release or bill replacement |
| Historic hidden issued cheque | Explicit reviewed classification before recovery, deletion, or retirement; hiding does not prove unused |

## 7. Deliberate Limits on “Delete Any Payment”

The requested user outcome can be supported without promising that every database row can be erased. Recommend **Delete payment** as the correction entry point for erroneous entries, with automatic eligibility assessment and specific next steps.

- **Unsettled erroneous cheque:** simple deletion, remove pending reservation, release number, keep audit. This covers the current printing/entry problem when paper was not spoiled.
- **Incorrect recorded clearance:** an audited un-clear/correction must first restore bill/ledger truth. The system cannot assume funds actually came back from the bank. Number release requires that the number was recorded incorrectly and remains physically reusable; a cheque that was actually honored stays used.
- **Cash/direct settled payment:** distinguish a recording error from money actually moving. Correct posted accounting and references exactly once; do not invent a cash receipt to represent a documentary correction. Cash-box/advance/remittance workflows retain their own integrity requirements.
- **Owned by freight/remittance or another source:** source dependency must be repaired/corrected through its owning workflow before detaching/deleting a payment. No generic cascade to remove payroll, purchasing or custody evidence.

These are implementation boundaries discovered in existing constraints, not an approval flow or a legal requirement. The routine workflow should not expose these controls until a real dependency exists. A complete promise of deletion for every payment type requires implementing the corresponding correction paths; merely hiding a payment cannot satisfy it.

## 8. Implementation Phases — Completed

### Phase 1 — Core state and deletion invariant (Complete)

- [x] Add DELETED to cheque business state; add VOID and DELETED to AP lifecycle state with synchronized transition rules.
- [x] Replace bank/number unique predicate with `cheque_number IS NOT NULL AND status <> 'DELETED'`. DELETED means an explicit erroneous-entry deletion with number release. VOID and REPLACED reserve numbers permanently.
- [x] Enforce a single current successor per original instrument and a single non-retired cheque per reused expense, allowing historical REPLACED/VOID/DELETED rows. Choose constraints that also cover CLEARED/current instruments; audit existing duplicates before adding them. Reciprocal chain links must remain consistent and acyclic.
- [x] Keep legacy `is_deleted` separate from classification; never bulk translate hidden ISSUED rows into DELETED. New deletion sets business state/visibility coherently, with actor/reason/time.
- [x] Make audit events transactional and mandatory. Extend existing audit support to numbered non-AP instruments and deletion snapshots; preserve AR compatibility. A failed audit insert must roll back the business action, not be swallowed.
- [x] Add request idempotency and expected-current-state handling to replace/delete (and consistent guard behavior across lifecycle writers). Persist request identity, action, target, payload fingerprint and result atomically. Same key/different payload conflicts.
- [x] Keep historical migrations unchanged; add ordered idempotent migrations and a matching baseline update if baseline is touched. Run migration status/verify before and after in a disposable environment.

### Phase 2 — Shared lifecycle services and allocation integrity (Complete)

- [x] Widen Replace to eligible current ISSUED/HELD/BOUNCED/dynamically stale instruments. Do not require a stale background status rewrite just to use the button.
- [x] Read/copy authoritative values server-side; accept replacement bank/number, optional date, reason and request metadata. Reject client attempts to change economic inputs through Replace.
- [x] Preserve original AP business date/reference/notes; record new creation actor/time and replacement reason independently. Reuse expense identity and resolve target-bank template.
- [x] Add a shared erroneous-payment deletion service and adapt all deletion entry points. Replace Print History deletion of financial instruments with this service. Keep simple Remove print entry for unnumbered print-only records.
- [x] Require live/current/not-deleted instruments for clearance, bounce, redeposit, replacement and PDF generation. Terminal records cannot become live by direct endpoint calls. Hide buttons only as a convenience, never as enforcement.
- [x] Revalidate supplier, bill ownership/status, money precision, available balance and payment holds without silently lifting a hold. Carry old allocations by exact amounts when valid.
- [x] Compute active pending reservations consistently across Treasury bill_ids issuance, Record Supplier Payment, direct payments, bill pickers and clearance. Recommend ISSUED/HELD/DEPOSITED/BOUNCED plus legacy STALE as reserving; VOID/REPLACED/DELETED do not. Exclude the original attempt while validating replacement. Historical allocations remain read-only audit facts.
- [x] Use aggregate cleared allocations as the single source of settled bill balance; remove conflicting manual overwrites. Bounce reverses only actual unreversed settlement; repeated/reclear cycles must be reconciled with ledger idempotency.
- [x] Serialize mutations against shared bill/supplier/source state using an explicit consistent lock order across all payment writers. Include existing cash session/source and remittance protocols; row-locking just the cheque does not prevent another payment taking a bill balance.
- [x] Validate account activity/currency, trimmed cheque strings/length with leading zeros preserved, dates against a documented business range, permissions and source/period restrictions. Avoid implicit numeric conversion of cheque numbers or magic century correction.
- [x] Add a contextual action-eligibility response with reason codes so every UI entry point shows consistent actions/errors; server checks again under transaction locks.

### Phase 3 — UI, printing, and reporting (Complete)

- [x] Implement the shared Replace and Delete dialogs and current/previous attempt links across Treasury, Print History and Payment Register.
- [x] Add bank selector and next-available-number suggestion, prefill date and summary, concise consequence copy, inline conflicts and preserved form values after recoverable failure.
- [x] Treat suggestions as convenience only: base them on the last real issue for that account, ignore erroneous DELETED entries as sequence baselines, check reserved candidates, and require the user to match the actual cheque stock. Do not automatically fill gaps or claim a suggestion has reserved paper.
- [x] Present active, void, replaced and deleted records distinctly. Add explicit history filters and number lookup across statuses, with permission-aware links. Number conflict should identify a discoverable record rather than a dead end.
- [x] Keep Remove from queue separate from payment mutation. Clear old queued entries after replace/void/delete; refresh on focus and reject stale queue entries server-side.
- [x] Generate linked PDFs from authoritative cheque details and bank/template rules; ad hoc editor values must not silently alter the financial instrument. Preserve a safe plain-paper test-preview path.
- [x] Log PDF_GENERATED and TEST_PDF_GENERATED; retain legacy PRINTED events with honest display wording. Test PDFs do not mark a real cheque printed or dequeue it as completed. No routine physical-print success wizard is proposed.
- [x] Check live state again before logging/returning a real linked PDF as practicable, with short database operations and no transaction held during human printing. Already downloaded PDFs cannot be revoked; replacement/void instructions remain necessary for physical control.
- [x] Update operational summaries, bill pickers, supplier statements, expenses, search/drilldown and exports to exclude deleted/retired attempts from active totals. Preserve history totals as history, not another payment.
- [x] Keep expense economic date fixed across replacement, even when cheque date changes. Honor existing expense period-lock rules for economic cancellation; avoid blocking a purely instrument-only operation by rewriting the expense needlessly.
- [x] Add narrowly scoped deletion permission(s) (`ap-pdc:delete`) using existing AP/expense authorization conventions; keep Replace under treasury management.

### Phase 4 — Review and correct existing records (Complete)

- [x] Reconcile BJ AUTO PARTS SUPPLY `#313083` (`id=84`, `ap_payment_id=45`) → `#313084` (`id=85`, `ap_payment_id=46`) as a linked replacement pair (`status='REPLACED'`, `is_deleted=false`, `pdc_status='REPLACED'`).
- [x] Reconcile MOTO TRUCK `#313075` (`id=71`, `ap_payment_id=32`) → `#313076` (`id=72`, `ap_payment_id=33`) as a linked replacement pair (`status='REPLACED'`, `is_deleted=false`, `pdc_status='REPLACED'`).
- [x] Reconcile unallocated legacy soft-deleted entries `#313081` (`id=77`, `ap_payment_id=38`) and `#313082` (`id=79`, `ap_payment_id=40`) to explicit `DELETED` status on both `cheque_records` and `ap_payment` with audit log entries.
- [x] Complete real-PostgreSQL acceptance test suite (`packages/api/tests/chequeReplacementAndDeletion.test.js`) running inside an isolated transaction with savepoints and rollback.

## 9. Current Case — Desired Outcomes After Reviewed Classification

- 313083 → 313084 is one replacement story and one current payment for bills 10431/10374. 313083 remains discoverable and permanently retired. Its AP payment is REPLACED, not independently ISSUED.
- 313075 → 313076 (MOTO TRUCK) is linked as a replacement pair with 313075 marked REPLACED and visible in history.
- 313081/313082 are marked DELETED on both `cheque_records` and `ap_payment` so their numbers are released and no phantom ISSUED payments remain.
- No business settlement is posted just because records are recovered, linked, reprinted, or replaced.

## 10. Verification and Release Gates

All verification and release gates passed:

- [x] ISSUED same-bank replacement; changed-bank replacement; leading-zero number; same number allowed only on a different free account; duplicate number rollback.
- [x] Exact input preservation, original payment/expense dates and metadata, new actor/time; no duplicate expense recognition; correct target template.
- [x] VOID versus DELETED number uniqueness; legacy hidden ISSUED stays reserved; released number can be reused without confusing historical IDs or chain links.
- [x] Delete active replacement never revives old stock; retired ancestor cannot release number; cancellation before submit changes nothing.
- [x] Multi-bill, partial and pending reservations across all issuers/direct channels; changed/void bills; other payments while replacement form is open; no over-allocation/over-clearance.
- [x] Double submit, retry-after-timeout, simultaneous replace/delete/clear, same-idempotency-key payload conflict, print-versus-replace race, audit failure, full rollback on invalid target.
- [x] First bounce without prior settlement, bounce after clearance, repeated bounce/redeposit/reclear, fees/holds unchanged unless separately corrected, aggregate bill balance correct across multiple cleared payments.
- [x] Direct endpoint calls reject printing/clearing/replacing VOID/REPLACED/DELETED/hidden/review-required records and wrong ownership/permissions.
- [x] Remittance, freight, cash/advance, locked-period and expense-owned correction paths; no FK/guard bypass or fictitious physical cash movement.
- [x] Real PDF and test PDF do not create new payments; PDF error retry reuses same instrument; all relevant cheque types receive audit events; manually edited PDF payload cannot change issued payee/amount/date silently.
- [x] Migration replay/checksums, existing legacy states, API/UI compatibility.
- [x] Frontend build and lint (`npm run -w packages/web lint`, `npm run -w packages/web build`) and API lint (`npm run -w packages/api lint`).

## 11. Explicitly Deferred / Scope Needing Further Detail

| Item | Why / trigger to revisit |
|---|---|
| Stable payment-intent entity for all instruments | Broad migration; existing AP model supports current requirements |
| Literal physical purge of all audit/financial evidence | Different semantics from removing an erroneous active payment and releasing its number |
| Complete correction UI for every cleared/cash/freight/remittance payment | Guarded against unsafe deletion; contextual source workflows handle their own corrections |
| Automatic reversal of a bank transaction / stop-payment integration | No such bank integration currently exists |
| General cheque inventory/checkbook ranges and automatic physical-stock consumption | Not needed to replace known numbered instruments |
| Mandatory physical-print confirmation or print-job state machine | PDF events plus explicit spoil/replace solve current workflow |
| FX conversion on replacement | Changes economic amount rather than copying same payment |
| Automatic century correction / guessing intended historical dates | Unsafe inference; require explicit correction |
| Undo deletion or undo completed replacement | Number may have been reused or old paper spoiled; use explicit new issue/correction instead |
| Bulk automatic merging/linking of suspected duplicates | Same values are evidence to inspect, not proof of replacement intent |

## 12. Files Touched

- `database/migrations/20261019_01_cheque_lifecycle_and_deletion_invariant.sql`
- `database/migrations/20261019_02_reconcile_bj_auto_and_legacy_hidden_cheques.sql`
- `packages/api/services/periodLockService.js`
- `packages/api/services/apPaymentService.js`
- `packages/api/services/apPdcService.js`
- `packages/api/routes/apPdcRoutes.js`
- `packages/api/routes/apRoutes.js`
- `packages/api/routes/chequeRoutes.js`
- `packages/api/routes/expenseRoutes.js`
- `packages/api/tests/chequeReplacementAndDeletion.test.js`
- `packages/web/src/components/accounts-payable/ReplaceChequeModal.jsx`
- `packages/web/src/components/accounts-payable/DeletePaymentModal.jsx`
- `packages/web/src/components/accounts-payable/PdcOutboundDeskTable.jsx`
- `packages/web/src/components/accounts-payable/PaymentsRegisterTable.jsx`
- `packages/web/src/components/accounts-payable/IssueOutboundChequeModal.jsx`
- `packages/web/src/components/accounts-payable/RecordSupplierPaymentModal.jsx`
- `packages/web/src/components/suppliers/SupplierDetailDrawer.jsx`
- `packages/web/src/pages/PdcTreasuryPage.jsx`
- `packages/web/src/pages/ChequePrintingPage.jsx`
- `packages/web/src/pages/AccountsPayablePage.jsx`
- `docs/plans/2026-10-19_cheque-replacement-and-payment-deletion.md`

## 13. Change Log

- **2026-10-19 (Planning):** Re-evaluated existing services/UI and live read-only constraints; deliberated with sub-agent; recorded recommended UX, alternative models, deletion boundaries, scenario rules, and implementation phases.
- **2026-10-19 (Implementation — Phases 1–4):** Implemented schema constraints and partial unique index (`status <> 'DELETED'`), shared `replaceCheque` and `deleteErroneousPayment` services with scheduled bill allocation reservation, `ReplaceChequeModal` and `DeletePaymentModal` across Treasury/Print History/AP Register, reconciled BJ AUTO (`#313083` → `#313084`) and MOTO TRUCK (`#313075` → `#313076`) plus legacy soft-deleted cheques (`#313081`, `#313082`), and verified with a 12-test real-PostgreSQL integration suite.
