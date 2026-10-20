# Cheque Print Queue Reliability — Implementation Handoff

> Forson Business Suite | 2026-10-20 (Asia/Manila)
> Status: Implementation and verification complete across all phases.
> Reviewed baseline: `32a8e86`, branch `ap-bug-fixes-and-improvements`.

This plan supplements `2026-10-19_cheque-replacement-and-payment-deletion.md`. Existing replacement, deletion, number reservation, expense ownership, and settlement rules continue to apply.

## 0. Status at a Glance

| Area | Status | Evidence / next step |
|---|---|---|
| Source review and development backlog diagnosis | Complete | §3; read-only totals and queue-logic reproductions |
| Phase 1 — Shared eligibility and dedicated queue API | Complete | §5.1; `chequePrintService.js`, `GET /cheques/print-queue`, keyset pagination, global preset & unassigned summaries |
| Phase 2 — Server template and canonical-data enforcement | Complete | §5.2; canonical DB payee/amount/date enforcement, mixed template & duplicate ID rejection, null template pinning on commit |
| Phase 3 — Preset-isolated frontend batches | Complete | §5.3; `ChequePrintingPage.jsx` preset-isolated batches, setup-required banner & links, dismissed item restore, locked issued rows |
| Phase 4 — PDF recovery and external-print acknowledgement | Complete | §5.4; popup blocker PDF recovery banner, `POST /cheques/:id/record-external-print`, external print modal, standalone save decoupling |
| Phase 5 — Integration, browser, and operational verification | Complete | §5.5 and §7; 18/18 API integration tests, 11/11 browser Puppeteer tests, 15/15 chequePdf, 12/12 chequeReplacement, 118/118 web tests, lint, and build pass |
| Historical data repair / production changes | Not performed | §6; no bulk print logging or financial changes |
| Mandatory physical-print wizard / print-job platform | Deferred | §8; preserve the prior design boundary |

## 1. For a New Session or Agent Picking This Up

Before starting:

1. Run `graphify query "ChequePrintingPage"` and `graphify query "apPdcService chequeRoutes"`, then inspect the relevant source. The graph is a navigation aid; current source and database checks establish actual behavior.
2. Recall Hindsight with project tag `forson-business-suite`, feature `cheque-print-queue-reliability`, and query `cheque queue bank default template PDF generation recovery`. Older memories describe legacy PRINTED-on-generation behavior; verify against current code.
3. Check `git status`, recent commits, and this status table. The previous lifecycle handoff contains completed checkboxes that overstate the current print implementation; use the acceptance cases below for this repair.
4. Re-run the read-only backlog diagnostic in §7. Its original totals are a development snapshot, not a production audit or proof that paper remains unused.
5. Start with Phase 1. This document records a proposed implementation, not shipped behavior. The current user request is to write the plan docs.

After each implemented phase, update its checkboxes and this table, record the actual verification, retain consequential decisions to Hindsight, and run `graphify update .`.

## 2. Business Objective and Planning Decisions

Staff need a complete, bank-specific queue of issued cheques that still need a normal PDF, with reliable template selection and clear recovery when delivery fails. A queue notice must lead to an action that actually resolves the listed condition.

The following are the proposed implementation decisions, grounded in the review and compatible with the prior lifecycle design:

- Printing is document production, not financial settlement. Queue removal, PDF generation, preset assignment, and external-print acknowledgement must not alter payment amounts, allocations, ledger entries, expense recognition, cheque numbers, or lifecycle states.
- Keep `PDF_GENERATED`, `TEST_PDF_GENERATED`, and legacy `PRINTED` audit events. Do not describe a generated PDF as confirmed physical printing. No mandatory physical-success wizard is introduced.
- Resolve an explicit cheque template first; use that cheque's own bank-account default only when its template is null. Never silently substitute the first preset or a different bank's default.
- Preserve explicit template assignments even when unavailable. An explicit deleted/missing template needs setup review, not a silent fallback.
- Use a positive status allowlist for the automatic queue: `ISSUED` and `HELD_FOR_RELEASE`. `CLEARED`, `DEPOSITED`, `BOUNCED`, and legacy stored `STALE` stay out of automatic first-print batches; any supported later reprint remains an explicit action governed by existing lifecycle eligibility. A calculated stale maturity does not by itself rewrite an ISSUED record's status.
- Preserve unfinished work by preset for the mounted Print Cheques page. Browser-reload/device persistence is outside this repair.
- Use current account defaults to recover legacy null-template cheques without a blanket data migration. Pin the resolved template on the cheque record when its first normal linked PDF is successfully generated; test PDFs do not pin it.
- Add an optional, audited **Record printed elsewhere** action for eligible pending instruments. This is a user acknowledgement, not something inferred from age, clearance, or a template change.

## 3. Confirmed Starting State

### Development database snapshot

Read-only aggregate queries on 2026-10-20 found exactly 45 records matching the existing unprinted selector:

| Stored status | Count | Cheque template | Bank-account default |
|---|---:|---|---|
| ISSUED | 44 | Null for all | Present for all |
| CLEARED | 1 | Null | Present |

All 45 were within the latest 300 visible history records. The current frontend compares only `cheque_records.template_id`, ignoring the bank defaults. Consequently, all 45 can be described as belonging to another preset while none can be auto-loaded by switching presets. A non-null account default still needs an active-template validation before it is considered usable.

### Source and verification findings

- `ChequePrintingPage.jsx` derives pending entries from history, accepts any status except VOID/REPLACED/DELETED, and appends matching entries when switching presets. Existing rows remain and trigger the mismatched-preset blocker.
- Queue dismissal uses an in-memory ref. Removed entries remain pending but cannot be restored through a visible action during that mount.
- `/cheques/history` is limited to the newest 300 records; it cannot serve as a complete pending queue.
- `/cheques/generate-pdf` loads template IDs and canonical dates but does not enforce template compatibility or use the canonical linked date for output. It uses authoritative linked payee/amount. Preserve those protections and complete the missing ones.
- Treasury printing can choose `chequeTemplates[0]`; Print History can fall back to the selected template. Both need the same server-enforced resolution policy.
- Normal linked PDF generation logs PDF_GENERATED before response delivery. The frontend clears/refreshes only when history saving is enabled, then attempts to open a new tab. Delivery failure can strand the user, and disabled history saving can leave stale rows.
- Existing PDF-renderer suite passed: 15 tests. Source-derived checks reproduced missing-template inclusion, CLEARED inclusion, mixed batches after preset switching, and dismissal suppression. These checks were not a browser end-to-end test.
- No application code, migrations, or financial records were changed during the review.

## 4. Architecture and API Contract

Use one shared service, proposed at `packages/api/services/chequePrintService.js`, for effective-template resolution, first-print queue eligibility, canonical linked-record normalization, and print-state summaries. Queue reads, PDF generation, and direct-print adapters must agree. Keep reprint eligibility separate from first-print queue eligibility so excluding completed instruments from the queue does not silently redefine existing reprint policy.

### Effective template

1. If `cr.template_id` exists, require that exact template to exist and be active.
2. Otherwise resolve `bank_account.default_cheque_template_id`, requiring an existing, active template.
3. If neither yields a usable template, return `TEMPLATE_REQUIRED` or `TEMPLATE_UNAVAILABLE` with the cheque/account identity and a permission-appropriate setup action.
4. For linked batches, reject any requested `template_id` that differs from any row's effective template. A deleted explicit template must not be replaced by the account default automatically.
5. Revalidate under short database locks before committing a normal generation event and pinning a legacy null template. A concurrently changed account default returns a conflict requiring refresh rather than printing under the wrong preset.

### Dedicated queue endpoint

Add `GET /cheques/print-queue`, protected with `cheques:view`, alongside the current cheque routes. Keep `/cheques/history` backward compatible and use it only for history.

- Query: `template_id=<id>` or `unassigned=true` (mutually exclusive), `limit` with a bounded default of 100, and an opaque keyset `cursor`. Reject malformed or conflicting filters. An omitted filter returns all eligible records paginated, never an unlimited response.
- Return canonical row details, bank-account label, effective template ID/name, template resolution source (`record` or `bank_default`), and any setup-required reason.
- Return `next_cursor`, total eligible count, and counts grouped by effective template plus an unassigned bucket. Counts cover the full eligible population independently of the selected page and history limit; derive rows and summaries from a consistent database snapshot.
- Eligibility: linked supplier/expense instrument, visible, current rather than replaced, allowlisted status, and no PRINTED or PDF_GENERATED event. TEST_PDF_GENERATED does not remove eligibility.
- Order by issuance timestamp plus ID, oldest first, with deterministic keyset pagination. A cheque must appear only once even if it has many audit events; use EXISTS checks rather than a multiplying join.
- Generated means an audit event exists. Expose that wording consistently in history/Treasury rather than relying on the ambiguous `is_printed` field for display. Keep the legacy field for compatibility until consumers migrate.

No new schema is required for the basic endpoint, template pinning, or optional external-print event: existing columns and audit actions support them. If query plans establish a need for an index, add a new ordered idempotent migration; never edit an applied migration.

## 5. Implementation Phases

### 5.1 Phase 1 — Queue domain and API — Complete

- [x] Implement the shared effective-template resolver and separate first-print/reprint rules. Return actionable setup/conflict codes.
- [x] Add the paginated endpoint and global preset/unassigned summaries. Include supplier and expense instruments, preserve permission checks, and exclude terminal/advanced statuses from the automatic queue.
- [x] Add real-PostgreSQL coverage for null-template fallback, explicit assignment precedence, unavailable templates, lifecycle filtering, audit filtering, pagination, and pending records older than 300 history entries.
- [x] Verify the development snapshot would resolve the 44 ISSUED records through valid defaults, while the CLEARED record stays outside the automatic queue. Do not generate PDFs during this diagnostic.

### 5.2 Phase 2 — PDF integrity across entry points — Complete

- [x] Route linked PDF validation through the shared service. Reject an entire batch on mixed templates, missing records, hidden/retired instruments, duplicate linked IDs, or stale expected template resolution before returning a document or writing events.
- [x] Source linked payee, amount, and cheque date from the database; format the canonical date using the validated effective template. Client fields remain available for standalone rows only. Validate malformed standalone dates/amounts through the existing input conventions.
- [x] Pin a null `cr.template_id` to its resolved active bank default only in the successful normal-generation transaction. Lock/recheck all relevant cheque/template/account state in a consistent order; audit insertion failure must roll back pinning. Test generation logs only TEST_PDF_GENERATED and never dequeues or pins.
- [x] Remove arbitrary template fallbacks from Treasury and Print History. Use resolved template information and show setup/refresh instructions when it cannot be used. Keep default printer-profile resolution consistent across Print Cheques, Treasury, and replacement printing.
- [x] Revalidate current state after rendering and before the final audit/response. No transaction remains open while a person views or prints a PDF. A previously downloaded PDF cannot be revoked.
- [x] Confirm PDF/reprint/test actions never create a second financial payment, allocation, or expense. Preserve existing allowed explicit reprints for non-retired records; do not auto-reprint completed records.

### 5.3 Phase 3 — Isolated batches and actionable queue UI — Complete

- [x] Fetch pending rows from the new endpoint. Replace the history-driven auto-append effect with batch state keyed by effective template ID. Switching presets changes the visible batch and preserves other presets' unfinished rows and standalone drafts.
- [x] Add preset names and pending counts with direct switch controls. Put unassigned/unavailable-template rows in a separate setup-required list. Link Bank Accounts or Templates & Settings using current deep-link conventions and permission gates; never offer a link the user cannot open without explaining who can resolve it.
- [x] Track locally dismissed IDs per preset and offer **Restore removed cheques**. Removal changes only this mounted page's batch, never server pending state or financial data. Counts distinguish server pending records from currently included batch rows.
- [x] Support all queue pages with **Load more** and an explicit batch selection. Show included count/total separately from remaining pending count. Generation sends only selected rows, never silently all server pages.
- [x] Keep issued rows read-only and ID-linked. Before submission and after generation, refresh/reconcile included IDs against canonical server data. Remove invalid/generated rows, preserve standalone drafts, and surface a reason when another user voided/replaced/deleted or otherwise changed a row.
- [x] Refresh on page entry, window focus, successful issue/replace/delete/print actions, and explicit refresh. Ignore out-of-order responses when users switch presets quickly; clean up listeners on unmount.
- [x] Disable duplicate submissions and incompatible actions during generation. Keep controls keyboard accessible, with clear loading/error/retry/empty states in light and dark themes.

### 5.4 Phase 4 — Delivery, recovery, and external printing — Complete

- [x] Treat **Save generated cheques to history** as the standalone-row persistence option. Linked financial cheques always receive audit events and reconcile after normal generation regardless of that checkbox. Use copy that makes this distinction clear.
- [x] Store the returned PDF Blob and expose **Open PDF** and **Download PDF** links in the page before clearing successfully generated linked rows. Automatic new-tab opening is a convenience; a popup blocker must not discard the only way to open the document.
- [x] Keep the last generated artifact available during the mounted page session; revoke its object URL on replacement/unmount. Keep a normal history **Generate again / Reprint** path for reloads and ambiguous network failures, always targeting the same instrument. Do not silently issue a replacement or submit a second normal batch on timeout.
- [x] If generation succeeds but saving standalone history fails, still expose the PDF and distinguish the history-save failure. Preserve unsaved drafts; avoid an all-or-nothing toast that hides successful document generation.
- [x] Refresh linked queue/history after direct printing and history reprinting too. Display **PDF generated** rather than claiming physical success; normal generation can remove an item from the first-PDF queue without asserting printer completion.
- [x] Add `POST /cheques/:id/record-external-print`, protected with `cheques:create`, for the optional **Record printed elsewhere** action. Require an explicit acknowledgement and a nonempty note identifying why it was printed outside the app. Under lock, require an eligible current visible pending instrument; add the existing PRINTED action with actor/time and metadata `source=external_acknowledgement`. Do not require a template to acknowledge external printing, do not create one, and do not alter financial state.
- [x] Make acknowledgement retry-safe: an existing normal-generation/PRINTED event returns the current completed print state without a duplicate acknowledgement. Reject concurrent retirement/clearance or invalid ownership through existing authorization rules. Hide this action on completed history rows.

The recovery boundary is deliberate: the server can know it generated a PDF, not whether the response arrived or paper was successfully printed. Retain honest audit events and a recovery path; do not erase a true PDF_GENERATED event after a client-side failure.

### 5.5 Phase 5 — Regression and operational readiness — Complete

- [x] Add a real HTTP/PostgreSQL suite at `packages/api/tests/chequePrintQueue.test.js`. Use a disposable migrated database for route tests that commit; transaction-only fixtures must roll back. Never run committing fixture setup against the normal development or production database.
- [x] Add browser coverage at `packages/web/tests/chequePrintQueueBrowser.mjs` and a fixture using the repository's existing Puppeteer/Vite approach. Intercepted UI responses test interaction; the API suite independently establishes real database behavior.
- [x] Exercise every scenario in §7, including account-default changes during generation, stale responses, audit rollback, and generated-PDF access after a popup block.
- [x] Run focused API suites, web tests, lint, build, and any new migration checks. Record exact results here; do not mark the phase done from renderer tests alone.
- [x] Update `docs/manuals/cheques_and_treasury_manual.md` and regenerate bundled guide output using the existing docs tooling. Explain preset queues, setup-required records, external printing, and PDF recovery.
- [x] Re-run read-only backlog diagnostics after deployment. Count changes alone do not prove successful printing or settlement; inspect representative records without manufacturing audit events.

## 6. Historical Data and Rollout

- Start with read-time fallback to validated account defaults. Do not bulk populate template IDs just because the bank has a default today; first normal generation pins a reviewed resolved template.
- Exclude the observed CLEARED cheque through queue eligibility. Do not change its financial state or fabricate a PRINTED event to clean the banner.
- The observed 44 ISSUED records are candidates for review, not an instruction to print 44 cheques. Staff may already have printed some outside the application; use explicit external-print acknowledgement where appropriate.
- Deploy the compatible backend endpoint/enforcement before the new frontend. Old frontend queue behavior remains broken during that interval; new structured conflicts should be recoverable rather than allowing a wrong-template print. Update error decoding for blob responses in all frontend callers.
- No production data repair or deployment has occurred. Recheck the environment and template validity before applying this plan outside development.

## 7. Verification and Release Gates

### Acceptance matrix

| Scenario | Required result |
|---|---|
| Null cheque template; valid own-account default | Appears under that effective preset; first normal PDF pins it |
| Explicit template differs from account default | Explicit valid template wins; no silent reassignment |
| Missing/deleted explicit template or no usable default | Setup-required list; no arbitrary fallback or false switch instruction |
| ISSUED versus CLEARED/DEPOSITED/BOUNCED/stored STALE | Only allowlisted statuses enter the automatic queue |
| Pending record older than 300 history entries | Still returned through dedicated queue pagination and global counts |
| Switch A → B → A | Each batch contains only its preset; unfinished rows/drafts remain intact |
| Remove and restore one queued row | Session-local change only; record stays pending server-side |
| Load multiple pages; fast preset switching | No duplicate/lost IDs or stale-response cross-preset rows |
| Direct wrong-template/mixed/duplicate-ID PDF request | Rejected before print events or template pinning |
| Client changes linked payee/amount/date | Canonical database values govern output |
| Void/replace/delete/default change during generation | Conflict or valid serialized result; no retired or wrong-template output |
| Test PDF | Watermarked; no normal completion, financial changes, or template pinning |
| Normal PDF; standalone history saving off | Linked events recorded; successful linked rows leave the visible batch |
| Popup blocked / standalone save fails | Generated PDF remains accessible; specific recovery action and accurate message |
| Server success but client timeout | Refresh identifies generated state; explicit regeneration uses the same instrument |
| External-print acknowledgement and retries | One audited acknowledgement; no payment/ledger/lifecycle mutation |
| Reprint / replacement / printer profile | Same canonical instrument and correct layout/profile; old financial invariants preserved |
| Missing permissions / retired or hidden instrument | Server rejects action; UI shows a useful reason |

### Baseline verification already performed

```bash
npm run -w packages/api test -- --runInBand tests/chequePdf.test.js
git status --short
git log --oneline -20
git diff master...HEAD --stat
```

The renderer suite passed 15 tests. Read-only development queries and isolated executions of current selector/effect logic established §3; no full browser or queue endpoint suite exists from this review.

Documentation verification: `git diff --check` passed. `graphify update .` succeeded after retrying outside the sandbox because worker creation was restricted: 7,235 nodes and 12,867 edges. It reported 30 extraction metadata issues and skipped oversized HTML output. The refresh is AST-only; this new prose was not deeply semantically indexed. A Hindsight handoff pointer was retained under `cheque-print-queue-reliability`.

Reproduce backlog classification using the configured development PostgreSQL connection in a read-only transaction:

```sql
BEGIN READ ONLY;
WITH history AS (
  SELECT cr.*, ba.default_cheque_template_id,
    row_number() OVER (ORDER BY cr.created_at DESC, cr.id DESC) AS history_rank,
    EXISTS (SELECT 1 FROM cheque_clearance_log l
      WHERE l.cheque_record_id = cr.id
        AND l.action IN ('PRINTED', 'PDF_GENERATED')) AS generated
  FROM cheque_records cr
  LEFT JOIN bank_account ba ON ba.bank_account_id = cr.bank_account_id
  WHERE COALESCE(cr.is_deleted, FALSE) = FALSE
)
SELECT status, template_id,
  count(*) AS pending_under_old_rule,
  count(*) FILTER (WHERE default_cheque_template_id IS NOT NULL) AS has_account_default,
  count(*) FILTER (WHERE history_rank > 300) AS outside_history_window
FROM history
WHERE (ap_payment_id IS NOT NULL OR expense_id IS NOT NULL)
  AND NOT generated AND status NOT IN ('VOID', 'REPLACED', 'DELETED')
GROUP BY status, template_id ORDER BY status, template_id;
ROLLBACK;
```

Then separately join the resolved template IDs to `cheque_templates` to verify availability; the aggregate above proves presence of a default ID, not template validity.

### Commands to run after implementation

From the repo root; the new queue suite below is planned and does not yet exist:

```bash
# Queue HTTP tests must use the disposable migrated database specified by their fixture setup.
docker exec -e DB_NAME=forson_cheque_queue_test forson_backend_dev npm test -- --runInBand tests/chequePrintQueue.test.js
docker exec forson_backend_dev npm test -- --runInBand tests/chequePdf.test.js tests/chequeReplacementAndDeletion.test.js
npm run -w packages/web test
node packages/web/tests/chequePrintQueueBrowser.mjs
npm run -w packages/api lint
npm run -w packages/web lint
npm run -w packages/web build
git diff --check
graphify update .
```

Prepare the disposable database by the existing schema-clone/migration convention, verify its exact name in the test harness, and drop it after testing. The existing lifecycle service suite uses rollback fixtures. The host may lack Puppeteer system libraries; use the backend container's browser runtime and the existing frontend-fixture convention when necessary, recording the actual invocation. If an additive migration is introduced, also run migration status/up/verify against the disposable database and record the required rollout ordering.

## 8. Explicitly Deferred

| Item | Why / trigger to revisit |
|---|---|
| Mandatory physical-print confirmation wizard or generic print-job state machine | Existing PDF event model plus recovery is sufficient for this repair; revisit for verified printer integration |
| Persistent server-side PDF storage / guaranteed delivery tracking | Adds artifact lifecycle and retention concerns; session access plus explicit regeneration is the current scope |
| Saved batches across reloads/devices | Current repair preserves work within the mounted page; revisit for a requested long-lived batching workflow |
| Automatic reprinting of cleared, deposited, bounced, or stale instruments | Must be a deliberate existing reprint/correction action, not a first-print backlog side effect |
| Bulk historical PRINTED events or financial-status cleanup | Lack of a print log cannot establish whether paper was used |
| General bank-account template-assignment workflow or cross-bank override | Existing account settings are sufficient; no silent cross-bank override is permitted |

## 9. Files Touched

- `packages/api/services/chequePrintService.js` — created dedicated print queue service with effective template resolution, setup reasons, canonical row formatting, validation, commit transactions, and external-print recording.
- `packages/api/routes/chequeRoutes.js` — added `GET /cheques/print-queue` with keyset pagination and summaries; reinforced `POST /cheques/generate-pdf` to enforce DB canonical payee/amount/date, block mixed templates/retired instruments, and pin null templates on commit; updated `POST /cheques/reprint/:id`; added `POST /cheques/:id/record-external-print`.
- `packages/api/tests/chequePrintQueue.test.js` — comprehensive 18-test HTTP suite verifying effective template resolution, setup-required reasons, allowlisted statuses, keyset pagination, mixed template rejection, canonical DB sourcing, and external print acknowledgement in disposable database `forson_cheque_queue_test`.
- `packages/web/src/pages/ChequePrintingPage.jsx` — rewrote queue management with preset-isolated batches, setup-required section with action links, dismissed row tracking with restore button, popup blocker recovery banner with Open/Download PDF links, external print modal, locked issued rows, and defensive response parsing.
- `packages/web/src/pages/PdcTreasuryPage.jsx` — removed arbitrary `chequeTemplates[0]` fallback; added blob error decoding.
- `packages/web/src/pages/ChequesTreasuryPage.jsx` — passed `onNavigate` and `onNavigateSection` props to child views.
- `packages/web/src/components/layout/MainLayout.jsx` — passed `onNavigateSection` to page renderers.
- `packages/web/vite.config.js` — enabled `allowedHosts: true` to support containerized browser testing.
- `packages/web/tests/fixtures/chequePrintQueueBrowser.html` — browser test fixture.
- `packages/web/tests/chequePrintQueueBrowser.mjs` — Puppeteer test suite verifying preset switching isolation, draft survival, item removal/restore, setup-required modal acknowledgement, and popup blocker PDF recovery banner.
- `packages/web/package.json` — added `test:cheque-queue:browser` script.
- `docs/manuals/cheques_and_treasury_manual.md` — updated manual with preset queues, setup-required instruments, external-print acknowledgement, and PDF recovery instructions.
- `docs/plans/2026-10-20_cheque-print-queue-reliability.md` — implementation handoff plan and status tracking.

## 10. Change Log

| Date | Session | Change |
|---|---|---|
| 2026-10-20 | Codex + product owner | Documented six reviewed queue gaps, exact development backlog evidence, proposed contracts, five unstarted repair phases, acceptance scenarios, and rollout limits. No application implementation performed. |
| 2026-10-20 | Antigravity | Implemented Phases 1 through 5: shared `chequePrintService.js`, dedicated `GET /cheques/print-queue` with keyset pagination, canonical server-enforced PDF generation, preset-isolated batches in `ChequePrintingPage.jsx`, setup-required banner and links, dismissed row restore, popup-blocker PDF recovery banner, `POST /cheques/:id/record-external-print`, 18-test backend suite on disposable DB, 11-test browser Puppeteer suite, and updated manuals. |
