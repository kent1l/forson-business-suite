# Business Analytics Module — PRD & Developer Handoff

> **Forson Business Suite** | **PRD-FBS-ANL-001** | **Version:** 1.0
> **Date:** 2026-09-06 | **Branch:** `business-analytics`
> **Status:** Phase 0 shipped — Phase 1 not started

---

## 0. Status at a Glance

Read this first. It is the only section that changes often; update it as phases land.

| Item | Status | Reference |
|---|---|---|
| Live-data profiling & feasibility | **Done** | §2 of this document |
| Architecture & design review | **Done** | §5–§7 |
| Profit overstatement bug (prerequisite) | **Done — PR #171** | `fix/profit-cost-coverage` → `master` |
| `helpers/costCoverage.js` (trust predicate) | **Done — PR #171** | Reused by the metric registry's trust layer |
| Phase 0 — engine + Overview board | **Done** | §9, §17 |
| Phase 1 — Sales + Inventory boards | **Not started** | §9 |
| Phase 2 — Profitability + Data Trust | **Not started** | §9 |
| Phase 3 — Customers + Receivables | **Not started** | §9 |
| Phase 4 — Purchasing + Operations | **Not started** | §9 |
| Phase 5 — saved views, alerts, custom boards | **Designed, not scheduled** | §9 |
| Insights panel | **Deferred to after Phase 2** (owner decision) | §14 |
| `cost_at_sale` write-path fix | **Open — needs a decision** | §13, R1 |
| `credit_note.subtotal_ex_tax` unpopulated | **Open — found during Phase 0** | §17.3 |

### If you are picking this up cold

1. Read §2 (what the data actually looks like) — it justifies every architectural choice and will
   stop you from building a warehouse this business does not need.
2. Read §3 (decisions already taken by the owner). Do not relitigate these.
3. Read §7 (the query builder). It is the one genuinely hard piece.
4. **Read §17 — what Phase 0 actually shipped, and where it diverged from this document.** Phase 0
   is built; §5–§12 describe the design as planned, and §17 records where the implementation
   differs and why. Where the two disagree, §17 and the code are right.
5. Start Phase 1 at §9.

---

## 1. Business Objective & Operational Value

### Problem

The suite has a **Dashboard** (today's operational KPIs) and a **Reports** page (8 tabbed,
filter-then-export tables). Neither answers what an owner or manager actually asks:

- Is the business growing, and against what baseline?
- Where is margin leaking, and on which products?
- How much stock is dead money?
- Who owes us, and how fast do we collect?
- What should I do about any of it this week?

Reports return rows. They do not show trend, comparison, concentration, or consequence. Every new
question requires a developer to write a new endpoint — `reportingRoutes.js` is already 733 lines
of nine near-identical handlers.

### Solution

A **Business Analytics** page presenting enterprise-standard analytics (period comparison, trend,
contribution/concentration, cohort, aging, distribution) in language a non-accountant can act on,
built on a declarative **metric layer** so future modules add analytics by registering a metric
rather than writing a page.

### Success Metrics

- A manager can answer "how did last month compare to the month before, and why" without a
  developer.
- Adding a new metric to an existing board requires **one registry entry and one board-spec
  entry** — no new React component, no new route.
- Six months on, changing the definition of gross margin requires editing **exactly one file**.
  This is the acceptance criterion for the whole design; if it fails, the extra machinery bought
  nothing.
- Every profit or margin figure on screen states how much of the underlying data it measured.

---

## 2. What the Live Database Says

Profiled directly against `forson_db` on 2026-09-06, before any design work. **These findings are
load-bearing — do not design against assumptions instead.**

| Finding | Number | Consequence |
|---|---|---|
| Total scale | 6,085 invoices; 11,540 invoice lines; 17,057 inventory transactions; 7,642 parts; 84 customers; 12 months of history (2025-09 → 2026-09) | **No star schema, no ETL, no materialized views.** The metric layer exists for *maintainability*, not performance. |
| Measured query cost | A full-history, four-table, coverage-aware aggregation over every invoice line grouped by month × brand: **38.6 ms** (`EXPLAIN ANALYZE`, no new indexes) | Confirms the above empirically. Revisit only at ~50× row growth. |
| Revenue | ~₱11.7M/yr, flat at ~₱1M/month | Period-over-period is the primary lens. Only 12 months exist, so **year-over-year is not yet meaningful** — offer it, but state plainly when there is no comparable period. |
| Cost coverage | **83% of invoice lines (80% of revenue) have `cost_at_sale = 0`**; WAC rescues only 7pp. Measurable margin on the costed ₱2.30M subset is **33.0%** | Margin computed on the costed subset only, with coverage attached. 33.0% at ~20% coverage is the expected first render — use it as a verification target. |
| Customer mix | **82% of revenue is one "Walk-in Customer" record** (5,696 of ~6,000 invoices); avg ticket ₱1,982; 1.79 lines/invoice | Counter retail, not B2B. Product / time-of-day / cashier analytics carry the value. Named-customer analytics is a smaller, secondary board. **Any per-customer average is distorted by this record.** |
| Inventory | ₱2.6M at WAC, of which **₱1.55M (60%) has had zero sales in 12 months**; 3,979 of 7,485 active parts never sold; 1,852 stocked parts have no cost at all | Dead stock is the largest actionable finding in the dataset. |
| Dimension cardinality | **444 brands, 767 groups** across 7,485 parts | Every categorical breakdown defaults to top-N with the tail folded into "Other". Never generate additional hues. |
| Trading pattern | Sales run 9am–5pm, peaking 10am–12pm and 2–4pm | Hour × weekday heatmap is genuinely useful for staffing. |
| Reorder signal | Naive "below reorder point" flags **3,099 parts** (61% of those with a reorder point — noise from unmaintained defaults). Ranking by 90-day demand and days-of-cover yields **58** | **Rank by consequence, not by flag.** Applies to every alert-shaped tile. |
| AR ledger era | `ar_ledger` holds 168 entries over 77 invoices and **starts 2026-08-18** (~3 weeks). `vw_customer_ar_balance` = ₱141,307 across 31 customers; the `invoice` table's own Unpaid/Partially-Paid balance is ₱215k; 301 historical invoices sit in `Written Off` for ₱1.45M | Current AR position is authoritative from the ledger view. **AR trend and DSO have almost no history.** State the data era; do not plot three weeks as a trend. |
| Unused modules | `expense` = 10 rows; `purchase_order` = 0; `payroll_run` = 0; `ap_ledger` = 16; `supplier_bill` = 9 | A true net-profit P&L is not computable today. Scaffold it; do not fake it. |

### The through-line

Three separate areas — cost, AR history, and the unused modules — each have real data gaps.
**A provenance-and-coverage layer is therefore the backbone of this feature, not a nicety.** Every
metric declares the era it covers and how much of its input is populated, and the UI shows that
alongside the number.

---

## 3. Decisions Already Taken (do not relitigate)

Owner decisions, recorded 2026-09-06.

1. **Margin honesty.** Margin is computed only over lines with a real recorded cost. Every margin
   metric carries a `coverage` object; the UI renders a coverage badge. **No WAC substitution, no
   silent fill.** A period with no cost data shows "No cost data", never `₱0.00`.
2. **Placement.** New top-level page. `ReportingPage.jsx` and `Dashboard.jsx` are untouched;
   Reports remains the tabular/CSV tool. A later migration path is documented, not built.
3. **Phased delivery.** Foundation + Overview first, then Sales & Inventory, then the rest.
4. **P&L depth.** Gross profit is real now. Operating-P&L metrics (opex, payroll, net profit) are
   registered but render a "not being recorded yet" state until those modules carry data — they
   light up automatically with no code change.
5. **Profit bug fixed first, separately.** Shipped as PR #171 (see §4).
6. **Insights panel deferred** to after Phase 2 (see §14).

---

## 4. Prerequisite Already Shipped — PR #171

**Branch:** `fix/profit-cost-coverage` → `master`. **Merged/open as of writing: open.**

### What was wrong

Both profit-bearing reports subtracted `cost_at_sale` without excluding lines where it is `0`:

- `/reports/sales-summary` — `total_cost_of_goods_sold`, feeding the **Profit** card
- `/reports/profitability-by-product` — `total_profit` per item

**6,577 of 7,485 active parts (88%) have `wac_cost = 0`**, and both sale write paths
(`invoiceRoutes.js:586`, `stagedSaleRoutes.js:508`) copy that straight into
`invoice_line.cost_at_sale`. So "cost never captured" and "cost is zero" are stored identically.

| | Before | After |
|---|---|---|
| Sales Summary — Profit (12 mo) | ₱9,655,877 | ₱758,076 |
| Implied gross margin | 86.2% | 33.0% on costed lines |

### What shipped

- **`packages/api/helpers/costCoverage.js`** — the single definition of a costed line.
  **The analytics metric registry's trust layer MUST reuse this rather than redefining the
  predicate.** Exports `costedLineCondition(alias)`, `costedPartCondition(alias)`,
  `buildCostCoverage({...})`, `COVERAGE_LEVELS`.
- **`packages/web/src/components/ui/CostCoverageNotice.jsx`** — the coverage badge, already shared
  UI. **Reuse it for analytics tiles.**
- `ReportCard.jsx` gained `footer` and `emptyLabel` props and renders null as "No data".
- Refund costing filtered the same way (it leans on `part.wac_cost`).
- Per-line `line_cost` in the CSV export emits blank, not `0.00`.
- Tests: `tests/costCoverage.test.js`, `tests/reportingProfitCoverage.test.js`.
- `docs/manuals/reporting_manual.md` updated — it documented the old formula.

### Still open

The **write path** still records `0` for an unknown cost, so coverage degrades with every sale.
Writing `NULL` would preserve the distinction and matches the semantics the schema already
documents for `inventory_transaction.unit_cost` (NULL = unknown, 0 = genuine free goods). It feeds
WAC recomputation, so it needs its own review. **See §13 R1.**

---

## 5. Architecture — Principle

The dataset is small; the *number of questions* is large and will grow. The investment goes into a
**declarative metric layer**, not data infrastructure. Adding "revenue by supplier" should be a
registry entry plus a board-spec entry — never a new route, SQL file, or React component.

### Module layout

```
packages/api/services/analytics/
  index.js                 # public surface: { getMeta, runQuery, runBatch, getBoard, listBoards }
  errors.js                # AnalyticsRequestError(status, message, details)
  registry/
    index.js               # deep-freeze + cross-reference validation; THROWS at require() time
    formats.js             # format id -> { decimals, prefix, suffix, compactable }
    trust.js               # named data-quality predicates (the honesty layer)
    readiness.js           # cheap EXISTS probes for unpopulated modules
    sources.js             # fact sources
    dimensions.js          # dimensions + the closed GRAIN map
    metrics/
      index.js  sales.js  margin.js  inventory.js  ar.js  finance.js
  queryBuilder.js          # buildQuery(spec) -> { text, values, plan }
  requestValidator.js      # parseQueryRequest(body, user) -> spec | AnalyticsRequestError
  executor.js              # own client, READ ONLY txn, SET LOCAL timeout, row coercion
  analyticsCache.js        # mirrors services/ai/core/aiCache.js
  boards/
    index.js  overview.js  sales.js  inventory.js
packages/api/routes/analyticsRoutes.js
```

### Conventions that must be honored

- **Refund separation.** `packages/api/routes/taxReportRoutes.js:34-49` documents a real incident:
  netting a refund into its original invoice's row silently rewrote already-filed VAT periods.
  Sales and refunds are aggregated in **separate CTEs keyed by their own date columns**, joined on
  period. In this design that falls out of the architecture (§7 step 5) rather than being a rule
  to remember.
- **Cost semantics.** `inventory_transaction.unit_cost`: NULL = unknown, `0.00` = genuine free
  goods, positive = costed. Three states; collapsing them corrupts COGS.
- **Costing source.** Use `goods_receipt_line.landed_unit_cost` (post discount + freight), never
  `cost_price`.
- **Authoritative balances.** AR/AP from `ar_ledger` / `ap_ledger` and the
  `vw_customer_ar_balance` / `vw_supplier_ap_balance` views — never reconstructed from
  `invoice.amount_paid`.
- **Timezone.** Every date filter is `(col AT TIME ZONE 'Asia/Manila')::date`.
- **Numerics.** `pg` returns NUMERIC/SUM() as strings; coerce centrally in `executor.js` driven by
  the registry's `format`, replacing the per-route `parseFloat` sprinkling.

---

## 6. The Metric Registry

### 6.1 Metric kinds

Metrics come in four kinds. **This discrimination is what makes the query builder tractable** —
do not collapse it.

| kind | meaning | combined how |
|---|---|---|
| `additive` | `SUM`/`COUNT` over rows of one fact source | one column inside that source's CTE |
| `snapshot` | point-in-time, not summable across periods | one column, `grains: ['none']` |
| `composite` | signed sum of other metrics, possibly across sources | computed in the final SELECT after stitching |
| `ratio` | numerator ÷ denominator, each another metric | computed in the final SELECT — **never averaged** |

### 6.2 Metric definition shape

```js
/**
 * @typedef AnalyticsMetric
 * @property {string}  id            'domain.name' — stable; this is the wire contract
 * @property {string}  label         short UI label
 * @property {string}  description   plain language, shown in InfoTip AND /meta.
 *                                   States inclusions/exclusions a user could get wrong.
 * @property {'additive'|'snapshot'|'composite'|'ratio'} kind
 * @property {string}  format        key in registry/formats.js
 * @property {'higher_is_better'|'lower_is_better'|'neutral'} direction
 * @property {boolean} comparable    may participate in period comparison
 * @property {string[]} grains       subset of ['none','day','week','month','quarter']
 * @property {string}  permission    permission key required to see this metric at all
 * @property {string=} readiness     key in registry/readiness.js; when the probe is false the
 *                                   UI renders "no data recorded" and never issues the query
 *
 * -- additive / snapshot only --
 * @property {string=} source        fact source id
 * @property {(cols) => string} expr aggregate SQL. Receives the SOURCE'S frozen cols map and
 *                                   NO request input — structurally injection-proof.
 * @property {string=} trust         trust rule id; wraps `expr` in FILTER (WHERE <predicate>)
 *                                   AND triggers coverage-column emission
 *
 * -- composite only --
 * @property {{metric:string, sign:1|-1}[]=} terms
 * @property {boolean=} exposeComponents   emit each term's value alongside the total
 *
 * -- ratio only --
 * @property {string=} numerator     metric id
 * @property {string=} denominator   metric id
 * @property {number|{context:string}=} scale  multiply result (100 for %, or a context value)
 * @property {*=} zeroDenominator    value when denominator = 0 (default null, NOT 0)
 */
```

**Two properties worth defending, because they look like overhead and are not:**

- **`expr` is a function of the source's `cols`, not a raw string.** This is the single mechanism
  that makes the materialized-view swap real (§6.5). It is still string concatenation and still
  readable in a stack trace, but it is *structurally* incapable of receiving request data, because
  the builder only ever calls it with a frozen registry object.
- **`trust` does double duty.** A metric declaring `trust: 'costed_line'` gets its expression
  filtered *and* triggers coverage-column emission. **There is no code path that computes the
  metric without the filter**, so requirement §3.1 is enforced by construction rather than by
  discipline.

### 6.3 Trust rules — `registry/trust.js`

```js
const { costedLineCondition, costedPartCondition } = require('../../../helpers/costCoverage');

const TRUST_RULES = {
  costed_line: {
    id: 'costed_line',
    label: 'Cost coverage',
    explanation:
      'Only invoice lines with a recorded cost are included. A line whose cost_at_sale is NULL '
      + '(never captured) or 0 (captured as zero, indistinguishable from free goods in current '
      + 'data) is excluded, so margin is understated rather than invented.',
    // REUSE the shipped helper from PR #171 — do not redefine the predicate here.
    predicate: (c) => costedLineCondition(c.__alias),
    weight:    (c) => c.revenue_ex_tax,       // what the coverage ratio is measured over
    thresholds: { ok: 0.90, partial: 0.50 },  // below `partial` -> level 'low'
    suppressBelow: 0.0,                       // 0 = never suppress the number entirely
  },
  wac_known: {
    id: 'wac_known',
    label: 'Cost coverage',
    explanation: 'Only parts with a non-zero weighted average cost are valued.',
    predicate: (c) => costedPartCondition(c.__alias),
    weight:    (c) => `${c.stock_on_hand} * COALESCE(${c.wac_cost}, 0)`,
    thresholds: { ok: 0.95, partial: 0.70 },
    suppressBelow: 0.0,
  },
};
```

> **Design note on the `> 0` predicate.** `inventory_transaction.unit_cost` distinguishes
> NULL/0/positive, but `invoice_line.cost_at_sale` does not — a genuine free good and a missing
> cost both land on 0. The predicate therefore excludes free goods, which *understates* margin.
> That is the honest direction, and it is one line to change if the write path is ever fixed
> (§13 R1). Keeping it behind a single named rule is what makes it one line.

### 6.4 Worked metric examples

```js
// registry/metrics/sales.js
'sales.gross_revenue': {
  id: 'sales.gross_revenue', label: 'Gross Revenue',
  description: 'Invoiced sales excluding VAT, counted in the period the invoice was issued. '
    + 'Cancelled invoices are excluded. Refunds are NOT deducted — see Net Revenue.',
  kind: 'additive', source: 'invoice_header',
  expr: (c) => `COALESCE(SUM(${c.revenue_ex_tax}), 0)`,
  format: 'currency', direction: 'higher_is_better', comparable: true,
  grains: ['none','day','week','month','quarter'], permission: 'analytics:view',
},

'sales.refunds': {
  id: 'sales.refunds', label: 'Refunds',
  description: 'Credit notes excluding VAT, counted in the period the credit note was issued — '
    + 'NOT the period of the original sale. A refund of an August sale raised in September '
    + 'appears in September.',
  kind: 'additive', source: 'credit_note_header',   // different source, different date column
  expr: (c) => `COALESCE(SUM(${c.revenue_ex_tax}), 0)`,
  format: 'currency', direction: 'lower_is_better', comparable: true,
  grains: ['none','day','week','month','quarter'], permission: 'analytics:view',
},

'sales.net_revenue': {
  id: 'sales.net_revenue', label: 'Net Revenue',
  description: 'Gross Revenue minus Refunds, each counted in its own period. '
    + 'This is the headline revenue figure.',
  kind: 'composite',
  terms: [
    { metric: 'sales.gross_revenue', sign:  1 },
    { metric: 'sales.refunds',       sign: -1 },
  ],
  exposeComponents: true,   // KPI tile shows "1.11M gross − 84k refunds" on hover
  format: 'currency', direction: 'higher_is_better', comparable: true,
  grains: ['none','day','week','month','quarter'], permission: 'analytics:view',
},

'sales.avg_ticket': {
  id: 'sales.avg_ticket', label: 'Average Ticket',
  description: 'Gross Revenue divided by invoice count. Deliberately uses GROSS, not net: a '
    + 'refund reverses a sale, it does not make the original transaction smaller.',
  kind: 'ratio',
  numerator: 'sales.gross_revenue', denominator: 'sales.invoice_count',
  zeroDenominator: null,
  format: 'currency', direction: 'higher_is_better', comparable: true,
  grains: ['none','day','week','month','quarter'], permission: 'analytics:view',
},

// registry/metrics/margin.js
'margin.gross_profit': {
  id: 'margin.gross_profit', label: 'Gross Profit',
  description: 'Ex-VAT revenue minus cost of goods sold, computed ONLY over invoice lines with a '
    + 'recorded cost. Lines with no cost are excluded from both sides, so this is a true profit '
    + 'on a subset of sales — never an estimate over all sales. Check the coverage badge.',
  kind: 'additive', source: 'invoice_line', trust: 'costed_line',
  expr: (c) => `COALESCE(SUM(${c.revenue_ex_tax} - (${c.quantity} * ${c.unit_cost})), 0)`,
  format: 'currency', direction: 'higher_is_better', comparable: true,
  grains: ['none','day','week','month','quarter'], permission: 'analytics:view',
},

'margin.gross_margin_pct': {
  id: 'margin.gross_margin_pct', label: 'Gross Margin',
  description: 'Gross Profit as a percentage of Costed Revenue. The denominator is costed '
    + 'revenue, not total revenue — dividing by total revenue would silently dilute the margin '
    + 'by the share of sales with no cost data.',
  kind: 'ratio',
  numerator: 'margin.gross_profit', denominator: 'margin.costed_revenue',
  scale: 100, zeroDenominator: null,
  format: 'percent', direction: 'higher_is_better', comparable: true,
  grains: ['none','day','week','month','quarter'], permission: 'analytics:view',
},

// registry/metrics/inventory.js
'inventory.dead_stock_value': {
  id: 'inventory.dead_stock_value', label: 'Dead Stock Value',
  description: 'Value of stock on hand for parts with no sale in the last 180 days. Parts never '
    + 'sold at all are included. Valued at weighted average cost.',
  kind: 'snapshot', source: 'inventory_snapshot', trust: 'wac_known',
  expr: (c) =>
    `COALESCE(SUM(${c.stock_on_hand} * ${c.wac_cost}) FILTER (
       WHERE ${c.stock_on_hand} > 0
         AND (${c.last_sold_at} IS NULL
              OR ${c.last_sold_at} < (CURRENT_DATE - INTERVAL '180 days'))), 0)`,
  format: 'currency', direction: 'lower_is_better',
  comparable: false, grains: ['none'],       // see §13 R5
  permission: 'analytics:view',
},

// registry/metrics/ar.js
'ar.dso': {
  id: 'ar.dso', label: 'Days Sales Outstanding',
  description: 'Average days to collect, measured over CREDIT sales only. Walk-in cash sales are '
    + 'excluded — including them (82% of revenue) would drag DSO toward zero and hide a genuine '
    + 'collection problem in the credit book.',
  kind: 'ratio',
  numerator: 'ar.balance', denominator: 'sales.credit_revenue',
  scale: { context: 'days_in_range' }, zeroDenominator: null,
  format: 'days', direction: 'lower_is_better',
  comparable: false, grains: ['none'], permission: 'analytics:view',
},

// registry/metrics/finance.js — scaffolded; renders "no data recorded"
'finance.operating_expenses': {
  id: 'finance.operating_expenses', label: 'Operating Expenses',
  description: 'Recorded expenses excluding cost of goods sold, by expense date.',
  kind: 'additive', source: 'expense',
  expr: (c) => `COALESCE(SUM(${c.amount}), 0)`,
  format: 'currency', direction: 'lower_is_better', comparable: true,
  grains: ['none','day','week','month','quarter'],
  permission: 'analytics:financials',   // NOT analytics:view
  readiness: 'expense_data',            // SELECT EXISTS(SELECT 1 FROM expense)
},
// finance.net_profit: composite [gross_profit +1, operating_expenses -1, payroll_cost -1],
// readiness: expense_data AND payroll_data
```

**Readiness probes** satisfy decision §3.4 without a failing query. `registry/readiness.js`
declares cheap `SELECT EXISTS(...)` probes; `/meta` runs them, caches for 5 minutes, and returns
`{ expense_data: false, payroll_data: false }`. The frontend renders a `NoDataYet` tile from that
flag and **never issues the query**.

### 6.5 The materialized-view swap, concretely

To move `invoice_line` behind a matview later, **only `SOURCES.invoice_line` changes** — no metric
file is touched:

```js
invoice_line: {
  from: `FROM mv_sales_line il`,
  dateColumn: 'il.invoice_date_manila',
  defaultWhere: () => [],                    // matview already excludes Cancelled
  cols: Object.freeze({
    line_id: 'il.line_id', invoice_id: 'il.invoice_id', part_id: 'il.part_id',
    quantity: 'il.quantity', revenue_ex_tax: 'il.revenue_ex_tax',
    unit_cost: 'il.unit_cost', discount: 'il.discount',
    customer_id: 'il.customer_id', employee_id: 'il.employee_id',
  }),
  joins: { part: `JOIN part p ON p.part_id = il.part_id`, /* ... */ },
  dimensions: ['date','part','brand','group','customer','customer_type','employee'],
}
```

**The contract is enforced by a test, not by hope** — see §11.1.

---

## 7. Fact Sources, Dimensions, and the Query Builder

### 7.1 Fact source contract

```js
/**
 * @typedef FactSource
 * @property {string} id, label
 * @property {string} grain            'invoice'|'invoice_line'|'credit_note'|'part'|'customer'|'expense'
 * @property {string} from             base FROM + mandatory JOINs. Table aliases are part of the
 *                                     contract and must survive a matview swap.
 * @property {string|null} dateColumn  raw timestamptz column; the builder wraps it in the standard
 *                                     Manila cast. NULL => snapshot source (no date filter).
 * @property {(params, opts) => string[]} defaultWhere   invariant predicates (status, is_active…)
 * @property {Readonly<Object<string,string>>} cols      logical name -> SQL expression
 * @property {string[]} dimensions     dimension ids this source can be broken down by
 * @property {Object<string,string>} joins   named optional JOIN fragments, pulled in on demand
 */
```

```js
// registry/sources.js  (abridged — the shape is the point)
invoice_header: {
  id: 'invoice_header', grain: 'invoice',
  from: `FROM invoice i`,
  dateColumn: 'i.invoice_date',
  defaultWhere: (params, { status }) => [
    buildStatusClause(status, params, { defaultFilter: 'active', column: 'i.status' }),
  ],
  cols: Object.freeze({
    invoice_id: 'i.invoice_id', revenue_ex_tax: 'i.subtotal_ex_tax',
    revenue_inc_tax: 'i.total_amount', tax: 'i.tax_total', amount_paid: 'i.amount_paid',
    customer_id: 'i.customer_id', employee_id: 'i.employee_id', due_date: 'i.due_date',
  }),
  joins: {
    customer: `LEFT JOIN customer cu ON cu.customer_id = i.customer_id`,
    employee: `LEFT JOIN employee e  ON e.employee_id  = i.employee_id`,
    payment_method: `LEFT JOIN LATERAL (
        SELECT ip.method_id FROM invoice_payments ip
        WHERE ip.invoice_id = i.invoice_id ORDER BY ip.payment_id LIMIT 1
      ) pm_pick ON TRUE
      LEFT JOIN payment_methods pm ON pm.method_id = pm_pick.method_id`,
  },
  dimensions: ['date','customer','customer_type','employee','payment_method','invoice_status'],
},

invoice_line: {
  id: 'invoice_line', grain: 'invoice_line',
  from: `FROM invoice_line il JOIN invoice i ON i.invoice_id = il.invoice_id`,
  dateColumn: 'i.invoice_date',            // a line is periodised by its INVOICE's date
  defaultWhere: (params, { status }) => [
    buildStatusClause(status, params, { defaultFilter: 'active', column: 'i.status' }),
  ],
  cols: Object.freeze({
    line_id: 'il.invoice_line_id', invoice_id: 'il.invoice_id', part_id: 'il.part_id',
    quantity: 'il.quantity',
    revenue_ex_tax: 'il.tax_base',         // matches reportingRoutes.js convention
    unit_cost: 'il.cost_at_sale', discount: 'il.discount_amount',
    customer_id: 'i.customer_id', employee_id: 'i.employee_id',
    __alias: 'il',                         // consumed by trust predicates
  }),
  joins: {
    part:  `JOIN part p ON p.part_id = il.part_id`,
    brand: `LEFT JOIN brand b ON b.brand_id = p.brand_id`,      // requires `part`
    group: `LEFT JOIN "group" g ON g.group_id = p.group_id`,    // requires `part`
    customer: `LEFT JOIN customer cu ON cu.customer_id = i.customer_id`,
    employee: `LEFT JOIN employee e ON e.employee_id = i.employee_id`,
  },
  dimensions: ['date','part','brand','group','customer','customer_type','employee'],
},

credit_note_header: {
  id: 'credit_note_header', grain: 'credit_note',
  from: `FROM credit_note cn`,
  dateColumn: 'cn.refund_date',            // THE reason refunds need their own source
  defaultWhere: () => [],
  cols: Object.freeze({
    cn_id: 'cn.cn_id', revenue_ex_tax: 'cn.subtotal_ex_tax',
    revenue_inc_tax: 'cn.total_amount', tax: 'cn.tax_total', invoice_id: 'cn.invoice_id',
  }),
  joins: {
    invoice:  `LEFT JOIN invoice i ON i.invoice_id = cn.invoice_id`,
    customer: `LEFT JOIN customer cu ON cu.customer_id = i.customer_id`,  // requires `invoice`
  },
  dimensions: ['date','customer','customer_type'],
  // NOTE: no 'brand'/'group'. credit_note_line has no cost snapshot, and joining it here would
  // double-count header amounts across a note's lines. See §13 R4.
},

inventory_snapshot: {
  id: 'inventory_snapshot', grain: 'part',
  from: `FROM part p
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(it.quantity), 0) AS soh
           FROM inventory_transaction it WHERE it.part_id = p.part_id) soh ON TRUE
         LEFT JOIN LATERAL (
           SELECT MAX((i2.invoice_date AT TIME ZONE 'Asia/Manila')::date) AS last_sold
           FROM invoice_line il2 JOIN invoice i2 ON i2.invoice_id = il2.invoice_id
           WHERE il2.part_id = p.part_id AND i2.status <> 'Cancelled') ls ON TRUE`,
  dateColumn: null,                        // snapshot: no date filter applied
  defaultWhere: () => [
    `p.is_service = FALSE`, `p.is_active = TRUE`, `p.merged_into_part_id IS NULL`,
  ],
  cols: Object.freeze({
    part_id: 'p.part_id', stock_on_hand: 'soh.soh', wac_cost: 'p.wac_cost',
    last_cost: 'p.last_cost', reorder_point: 'p.reorder_point', last_sold_at: 'ls.last_sold',
    __alias: 'p',
  }),
  joins: {
    brand: `LEFT JOIN brand b ON b.brand_id = p.brand_id`,
    group: `LEFT JOIN "group" g ON g.group_id = p.group_id`,
  },
  dimensions: ['part','brand','group'],
},

// ar_balance: FROM vw_customer_ar_balance v JOIN customer cu …  dateColumn: null
// expense:    FROM expense ex …  dateColumn: 'ex.expense_date'  readiness-gated
```

### 7.2 Dimensions and the closed grain map

```js
/**
 * @typedef Dimension
 * @property {string} id, label
 * @property {'time'|'entity'|'attribute'} kind
 * @property {(cols, src, ctx) => string} key    grouping key expression (stable id)
 * @property {(cols, src, ctx) => string} label  display expression
 * @property {string[]} requiresJoins            join names looked up in source.joins, in order
 * @property {boolean} filterable
 * @property {string=} lookup                    endpoint the UI uses to populate a filter picker
 */
const DIMENSIONS = {
  date: {
    kind: 'time', requiresJoins: [], filterable: false,
    key:   (c, s, { grainUnit }) =>
      `date_trunc('${grainUnit}', ${s.dateColumn} AT TIME ZONE 'Asia/Manila')`,
    label: (c, s, { grainUnit, dateFormat }) =>
      `to_char(date_trunc('${grainUnit}', ${s.dateColumn} AT TIME ZONE 'Asia/Manila'), '${dateFormat}')`,
  },
  brand:    { key: () => 'b.brand_id', label: () => `COALESCE(b.brand_name, '(No brand)')`,
              requiresJoins: ['part','brand'], filterable: true, lookup: '/brands' },
  group:    { key: () => 'g.group_id', label: () => `COALESCE(g.group_name, '(No group)')`,
              requiresJoins: ['part','group'], filterable: true, lookup: '/groups' },
  part:     { key: (c) => c.part_id,
              label: () => `(SELECT pv.display_name FROM public.parts_view pv WHERE pv.part_id = p.part_id)`,
              requiresJoins: ['part'], filterable: true, lookup: '/parts' },
  customer: { key: (c) => c.customer_id,
              label: () => `COALESCE(NULLIF(cu.company_name,''), cu.first_name || ' ' || cu.last_name)`,
              requiresJoins: ['customer'], filterable: true, lookup: '/customers' },
  customer_type: { key: () => 'cu.customer_type', label: () => 'cu.customer_type',
              requiresJoins: ['customer'], filterable: true, values: ['PRIVATE','GOVERNMENT'] },
  employee: { key: (c) => c.employee_id, label: () => `e.first_name || ' ' || e.last_name`,
              requiresJoins: ['employee'], filterable: true, lookup: '/employees' },
  payment_method: { key: () => 'pm.method_id', label: () => `COALESCE(pm.name,'(Unpaid)')`,
              requiresJoins: ['payment_method'], filterable: true },
  invoice_status: { key: () => 'i.status', label: () => 'i.status',
              requiresJoins: [], filterable: true },
  // supplier, tag: DEFINED (documents intent) but no phase-0 tile. `tag` fans out rows and must
  // be rejected with additive metrics unless the metric declares fanoutSafe. See §13 R4.
};

// The ONLY place a grain string reaches SQL.
const GRAINS = Object.freeze({
  day:     { unit: 'day',     dateFormat: 'YYYY-MM-DD', interval: '1 day' },
  week:    { unit: 'week',    dateFormat: 'IYYY-"W"IW', interval: '1 week' },
  month:   { unit: 'month',   dateFormat: 'YYYY-MM',    interval: '1 month' },
  quarter: { unit: 'quarter', dateFormat: 'YYYY-"Q"Q',  interval: '3 months' },
});
```

### 7.3 `buildQuery(spec) -> { text, values, plan }`

**Note:** the spec does **not** accept a `source`. Sources are derived from the metrics — passing
one is redundant and creates an invalid-request surface (`source: 'invoice_header'` +
`metrics: ['margin.gross_profit']`).

```js
/**
 * @typedef QuerySpec  (output of requestValidator.js — already fully resolved & safe)
 * @property {AnalyticsMetric[]} metrics    resolved registry objects, not ids
 * @property {Dimension[]} dimensions       resolved, ordered; `date` (if present) is always [0]
 * @property {{dimension, op:'in'|'eq', values:any[]}[]} filters
 * @property {string|null} grain            key in GRAINS, or null
 * @property {{from:string,to:string}} dateRange
 * @property {{mode:'previous_period'|'previous_year', dateRange:{from,to}}|null} compare
 * @property {{by:string, dir:'ASC'|'DESC'}|null} sort
 * @property {number} limit                 already clamped
 * @property {{status?:string}} sourceOptions
 */
```

#### Algorithm

**Step 1 — expand derived metrics.** Topologically resolve `composite.terms` and
`ratio.{numerator,denominator}` down to leaf `additive`/`snapshot` metrics. Cycle detection throws
at registry load, not query time. Yields `leafMetrics` (deduped) + `derivations` (ordered
post-aggregation expressions).

**Step 2 — group leaves by source.** `bySource: Map<sourceId, leafMetric[]>`.

**Step 3 — validate.** For each source in play:
- every requested dimension ∈ `source.dimensions`, else **400 with the exact reason**:
  `"Metric 'sales.net_revenue' cannot be broken down by 'brand': its refund component comes from
  credit notes, which carry no part detail."`
- `grain` ∈ every leaf metric's `grains`, else 400:
  `"'inventory.stock_value' is a point-in-time figure and cannot be broken down by month."`
- if a source has `dateColumn === null` but the query has a `date` dimension → 400.
- `sort.by` ∈ requested metric ids ∪ dimension ids.

**Step 4 — build one CTE per source.**

```sql
src_invoice_line AS (
  SELECT
    date_trunc('month', i.invoice_date AT TIME ZONE 'Asia/Manila')            AS dim_0,
    to_char(date_trunc('month', i.invoice_date AT TIME ZONE 'Asia/Manila'),
            'YYYY-MM')                                                        AS dim_0_label,
    b.brand_id                                                                AS dim_1,
    COALESCE(b.brand_name, '(No brand)')                                      AS dim_1_label,
    CASE WHEN (i.invoice_date AT TIME ZONE 'Asia/Manila')::date
              BETWEEN $1 AND $2 THEN 0 ELSE 1 END                             AS bucket,
    -- metric columns
    COALESCE(SUM(il.tax_base) FILTER (
      WHERE il.cost_at_sale IS NOT NULL AND il.cost_at_sale > 0), 0)          AS m_0,
    COALESCE(SUM(il.tax_base - (il.quantity * il.cost_at_sale)) FILTER (
      WHERE il.cost_at_sale IS NOT NULL AND il.cost_at_sale > 0), 0)          AS m_1,
    -- coverage columns: emitted ONCE per (source, trust rule), deduped across metrics
    COALESCE(SUM(il.tax_base) FILTER (
      WHERE il.cost_at_sale IS NOT NULL AND il.cost_at_sale > 0), 0)          AS cov_costed_line_num,
    COALESCE(SUM(il.tax_base), 0)                                             AS cov_costed_line_den,
    COUNT(*) FILTER (
      WHERE il.cost_at_sale IS NOT NULL AND il.cost_at_sale > 0)              AS cov_costed_line_num_rows,
    COUNT(*)                                                                  AS cov_costed_line_den_rows
  FROM invoice_line il
  JOIN invoice i ON i.invoice_id = il.invoice_id
  JOIN part p ON p.part_id = il.part_id
  LEFT JOIN brand b ON b.brand_id = p.brand_id
  WHERE ((i.invoice_date AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2
      OR (i.invoice_date AT TIME ZONE 'Asia/Manila')::date BETWEEN $3 AND $4)
    AND i.status <> 'Cancelled'
    AND b.brand_id = ANY($5::int[])
  GROUP BY 1, 2, 3, 4, 5
)
```

Column naming: dimensions `dim_N`, metrics `m_N`, coverage `cov_<rule>_*`. **No user-supplied
string ever becomes an identifier**, so a metric id containing `"` or `;` is structurally harmless
even before validation catches it.

**Step 5 — stitch (this is the refund-separation answer).** With one source, that CTE *is* the
result. With more than one:

```sql
keys AS (
  SELECT bucket, dim_0, dim_0_label, dim_1, dim_1_label FROM src_invoice_header
  UNION
  SELECT bucket, dim_0, dim_0_label, dim_1, dim_1_label FROM src_credit_note_header
),
joined AS (
  SELECT k.bucket, k.dim_0, k.dim_0_label, k.dim_1, k.dim_1_label,
         COALESCE(a.m_0, 0) AS m_0,     -- gross revenue
         COALESCE(b.m_0, 0) AS m_2      -- refunds
  FROM keys k
  LEFT JOIN src_invoice_header     a ON a.bucket IS NOT DISTINCT FROM k.bucket
                                    AND a.dim_0  IS NOT DISTINCT FROM k.dim_0
                                    AND a.dim_1  IS NOT DISTINCT FROM k.dim_1
  LEFT JOIN src_credit_note_header b ON b.bucket IS NOT DISTINCT FROM k.bucket
                                    AND b.dim_0  IS NOT DISTINCT FROM k.dim_0
                                    AND b.dim_1  IS NOT DISTINCT FROM k.dim_1
)
```

> **Why this matters.** Sales and refunds are different sources with different `dateColumn`s, so
> the generic "one CTE per source, UNION the keys, LEFT JOIN back" shape *automatically* produces
> the `taxReportRoutes.js` pattern. There is no special case and no rule to remember: the builder
> has **no code path** that puts `credit_note` and `invoice` in the same FROM clause. The
> documented incident becomes structurally unrepeatable.

`IS NOT DISTINCT FROM` rather than `USING`/`=`: `brand_id` is nullable and `NULL = NULL` is false,
so an equality join would silently drop the "(No brand)" row from every multi-source query —
exactly the class of silent wrong number this design exists to prevent. It costs hash-join
eligibility, irrelevant at 11.5k rows. Escape hatch for the matview era: COALESCE sentinel keys.

**Step 6 — final SELECT: derivations, ratios, coverage ratios.**

```sql
SELECT
  bucket, dim_0, dim_0_label, dim_1, dim_1_label,
  m_0, m_1, m_2,
  (m_0 - m_2)                                            AS d_net_revenue,
  CASE WHEN m_0 = 0 THEN NULL
       ELSE (m_1 / NULLIF(m_0, 0)) * $6 END              AS d_gross_margin_pct,  -- $6 = scale 100
  CASE WHEN cov_costed_line_den = 0 THEN NULL
       ELSE cov_costed_line_num / cov_costed_line_den END AS cov_costed_line_ratio,
  cov_costed_line_num, cov_costed_line_den,
  cov_costed_line_num_rows, cov_costed_line_den_rows
FROM joined
ORDER BY d_net_revenue DESC NULLS LAST, dim_0 ASC
LIMIT $7
```

Computing ratios **here, after aggregation**, is what guarantees a margin percentage is never an
average of per-row percentages, and that `net = gross − refunds` holds *per period* rather than
per invoice. `scale` is a positional param purely to keep the §7.5 invariant absolute.

**Grand totals: compute in JS from the `joined` rows.** Additive leaves are summable and
derivations are pure functions, so totals and rows provably agree, and there is one less SQL
branch. Do **not** sum row-level ratios.

**Step 7 — period comparison: one round trip via the `bucket` column.**

| approach | verdict |
|---|---|
| **bucket column, one query** | **Chosen.** One plan, one consistent snapshot, filters/joins written once, works identically for additive and ratio paths, reuses the whole dimension machinery. |
| two CTEs `UNION ALL` with literal tags | Equivalent result, more SQL, but preserves index-friendly single-range scans. Keep as a documented escape hatch. |
| two round trips | **Rejected.** Two `protect` DB hits, drift between snapshots, doubled cache entries, client must reconcile. |

The route pivots `bucket 0/1` into `{ values, compare: { values, delta, deltaPct } }` per key.

**Two comparison traps to design for explicitly:**

1. **Trend + compare must align by ordinal, not by date.** Emit `periodIndex` (0-based ordinal
   within its own range) so the frontend overlays "month 3 of current" against "month 3 of
   previous" without date arithmetic. Without it, `previous_year` overlays produce garbage.
2. **With 12 months of data, `previous_year` returns nothing for almost every range.** The
   response must carry `compare.available: false` rather than `deltaPct: -100`. A `-100%` on a KPI
   card reads as a business collapse.

**Phase-0 simplification:** enable `compare` only when `dimensions` is empty or `['date']`.
Dimensioned comparison roughly doubles pivot complexity for a tile nobody has asked for.

### 7.4 Coverage in the response

- Coverage columns emitted **once per (source, trust rule)**, deduped — three margin metrics
  sharing `costed_line` emit four columns, not twelve.
- Emitted at **row level and total level**, always. Four columns is free at this scale; the
  alternative is a second request when a user hovers a bar.
- Response shape per rule:

```js
{ rule: 'costed_line', label: 'Cost coverage',
  explanation: '…',                  // verbatim from the registry
  valueRatio: 0.205, rowRatio: 0.171,
  numValue: 2297769.23, denValue: 11195570.09,
  numRows: 1965, denRows: 11527,
  level: 'low' }                     // ok | partial | low | none
}
```

- `valueRatio` and `rowRatio` diverge sharply here. Show **both** in the badge tooltip; the
  headline is `valueRatio`, since that is what weights the margin.

### 7.5 The injection-safety invariant

> **No byte of `text` originates from the request.** Every fragment is either a literal in
> `queryBuilder.js` or a value read from the deep-frozen registry via a key that
> `requestValidator.js` resolved by exact match. Every request value appears only in `values`.

Enforcement, strongest first:

1. **Deep-freeze the registry** at load and validate all cross-references (metric→source,
   metric→trust, dimension→join, board→metric). A dangling reference **throws at `require()`
   time**, so the server refuses to boot rather than 500-ing one tile in production.
2. **`mustResolve(registry, id, kind)`** using `Object.prototype.hasOwnProperty.call` (not `in` —
   blocks `__proto__`, `constructor`), throwing `AnalyticsRequestError(400, …)` listing valid ids.
3. **`expr` / `key` / `label` take only registry objects.** The builder never holds a reference to
   request data at the point it calls them.
4. **Whitelists for the three interpolated things**: grain unit + date format (from `GRAINS`),
   sort direction (`'ASC'|'DESC'`), and `LIMIT` (a positional param anyway).
5. **Fuzz test** — adversarial ids/filters/grains/sorts (`"'; DROP TABLE invoice;--"`,
   `__proto__`, `constructor.prototype`, unicode homoglyphs) must yield **either** a 400 **or**
   SQL that provably does not contain the input substring.
6. **"No placeholders in registry SQL" test** — call every `expr` with its source's `cols` and
   assert the output contains no `$`.
7. **`EXPLAIN` smoke test** (see §11.1).

### 7.6 Filters

Every filter is `dimension IN (values)`, pushed as a single array param:

```js
whereParts.push(`${dim.key(cols, src, grainCtx)} = ANY($${params.push(values)}::int[])`);
```

Filter value types are declared per dimension (`int[]`, `text[]`) so the cast is registry-
controlled. **Free-text filters are not supported in Phase 0** — a `LIKE` filter is where an
injection review gets interesting for no user benefit.

### 7.7 The `plan` output

`buildQuery` also returns `plan`: `{ sources, leafMetrics, derivations, dimensionOrder, columnMap,
coverageRules, compareBuckets }`. `executor.js` uses `plan.columnMap` to shape rows and coerce
numerics **once, centrally, driven by the registry's `format`**.

---

## 8. HTTP Surface, Execution, and Caching

### 8.1 Endpoints

```
GET  /api/analytics/meta
       -> { version, metrics[], dimensions[], grains[], formats, trustRules[], readiness{}, budget }
       Permission-filtered per metric. ETag = sha256(registry version + user's permission set).
       Cache-Control: private, max-age=300.

GET  /api/analytics/boards
GET  /api/analytics/boards/:id
       -> board SPEC only (no data). Tiles whose metrics the user cannot see are stripped.

POST /api/analytics/query   { metrics, dimensions, filters, grain, dateRange, compare, sort, limit }
       -> { meta, rows, totals, coverage }

POST /api/analytics/batch   { queries: [{ key, ...querySpec }] }   // max 12
       -> { results: { [key]: {meta, rows, totals, coverage} | {error} } }
       Partial failure is per-key. One bad tile must not blank a board.

POST /api/analytics/query   { ..., format: 'csv' }
       -> text/csv via `new (require('json2csv').Parser)().parse(rows)`, matching the existing
          inline convention. Always over the UNPAGINATED (limit = maxRowsCsv) set.

POST /api/analytics/query?explain=1     (isAdmin only)
       -> { text, values, plan }. Does not execute. Invaluable for debugging and for writing
          builder tests against the real registry.
```

**`/batch` is load-bearing, not an optimization.** `protect`
(`packages/api/middleware/authMiddleware.js`) performs a JWT verify **and a joined query against
`employee`/`role_permission`/`permission` on every request**. A 12-tile board rendered as 12
requests costs 12 extra auth queries and 12 pool checkouts before any analytics work begins.

### 8.2 The capability envelope

Enforced in `requestValidator.js` **before a single character of SQL is built**:

```js
const BUDGET = Object.freeze({
  maxMetrics: 8,
  maxDimensions: 2,
  maxFilterValues: 200,      // per filter
  maxRangeDays: 731,
  maxRowsJson: 500,
  maxRowsCsv: 5000,
  maxBatchQueries: 12,
  timeoutMs: 8000,
});
```

Plus: every metric carries a `permission`; the validator intersects the request's metric set with
`req.user` via `userHasPermission` and **403s on the specific metric**. Every dimension must be
compatible with every metric's source. Anything else → 400 with a precise, actionable message.

Always append `LIMIT`. When `rows.length === limit`, set `meta.truncated = true` and the tile
renders "showing top 200 of more" — silence here is how a chart lies.

### 8.3 Executor — `SET LOCAL`, not a pool-wide timeout

**Do NOT set `statement_timeout` on the pool in `packages/api/db.js`.** That file's
`query`/`getClient` are used by GRN posting, backups, the dedupe scan worker, Meili outbox workers,
and payroll. A pool-wide timeout is a silent behavioural change to every one of them.

```js
// executor.js
async function execute({ text, values }, { timeoutMs = 8000 }) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ');
    await client.query(`SET LOCAL statement_timeout = ${Number(timeoutMs)}`);
    await client.query(`SET LOCAL idle_in_transaction_session_timeout = 15000`);
    const res = await client.query(text, values);
    await client.query('COMMIT');
    return res;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
```

Four properties, all needed:

- `SET LOCAL` reverts on COMMIT/ROLLBACK — **the pooled connection is never polluted.**
- `READ ONLY` makes a write from an analytics bug impossible at the database level.
- `REPEATABLE READ` + running all of a batch's queries **serially on this one client** gives every
  tile on a board the same snapshot, eliminating "the KPI card and the chart disagree". At <50ms
  per query, 12 serial queries is ~0.5s — imperceptible, and a better trade than parallelism here.
- A runaway query dies in 8s instead of pinning a pool connection.

> If this design contributes one line to the codebase, it should be `SET LOCAL statement_timeout`.

**Concurrency semaphore:** max 4 concurrent analytics executions, queue the rest, 503 past a queue
depth of 20. **POS must never stall because someone opened a dashboard.** This matters more than
the timeout.

### 8.4 Cache

`analyticsCache.js` mirrors `packages/api/services/ai/core/aiCache.js` exactly (Map + SHA-256 key +
TTL + FIFO eviction). Key = `sha256(text + JSON.stringify(values))` — the SQL already encodes the
user's permission-filtered metric set, so no separate user dimension is needed.

**TTL 60s** — long enough to absorb a board's render storm and tab-flipping, short enough that a
cashier's sale shows up quickly. Bypass with `?fresh=1`. Max 200 entries. Tiles show `meta.cached`
age and offer refresh.

---

## 9. Phases

Each phase is a mergeable branch off `business-analytics`.

### Phase 0 — Foundation + Overview  *(NOT STARTED — start here)*

Metric/dimension registries, fact sources, query builder, period math, coverage, cache;
`analyticsRoutes.js` with `/meta`, `/boards/:id`, `/query`, `/batch`; the executor with `SET LOCAL`
and the semaphore; `analytics:view` / `analytics:financials` / `analytics:export` permissions and
settings migration; page shell, board renderer, tile framework, `useAnalyticsQuery`,
`AnalyticsBatchContext`; the **Overview** board; nav + `MainLayout` wiring; the §11 test suite.

**Scope discipline — ship exactly:**
- **Four tile types**: `kpi`, `line`, `bar`, `table`. Not `heatmap`, `meter`, `narrative`,
  `stacked-bar`, `list` — every unbuilt-for tile type is untested code that will be wrong the
  first time it is used.
- **One board**: Overview.
- **No dimensioned comparison** — compare only for non-dimensioned KPIs and date-grained trends.
- **No insights endpoint** (§14).
- The remaining metrics (inventory, AR, scaffolded finance) exist as **registry entries** from day
  one. They cost nothing and break nothing because no tile queries them yet.

*This phase determines whether the rest is cheap. Everything after is content. When Phase 1 needs
"Sales by brand" and it is a board-spec entry, the design has proved itself.*

### Phase 1 — Sales + Inventory  *(NOT STARTED)*
The two highest-value boards. Adds `heatmap` and richer `table` tiles, top-N + "Other" rollup,
CSV export, drill-down into existing pages.

### Phase 2 — Profitability + Data Trust  *(NOT STARTED)*
Margin metrics with coverage enforcement; the trust scorecard. Delivered together because neither
is honest without the other. **Also migrate `/reports/profitability-by-product` onto the registry**
(scheduled here, not aspirational — see §13 R2).

### Phase 3 — Customers + Receivables & Cash  *(NOT STARTED)*
Pareto/cohort tile types; AR aging from the ledger views; the insights panel (§14) may land here.

### Phase 4 — Purchasing & Suppliers, Operations  *(NOT STARTED)*
Supplier analytics, lead time, price variance; staff productivity and cycle-count accuracy
(reusing the existing `employee_cycle_count_performance` materialized view).

### Phase 5 — Designed for, not scheduled
Saved views; scheduled email digests; threshold alerts via the existing notification service;
user-customizable boards (moves board specs from config to an `analytics_board` table whose rows
pass through the **same validator**); forecasting.

---

## 10. Frontend

### 10.1 Tile spec

```jsonc
{
  "id": "overview.net_revenue",
  "type": "kpi",                              // phase 0: kpi | line | bar | table
  "title": "Net Revenue",                     // optional; defaults to the metric's registry label
  "help": null,                               // optional; defaults to registry description
  "span": { "base": 12, "md": 6, "lg": 3 },   // 12-col grid

  "query": {
    "metrics": ["sales.net_revenue"],
    "dimensions": [], "grain": null, "filters": {},
    "compare": "previous_period", "sort": null, "limit": null
  },

  "display": {
    "value": "sales.net_revenue",
    "compare": { "show": true },
    "coverage": { "show": false },
    "components": { "show": "hover" },        // composite: "1.11M gross − 84k refunds"
    "sparkline": { "metric": "sales.net_revenue", "grain": "week" }
  },

  "drilldown": {
    "kind": "page",                           // page | tile | filter  (closed vocabulary)
    "page": "sales_history",
    "params": { "startDate": "$dateRange.from", "endDate": "$dateRange.to" }
  }
}
```

**The rule that makes "no new React component" true:** `display` never contains a label, format,
unit, direction, or colour derived from the metric. All of those come from `/meta` keyed by metric
id. `display` contains only *layout* and *overrides*. Adding a metric to a board = one registry
entry + one board-spec entry.

**`drilldown` is a closed vocabulary, never a URL:**
- `{kind:'page', page, params}` → `onNavigate(page, params)` into the existing `MainLayout` switch.
- `{kind:'tile', tileId}` → opens that tile in the existing `Drawer`, with the clicked row's key
  merged into `filters`.
- `{kind:'filter', dimension}` → adds the clicked key as a board-level filter.

`$dateRange.from` / `$filters.brand` are a **closed macro vocabulary** resolved client-side from
board state — a token substitution table, not an expression language.

### 10.2 Components

```
packages/web/src/
  pages/AnalyticsPage.jsx
  components/analytics/
    AnalyticsBoard.jsx        # fetches /boards/:id, owns board state (date range, filters,
                              #   compare), renders the grid, provides the batch context
    AnalyticsBatchContext.jsx # collects tile queries in a microtask -> one POST /batch
    AnalyticsTile.jsx         # switch(spec.type) -> a tile component
    TileShell.jsx             # title + InfoTip + CoverageBadge + menu (Export CSV, Drill down)
                              #   + LoadingState/EmptyState/ErrorState from components/ui
    NoDataYet.jsx             # readiness === false state
    chartTheme.js             # CHART_THEME + useChartTheme, EXTRACTED from AnalyticsCharts.jsx
    tiles/{KpiTile,LineTile,BarTile,TableTile}.jsx
  hooks/
    useAnalyticsMeta.js       # fetch /meta once, context-provided; metric(id), format(id, v)
    useAnalyticsQuery.js      # per-tile; registers with batch context, memoized cache key
```

```js
const { data, meta, loading, error, refetch } =
  useAnalyticsQuery(spec.query, { boardState, skip: !ready });
```

Behaviour: resolve `$` macros against `boardState`; compute a stable cache key; register the spec
with `AnalyticsBatchContext`, which flushes on `queueMicrotask` → **one `POST /batch` per board
render**; dedupe identical specs across tiles (a KPI and its sparkline often share a query); abort
in-flight requests on unmount / date-range change via `AbortController`.

```jsx
// AnalyticsTile.jsx — the entire dispatch
const TILE_TYPES = { kpi: KpiTile, line: LineTile, bar: BarTile, table: TableTile };

export default function AnalyticsTile({ spec, boardState, onNavigate }) {
  const { metric, readiness } = useAnalyticsMeta();
  const { data, meta, loading, error, refetch } = useAnalyticsQuery(spec.query, { boardState });
  const Body = TILE_TYPES[spec.type];
  if (!Body) return null;   // unknown type from a newer server: degrade, never crash

  const primary = metric(spec.display?.value ?? spec.query.metrics[0]);
  const ready = !primary?.readiness || readiness[primary.readiness];

  return (
    <TileShell
      title={spec.title ?? primary?.label}
      help={spec.help ?? primary?.description}
      coverage={spec.display?.coverage?.show ? data?.coverage : null}
      truncated={meta?.truncated}
      loading={loading} error={error} onRetry={refetch} span={spec.span}
      actions={{ onExportCsv: () => exportTile(spec, boardState), onDrilldown: /* … */ }}
    >
      {!ready ? <NoDataYet metric={primary} /> : <Body spec={spec} data={data} meta={meta} />}
    </TileShell>
  );
}
```

### 10.3 The coverage badge

**Reuse `packages/web/src/components/ui/CostCoverageNotice.jsx`, shipped in PR #171.**

| `level` | presentation |
|---|---|
| `ok` (≥90%) | subtle grey "97% cost coverage"; number shown normally |
| `partial` (50–90%) | amber chip "61% cost coverage"; tooltip explains the exclusion verbatim |
| `low` (<50%) | amber chip; number in muted weight; tooltip + "Fix cost data" link to `cost_data_health` |
| `none` (0%) | **no number at all** — "No cost data for this period" |

That last row is the requirement. A `0%` margin badge reads as "we made no money"; "no cost data"
reads as "we don't know". **They must not look alike.**

### 10.4 Chart theming

Extract `CHART_THEME` and `useChartTheme` from
`packages/web/src/components/dashboard/AnalyticsCharts.jsx:17-41` into
`components/analytics/chartTheme.js` and re-export from `AnalyticsCharts.jsx` so the existing
Dashboard is untouched. recharts paints inline SVG styles, so Tailwind `dark:` classes do not reach
it — colours must be picked in JS from `useTheme().mode` (which already resolves "system").

The current theme has one line colour and one bar colour; **a categorical series palette of ~6
colours (light + dark variants) needs adding** for multi-series tiles.

### 10.5 Board specs live server-side

`packages/api/services/analytics/boards/*.js` — JS modules, not JSON files, so they can reference
metric-id constants and be validated at boot. The argument:

1. **Permission filtering must happen server-side anyway.** A tile using `finance.net_profit` must
   be stripped for a user without `analytics:financials`. Client-side specs duplicate that logic,
   and the client copy is the one that's wrong.
2. **Boot-time validation.** A tile referencing a renamed metric fails server startup and the test
   suite, loudly. A client-side constant fails silently as a blank tile in production.
3. **The migration to user-customizable boards is free.** Add
   `analytics_board (board_id, owner_employee_id, name, spec jsonb, is_system)`; `/boards` returns
   built-ins ∪ the user's rows, both through the **same validator**.
4. **Counter-argument acknowledged:** server-side specs mean tweaking a board needs an API deploy.
   In a multi-tenant SaaS that would be a real cost. Here `packages/api` and `packages/web` are one
   repo, one `docker-compose`, deployed together. The cost is zero.

Client-side owns **board *state*** — selected date range, active filters, compare mode, tile
collapse — persisted per user in `localStorage` via the existing `useLocalStorage` hook.

### 10.6 Navigation wiring

Add to `packages/web/src/config/navigation.js`, in the existing `system` category
(`'System & Analytics'`), above Reporting:

```js
{ name: 'Analytics', icon: ICONS.reporting, page: 'analytics', permission: 'analytics:view',
  keywords: ['insights','kpi','metrics','business intelligence','margin','dashboard'] },
```

**Move the `analytics` keyword off the existing `Reporting` item** so the command palette resolves
"analytics" to the new page. Then one `case 'analytics': return <AnalyticsPage />;` in
`MainLayout.jsx`. `Sidebar.jsx` and `CommandPalette.jsx` both render from `navigation.js`, so no
further registration is needed.

### 10.7 Visualization rules

**Load the `dataviz` skill before writing any chart code** — `CLAUDE.md` mandates it for
`packages/web`, and it must be loaded *before* choosing colours or layout, not after.

- Form follows the data's job: trend → line; magnitude → bar; part-to-whole → stacked bar; a single
  value → stat tile, **never a one-bar chart**; >7 meaningful classes → table.
- **Never a dual-axis chart.** Revenue and margin % are two charts, or indexed to a common base.
- Categorical hues assigned in fixed order, never cycled. **Colour follows the entity, not its
  rank** — a filter that changes the series count must not repaint the survivors.
- **444 brands and 767 groups**: every categorical breakdown defaults to top-N with the tail folded
  into "Other". Never generate additional hues.
- Legend present for ≥2 series; ≤4 series also direct-labelled. Figures carry the `.tnum` class
  (defined in `index.css` for tabular numerals).
- Validate the palette with the skill's `scripts/validate_palette.js` in **both** light and dark
  before shipping. Input is the project's `@theme` tokens in `packages/web/src/index.css`; note
  `primary`/`accent` are admin-brandable at runtime, so validation covers the default brand only.

### 10.8 Making it understandable to non-professionals

- Every metric ships a plain-language `description` and formula sentence, surfaced through the
  existing `InfoTip` — same voice as `docs/manuals/reporting_manual.md`.
- Comparison is always labelled in words ("vs previous 30 days"), never a bare arrow.
- Coverage badges state their own limits in plain words rather than showing a confident wrong
  number.

---

## 11. Testing & Verification

Per `.agents/rules/04-docker-execution.md`, backend commands run **inside the container**:
`docker exec forson_backend_dev npm run test`. Per `.agents/rules/05-testing-protocol.md`, tests
are mandatory for new logic and must pass 100% before declaring anything complete.

### 11.1 Phase-0 test suite, in priority order

1. **`tests/analyticsRegistry_db_test.js`** — *the cheapest high-value test in the plan.* For every
   metric, build a canonical query and run **`EXPLAIN`** (never `EXECUTE`). Proves every metric's
   SQL parses and every column it names exists, catching registry/schema drift at test time instead
   of one tile at a time in production. Note the `*_db_test.js` suffix: these are excluded from
   `testMatch` and run manually against a live DB inside a rolled-back transaction, matching
   `arLedgerSafetyNet_db_test.js`.
2. **`tests/analyticsQueryBuilder.test.js`** — snapshot the generated SQL for ~10 canonical specs,
   **including the multi-source refund case and the compare case**. Snapshot tests on generated SQL
   are exactly right here: any change to a number becomes a visible diff in review.
3. **Injection fuzz test** — §7.5 item 5. Twenty lines; catches the entire class.
4. **`tests/analyticsRoutes.test.js`** — follow `packages/api/tests/arRoutes.test.js`: `jest.mock`
   the db and auth middleware, mount the real router on a bare express app, supertest. Assert the
   happy path, a **400 on an invalid metric id**, a **403 on a missing permission**, a **500 on a
   DB error**, and **partial batch failure** (one bad key must not fail the whole request).

> **Gotcha learned in PR #171:** `helpers/partNumberSoftDelete.js` fires an `information_schema`
> probe via `db.query` on module load, so `db.query.mock.calls[0]` is **not** your route's query.
> Select the SQL under test by shape, not by call index.

### 11.2 Numeric agreement

Analytics figures for a fixed date range must reconcile against the existing
`/api/reports/sales-summary` **as corrected by PR #171**. Any disagreement is a bug in the new
layer, not a new truth. Verify directly with `docker exec forson_db psql`.

**Expected first-render values (12 months to 2026-09-06):**

| Metric | Expected |
|---|---|
| Gross revenue | ~₱11.20M |
| Costed revenue | ₱2,297,769 |
| COGS (costed) | ₱1,539,693 |
| Measured gross profit | ₱758,076 |
| Measured gross margin | **33.0%** |
| Cost coverage (value) | **~20.5%** → level `low` |
| Cost coverage (rows) | 1,965 of 11,527 → ~17.1% |
| Inventory value @ WAC | ~₱2.61M |
| Dead stock value | ~₱1.55M (60%) |
| Refund rate | 3.64% of revenue |

### 11.3 Live check

Use the `run` skill to bring up the dev stack and open `localhost:5173`. Confirm each tile renders,
the period switcher and comparison work, coverage badges show ~20% cost coverage, CSV export
downloads, drill-down links land on the right pages, and **both light and dark themes** are correct.

### 11.4 Before merge

- `security-review` skill — this feature adds a parameterized query surface and new permission
  keys, and `CLAUDE.md` requires a security pass for auth-touching changes in `packages/api`.
- `graphify update .` after the code lands.
- `docker exec forson_backend_dev npm run migrate:status` before and after applying the migration.

---

## 12. Files

### New — API
- `packages/api/services/analytics/` — `index.js`, `errors.js`, `queryBuilder.js`,
  `requestValidator.js`, `executor.js`, `analyticsCache.js`, `periods.js`
- `packages/api/services/analytics/registry/` — `index.js`, `formats.js`, `trust.js`,
  `readiness.js`, `sources.js`, `dimensions.js`, `metrics/{index,sales,margin,inventory,ar,finance}.js`
- `packages/api/services/analytics/boards/` — `index.js`, `overview.js` (+ `sales.js`,
  `inventory.js` in Phase 1)
- `packages/api/routes/analyticsRoutes.js`
- `packages/api/tests/` — `analyticsRegistry_db_test.js`, `analyticsQueryBuilder.test.js`,
  `analyticsRoutes.test.js`

### New — Web
- `packages/web/src/pages/AnalyticsPage.jsx`
- `packages/web/src/components/analytics/` — `AnalyticsBoard.jsx`, `AnalyticsBatchContext.jsx`,
  `AnalyticsTile.jsx`, `TileShell.jsx`, `NoDataYet.jsx`, `chartTheme.js`,
  `tiles/{KpiTile,LineTile,BarTile,TableTile}.jsx`
- `packages/web/src/hooks/` — `useAnalyticsMeta.js`, `useAnalyticsQuery.js`
- `packages/web/src/components/settings/AnalyticsSettings.jsx`

### New — Database
- `database/migrations/YYYYMMDD_NN_analytics_permissions_and_settings.sql`

> **Migration filename rules** (`.agents/rules/03-database-migrations.md`): use the **Asia/Manila**
> date, and include the two-digit sequence prefix (`_01_`) whenever multiple migrations share a
> date — plain alphabetical sort puts `0` before `c`. **Migrations are immutable once merged**; fix
> forward, never edit.

### Modified (small, surgical)
- `packages/api/index.js` — one `registerRoute('/api', './routes/analyticsRoutes')` line, in the
  "Admin & System Modules" block near `dashboardRoutes`/`reportingRoutes`.
- `packages/web/src/config/navigation.js` — one item; move the `analytics` keyword off `Reporting`.
- `packages/web/src/components/layout/MainLayout.jsx` — one import + one `switch` case.
- `packages/web/src/constants.js` — an `ICONS.analytics` path if a distinct icon is wanted.
- `packages/web/src/components/dashboard/AnalyticsCharts.jsx` — extract `CHART_THEME` /
  `useChartTheme`, re-export for compatibility.
- `packages/web/src/pages/SettingsPage.jsx` — mount `AnalyticsSettings`.
- `docs/manuals/business_analytics_manual.md` — new, following `docs/manuals/STANDARDS.md`.

> **Verified while planning:** `PermissionsSettings.jsx` needs **no change** — it renders whatever
> `GET /permissions` returns, grouped by the permission's `category`, so a migration-seeded key
> appears in the admin UI automatically. Feature *settings*, by contrast, are hand-rendered per key
> in `SettingsPage.jsx`, so they do need the new panel.

---

## 13. Permissions, Settings, and Risks

### 13.1 Permissions

`.agents/rules/06-feature-permissions-and-admin-settings.md` makes RBAC **and** Admin Settings
integration mandatory before the feature can be called complete.

**Do not reuse `reports:view`** — it is already granted to five roles.

```sql
INSERT INTO public.permission (permission_key, description, category) VALUES
    ('analytics:view',       'View Analytics',           'Administration'),
    ('analytics:financials', 'View Financial Analytics', 'Administration'),
    ('analytics:export',     'Export Analytics Data',    'Administration')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO public.role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
  FROM public.permission_level pl CROSS JOIN public.permission p
 WHERE pl.level_name IN ('Admin', 'Manager')
   AND p.permission_key IN ('analytics:view', 'analytics:financials', 'analytics:export')
ON CONFLICT DO NOTHING;
```

Pattern mirrors `database/migrations/20260906_06_ar_adjustment_permissions_and_settings.sql`.
Prefer `level_name` over hardcoded numeric ids. Note `permission_level_id = 10` (Admin) **bypasses
all permission checks** in `hasPermission`, which is correct here.

Enforcement at three layers: `hasPermission()` middleware on the routes; a per-metric `permission`
field so a restricted metric is stripped from `/meta` and refused by `/query`; and
`hasPermission()` gating in the nav item and the board renderer.

### 13.2 Settings

Seeded in the same migration. **A key must exist before Admin Settings can edit it** — the
`PUT /settings` handler only `UPDATE`s, never upserts (verified in `settingsRoutes.js`).

| Key | Purpose |
|---|---|
| `ANALYTICS_ENABLED` | feature toggle |
| `ANALYTICS_DEFAULT_PERIOD` | default date preset |
| `ANALYTICS_CACHE_TTL_SECONDS` | query cache lifetime |
| `ANALYTICS_LOW_COVERAGE_THRESHOLD` | coverage % below which a metric shows a warning state |

### 13.3 Risks — where this will actually go wrong

**R1 — `cost_at_sale = 0` ambiguity is load-bearing for the entire margin story.** 83% of lines.
The predicate cannot distinguish a genuinely free good from a missing cost, so it excludes free
goods and understates margin. **Every historical margin number moves if that predicate changes.**
*Mitigations:* one named trust rule reusing `helpers/costCoverage.js`; expose the explanation
verbatim in `/meta` and the badge; put a dedicated "Cost data coverage" tile on Overview so the
user watches the denominator, not just the ratio; link the badge to `cost_data_health`.
**Open decision:** the write paths (`invoiceRoutes.js:586`, `stagedSaleRoutes.js:508`) still record
`0` for unknown cost, so coverage degrades with every sale. Writing `NULL` matches the semantics
the schema documents for `inventory_transaction.unit_cost`, but it feeds WAC recomputation and
needs its own review.

**R2 — The new page will disagree with the old Reports page, and it will be reported as a bug.**
Largely mitigated by PR #171, which corrected the old endpoints. Remaining exposure: anyone
comparing against a pre-#171 export or screenshot. *Mitigations:* an `InfoTip` explaining the
difference; migrate `/reports/profitability-by-product` onto the registry in Phase 2 **as a
scheduled item**.

**R3 — Correct refund periodisation will still be misread.** Net Revenue for September correctly
includes September-issued refunds against August sales. A KPI showing "Net Revenue ↓ 8%" after one
large refund lands will be read as a sales collapse. *Mitigation:* `exposeComponents` is
first-class for composites; default `display.components.show: 'hover'` on every composite KPI.

**R4 — Cross-source dimension mismatches produce plausible-looking wrong numbers.**
`credit_note_header` is per-credit-note; `credit_note_line` carries no cost. Naively allowing a
`brand` breakdown of `sales.net_revenue` by joining `credit_note_line` would double-count header
amounts across a note's lines. *Mitigation:* the source's `dimensions` array is the guard, and the
builder must **fail loudly with the reason** rather than silently dropping the refund term. A
composite whose terms don't all support the requested dimension is a **400, never a partial
answer.** The same applies to `tag`, which fans out rows.

**R5 — Snapshot metrics under a grain will silently repeat today's value per month.** Nearly
certain if not designed against. *Mitigation:* `grains: ['none']` on snapshot metrics plus an
explicit builder rejection. Historical stock-as-of-date *is* computable from
`inventory_transaction` (`SUM(quantity) WHERE trans_date <= period_end`) but it is a fundamentally
different and much more expensive query — a Phase-3 `inventory_history` source, **not a grain on
the existing one**.

**R6 — DSO over 82% walk-in cash revenue is worse than no metric.** It will read ~5 days and
conceal a real 60-day problem in the 18% credit book. This is a *registry-design* failure mode —
exactly the class a semantic layer should make visible. *Mitigation:* define
`sales.credit_revenue` (excluding the walk-in customer / cash payment methods) as DSO's
denominator, and say so in the description. **The same scrutiny applies to Average Ticket and every
per-customer metric** — the walk-in record distorts all of them.

**R7 — `protect` costs a DB round trip and a log line per request.** Justifies `/batch` (§8.1).
Analytics traffic will also make the auth middleware's per-request logging noisy.

**R8 — No `statement_timeout` exists anywhere today.** One bad exploratory query can pin a pool
connection and stall POS. `SET LOCAL` + the semaphore belong in Phase 0, not "later".

**R9 — Registry/schema drift breaks metrics at query time, in production, one tile at a time.**
*Mitigation:* the `EXPLAIN` db-test (§11.1 item 1).

**R10 — Cache staleness at a POS counter.** 60s TTL is the right trade, but tiles must show cache
age and offer refresh.

**R11 — `IS NOT DISTINCT FROM` loses hash-join eligibility.** Irrelevant at 11.5k rows; will matter
at matview scale. The sentinel-`COALESCE` escape hatch is noted in the source contract so a future
author does not have to rediscover why the join is written that way.

**R12 — Scope.** Eight boards is a lot of surface. Phasing is the control; **Phase 0 must not grow
to include board content.**

**R13 — Only 12 months of history.** Year-over-year is unavailable for most of the first year of
use. Offer it, but return `compare.available: false` rather than a misleading `-100%`.

---

## 14. The Boards

Eight boards, delivered per §9. Each is a **spec entry, not a bespoke page.**

| Board | What it answers | Key tiles |
|---|---|---|
| **Overview** | "How are we doing versus last period?" | Hero net revenue + comparison; KPI row (net revenue, gross profit w/ coverage, invoices, average ticket, AR outstanding, inventory value); revenue trend with previous-period overlay; data-coverage strip |
| **Sales** | "What sold, when, through whom?" | Trend by day/week/month; revenue by brand / group (top-N + Other); hour × weekday heatmap; top and bottom products; basket metrics; payment-method mix; cashier comparison; refund-rate trend |
| **Inventory** | "Where is our money sitting?" | Inventory value and composition; **dead & slow stock matrix** (movement × value); **demand-ranked reorder list** (days of cover from 90-day velocity, *not* the reorder-point flag — see §2); inventory turns; days-since-last-movement aging; no-cost and negative-stock counts linking to Cost Data Health |
| **Profitability** | "Where does margin actually come from?" | Measurable gross margin by product / brand / group; margin distribution; discount impact; price-vs-cost — all gated behind the coverage badge |
| **Data Trust** | "How much of this can I believe?" | Cost coverage over time; parts with stock but no cost; negative stock; unlinked receipts; a plain-language scorecard linking to the remediation pages that already exist |
| **Customers** | "Who are the named accounts and what is the exposure?" | Revenue concentration (Pareto); new vs returning; retention cohort; credit exposure vs `customer.credit_limit`; government vs private split |
| **Receivables & Cash** | "Who owes us and how fast do we collect?" | Current AR position and aging from `vw_customer_ar_balance` (authoritative); concessions and write-downs granted; cheque/PDC pipeline. **DSO and collection-effectiveness trends are registered but render an era notice** until `ar_ledger` has more than its current three weeks of history |
| **Purchasing & Suppliers** | "What do we buy, from whom, at what price?" | Spend by supplier and concentration; goods-receipt lead time; purchase price variance; free-goods received |

Operating-P&L metrics (opex by category, payroll cost, net profit) are registered now and appear on
Overview and Profitability in a "not being recorded yet" state until the Expenses and Payroll
modules carry data.

### The insights panel — DEFERRED (owner decision)

**Status: deferred to after Phase 2.** Generated prose is the highest-risk-per-line part of this
feature on data this uneven, and it is the part a reader trusts most because it reads like a
colleague talking. It ships once the coverage layer has been used on real data.

When it does ship: **deterministic rules only, declared in the registry, never LLM-generated**, and
every insight must carry the metric ids and coverage it was derived from so it can be clicked
through and disproved.

```js
{ id: 'insight.margin_low_coverage',
  when: { metric: 'margin.gross_margin_pct', coverageBelow: 0.5 },
  severity: 'warning',
  template: 'Margin is calculated over only {coveragePct} of revenue — {uncostedCount} of '
          + '{totalCount} lines have no recorded cost.',
  cites: ['margin.gross_margin_pct'],
  action: { page: 'cost_data_health' } }
```

Seed rules, with what they would say against today's data:

| Rule | Fires when | Example output today |
|---|---|---|
| Dead stock | Non-moving stock value > 25% of inventory value | "₱1.55M — 60% of your stock value — has not sold in 12 months." |
| Cost coverage | Costed revenue < 80% of total revenue | "Margin is measured on only 20% of sales; cost is missing on 9,566 lines." |
| Reorder | Any part has < 14 days of cover at its 90-day rate | "58 items that are actively selling will run out within two weeks." |
| Customer concentration | Top named account > 20% of named-customer revenue | Concentration risk → Customers board |
| Period movement | Revenue moves > 10% versus the previous period | "Revenue is down 12% versus the previous 30 days." |
| Refund spike | Refund rate exceeds trailing average by > 50% | Baseline is 3.64% of revenue |
| Stocked-but-uncosted | Parts with stock and no cost basis > 500 | "1,852 stocked items have no cost, so their value is understated." |

Thresholds live in the registry, not scattered in code, so they become admin-tunable without
touching rule logic.

---

## 15. Explicitly Out of Scope

Named so the phases do not quietly absorb them:

- No data warehouse, star schema, or ETL pipeline.
- No OLAP/cube engine.
- No third-party BI embed (Metabase, Superset).
- No LLM-generated narrative in Phases 0–4.
- No forecasting or anomaly-detection models.
- No changes to `Dashboard.jsx` or `ReportingPage.jsx` (beyond the PR #171 corrections already
  shipped).
- **No mobile analytics.** `packages/mobile` is deliberately scoped to staff operations; back-office
  finance stays out of it.

---

## 16. The Alternative That Was Rejected

The simpler option is a set of named endpoints — `/api/analytics/sales-trend`,
`/api/analytics/dead-stock` — each with hand-written SQL, mirroring how `reportingRoutes.js` already
works. It is faster to write the first three tiles and needs no query builder.

**Rejected for two reasons specific to this codebase:**

1. `reportingRoutes.js` is already 733 lines of nine near-identical handlers, with the same
   date/status/pagination/CSV logic copy-pasted through every one. An eight-board analytics page
   built that way would add roughly forty more.
2. **The coverage-and-provenance requirement is cross-cutting.** Every margin metric needs its
   costed-subset figures; every AR metric needs its data era. In the named-endpoint shape that logic
   is re-implemented per endpoint and will drift — which is precisely how
   `reportingRoutes.js:630` came to disagree with `taxReportRoutes.js` about what profit means, and
   how the ₱9.6M overstatement survived for a year.

**Judge this design by the maintainability criterion, not the sophistication one.** If, six months
in, changing the definition of gross margin requires touching more than
`registry/metrics/margin.js`, the design failed and the machinery bought nothing.

---

## 17. What Phase 0 Actually Shipped

Everything §9 lists for Phase 0 is built, live against the real database, and covered by tests.
This section records only where the implementation diverges from §5–§12, and what the build learned
about the data that §2 did not know.

### 17.1 The metric contract changed shape (and this matters)

§6.2 has `expr` return a complete aggregate: `expr: (c) => COALESCE(SUM(...), 0)`. That cannot work.
The builder has to wrap a trusted metric's aggregate in `FILTER (WHERE <predicate>)`, and it cannot
splice a FILTER into the middle of a finished expression string — nor combine it with a metric that
already carries a FILTER of its own, such as `inventory.dead_stock_value`. Two FILTERs on one
aggregate is a syntax error.

**As built, a metric declares three things and the builder assembles them:**

```js
'margin.gross_profit': {
  kind: 'additive', source: 'invoice_line', trust: 'costed_line',
  expr: (c) => `SUM(${c.revenue_ex_tax} - (${c.quantity} * ${c.unit_cost}))`,   // bare aggregate
}
'inventory.dead_stock_value': {
  kind: 'snapshot', source: 'inventory_snapshot', trust: 'wac_known',
  expr:  (c) => `SUM(${c.stock_on_hand} * ${c.wac_cost})`,
  where: (c) => `${c.stock_on_hand} > 0 AND (${c.last_sold_at} IS NULL OR ...)`, // its own filter
}
```

The builder emits `COALESCE(<expr> FILTER (WHERE <where> AND <trust predicate>), 0)`, combining the
metric's own filter with its trust rule. The registry **rejects at load** any `expr` containing its
own `FILTER (`, so the assembly cannot be bypassed by a future author. This makes §6.2's claim —
"there is no code path that computes the metric without the filter" — literally true rather than a
convention.

Two smaller consequences:

- **A trusted metric is left NULL, not COALESCEd to 0,** when nothing in a group qualified. "We
  measured no profit here" and "profit here was zero" are different statements, and the UI renders
  them differently (a dash, and a coverage badge reading *No cost data*).
- **`wac_known`'s coverage weight is units on hand, not value.** §6.3 weights it by
  `stock_on_hand * wac_cost`, which is the very thing that is unknown for an uncosted part — the
  numerator and denominator would be identical and the rule would report 100% coverage every time.
  Trust rules therefore also carry an optional `scope`, so coverage is asked only of parts that
  actually hold stock: `SUM(weight) FILTER (scope AND predicate) / SUM(weight) FILTER (scope)`.

### 17.2 Smaller divergences

| §  | As planned | As built | Why |
|---|---|---|---|
| 7.2 | A dimension names the joins it needs | Sources also carry `providedJoins` and `joinDeps` | Reaching a credit note's customer means joining its invoice first. Putting that in the source, not the dimension, lets one dimension definition serve every source. Validated at load. |
| 7.3 | Date params are `$1`–`$4` | Placeholders are allocated lazily | A query made only of snapshot metrics never mentions a date, and `pg` rejects a statement handed a parameter its text never uses. |
| 10.1 | `grain` is a fixed string | Tiles may declare `grain: 'auto'` (+ optional `minGrain`) | A tile hard-coded to `month` plots two points on a 30-day board. `auto` is resolved client-side from the period; the server only ever receives a concrete grain. |
| 8.1 | `/meta` caches readiness for 5 min | `?fresh=1` also clears it | So an admin who has just recorded the first expense sees that tile light up without waiting out the TTL. |
| 11.1 | EXPLAIN every metric | Also every metric × every dimension × every grain, every filter, and every board tile at every grain it can resolve to | 156 statements, well under a second. This is the test that catches registry/schema drift. |

### 17.3 What the build learned about the data

§2 profiled the database before design. Building against it surfaced three more things, each of
which changed a source definition:

1. **`credit_note.subtotal_ex_tax` is NULL on 210 of 230 credit notes.** Reading the column alone
   reports ~₱36K of refunds where the real figure is ~₱443K — a twelvefold understatement. Every
   credit note in the data records `tax_total = 0`, so `total_amount` *is* the ex-VAT figure for
   them and `COALESCE(subtotal_ex_tax, total_amount)` is exact, not approximate. With that fallback
   the refund rate comes out at 3.643%, matching §2's independently measured 3.64%.
   **`/reports/sales-summary` reads the bare column and therefore still understates refunds.** It is
   a real bug in the existing report, out of scope for Phase 0, and it should be fixed on its own.
2. **`invoice_line.tax_base` is NULL on 477 lines, and `invoice.subtotal_ex_tax` on 266 invoices** —
   the legacy `v1.0` rows that predate the tax-versioning work. They record no VAT, so both sources
   fall back to the pre-tax total. Without the fallback, line-level revenue lands ~₱66K short of the
   invoice headers and every margin computed from it inherits the gap. This is also why Analytics
   reports slightly more revenue than Reporting over ranges containing those invoices; the
   difference is exactly their value.
3. **`sales.credit_revenue` is defined by settlement type, not by payment terms.** §13's R6 needs a
   DSO denominator that excludes walk-in cash. `invoice.terms` is empty on 5,673 of 6,085 invoices,
   so it cannot carry that meaning; an `EXISTS` over `invoice_payments` joined to
   `payment_methods.settlement_type = 'on_account'` can, and survives split payments.

### 17.4 Verified against the live database

Twelve months to 2026-09-06, checked directly rather than assumed:

| Metric | §11.2 expected | Measured | |
|---|---|---|---|
| COGS (costed) | ₱1,539,693 | ₱1,539,693 | exact |
| Costed revenue | ₱2,297,769 | ₱2,294,722 | §11.2's figure came from `quantity × sale_price − discount`, which is VAT-inclusive; the registry uses the ex-VAT base consistently |
| Gross margin | 33.0% | 32.90% | follows from the above |
| Cost coverage (value) | ~20.5% | 19.8% | |
| Cost coverage (rows) | 1,965 of 11,527 | 1,965 of 11,522 | the five are `INV-TEST-*` fixtures left in the dev database |
| Refund rate | 3.64% | 3.643% | only with the §17.3 fallback |
| Inventory value @ WAC | ~₱2.61M | ₱2,605,358 | |

Dead stock reads ₱1.98M rather than §2's ₱1.55M because the shipped metric uses a 180-day window,
as §6.4 specifies, where §2 measured twelve months.

### 17.5 The categorical palette

§10.4 asks for a six-colour series palette. Both sets pass all six of the `dataviz` validator's
checks against their own surface — lightness band, chroma floor, adjacent-pair CVD separation in
deuteranopia and tritanopia, the normal-vision floor, and contrast:

- light (on white): `#2563eb #c2410c #0891b2 #be185d #7c3aed #4d7c0f`
- dark (on slate-800): `#5590f0 #d7752f #12a2bd #e0608f #9a7af0 #7ba32e`

Dark is a separately chosen set at the dark band's own lightness, not a flip of the light one. Do
not edit either by eye — re-run the skill's `scripts/validate_palette.js`. Status colours are
deliberately absent: reusing a warning amber as "series 4" makes a neutral category look like an
alarm.

---

## 18. Change Log

| Date | Version | Change |
|---|---|---|
| 2026-09-06 | 1.0 | Initial PRD. Live-data profiling, architecture, design review incorporated. PR #171 (profit overstatement) shipped as prerequisite. Insights panel deferred to post-Phase-2 by owner decision. |
| 2026-09-08 | 1.1 | Phase 0 shipped. §17 records the metric-contract change that makes the trust filter unbypassable, three data findings that changed source definitions (including a twelvefold refund understatement still present in `/reports/sales-summary`), the figures verified against the live database, and the validated series palette. |
