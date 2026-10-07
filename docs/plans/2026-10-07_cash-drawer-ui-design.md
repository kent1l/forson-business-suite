# Cash Drawer — Final UI Design and Developer Handoff

> **Forson Business Suite** | **Date:** 2026-10-07 (Asia/Manila) | **Branch inspected:** `cash-count-module`
> **Status (2026-10-07):** Connected React workspace is implemented and enabled in local development; web lint/build pass. The store uses a manual cash box. Electronic drawer integration is reserved for future hardware. Browser role walkthrough and store acceptance remain pending; consult the companion implementation plan for current release gates.

## 0. Status at a Glance

| Item | Status | Detail |
|---|---|---|
| Information architecture and cashier workspace | Implemented in React | §4–6; live navigation label is Cash Box |
| Current hardware | Manual cash box | Staff physically count notes and coins; no connected drawer |
| Future hardware option | Reserved | `ELECTRONIC_DRAWER` schema mode; no device integration or automatic count |
| Opening, movement, count, closing and custody | Connected API screens | §5; wider browser/role walkthrough pending |
| Local development | Enabled and migrated | Companion implementation plan §12 |
| Store-day acceptance | Pending | §7 |
| Native mobile application and charts | Deferred | §9 |

## 1. For a New Session or Agent Picking This Up

Before starting:
1. Run `graphify query "cash drawer payments expenses refunds MainLayout navigation Drawer Modal"`. Fresh code wins over old path references. A graph result for the generic UI Drawer is NOT evidence of a cash module.
2. Recall Hindsight with query `"FBS cash drawer reconciliation notebook CASH SALES funding source count cutoff"`, tags `forson-business-suite`, `cash-drawer`.
3. Confirm current branch, `git status`, `git log --oneline -20`, migration state and the companion module plan before trusting §0.
4. Read this whole document. Core behavior is transcribed here; local HTML or this chat is not a prerequisite.
5. Locate the dated `cash-drawer-reconciliation` implementation plan in this same directory for monetary invariants/schema/API. UI must not override those financial controls.

After each phase: update §0 and its checklist, retain non-obvious decisions to Hindsight, and run `graphify update .` on the actual repo host. Document runtime checks that remain unavailable.

## 2. Objective and User Stories

Replace the disconnected Google Sheets cash movement/denomination sheets with a fast cashier workspace. Staff should manually record exceptions and counts, while normal FBS physical cash payments flow in once.

- As cashier, I can see expected cash and the age/cutoff of the latest count without mistaking old physical cash for today's live balance.
- As counter, I can enter denomination quantities, save a reproducible count and recount without deleting earlier evidence.
- As manager, I can see who released/received money, review every nonzero closing variance and distinguish bank confirmation from handover.
- As a future developer, I can implement the screens without relying on local-only prototype files.

## 3. Decisions Already Taken

- The current store keeps cash in a manually counted cash box. The software term `cash_drawer` describes the custody ledger; it does not imply electronic hardware. Future electronic drawer integration remains a separate option and must never imply that physical counts are automatic.

- Recommended design is the **cashier workspace**: register-first main panel with count/custody side rail. Compact prototype is a comparison only, not a second approved production layout.
- Navigation: **Finance & Expenses -> Cash Box**, state key `cash_drawer`. Reuse FBS state-based navigation, not React Router.
- No charts or decorative analytics. Cash control is an operational task, not a profit dashboard.
- PHP physical notes/coins only. GCash/card/bank/cheques are not denomination rows or drawer receipts.
- The owner's `CASH SALES` spreadsheet row is a copied FBS expected-cash result, not an additional independent receipt. Remove that manual summary field.
- Notebook means a casual sale recorded in a notebook without a receipt. An unrepresented physical receipt needs a referenced exception and later source reconciliation, never double posting. The exception is not legal invoice issuance or inventory accounting.
- Count comparisons preserve cutoff sequence/version. A timestamp on the latest count is NOT a live cash guarantee.
- Closed financial reports are immutable; later acknowledgment/deposit/advance settlement is separate linked history.
- Ordinary Expenses/AP workflows retain ownership of those business documents. Drawer action launches them with funding context, not a duplicate generic cash-out.

## 4. Final Information Architecture

### 4.1 Header and summary

Header: page title, drawer selector (Main Counter at rollout), business date, session code, designated custodian, OPEN/CLOSING/CLOSED badge and last successful refresh time.

Four summary cards:
1. **Expected Cash** — current ledger expectation.
2. **Latest Count** — submitted physical total with count date/time.
3. **Over / Short** — variance at THAT count's cutoff, not recomputed against later movements.
4. **Cash Out** — posted releases for the selected session, excluding opening float.

Show opening, cash-in and cash-out subtotals below. Until first count, display `Not counted` and no balanced/zero-variance claim. When later transactions exist show `Movements since count: N` and `Recount to verify current cash`. A stale refresh must be visibly labeled.

### 4.2 Actions and tabs

Actions: **Cash In**, **Cash Out**, **Transfer**, primary **Count Cash**, **Close Drawer**.
Tabs: **Today**, **Counts**, **Handover & Advances**, **History**.

```
Cash Box / Main Counter          Business date / custodian / status
Expected Cash | Latest Count | Over / Short at cutoff | Cash Out
Opening / Cash In / Cash Out
Cash In / Cash Out / Transfer / COUNT CASH / Close Drawer
Today | Counts | Handover & Advances | History

Movement register                  Latest count
Search / filters                   Submitted time and cutoff
Time, type, description, reference  Recount / view count
Cash in/out, balance, employee      Outstanding handovers / advances
```

### 4.3 Movement register and detail

- Ascending posting sequence by default; 50 rows default, 100 maximum. Opening float is a pinned separate row and never added to cash-in totals twice.
- Columns: time, category/type, description, human receipt/reference, Cash In, Cash Out, Running Balance, operator. Right-align two-decimal PHP and use tabular numerals.
- Badges: Automatic, Manual, Reversal. Late-entry indicator exposes occurred-at versus recorded-at.
- Search reference/description/employee; filters category, direction, operator, source, occurred or recorded time. Do not confuse occurrence order with posting balance order.
- If sorted descending, label balance `Balance after entry` rather than implying displayed row order is the arithmetic sequence.
- Row click opens detail panel: amount/direction, source document, physical reference, counterparty/custody, authenticated employee, occurred_at, recorded_at, reason/attachment and linked corrections.
- Source navigation uses existing `onNavigate(page, pageState)`, preserving cash drawer filters on return. Permission-denied source or unavailable Paperless document gives a clear error. Permanent link uses document ID; physical number is display/search text.

## 5. Screen and Interaction Contracts

### 5.1 Opening

Fields: drawer, business date, designated custodian, denomination quantities, retained prior-session source, fresh funding sources, optional attachments. Prior actual retained amount compared with new count. Difference needs reason and manager review; inherited cash is not a new sale.
CTA: **Verify and Open Drawer**. First-cutover opening clearly identified. Zero float allowed. Opening source amounts and denomination total agree before server confirmation.

### 5.2 Cash In and Cash Out

Desktop side panel; mobile full-screen form. Category first, positive amount, payer/recipient, purpose, reference, optional supporting document, occurred-at default now. Actor read-only from authenticated session. Preview expected drawer effect.

Cash In: additional funding, returned advance, exceptional notebook receipt, other documented receipt.
Cash Out: Expense, AP settlement, Employee advance, Owner withdrawal, Other authorized release.

Expense/AP category navigates into existing owning workflow with drawer context and required existing permissions. Choosing bank/office-petty-cash/personal funding yields no Main Counter impact; do not infer funding from the word Cash. Advances, owner draws and other sensitive release require amount-bound manager authorization before release.

Notebook exception requires notebook/page reference and flag `Not yet encoded as sale`. When later encoded, select original exception BEFORE canonical payment posting. UI shows amount already covered and actual new cash remaining; no generic daily CASH SALES summary input.

### 5.3 Count Cash

Focused large dialog/full-screen mobile view. Denomination | Quantity | Subtotal. Configurable PHP values: 1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.25, 0.10, 0.05, 0.01. Optional same-value note/coin variants retain type but aggregate monetary value.

- Integer numeric input; blank is zero, negative/fractional invalid. Tab/Enter advances to next denomination.
- Sticky counted total, expected-at-cutoff, signed Over/Short text, notes and submit button.
- Paused cash-activity banner, count start/cutoff, expiry and server validity always visible. Count window is persisted state, not a SQL transaction held while a human counts.
- Midday CTA **Save Count and Resume**; closing CTA **Submit Final Count**.
- Recounts create a new record. No overwrite of earlier submitted count.
- Cancel resumes where appropriate only after server cancellation; interrupted/expired draft says `Count no longer valid`. Restored local draft revalidates server window/version.
- Input totals are previews; committed server decimal calculation is authoritative.

### 5.4 Closing wizard

1. **Pause** cash activity and verify source completeness. If card terminal activity occurred, separate batch-settlement checklist with evidence/reference or documented authorized exception.
2. **Final count**, including optional recount with original retained.
3. **Variance review**. Every nonzero final variance requires reason and independent manager approval; approval bound to count/version/amounts. Reason alone does not authorize closure. Unresolved discrepancy can close after documented review but must remain visible.
4. **Handover and retain**. Amount, destination, recipient acknowledgment. Show actual retained and ledger retained separately. Transfer cannot exceed physical counted availability.
5. **Review and Confirm Close**. Expected/count before final removals, variance, final handovers, retained actual/ledger, custodian/reviewer and notes. Print/export only after committed result.

Routine writes remain blocked in CLOSING. Final handover operations follow module closing transaction contract. Changed counts invalidate prior approval. Cancel closing requires reason, server transition and fresh final count/approval later.

Do not simulate a real manager approval with a client-only checkbox in production. The prototype's simulation is labeled as demo only.

### 5.5 Handover & Advances

Pending/completed filters; type, original release, confirmed/returned/remaining amount, responsible person, age, reference/evidence. Actions: acknowledge receipt, confirm bank deposit, return cash to an OPEN receiving session, attach consumption documents, settle advance.

Release and acknowledgment/deposit are different custody stages. Acknowledgment does not post drawer cash again; bank confirmation does not change closed drawer records. Partial stages validate independently, never sum acknowledgment and deposit as two receipts. Advance expense consumption does not release money again.

### 5.6 Counts and History

Counts: list type, counter, submission, cutoff, expected, counted, variance, validity and reviewer decision. Drill into original denominations and recount chain.
History: date/session code/custodian, opening, receipts/releases, expected/count, variance, retained and state. Closed detail read-only with linked addenda and later custody events. Printable/PDF daily report and CSV; footer session/revision/generated time; protect exported CSV from formula injection.

## 6. Production Work — Implemented, Verification Pending

- [x] Add `packages/web/src/pages/CashDrawerPage.jsx` and focused `packages/web/src/components/cashDrawer/` components for opening, movement detail, count, closing, handover and advance flows.
- [x] Register `cash_drawer` in `packages/web/src/components/layout/MainLayout.jsx` and `packages/web/src/config/navigation.js`; Sidebar/CommandPalette consume navigation registry.
- [x] Reuse API client, AuthContext, FBS theme tokens and existing UI Modal/Drawer/Tabs/Pagination primitives where suitable. Confirm their current props with fresh graph/source reads.
- [x] Integrate server summary, pagination, count window, approval, lifecycle and idempotent write APIs from companion module plan.
- [x] Enforce backend permissions and object scope; frontend visibility is not security.
- [ ] Restore drafts through existing draft conventions only after confirming APIs. Do not add a new state library/router.
- [ ] Preserve UI filters and handle navigation back to source records.
- [x] Ensure existing Sales History cash estimate is not used as canonical expected physical drawer balance.

### Responsive, accessibility and failure states

Desktop >=1024px: register/right rail. Tablet 768–1023px: stacked rail. Mobile <768px: summary two columns, movement cards instead of page-wide table, full-screen forms and sticky Count Cash action.

Use existing primary/slate/light/dark tokens; two-decimal PHP. Minimum 44px targets; visible labels and focus; trap/restore focus; keyboard/Escape behavior with safe cancellation; AA contrast; Over/Short text not color alone.

Required states: no open session, opening draft, OPEN, count pause, CLOSING, pending approval, stale count, CLOSED, loading/empty/filter-empty, forbidden source, stale/offline data, unavailable document, known write failure and unknown network result. Keep last known data visibly stale. Local count drafts may persist offline, but no financial posting/approval/close until server confirmation. Retry unknown writes with same idempotency key.

## 7. Acceptance — Live FBS Still Pending

- [ ] Only assigned/authorized users open/count/move/close or review/correct.
- [ ] Opening float counted once; zero opening and prior-custody mismatch handled.
- [ ] Actual FBS cash receipts/refunds appear once with clickable sources; noncash absent.
- [ ] Latest count variance stays tied to cutoff after more activity.
- [ ] Concurrent payment cannot bypass count/closing pause; stale count/approval blocked.
- [ ] Bank/office expenses have zero drawer effect; advance consumption has no second outflow.
- [ ] Original count/recounts and audit timestamps survive closure/corrections.
- [ ] Nonzero closing variance requires independent review and remains on report.
- [ ] Named recipient acknowledges final custody; bank deposit may remain pending separately.
- [ ] Desktop/tablet/mobile, light/dark, keyboard/touch, real network errors and permissions validated.
- [ ] Manager approves one full operating-day pilot; no duplicate Sheets entry after cutover.

## 8. Verified Local Prototype Work and Limits

Local-only files created on the agent host:
- `/opt/data/output/cash-drawer/cash-drawer-ui.html` — recommended workspace.
- `/opt/data/output/cash-drawer/cash-drawer-compact.html` — dense comparison.
- Corresponding `.README.md` files, `verify.py`, `verification-results.json` and screenshots.

These assets have NOT been uploaded into this project repository by this docs-only handoff. All balances, operators, references and dates are illustrative. Production UI requirements above take priority over incomplete prototype controls.

Recorded verification command on agent host:
```
/opt/data/output/cash-drawer/.venv/bin/python /opt/data/output/cash-drawer/verify.py
```
The trace reports exit code 0 and PASS for workspace/compact at 1440px desktop and 390px mobile. Checks cover tabs, arrow navigation, denomination calculator (initial/short/balanced/coin), invalid quantity, dialog controls/focus restoration, draft category/source behavior, simulated close gates, dark mode, touch sizing, no page overflow and no JavaScript errors. Screenshots generated.

Limits: automatic geometry checks are not complete visual/accessibility acceptance. Image-based review failed at provider input restriction; no visual-AI review completion claim. No live application/backend/database/browser integration test was run. Local prototypes do not prove actual approval enforcement, receipt correctness or safe closing.

Remote shell checks NOT run here:
```
git diff --check
npm run -w packages/web lint
npm run -w packages/web build
graphify update .
```
Run these on actual dev-server after implementation; record exact UI test runner invocation selected from package scripts, not an invented command. `graphify update .` unavailable through read-only graph MCP; no remote executor exposed.

## 9. Explicitly Deferred

| Item | Revisit when |
|---|---|
| Native mobile Cash Drawer module | Store establishes authorized mobile custodians; web pilot stable |
| Analytics/chart dashboard | Operational reporting use case proven; not necessary for counting |
| Full treasury/fund-account reconciliation | Separate finance scope approved |
| Offline financial submission | Durable conflict/idempotency/custody model separately approved |
| Semantically indexing these Markdown docs | Remote Graphify semantic runner available; best effort, never force shrink-guard |

## 10. Files Touched So Far

Remote deliverable of this work: `docs/plans/2026-10-07_cash-drawer-ui-design.md`. Companion module document is a separately published handoff in this directory. No application code changed by this design/doc work. Proposed production paths in §6 are NOT files already implemented. Local artifacts in §8 remain local. MCP file creation is not a Git commit/push/deployment.

## 11. Change Log

| Date | Author / Session | Change |
|---|---|---|
| 2026-10-07 | Forson + Kent Pilar | Finalized cashier workspace and resumable UI contract; preserved prototype/live-implementation distinction and verification limits; published via project plan writer. |
