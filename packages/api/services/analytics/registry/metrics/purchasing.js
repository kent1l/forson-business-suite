const { costedReceiptLineCondition } = require('../../../../helpers/costCoverage');

/**
 * Purchasing, supplier and payables metrics.
 *
 * Three things about this file are worth reading before its contents:
 *
 * - **Spend is a trusted figure.** 1,547 of 2,679 receipt lines carry a landed
 *   cost of zero, which the schema cannot tell apart from goods a supplier gave
 *   away. Every money metric here declares `trust: 'costed_receipt_line'`, so
 *   spend is measured over the 42% of lines that carry a cost and the coverage
 *   badge says so, rather than counting the rest as free.
 * - **Lead time is registered but dark.** There are no purchase orders in this
 *   database and no receipt references one, so order-to-receipt time is a gap
 *   between two events of which only the second is recorded. Gated on
 *   `purchase_order_data`; it lights up on its own when the first order is
 *   raised.
 * - **The A/P ledger is three weeks old.** Everything on it is gated on
 *   `ap_ledger_data` and every trend over it carries the era in the tile's help
 *   text, exactly as the A/R ledger does.
 */
const SNAPSHOT_ONLY = ['none'];
const ALL_GRAINS = ['none', 'day', 'week', 'month', 'quarter'];

const PURCHASING_METRICS = {
    // -----------------------------------------------------------------------
    // What we bought.
    // -----------------------------------------------------------------------

    'purch.spend': {
        id: 'purch.spend',
        label: 'Purchase Spend',
        description:
            'What goods received in the period cost, at landed cost — after supplier discount '
            + 'and allocated freight — and net of anything sent back. Only lines with a recorded '
            + 'cost are counted: over half of all receipt lines store a cost of zero, which '
            + 'cannot be told apart from free goods, so they contribute units but no money. '
            + 'Check the coverage badge.',
        kind: 'additive',
        source: 'receipt_line',
        expr: (c) => `SUM(${c.spend})`,
        trust: 'costed_receipt_line',
        format: 'currency',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'purch.units_received': {
        id: 'purch.units_received',
        label: 'Units Received',
        description:
            'How many units came in, net of returns. Unlike Purchase Spend this counts every '
            + 'line, whether or not its cost was recorded — the goods arrived either way.',
        kind: 'additive',
        source: 'receipt_line',
        expr: (c) => `SUM(${c.quantity})`,
        format: 'integer',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'purch.receipt_lines': {
        id: 'purch.receipt_lines',
        label: 'Receipt Lines',
        description: 'How many part lines were received in the period, across all receipts.',
        kind: 'additive',
        source: 'receipt_line',
        expr: () => 'COUNT(*)',
        format: 'integer',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'purch.uncosted_lines': {
        id: 'purch.uncosted_lines',
        label: 'Lines With No Cost',
        description:
            'Receipt lines that record a landed cost of zero. Each one is stock that arrived '
            + 'and was put on the shelf without anybody recording what it cost, which is also '
            + 'why so many parts carry no weighted average cost and so many sales cannot be '
            + 'costed. This is the root of the module\'s largest data gap.',
        kind: 'additive',
        source: 'receipt_line',
        expr: () => 'COUNT(*)',
        where: (c) => `NOT ${costedReceiptLineCondition(c.__alias)}`,
        format: 'integer',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'purch.uncosted_line_share': {
        id: 'purch.uncosted_line_share',
        label: 'Share With No Cost',
        description:
            'Lines With No Cost as a percentage of every receipt line. The higher this is, the '
            + 'less Purchase Spend — and every profit figure downstream of it — actually measures.',
        kind: 'ratio',
        numerator: 'purch.uncosted_lines',
        denominator: 'purch.receipt_lines',
        scale: 100,
        zeroDenominator: null,
        format: 'percent',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'purch.returned_units': {
        id: 'purch.returned_units',
        label: 'Units Returned',
        description:
            'Units that were received and sent back to the supplier. They are already excluded '
            + 'from Units Received and Purchase Spend; this counts them on their own.',
        kind: 'additive',
        source: 'receipt_line',
        expr: (c) => `SUM(${c.return_quantity})`,
        format: 'integer',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'purch.rejected_lines': {
        id: 'purch.rejected_lines',
        label: 'Lines Rejected',
        description:
            'Receipt lines recorded with a rejection reason — goods that arrived and were not '
            + 'accepted. This is the only supplier quality signal the database captures.',
        kind: 'additive',
        source: 'receipt_line',
        expr: () => 'COUNT(*)',
        where: (c) => `${c.rejection_reason} IS NOT NULL`,
        format: 'integer',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'purch.receipts': {
        id: 'purch.receipts',
        label: 'Receipts Recorded',
        description:
            'How many goods receipts were posted in the period. Drafts and voided receipts are '
            + 'not counted.',
        kind: 'additive',
        source: 'receipt_header',
        expr: () => 'COUNT(*)',
        format: 'integer',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'purch.backfill_receipts': {
        id: 'purch.backfill_receipts',
        label: 'Backfilled Receipts',
        description:
            'Receipts entered to correct historical stock rather than to record a delivery that '
            + 'happened that day. Their dates are when somebody keyed them, not when goods '
            + 'arrived, so a spend trend that leans on them describes data entry rather than '
            + 'buying.',
        kind: 'additive',
        source: 'receipt_header',
        expr: () => 'COUNT(*)',
        where: (c) => c.is_backfill,
        format: 'integer',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'purch.receipts_without_invoice_ref': {
        id: 'purch.receipts_without_invoice_ref',
        label: 'Receipts With No Supplier Invoice',
        description:
            'Receipts recorded without the supplier\'s own invoice number. Without it a receipt '
            + 'cannot be matched to the bill that arrives for it, which is how the same delivery '
            + 'gets paid for twice.',
        kind: 'additive',
        source: 'receipt_header',
        expr: () => 'COUNT(*)',
        where: (c) => `${c.supplier_invoice_no} IS NULL`,
        format: 'integer',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'purch.invoice_ref_gap_share': {
        id: 'purch.invoice_ref_gap_share',
        label: 'Share With No Supplier Invoice',
        description:
            'Receipts With No Supplier Invoice as a percentage of receipts posted in the period.',
        kind: 'ratio',
        numerator: 'purch.receipts_without_invoice_ref',
        denominator: 'purch.receipts',
        scale: 100,
        zeroDenominator: null,
        format: 'percent',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    // -----------------------------------------------------------------------
    // What prices did.
    //
    // Every metric here is measured over REPEAT purchases only: a part bought
    // for the first time has no previous price and no price change. The
    // comparison itself is made against the part's own previous receipt whenever
    // that happened, not against the oldest receipt inside the selected range —
    // see `repeat_receipt_line` for why that distinction is the whole metric.
    // -----------------------------------------------------------------------

    'purch.repeat_lines': {
        id: 'purch.repeat_lines',
        label: 'Repeat Purchase Lines',
        description:
            'Receipt lines for a part that had been bought — and costed — at least once before. '
            + 'These are the only lines on which a price change can be measured at all.',
        kind: 'additive',
        source: 'repeat_receipt_line',
        expr: () => 'COUNT(*)',
        format: 'integer',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'purch.price_variance_value': {
        id: 'purch.price_variance_value',
        label: 'Cost of Price Changes',
        description:
            'What repeat purchases cost compared with what the same quantities would have cost '
            + 'at each part\'s previous price. Positive means prices moved against you. This is '
            + 'money, not a percentage, so a small rise on a large order outweighs a large rise '
            + 'on a small one — which is the way round that matters.',
        kind: 'additive',
        source: 'repeat_receipt_line',
        expr: (c) => `SUM(${c.value_impact})`,
        format: 'currency',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'purch.prior_cost_base': {
        id: 'purch.prior_cost_base',
        label: 'Repeat Purchases at Last Price',
        description:
            'What the repeat purchases in the period would have cost at each part\'s previous '
            + 'price. It exists as the denominator of the price-change percentage, so that the '
            + 'percentage is weighted by money rather than being an average of unrelated '
            + 'per-part percentages.',
        kind: 'additive',
        source: 'repeat_receipt_line',
        expr: (c) => `SUM(${c.prior_value})`,
        format: 'currency',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'purch.price_variance_pct': {
        id: 'purch.price_variance_pct',
        label: 'Price Change',
        description:
            'How much more (or less) repeat purchases cost than they did last time, as a '
            + 'percentage weighted by what was actually bought. A part whose price doubled on '
            + 'one unit moves this far less than a part whose price rose 2% on a thousand.',
        kind: 'ratio',
        numerator: 'purch.price_variance_value',
        denominator: 'purch.prior_cost_base',
        scale: 100,
        zeroDenominator: null,
        format: 'percent',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'purch.price_increases': {
        id: 'purch.price_increases',
        label: 'Prices Up',
        description: 'Repeat purchase lines that cost more per unit than the part did last time.',
        kind: 'additive',
        source: 'repeat_receipt_line',
        expr: () => 'COUNT(*)',
        where: (c) => `${c.unit_cost_delta} > 0`,
        format: 'integer',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'purch.price_decreases': {
        id: 'purch.price_decreases',
        label: 'Prices Down',
        description: 'Repeat purchase lines that cost less per unit than the part did last time.',
        kind: 'additive',
        source: 'repeat_receipt_line',
        expr: () => 'COUNT(*)',
        where: (c) => `${c.unit_cost_delta} < 0`,
        format: 'integer',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    // -----------------------------------------------------------------------
    // Lead time — registered, and dark until purchase orders are raised.
    // -----------------------------------------------------------------------

    'purch.orders_placed': {
        id: 'purch.orders_placed',
        label: 'Orders Placed',
        description: 'Purchase orders raised in the period, excluding cancelled ones.',
        kind: 'additive',
        source: 'purchase_lead',
        readiness: 'purchase_order_data',
        expr: () => 'COUNT(*)',
        format: 'integer',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'purch.orders_received': {
        id: 'purch.orders_received',
        label: 'Orders Delivered',
        description:
            'Orders raised in the period against which something has since been received. It is '
            + 'the denominator of the lead time average, so an order still outstanding does not '
            + 'enter that average as an instant delivery.',
        kind: 'additive',
        source: 'purchase_lead',
        readiness: 'purchase_order_data',
        expr: () => 'COUNT(*)',
        where: (c) => c.is_received,
        format: 'integer',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'purch.orders_outstanding': {
        id: 'purch.orders_outstanding',
        label: 'Orders Not Yet Delivered',
        description: 'Orders raised in the period with nothing received against them yet.',
        kind: 'additive',
        source: 'purchase_lead',
        readiness: 'purchase_order_data',
        expr: () => 'COUNT(*)',
        where: (c) => `NOT (${c.is_received})`,
        format: 'integer',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'purch.lead_days_total': {
        id: 'purch.lead_days_total',
        label: 'Total Days Waited',
        description:
            'Every delivered order\'s wait, added together. It exists as the numerator of '
            + 'Average Lead Time; on its own it is a figure in order-days rather than one about '
            + 'the business.',
        kind: 'additive',
        source: 'purchase_lead',
        readiness: 'purchase_order_data',
        expr: (c) => `SUM(${c.lead_days})`,
        where: (c) => c.is_received,
        format: 'days',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'purch.avg_lead_days': {
        id: 'purch.avg_lead_days',
        label: 'Average Lead Time',
        description:
            'How many days pass between raising a purchase order and the first goods arriving '
            + 'against it. A true mean over delivered orders — the total wait divided by the '
            + 'number of orders that arrived — not an average of monthly averages, which would '
            + 'weight a quiet month the same as a busy one.',
        kind: 'ratio',
        numerator: 'purch.lead_days_total',
        denominator: 'purch.orders_received',
        zeroDenominator: null,
        readiness: 'purchase_order_data',
        format: 'days',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    // -----------------------------------------------------------------------
    // What we owe.
    // -----------------------------------------------------------------------

    'purch.ap_balance': {
        id: 'purch.ap_balance',
        label: 'Owed to Suppliers',
        description:
            'What the supplier ledger says is owed right now. The ledger is authoritative for '
            + 'what the Payables module manages, and it begins on 19 August 2026. A position as '
            + 'of now, so changing the date range does not change it.',
        kind: 'snapshot',
        source: 'ap_balance',
        expr: (c) => `SUM(${c.balance})`,
        format: 'currency',
        direction: 'lower_is_better',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'purch.ap_open_balance': {
        id: 'purch.ap_open_balance',
        label: 'Open Bill Balance',
        description:
            'What is still unpaid across every supplier bill that is not settled or voided. '
            + 'Compare with Owed to Suppliers, which reads the ledger: unlike the receivable '
            + 'side, nothing was billed before the ledger went live, so the two agree.',
        kind: 'snapshot',
        source: 'supplier_bill_open',
        expr: (c) => `SUM(${c.balance})`,
        format: 'currency',
        direction: 'lower_is_better',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'purch.ap_ledger_gap': {
        id: 'purch.ap_ledger_gap',
        label: 'Not on the Supplier Ledger',
        description:
            'The open bill balance minus the ledger balance. On the receivable side the '
            + 'equivalent figure is ₱39,300, because invoices were raised for months before that '
            + 'ledger existed. Here it should be zero, and it is published rather than asserted '
            + 'so that a reader can see it stay zero — or notice the day it does not.',
        kind: 'composite',
        terms: [
            { metric: 'purch.ap_open_balance', sign: 1 },
            { metric: 'purch.ap_balance', sign: -1 },
        ],
        exposeComponents: true,
        format: 'currency',
        direction: 'neutral',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'purch.ap_open_bills': {
        id: 'purch.ap_open_bills',
        label: 'Open Bills',
        description: 'How many supplier bills still carry a balance right now.',
        kind: 'snapshot',
        source: 'supplier_bill_open',
        expr: () => 'COUNT(*)',
        format: 'integer',
        direction: 'neutral',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'purch.ap_overdue_balance': {
        id: 'purch.ap_overdue_balance',
        label: 'Overdue to Suppliers',
        description:
            'Owed on bills whose due date has passed. A bill with no agreed terms can never be '
            + 'overdue and is not counted here — see Bills With No Terms.',
        kind: 'snapshot',
        source: 'supplier_bill_open',
        expr: (c) => `SUM(${c.balance})`,
        where: (c) => `COALESCE(${c.days_overdue}, 0) > 0`,
        format: 'currency',
        direction: 'lower_is_better',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'purch.ap_untermed_balance': {
        id: 'purch.ap_untermed_balance',
        label: 'Bills With No Terms',
        description:
            'Owed on bills that carry no due date at all. This money can never appear as '
            + 'overdue however long it sits, so a payables schedule built only on overdue days '
            + 'does not see it.',
        kind: 'snapshot',
        source: 'supplier_bill_open',
        expr: (c) => `SUM(${c.balance})`,
        where: (c) => `${c.due_date} IS NULL`,
        format: 'currency',
        direction: 'neutral',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'purch.ap_untermed_share': {
        id: 'purch.ap_untermed_share',
        label: 'Share With No Terms',
        description: 'Bills With No Terms as a percentage of everything owed to suppliers.',
        kind: 'ratio',
        numerator: 'purch.ap_untermed_balance',
        denominator: 'purch.ap_open_balance',
        scale: 100,
        zeroDenominator: null,
        format: 'percent',
        direction: 'neutral',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'purch.ap_overdue_share': {
        id: 'purch.ap_overdue_share',
        label: 'Share Overdue',
        description: 'Overdue to Suppliers as a percentage of everything owed to suppliers.',
        kind: 'ratio',
        numerator: 'purch.ap_overdue_balance',
        denominator: 'purch.ap_open_balance',
        scale: 100,
        zeroDenominator: null,
        format: 'percent',
        direction: 'lower_is_better',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'purch.ap_oldest_overdue_days': {
        id: 'purch.ap_oldest_overdue_days',
        label: 'Oldest Overdue Bill',
        description:
            'How many days past its due date the most overdue open bill is. Bills with no terms '
            + 'count as zero, because there is no date for them to be past.',
        kind: 'snapshot',
        source: 'supplier_bill_open',
        expr: (c) => `MAX(COALESCE(${c.days_overdue}, 0))`,
        // Not additive: the largest of several maxima is the answer, and adding
        // each supplier's oldest overdue bill together would produce a number of
        // days that means nothing while still rendering as a figure.
        fold: 'max',
        format: 'days',
        direction: 'lower_is_better',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    // -----------------------------------------------------------------------
    // Supplier ledger movement. Gated on `ap_ledger_data`; every trend over it
    // must carry the era in the tile, because the ledger begins on 19 August
    // 2026 and a twelve-month chart is eleven months of a flat zero.
    // -----------------------------------------------------------------------

    'purch.billed_by_suppliers': {
        id: 'purch.billed_by_suppliers',
        label: 'Billed by Suppliers',
        description:
            'What suppliers billed to our accounts in the period, taken from the supplier '
            + 'ledger rather than from receipts, so it counts what was actually recorded as owed.',
        kind: 'additive',
        source: 'ap_ledger',
        readiness: 'ap_ledger_data',
        expr: (c) => `SUM(${c.amount})`,
        where: (c) => `${c.entry_type} = 'BILL_POSTED'`,
        format: 'currency',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'purch.paid_to_suppliers': {
        id: 'purch.paid_to_suppliers',
        label: 'Paid to Suppliers',
        description:
            'Payments settled against supplier accounts in the period. The ledger stores these '
            + 'as negative movements; the sign is flipped here so the figure reads as money out.',
        kind: 'additive',
        source: 'ap_ledger',
        readiness: 'ap_ledger_data',
        expr: (c) => `SUM(-${c.amount})`,
        where: (c) => `${c.entry_type} = 'PAYMENT_SETTLED'`,
        format: 'currency',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'purch.supplier_credits': {
        id: 'purch.supplier_credits',
        label: 'Credits from Suppliers',
        description:
            'Credit notes and adjustments that reduced what we owe — returned goods, and '
            + 'concessions agreed after billing. Shown as a positive figure for money we no '
            + 'longer have to pay.',
        kind: 'additive',
        source: 'ap_ledger',
        readiness: 'ap_ledger_data',
        expr: (c) => `SUM(-${c.amount})`,
        where: (c) => `${c.entry_type} IN ('CREDIT_ADJUSTMENT', 'RETURN_CREDIT')`,
        format: 'currency',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'purch.ap_ledger_movement': {
        id: 'purch.ap_ledger_movement',
        label: 'Net Movement',
        description:
            'The signed sum of every supplier ledger entry in the period: positive means what we '
            + 'owe grew, negative means it shrank. Broken down by movement type, this is the '
            + 'whole story of the payable in one table.',
        kind: 'additive',
        source: 'ap_ledger',
        readiness: 'ap_ledger_data',
        expr: (c) => `SUM(${c.amount})`,
        format: 'currency',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'purch.ap_ledger_entries': {
        id: 'purch.ap_ledger_entries',
        label: 'Ledger Entries',
        description: 'How many movements were recorded against supplier accounts in the period.',
        kind: 'additive',
        source: 'ap_ledger',
        readiness: 'ap_ledger_data',
        expr: () => 'COUNT(*)',
        format: 'integer',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },
};

module.exports = { PURCHASING_METRICS };
