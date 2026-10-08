# Cash Box — Visual Polish and UX Redesign

> Forson Business Suite | 2026-10-08 | Inspected branch: `cash-count-module`
> **Design only.** Application changes, migrations, deployment and production feature flags are outside this task.

## 0. Status at a Glance

| Phase | Status | Evidence / remaining work |
|---|---|---|
| Current UI and workflow audit | Source reviewed | CashDrawerPage, app theme/shell, Expenses/A/P, shared UI primitives and selected route contracts inspected via project MCP |
| Usability research | Completed | W3C consistent identification/financial error prevention; NN/g progressive disclosure |
| Final design | Specified below | Register-first neutral workspace; no permanent entry rail |
| Disposable previews | Local-only, separately verified | Not prerequisites for implementation; all essential behavior is in this document |
| Implementation and live acceptance | Not started by this session | Coding-agent work, connected browser verification and physical store acceptance required |

MCP status showed `cash-count-module...origin/cash-count-module`; initial diff was empty. Source inspection is not a screenshot review of the served app, and prior plan test results were not rerun here. Remote plan publication creates a repository file, not a Git commit.

## 1. For a New Session or Coding Agent

Reinspect HEAD, repository instructions, Git status and Graphify mapping before editing. Read the existing cash-drawer reconciliation, UI-design and cash-box-fixes plans in this directory; their financial contracts remain authoritative. Recall Hindsight cash-drawer context, then verify against source. Preserve unrelated changes.

This document supersedes the earlier **permanent desktop cash-entry rail**, not the monetary rules. Implement a frontend presentation/workflow refinement. No schema migration, new API, permission, router, state library, UI/icon library or offline financial queue is required. If existing data cannot serve a requirement, record the exact gap rather than inventing fields or bypassing server checks. Leave production data/rollout flags unchanged.

## 2. Business Objective, User Stories and Current Findings

Objective: professional, consistent cash control with fast scanning, less form clutter and fewer avoidable entry mistakes.

- Cashier sees expected cash and last count age/cutoff without confusing an old count with live cash.
- Authorized operator records a receipt/release in a focused task and returns to unchanged register context.
- Counter enters quantities/subtotals rapidly against the server-preserved cutoff.
- Manager finds independent reviews and distinguishes requester/operator/reviewer/recipient.
- Viewer inspects History without opening a financial session.

Verified design issues in `packages/web/src/pages/CashDrawerPage.jsx` baseline:
- Lines 13–14 hardcode amber action/focus styles despite app configurable primary/accent tokens.
- Lines 582–611 scatter header/session/cutoff context and give refresh/cash/count/close actions competing filled styles.
- Lines 650–676 expose all filters, raw operator ID and pagination together.
- Lines 677–690 squeeze a minimum-760px register into a 2:1 rail layout with a permanently visible cash-entry form.
- Lines 692–711 render a movement-detail surface before an entry is selected.
- Lines 713–736 show counts, reviews and custody as technical sentence blocks and multiple permanent forms.
- Lines 738–771 append closing/history detail below ordinary page content; cancellation uses browser prompts.
- Reload lines 205–253 clears operational data while requests run, and broad error gates can hide major page content.

These are static findings, not executed visual/accessibility defects. Line positions may change. Shared operation remains intentional: coordinator is not exclusive operator and is not automatically responsible for every shortage.

## 3. Final Visual System

Match the existing FBS finance UI, not an imported aesthetic:
- Inherited Manrope UI face; JetBrains Mono only for codes. Tabular UI numerals for currency.
- Existing slate-50 / dark slate-950 shell and outer padding; no double-padding or shell redesign.
- Neutral shared `KPICard` surfaces, rounded-xl, subtle borders and `shadow-card`; its current dark surface is slate-800. Cash panels follow the same shared surface convention.
- Pass preformatted exact two-decimal PHP strings into KPICard: its numeric formatter abbreviates large values, which is unacceptable for reconciliation.
- Page title 24–30px according to existing finance hierarchy; section headings 16–18px, regular content 14px, metadata 12px. Critical cash figures never tiny.
- Major section gaps 24px, card gaps 16px, panel padding about 20px, related control gaps 8–12px; existing utilities only.
- Primary theme tokens for main CTA, selected tabs and focus. Warning tokens only for actual pause/staleness/review warnings; danger for shortage/errors. Surplus is **Over**, not automatically green success. Always include text/sign, not color alone.
- One filled primary per task. Neutral outlined secondary actions. Existing Icon/ICONS only. No charts, hero banners, gradients, external font/CDN or hover-lifting noninteractive cards.
- 44px action targets, visible focus, accessible labels and meaningful disabled reasons.

Verified shared primitives: KPICard, SegmentedTabs, PaginationControls, Drawer, Modal. Reuse conventions without assuming full accessibility: current SegmentedTabs lacks tab roles/arrow behavior; Modal lacks a focus trap; inspected Drawer does not establish full trap/restore and needs dark overrides. Prefer the already-used Headless UI Dialog for cash overlays unless shared primitives receive backward-compatible, regression-tested improvements. Preserve Cash Box's existing keyboard tab behavior; no global rewrite.

## 4. Final Information Architecture

```text
Cash Box                         [Main Counter v] [Refresh] [Count Cash]
Physical cash movements and reconciliation
Business date · Session code · Coordinator · Open       Updated time

[Expected cash] [Latest count/time] [Over/short at cutoff] [Cash out]
Opening · Cash in · Cash out — opening float is separate from receipts

[Cash In] [Cash Out] [Transfer]                      [Close Cash Box]
[conditional attention links: stale count / reviews / custody]

Today | Counts & Reviews | Handover & Advances | History

Movement register
[Search reference/purpose/operator] [All directions v] [Filters (n)]
[applied filter chips / Clear] [advanced region on demand]
Recorded/seq | Type/purpose/reference | Cash In | Cash Out | Balance | Operator | View
...
Showing range / total                                  [Previous] [Next]
```

Full-width register; **no permanent rail or cash-entry/detail form**. Latest-count card carries timestamp/cutoff; do not duplicate it in another large card. Zero/empty attention indicators omitted. Hardware details move into drawer information, not an advertising banner for hypothetical electronic support.

State-dependent primary:
- OPEN and authorized/valid: Count Cash.
- No open session: Open Cash Box if authorized; no fabricated zero metrics. History remains available.
- CLOSING: Continue Closing for authorized closer; required final count in focused workflow for permitted counter.
- Active count: expose Resume only to the server-authorized counter. Other users see actor/pause, not a submit-capable draft.
- Missing permission hides actions; lifecycle/busy/unknown-result unavailability disables permitted actions with visible explanation.

Metrics are server session.expected, latest_count.counted, latest_count.variance at that count cutoff, session.total_out. No count means Not counted, never Balanced/zero variance. Later sequence warns `Cash moved since this count — recount to verify current cash`; old variance stays unchanged. Refresh time is not count time. Opening is excluded from cash-in totals. Coordinator and active signed-in actor remain distinct.

## 5. Register, Filters and Detail

Preserve posting-sequence order and server balance_after. Filtering never recalculates balances from visible rows. Label Balance with help explaining it is after the posted entry and filtered rows may omit intervening entries.

Group friendly category/purpose/human reference; show restrained Automatic/Manual/Reversal and Late-entry badges. Full occurrence/recording timestamps, raw source keys, reversals and counterparty go in detail. Cash In/Out remain separate right-aligned exact PHP columns; absent side uses dash. Operator stays visible; amounts never truncated. Real keyboard-accessible View button, optional row-click supplementary.

Detail sheet 480–640px desktop / full-screen mobile: amount, direction, balance after, purpose/category, human/source reference, operator, counterparty, occurrence/recorded time, reason/reversal and existing source links. Source permission and return-state behavior unchanged. Dismiss restores selected row focus/context.

Toolbar initially search/direction/Filters. Advanced category/source/named operator/time basis/from/to behind Filters. Use existing employee names but submit current operator ID parameter; preserve an explicit ID fallback for inactive historical operator absent from active options. Apply/Clear stage advanced edits; search debounce about 300ms and Enter immediate. Applied chips/badge remain when collapsed. Reset paging on applied changes; no unrelated full-page refetch per keystroke.

Footer paging follows PaginationControls with 50 register / 25 history defaults, server cap 100. Do not expose page-size changes unless fully wired/restored. Opening is context, not a fabricated extra movement.

Display-only label examples: NOTEBOOK_RECEIPT → Notebook receipt; OWNER_DRAW → Owner withdrawal; AR_RECEIPT → Customer collection; SUPPLIER_PAYMENT → Supplier payment; MIDDAY → Checkpoint count; CLOSING → Final count; DEPOSITED → Deposit confirmed; CONSUMPTION → Apply to expense/payment. API values unchanged; unknown values retain readable fallback plus original code in detail.

## 6. Workflow Specifications

### 6.1 Cash In/Out and opening

Same focused task on desktop/mobile: side sheet/full-screen, visible labels, sticky footer, inline validation and safe local-draft dismissal. No scrolling to permanent desktop form.

Keep existing supported manual categories. Expense/AP selections navigate the owning workflow, never create generic duplicate cash-out. Verify existing return/prefill contracts before adding context fields. Preserve amount/payer/recipient/purpose/reference/occurrence/reason/actor and expected-after preview. Notebook helper explicitly explains prior physical receipt and later source coverage. Independent release review remains real server authorization; preview/confirmation cannot replace it. Unknown posting result is not an unposted draft and cannot be dismissed/recreated.

Opening is explicit Open Cash Box choice. Group date/coordinator, sources/prior retained, physical count, reconciliation and confirmation. Preserve zero float, source-count equality, bridge-review and draft rules.

### 6.2 Count Cash

Aligned Denomination | Quantity | Subtotal rows. Retain all 13 current PHP values: 1000, 500, 200, 100, 50, 20, 10, 5, 1, .25, .10, .05, .01. No hidden uncommon coins or unsupported note/coin subtype. Blank zero; nonnegative whole quantities; denomination-specific accessible labels; Tab/Enter advance without submitting.

Short pre-count introduction explains cash pause; explicit Start Count calls real endpoint. Active view prominently shows pause, authorized counter, cutoff/version, expected at cutoff and expiry. Sticky counted/expected/signed variance summary; browser amounts previews, server final. Save Count and Resume vs Submit Final Count. Cancel Count uses reason dialog and actual cancellation; closing UI is not cash resumption. Expired/mismatched draft blocks submit and does not silently create another count or discard request identity.

### 6.3 Counts & Reviews

Keep saved internal Counts tab key; new visible label Counts & Reviews. Counts table/cards and detail show type/time/counter where available/expected/counted/variance/status/cutoff/denominations/notes. Submitted counts immutable; recount creates new record.

Separate review queue with type/amount/requester/reason/status/reviewer where available. Only independent permitted reviewer decides. Created review ID is Pending, never Approved automatically. Replace ID typing as default with status and verified eligible selection from existing approvals response: action/session/requester/amount/version/count bindings. Changing bound input invalidates local selection. Retain labeled advanced ID fallback where response/consumption fields cannot establish eligibility; backend final authority. No new lookup API implicitly included.

### 6.4 Handover & Advances

Nested Pending/Completed/All control, transfer and advance table/card lists, contextual New Transfer/New Advance, detail/timeline and permitted actions. No permanent event form per row; request review and release live in the same focused task.

Acknowledge, deposit/return and outstanding amounts distinct. Partial deposit not Completed merely because a deposit event exists; never add acknowledgment + deposit as two receipts. Advance application no second outflow; reimbursement separate with payer proof/review; settled advance read-only. No fictitious aggregate across unlike obligations.

### 6.5 Closing

Close Cash Box first opens explanation/review; explicit Start Closing changes state and pauses postings. Focused large workspace with read-only session context and five steps: Verify sources → Final count → Variance review → Handover & retain → Review & confirm.

One primary Next/Submit, neutral Back, separate reason-required Cancel Closing. No duplicate final-count/cancel rail actions. Pending approval visible. Recipient authentication/evidence separated from actual/ledger retained amounts; password/token never persisted in retry drafts. Changed bindings invalidate eligibility. Final review shows count/expected/variance/removal/retained cash; Confirm Close uses existing approved server state. Committed result only triggers success/export/history.

### 6.6 History

Accessible without OPEN session and independently of failed current-session operational reads. List date/session/coordinator/state/opening/expected/View and closed PDF/CSV. Closing figures only if actual response includes snapshot; no per-row detail fetching to manufacture columns.

Read-only detail workspace with Summary/Movements/Counts/Activity/Later custody. Preserve list filters/page/return focus. Activity named employee/action/date filters; authentic audit records, not fabricated events. Immutable closing numbers distinct from subsequent custody/addenda. Existing export security unchanged.

## 7. API, Schema, Security and Performance Contract

No migrations, tables, endpoints, new permissions, workers or search-index changes. Current schema and posting services remain authoritative. Verified frontend consumes these existing `/api` contracts:

- GET `/cash-drawers`, `/cash-drawers/employees`, `/cash-drawers/custodians`: existing `{data}` choices; custodians opening-gated.
- GET `/cash-drawers/sessions`: drawer_id/page/limit/from/to/status/custodian_id, `{data,page,limit,total}`.
- GET session detail `/cash-drawers/sessions/:id`: existing `{data}` expected/totals/latest count/version/sequence/window/close snapshot.
- GET session `/movements`: page/limit/search/direction/category/source/operator/time_field/from/to, existing data/total and server balances.
- GET session `/counts`, `/custody`, `/approvals`; inspect exact response fields before eligibility or summaries.
- GET session `/activity`: employee_id/action/from/to/page/limit, `{data,page,limit,total}`.
- POST drawer `/:id/sessions`: current business_date/custodian_id/opening_lines/opening_sources/prior_session_id/approval_id/reason.
- POST session `/movements`, `/transfers`, `/advances`: existing validated payloads/version/bound approval.
- POST session `/counts/start`; count `/submit` and `/cancel`: existing kind/version, lines/notes, cancellation reason.
- POST `/cash-drawers/approvals`, approval `/decision`, transfer/advance `/events`: current bindings/stages/evidence/review rules.
- POST session `/start-closing`, `/cancel-closing`, `/handover-ack`, `/close`: existing version/count/review/acknowledgment/close contract.
- GET `/cash-drawers/requests/:id`: actor-bound reconciliation; session `/report?format=pdf|csv`: current blobs.

These are observed source consumption, not fresh live API/schema certification. Permission keys verified in UI: cash_drawer:view/open/count/close/move/transfer/review/settle_advance, plus owning workflow permissions. Backend feature gate/auth/object scope decisive. Preserve server actor identity, independent review, secure request keys/payload binding, pause/expiry/version guards, immutable counts/reports, notebook/source duplicate prevention and secret-free retries. No custodian-exclusive access added.

Targets: immediate busy/loading feedback, responsive count typing, one search request per debounce window, bounded pages, no per-row detail requests/unrelated subsection reload for local selection. Measure representative development filter/register server 95th-percentile latency target <=500ms excluding debounce; target, not observed result.

## 8. Responsive, Accessibility and Error States

Desktop >=1024: full-width table/4 cards. Tablet 768–1023: 2-column cards, wrapped actions, table only if content region fits. Mobile <768: 2-column metrics if readable else 1, movement cards, full-screen sheets and safe-area/keyboard-aware footer. Sticky Count only when permitted/valid; do not obscure content or duplicate tab stops. Confine any table/tab horizontal scroll to that region.

Accessible tabs: roles, selected state, arrow/Home/End, roving focus and linked panels. Dialog traps/restores focus; Escape/backdrop cannot bypass financial cancellation. 44px hit targets, text/sign states, AA contrast, 200% zoom, reduced motion and long names/amounts.

Initial loading skeletons; same-session refresh keeps last known values visibly Updating/Stale. Clear immediately on drawer/account change and ignore old responses. Per-section loading/empty/filter-empty/error/403/503; failed reads are not empty/zero. Critical uncertainty blocks writes, but successful independent History remains readable.

Unknown write has persistent `Result not confirmed — check the original request before recording again` and existing exact retry/reconciliation, not dismissible replacement key. No offline financial posting. Inline task/field errors; toast alone insufficient for failure. Server-confirmed success only.

## 9. Execution Phases and Acceptance

All implementation phases **not started**:
A. Theme/hierarchy: primary tokens, shared precise KPI/panel/tab styling, structured context and one main action.
B. Register/tasks: full-width register/cards, advanced filters/chips/named operator/footer paging, focused entry/detail/reason dialogs, return-state and pending identity preserved.
C. Counts/custody/close/history: aligned denominations, distinct review queue, contextual custody actions, five-step focused close and independent history workspace.
D. Verification/handoff: actual commands, connected screenshots and acceptance results recorded.

Required checks:
- Exact PHP, no abbreviated balances; no count never Balanced.
- Later cash movement does not change old cutoff variance; count freshness warning appears.
- Cash form dismissal without posting creates no movement; unknown-result dismissal never starts replacement write.
- Filter chips/state survive collapse, paging, source round-trip/detail return; failed reads never empty success.
- Pending approval not Approved by UI; binding changes invalidate eligibility; independent review preserved.
- Count pause/expiry/other counter/version and unknown-result guards intact.
- History available on first use and no open session, without fictitious financial records.
- Close pause/count/review/acknowledgment/replay correct; no stored secrets.
- Multiple authorized operators retain authentic attribution distinct from coordinator.
- Partial custody stages/advance consumption/reimbursement do not double-post or falsely complete.
- 390/768/1024/1440px with sidebar, light/dark, alternate brand, long names/large balances, 200% zoom, keyboard and software keyboard; no page-wide overflow.

Run web lint/tests/build and focused browser suite; update assertions by accessible role/label without weakening financial checks. Standalone cash-drawer real-PostgreSQL regressions use an explicitly disposable DB, never store data. Separate mocked browser, real DB and authenticated live results. Update status/docs and run `graphify update .` on actual repo after implementation. No production rollout without owner-approved release gates.

## 10. Files, Limits, Deferred Items and Research

Inspected: CashDrawerPage, CashSessionBar, MainLayout, index.css, ExpensesPage, AccountsPayablePage, KPICard, SegmentedTabs, PaginationControls, Drawer, Modal, selected cashDrawerRoutes ranges and existing plans. Some searches/guessed paths failed; no exhaustive absence claims.

Proposed work: CashDrawerPage and focused cashDrawer components/tests; reuse shared UI, backward-compatible accessibility changes only where needed. CashSessionBar normal-state brand alignment is optional adjacent scope; warnings stay semantic and payment-selection behavior unchanged. This session changed only design documentation and local throwaway previews. No app source/migration/dev-server test/deployment. Remote Graphify update not run: available Graphify tools read/query only.

Deferred: new approval/source picker APIs, fifth live Activity tab, custody periods/account-switch redesign, hardware/new denominations, charts, native mobile, offline posting, coordinated financial correction and rollout.

Research:
- W3C WCAG 2.2 Consistent Identification 3.2.4 — recognizable repeated functionality; visual conventions come from FBS. https://www.p95.org/WAI/WCAG22/Understanding/consistent-identification.html
- W3C WCAG 2.2 Financial Error Prevention 3.3.4 — check/correct or review/confirm important submissions; not a fake manager approval. https://www.p95.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html
- NN/g Progressive Disclosure — defer advanced/rare controls, never conceal critical warnings. https://www.nngroup.com/articles/progressive-disclosure/

## 11. Change Log

2026-10-08 — Forson: source-grounded audit; final register-first neutral workspace specified for later coding-agent implementation. Financial controls preserved; design versus live verification explicitly separated.
