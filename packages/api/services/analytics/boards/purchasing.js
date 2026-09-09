/**
 * The Purchasing & Suppliers board: "what are we buying, from whom, at what
 * price, and what do we owe for it?"
 *
 * Four things shape this board, and each is a decision rather than a layout.
 *
 * - **The coverage badge leads.** Over half of all receipt lines record a
 *   landed cost of zero, which the schema cannot tell apart from free goods, so
 *   Purchase Spend is measured over 42% of the lines and says so on the hero
 *   tile. A purchasing board whose headline figure looked complete would be
 *   wrong by more than half.
 * - **The biggest supplier is called "N/A".** A placeholder record carries 167
 *   of the 336 posted receipts. It is not hidden, not folded into "Other" and
 *   not gated behind a setting the way Phase 3 gated the walk-in customer: that
 *   record was indistinguishable from a real account, and this one announces
 *   itself. It sits at the top of the supplier ranking reading exactly as what
 *   it is, which is that half of this business's purchasing is not attributed
 *   to anybody.
 * - **No trend over the supplier ledger.** It begins on 19 August 2026. §21.8's
 *   rule — do not plot anything longer than its own history — applies here
 *   unchanged, so ledger movement is a table broken down by movement type
 *   rather than a line that would be eleven months of flat zero.
 * - **Lead time is on the board and dark.** There are no purchase orders. The
 *   tiles are here, gated, saying so, because a lead-time section that simply
 *   did not exist would leave a reader believing the question had never been
 *   asked.
 */

const SPEND_QUERY = {
    metrics: [
        'purch.spend',
        'purch.units_received',
        'purch.receipt_lines',
        'purch.uncosted_lines',
        'purch.uncosted_line_share',
    ],
    dimensions: [],
    grain: null,
    compare: 'previous_period',
};

const RECEIPT_QUERY = {
    metrics: [
        'purch.receipts',
        'purch.receipts_without_invoice_ref',
        'purch.invoice_ref_gap_share',
        'purch.backfill_receipts',
    ],
    dimensions: [],
    grain: null,
    compare: 'previous_period',
};

const QUALITY_QUERY = {
    metrics: ['purch.returned_units', 'purch.rejected_lines'],
    dimensions: [],
    grain: null,
    compare: 'previous_period',
};

const PRICE_QUERY = {
    metrics: [
        'purch.price_variance_value',
        'purch.price_variance_pct',
        'purch.price_increases',
        'purch.price_decreases',
        'purch.repeat_lines',
    ],
    dimensions: [],
    grain: null,
    compare: null,
};

const LEAD_QUERY = {
    metrics: [
        'purch.avg_lead_days',
        'purch.orders_placed',
        'purch.orders_received',
        'purch.orders_outstanding',
    ],
    dimensions: [],
    grain: null,
    compare: null,
};

const AP_QUERY = {
    metrics: [
        'purch.ap_open_balance',
        'purch.ap_balance',
        'purch.ap_ledger_gap',
        'purch.ap_open_bills',
        'purch.ap_overdue_balance',
        'purch.ap_overdue_share',
        'purch.ap_untermed_balance',
        'purch.ap_oldest_overdue_days',
    ],
    dimensions: [],
    grain: null,
    compare: null,
};

const AP_MOVEMENT_QUERY = {
    metrics: [
        'purch.billed_by_suppliers',
        'purch.paid_to_suppliers',
        'purch.supplier_credits',
        'purch.ap_ledger_entries',
    ],
    dimensions: [],
    grain: null,
    compare: null,
};

const LEDGER_ERA = 'The supplier ledger begins on 19 August 2026 and knows nothing before it, so '
    + 'a range that reaches further back describes only the part of it the ledger covers.';

const kpi = (id, value, query, span, extra = {}) => ({
    id,
    type: 'kpi',
    span: { base: 12, md: 6, lg: 3, ...(span || {}) },
    display: { value, ...(extra.display || {}) },
    query,
    ...(extra.drilldown ? { drilldown: extra.drilldown } : {}),
    ...(extra.title ? { title: extra.title } : {}),
    ...(extra.help ? { help: extra.help } : {}),
});

// A position as of now says so instead of showing a delta arrow it has nothing
// to compute.
const asOfKpi = (id, value, query, span, extra = {}) =>
    kpi(id, value, query, span, { ...extra, display: { asOf: 'now', ...(extra.display || {}) } });

const PURCHASING_BOARD = {
    id: 'purchasing',
    title: 'Purchasing & Suppliers',
    description:
        'What the business buys, who it buys from, what prices are doing, and what is owed for '
        + 'it.',
    defaultPreset: 'last_90_days',
    period: 'range',
    tiles: [
        kpi('purch.spend', 'purch.spend', SPEND_QUERY, { lg: 3 }, {
            display: { emphasis: 'hero', coverage: { show: true, rule: 'costed_receipt_line' } },
            help: 'Landed cost of everything received in the range, net of returns. Only lines '
                + 'that carry a recorded cost are counted — the badge says how many units that '
                + 'is out of everything received. The uncounted lines are not free goods; they '
                + 'are goods whose cost nobody wrote down.',
            drilldown: { kind: 'page', page: 'goods_receipt_history', params: {} },
        }),
        kpi('purch.units_received', 'purch.units_received', SPEND_QUERY, { lg: 3 }, {
            help: 'Every unit that came in, whether or not its cost was recorded. Read against '
                + 'Purchase Spend beside it: the gap between the two is the part of the buying '
                + 'this board cannot value.',
        }),
        kpi('purch.receipts', 'purch.receipts', RECEIPT_QUERY, { lg: 3 }),
        kpi('purch.uncosted_line_share', 'purch.uncosted_line_share', SPEND_QUERY, { lg: 3 }, {
            help: 'The share of receipt lines with no landed cost. This is the origin of the '
                + 'cost gap that runs through the whole system: a part received without a cost '
                + 'gets no weighted average cost, and every sale of it afterwards has no profit '
                + 'that can be worked out.',
            drilldown: { kind: 'page', page: 'cost_data_health', params: {} },
        }),

        {
            id: 'purch.spend_trend',
            type: 'line',
            title: 'Purchase spend over time',
            help: 'Landed cost of goods received, by period. Backfilled receipts are included '
                + 'and are dated when they were keyed rather than when goods arrived, so a '
                + 'spike may be data entry — the backfill count below says how many.',
            span: { base: 12, md: 12, lg: 8 },
            query: {
                metrics: ['purch.spend', 'purch.units_received'],
                dimensions: ['date'],
                grain: 'auto',
                minGrain: 'month',
                compare: 'previous_period',
            },
            display: {
                value: 'purch.spend',
                coverage: { show: true, rule: 'costed_receipt_line' },
            },
        },
        {
            id: 'purch.spend_by_supplier_bar',
            type: 'bar',
            title: 'Spend by supplier',
            help: 'The largest bar in this database belongs to a placeholder supplier record '
                + 'named "N/A", which carries about half of all receipts. It is shown rather '
                + 'than hidden: unattributed purchasing is the single most useful thing this '
                + 'chart has to say.',
            span: { base: 12, md: 12, lg: 4 },
            query: {
                metrics: ['purch.spend'],
                dimensions: ['supplier'],
                grain: null,
                sort: { by: 'purch.spend', dir: 'DESC' },
                topN: { n: 8, by: 'purch.spend' },
            },
            display: {
                value: 'purch.spend',
                category: 'supplier',
                coverage: { show: true, rule: 'costed_receipt_line' },
            },
            drilldown: { kind: 'filter', dimension: 'supplier' },
        },
        {
            id: 'purch.by_supplier',
            type: 'table',
            title: 'Suppliers',
            help: 'Every supplier bought from in the range, with the tail beyond the top twelve '
                + 'folded into "Other" so the totals are the whole book rather than the part '
                + 'that fitted. Lines With No Cost is the column to read beside the spend: a '
                + 'supplier with high units and low spend is one whose costs are not being '
                + 'captured.',
            span: { base: 12, md: 12, lg: 12 },
            query: {
                metrics: [
                    'purch.spend',
                    'purch.units_received',
                    'purch.receipt_lines',
                    'purch.uncosted_lines',
                    'purch.uncosted_line_share',
                ],
                dimensions: ['supplier'],
                grain: null,
                sort: { by: 'purch.spend', dir: 'DESC' },
                topN: { n: 12, by: 'purch.spend' },
            },
            display: {
                columns: [
                    'purch.spend',
                    'purch.units_received',
                    'purch.receipt_lines',
                    'purch.uncosted_lines',
                    'purch.uncosted_line_share',
                ],
                category: 'supplier',
                rank: true,
                bar: 'purch.spend',
                coverage: { show: true, rule: 'costed_receipt_line' },
            },
            drilldown: { kind: 'page', page: 'suppliers', params: { search: '$row.label' } },
        },

        // --- prices ---------------------------------------------------------
        kpi('purch.price_variance_value', 'purch.price_variance_value', PRICE_QUERY, { lg: 3 }, {
            help: 'What repeat purchases in this range cost against what the same quantities '
                + 'would have cost at each part\'s previous price. Each part is compared with '
                + 'its own last purchase whenever that happened, not with the oldest receipt '
                + 'inside the range — otherwise the figure would change every time you moved '
                + 'the date picker without a single price having moved.',
        }),
        kpi('purch.price_variance_pct', 'purch.price_variance_pct', PRICE_QUERY, { lg: 3 }, {
            help: 'The same change as a percentage, weighted by what was actually bought, so a '
                + 'doubling on one unit does not outweigh a 2% rise on a thousand.',
        }),
        kpi('purch.price_increases', 'purch.price_increases', PRICE_QUERY, { lg: 3 }),
        kpi('purch.price_decreases', 'purch.price_decreases', PRICE_QUERY, { lg: 3 }),

        {
            id: 'purch.price_moves_by_part',
            type: 'table',
            title: 'Where prices moved',
            help: 'Parts whose landed cost changed against their own previous purchase, ranked '
                + 'by what the change cost in money. Parts bought for the first time in the '
                + 'range are absent by construction: there is nothing to compare them with.',
            span: { base: 12, md: 12, lg: 8 },
            query: {
                metrics: [
                    'purch.price_variance_value',
                    'purch.price_variance_pct',
                    'purch.repeat_lines',
                ],
                dimensions: ['part'],
                grain: null,
                sort: { by: 'purch.price_variance_value', dir: 'DESC' },
                limit: 15,
            },
            display: {
                columns: [
                    'purch.price_variance_value',
                    'purch.price_variance_pct',
                    'purch.repeat_lines',
                ],
                category: 'part',
                rank: true,
                bar: 'purch.price_variance_value',
            },
            drilldown: { kind: 'page', page: 'inventory', params: { search: '$row.label' } },
        },
        {
            id: 'purch.price_moves_by_supplier',
            type: 'bar',
            title: 'Price changes by supplier',
            help: 'Which suppliers the price movement came from. Negative bars are suppliers '
                + 'whose prices came down.',
            span: { base: 12, md: 12, lg: 4 },
            query: {
                metrics: ['purch.price_variance_value'],
                dimensions: ['supplier'],
                grain: null,
                sort: { by: 'purch.price_variance_value', dir: 'DESC' },
                topN: { n: 8, by: 'purch.price_variance_value' },
            },
            display: { value: 'purch.price_variance_value', category: 'supplier' },
            drilldown: { kind: 'filter', dimension: 'supplier' },
        },

        // --- how the buying is being recorded --------------------------------
        kpi('purch.receipts_without_invoice_ref', 'purch.receipts_without_invoice_ref', RECEIPT_QUERY, { lg: 3 }, {
            help: 'Receipts recorded without the supplier\'s own invoice number. Without it, a '
                + 'receipt cannot be matched against the bill that arrives for it — which is how '
                + 'the same delivery ends up paid for twice. On this data that is every receipt.',
            drilldown: { kind: 'page', page: 'goods_receipt_history', params: {} },
        }),
        kpi('purch.invoice_ref_gap_share', 'purch.invoice_ref_gap_share', RECEIPT_QUERY, { lg: 3 }),
        kpi('purch.backfill_receipts', 'purch.backfill_receipts', RECEIPT_QUERY, { lg: 3 }, {
            help: 'Receipts entered to correct historical stock rather than to record a delivery '
                + 'that day. Their dates say when somebody keyed them, so they move the spend '
                + 'trend without any goods having arrived.',
        }),
        kpi('purch.rejected_lines', 'purch.rejected_lines', QUALITY_QUERY, { lg: 3 }, {
            help: 'Lines recorded with a rejection reason. This is the only supplier quality '
                + 'signal the database captures, so a low number here means little on its own.',
        }),

        {
            id: 'purch.uncosted_by_supplier',
            type: 'bar',
            title: 'Lines with no cost, by supplier',
            help: 'Where the cost gap comes from. A supplier high on this chart and low on the '
                + 'spend chart is one whose deliveries are being received without their prices.',
            span: { base: 12, md: 6, lg: 6 },
            query: {
                metrics: ['purch.uncosted_lines'],
                dimensions: ['supplier'],
                grain: null,
                sort: { by: 'purch.uncosted_lines', dir: 'DESC' },
                topN: { n: 8, by: 'purch.uncosted_lines' },
            },
            display: { value: 'purch.uncosted_lines', category: 'supplier' },
            drilldown: { kind: 'filter', dimension: 'supplier' },
        },
        {
            id: 'purch.spend_by_brand',
            type: 'bar',
            title: 'Spend by brand',
            help: 'What the money went on, by brand. Read against the Inventory board\'s dead '
                + 'stock by brand: a brand that is large in both is being bought faster than it '
                + 'sells.',
            span: { base: 12, md: 6, lg: 6 },
            query: {
                metrics: ['purch.spend'],
                dimensions: ['brand'],
                grain: null,
                sort: { by: 'purch.spend', dir: 'DESC' },
                topN: { n: 8, by: 'purch.spend' },
            },
            display: {
                value: 'purch.spend',
                category: 'brand',
                coverage: { show: true, rule: 'costed_receipt_line' },
            },
            drilldown: { kind: 'filter', dimension: 'brand' },
        },

        // --- lead time: registered, and dark until orders are raised ---------
        kpi('purch.avg_lead_days', 'purch.avg_lead_days', LEAD_QUERY, { lg: 3 }, {
            help: 'Days between raising a purchase order and the first goods arriving against '
                + 'it. Nothing in this database has ever been ordered through a purchase order, '
                + 'so there is no gap to measure yet; this tile fills itself in once orders are '
                + 'being raised.',
            drilldown: { kind: 'page', page: 'purchase_orders', params: {} },
        }),
        kpi('purch.orders_placed', 'purch.orders_placed', LEAD_QUERY, { lg: 3 }),
        kpi('purch.orders_outstanding', 'purch.orders_outstanding', LEAD_QUERY, { lg: 3 }),
        kpi('purch.returned_units', 'purch.returned_units', QUALITY_QUERY, { lg: 3 }),

        // --- what we owe ------------------------------------------------------
        asOfKpi('purch.ap_open_balance', 'purch.ap_open_balance', AP_QUERY, { lg: 3 }, {
            display: { emphasis: 'hero' },
            help: 'Unpaid across every supplier bill that is not settled or voided. A position '
                + 'as of now, so the date range above does not change it.',
            drilldown: { kind: 'page', page: 'ap', params: {} },
        }),
        asOfKpi('purch.ap_balance', 'purch.ap_balance', AP_QUERY, { lg: 3 }, {
            help: `What the supplier ledger says is owed. ${LEDGER_ERA} On the receivable side `
                + 'the equivalent pair disagree by ₱39,300; here they agree, because nothing was '
                + 'billed before the ledger existed.',
        }),
        asOfKpi('purch.ap_ledger_gap', 'purch.ap_ledger_gap', AP_QUERY, { lg: 3 }, {
            help: 'The difference between the two figures beside it. It is published rather than '
                + 'assumed away: a zero you can see is worth more than an agreement you are '
                + 'asked to take on trust.',
        }),
        asOfKpi('purch.ap_open_bills', 'purch.ap_open_bills', AP_QUERY, { lg: 3 }),

        asOfKpi('purch.ap_overdue_balance', 'purch.ap_overdue_balance', AP_QUERY, { lg: 3 }, {
            drilldown: { kind: 'page', page: 'ap', params: {} },
        }),
        asOfKpi('purch.ap_untermed_balance', 'purch.ap_untermed_balance', AP_QUERY, { lg: 3 }, {
            help: 'Owed on bills with no due date at all. This money can never show as overdue, '
                + 'so a payment schedule built on overdue days alone does not see it.',
        }),
        asOfKpi('purch.ap_overdue_share', 'purch.ap_overdue_share', AP_QUERY, { lg: 3 }),
        asOfKpi('purch.ap_oldest_overdue_days', 'purch.ap_oldest_overdue_days', AP_QUERY, { lg: 3 }),

        {
            id: 'purch.ap_by_age',
            type: 'bar',
            title: 'What we owe, by age',
            help: '"(No payment terms)" is a band of its own and reads last. A bill with no due '
                + 'date can never become overdue however long it sits, so folding it into "not '
                + 'yet due" would report the payables as healthier than they are.',
            span: { base: 12, md: 6, lg: 5 },
            query: {
                metrics: ['purch.ap_open_balance'],
                dimensions: ['aging_bucket'],
                grain: null,
                sort: { by: 'aging_bucket', dir: 'ASC' },
            },
            display: { value: 'purch.ap_open_balance', category: 'aging_bucket' },
            drilldown: { kind: 'page', page: 'ap', params: {} },
        },
        {
            id: 'purch.ap_by_supplier',
            type: 'table',
            title: 'Who we owe',
            help: 'Every supplier with an open balance, the tail folded into "Other" so the '
                + 'footer equals the figure at the top of this section. Oldest Overdue Bill is '
                + 'the worst bill on each row, not a sum — adding those together would give a '
                + 'number of days that means nothing.',
            span: { base: 12, md: 6, lg: 7 },
            query: {
                metrics: [
                    'purch.ap_open_balance',
                    'purch.ap_open_bills',
                    'purch.ap_overdue_balance',
                    'purch.ap_oldest_overdue_days',
                ],
                dimensions: ['supplier'],
                grain: null,
                sort: { by: 'purch.ap_open_balance', dir: 'DESC' },
                topN: { n: 12, by: 'purch.ap_open_balance' },
            },
            display: {
                columns: [
                    'purch.ap_open_balance',
                    'purch.ap_open_bills',
                    'purch.ap_overdue_balance',
                    'purch.ap_oldest_overdue_days',
                ],
                category: 'supplier',
                rank: true,
                bar: 'purch.ap_open_balance',
            },
            drilldown: { kind: 'page', page: 'ap', params: { search: '$row.label' } },
        },

        kpi('purch.paid_to_suppliers', 'purch.paid_to_suppliers', AP_MOVEMENT_QUERY, { lg: 4 }, {
            help: `Payments settled against supplier accounts in the range. ${LEDGER_ERA}`,
            drilldown: { kind: 'page', page: 'cheques_treasury', params: {} },
        }),
        kpi('purch.billed_by_suppliers', 'purch.billed_by_suppliers', AP_MOVEMENT_QUERY, { lg: 4 }, {
            help: `What suppliers billed to our accounts in the range. ${LEDGER_ERA}`,
        }),
        kpi('purch.supplier_credits', 'purch.supplier_credits', AP_MOVEMENT_QUERY, { lg: 4 }, {
            help: `Returns and concessions that reduced what we owe. ${LEDGER_ERA}`,
        }),

        {
            id: 'purch.ap_movement_by_type',
            type: 'table',
            title: 'What moved on supplier accounts',
            help: 'The whole story of the payable in one table, rather than a line chart. '
                + `${LEDGER_ERA} A twelve-month trend over it would be eleven months of flat `
                + 'zero, which reads as a collapse in trading rather than as absent history.',
            span: { base: 12, md: 12, lg: 12 },
            query: {
                metrics: ['purch.ap_ledger_movement', 'purch.ap_ledger_entries'],
                dimensions: ['ap_entry_type'],
                grain: null,
                sort: { by: 'purch.ap_ledger_movement', dir: 'DESC' },
                limit: 20,
            },
            display: {
                columns: ['purch.ap_ledger_movement', 'purch.ap_ledger_entries'],
                category: 'ap_entry_type',
                bar: 'purch.ap_ledger_movement',
            },
            drilldown: { kind: 'page', page: 'ap', params: {} },
        },
    ],
};

module.exports = { PURCHASING_BOARD };
