# Manual Inventory & Build Status

Tracks the module → manual-file mapping and build status. Update this file whenever a manual is
added, merged, or split. See `STANDARDS.md` and `TEMPLATE.md` for the rules every file below follows.

| # | Module | File | Source page(s) | Status |
|---|---|---|---|---|
| 1 | Getting Started | `getting_started_manual.md` | LoginScreen.jsx, Dashboard.jsx | done |
| 2 | Point of Sale | `point_of_sale_manual.md` | POSPage.jsx | done |
| 3 | Sales History | `sales_history_manual.md` | SalesHistoryPage.jsx | done (rewritten to standard) |
| 4 | Invoicing & Statements | `invoicing_and_statements_manual.md` | InvoicingPage.jsx, SoaGenPage.jsx | done |
| 5 | Accounts Receivable & Customers | `accounts_receivable_manual.md` | AccountsReceivablePage.jsx, CustomersPage.jsx, PaperlessReceiptsPage.jsx | done (absorbed payment_methods_manual.md) |
| 6 | Accounts Payable & Suppliers | `accounts_payable_manual.md` | AccountsPayablePage.jsx, SuppliersPage.jsx | done |
| 7 | Cheques & Treasury | `cheques_and_treasury_manual.md` | ChequePrintingPage.jsx, ChequesTreasuryPage.jsx, PdcTreasuryPage.jsx, BankAccountsPage.jsx, CashierApprovalDesk.jsx | done |
| 8 | Purchasing & Goods Receipt | `purchasing_and_goods_receipt_manual.md` | PurchaseOrderPage.jsx, PurchaseOrderEditorPage.jsx, GoodsReceiptPage.jsx, GoodsReceiptHistoryPage.jsx | done |
| 9 | Inventory & Parts Catalog | `inventory_and_parts_manual.md` | InventoryPage.jsx, PartsPage.jsx, PartNumberManager.jsx, PartApplicationManager.jsx, ApplicationsPage.jsx, PartsCleanupPage.jsx, CycleCountExecutionPage.jsx | done |
| 10 | Expenses | `expenses_manual.md` | ExpensesPage.jsx, ExpenseCategoriesPage.jsx, ExpenseLexiconPage.jsx | done |
| 11 | Payroll | `payroll_manual.md` | PayrollPage.jsx, PayComponentsPage.jsx, StatutoryTablesPage.jsx, MyPayslipsPage.jsx | done |
| 12 | HR & Workforce | `hr_workforce_manual.md` | EmployeesPage.jsx, DepartmentsPage.jsx, LeavePage.jsx, WorkSchedulesPage.jsx, DtrPage.jsx | done (supersedes HR_Module_User_Manual.md) |
| 13 | Documents | `documents_manual.md` | DocumentsPage.tsx | done |
| 14 | Reporting | `reporting_manual.md` | ReportingPage.jsx | done |
| 15 | Power Search | `power_search_manual.md` | PowerSearchPage.jsx | done |
| 16 | Settings & Setup | `settings_and_setup_manual.md` | SettingsPage.jsx, SetupPage.jsx, MobileSetupPage.jsx | done |

## Notes
- Modules are grouped by user goal, not 1:1 with page files — see STANDARDS.md file-naming note.
- `HR_Module_User_Manual.md` and `payment_methods_manual.md` (pre-standard files) have been deleted:
  their content is now fully covered by `hr_workforce_manual.md` + `payroll_manual.md`, and
  `accounts_receivable_manual.md`, respectively.
- Known intentional overlap, resolved by ownership: Accounts Payable documents *initiating* a
  supplier payment (Issue Outbound Cheque) as an entry point only; the full cheque lifecycle
  (clearing, bouncing, voiding, redepositing) is owned by `cheques_and_treasury_manual.md`, which
  Accounts Payable links out to rather than duplicating.
- Verification pass (2026-08-17): all 16 files checked for required TEMPLATE.md headings (100%
  pass), for LaTeX/set-notation leaking outside Advanced Reference (only sales_history_manual.md
  has any, correctly confined to its Advanced Reference section), and for internal cross-links
  resolving to real files (all fixed — several stale links to the two deleted pre-standard files,
  and a few typo'd filenames, were corrected).
- Outstanding low-priority items surfaced by drafting agents, not yet independently re-verified:
  a few per-file "assumptions/uncertainties" notes (e.g. unconfirmed backend validation strings,
  two-hops-deep sub-form field labels) remain in each agent's original report; none block use of
  the manuals as-is. A `documents_manual.md` finding (PreviewComponent uses
  `dangerouslySetInnerHTML` on server-supplied HTML) is a security-review candidate, out of scope
  for this documentation pass.
- Phase 2 (not in this pass): combined/printable manual generator, in-app contextual tooltips,
  PR-time staleness check.
