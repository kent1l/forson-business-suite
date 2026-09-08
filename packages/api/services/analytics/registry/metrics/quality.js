const { costedLineCondition } = require('../../../../helpers/costCoverage');

const ALL_GRAINS = ['none', 'day', 'week', 'month', 'quarter'];
const SNAPSHOT_ONLY = ['none'];

/**
 * Data-quality metrics — the numbers behind the Data Trust board.
 *
 * Everywhere else in this module, a gap in the data is something to be disclosed
 * *alongside* a figure: the coverage badge under a margin. These metrics make the
 * gap itself the figure, so it can be watched, ranked and worked down.
 *
 * That distinction matters for how they are read. A coverage badge answers "how
 * much of this number can I believe?". These answer "how much work is left, and
 * where?" — which is a question with an owner and a page to fix it on. Every one
 * of them therefore names the remediation page in its description.
 *
 * None of them carry a `trust` rule. Counting the rows a trust rule excludes and
 * then filtering by that same rule would report zero every time.
 *
 * What counts as a costed line is NOT redefined here. It comes from
 * helpers/costCoverage.js, which is also what the Reports page filters on, so
 * "how many lines are missing a cost" and "which lines were excluded from
 * margin" cannot drift into disagreeing.
 */
const QUALITY_METRICS = {
    'quality.costed_line_count': {
        id: 'quality.costed_line_count',
        label: 'Lines With a Cost',
        description:
            'Sale lines in the period that recorded what the item cost. These are the only lines '
            + 'any profit or margin figure is measured over.',
        kind: 'additive',
        source: 'invoice_line',
        expr: (c) => `COUNT(${c.line_id})`,
        where: (c) => costedLineCondition(c.__alias),
        format: 'integer',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'quality.uncosted_line_count': {
        id: 'quality.uncosted_line_count',
        label: 'Lines Missing a Cost',
        description:
            'Sale lines in the period with no recorded cost. Each one is a sale whose profit the '
            + 'system cannot work out. The cause is upstream: the part had no weighted average '
            + 'cost when it was sold, so a zero was stored — fix the parts on the Cost Data '
            + 'Health page and future sales will carry a cost.',
        kind: 'additive',
        source: 'invoice_line',
        expr: (c) => `COUNT(${c.line_id})`,
        where: (c) => `NOT (${costedLineCondition(c.__alias)})`,
        format: 'integer',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'quality.uncosted_revenue': {
        id: 'quality.uncosted_revenue',
        label: 'Revenue We Cannot Measure',
        description:
            'Ex-VAT revenue on sale lines with no recorded cost. This is the share of the '
            + 'business no margin figure describes — not revenue that was lost, revenue whose '
            + 'profit is unknown.',
        kind: 'additive',
        source: 'invoice_line',
        expr: (c) => `SUM(${c.revenue_ex_tax})`,
        where: (c) => `NOT (${costedLineCondition(c.__alias)})`,
        format: 'currency',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'quality.cost_coverage_pct': {
        id: 'quality.cost_coverage_pct',
        label: 'Cost Coverage',
        description:
            'The share of ex-VAT revenue that carries a recorded cost — how much of the business '
            + 'every margin figure on this page actually describes. This is the single most '
            + 'important number in Analytics: at 20%, a gross margin of 33% is a true statement '
            + 'about a fifth of the business and says nothing about the rest.',
        kind: 'ratio',
        numerator: 'margin.costed_revenue',
        denominator: 'sales.line_revenue',
        scale: 100,
        zeroDenominator: null,
        format: 'percent',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'quality.costed_line_pct': {
        id: 'quality.costed_line_pct',
        label: 'Lines With a Cost (share)',
        description:
            'The share of sale lines that carry a recorded cost. Read it next to Cost Coverage: '
            + 'the two diverge when the costed lines are unusually large or unusually small, and '
            + 'a big gap between them means margin is being measured on an unrepresentative '
            + 'slice rather than merely a small one.',
        kind: 'ratio',
        numerator: 'quality.costed_line_count',
        denominator: 'sales.line_count',
        scale: 100,
        zeroDenominator: null,
        format: 'percent',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'quality.negative_stock_parts': {
        id: 'quality.negative_stock_parts',
        label: 'Parts With Negative Stock',
        description:
            'Active parts whose recorded stock is below zero — which is physically impossible, so '
            + 'each one is a receipt that was never entered, a sale entered twice, or an '
            + 'adjustment that went the wrong way. They also drag inventory value down. Work '
            + 'through them on the Stock Reconciliation page.',
        kind: 'snapshot',
        source: 'inventory_snapshot',
        expr: () => 'COUNT(*)',
        where: (c) => `${c.stock_on_hand} < 0`,
        format: 'integer',
        direction: 'lower_is_better',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'quality.legacy_untaxed_lines': {
        id: 'quality.legacy_untaxed_lines',
        label: 'Lines Predating VAT Capture',
        description:
            'Sale lines with no stored ex-VAT figure. These are legacy rows from before the tax '
            + 'work; Analytics falls back to their pre-tax total, which is exact for them because '
            + 'they record no VAT. Nothing needs fixing — this is here so the number can be seen '
            + 'to be small and shrinking, and so a figure that differs slightly from an older '
            + 'Reports export has a visible explanation.',
        kind: 'additive',
        source: 'invoice_line',
        expr: (c) => `COUNT(${c.line_id})`,
        where: (c) => `${c.tax_base_raw} IS NULL`,
        format: 'integer',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'quality.credit_notes_without_subtotal': {
        id: 'quality.credit_notes_without_subtotal',
        label: 'Credit Notes Without an Ex-VAT Figure',
        description:
            'Credit notes with no stored ex-VAT subtotal. Analytics falls back to the total, '
            + 'which is exact for them because every credit note in the data records no VAT. '
            + 'Worth watching: the Reports page reads the stored column directly and therefore '
            + 'understates refunds by roughly twelve times while this number stays high.',
        kind: 'additive',
        source: 'credit_note_header',
        expr: (c) => `COUNT(${c.cn_id})`,
        where: (c) => `${c.subtotal_raw} IS NULL`,
        format: 'integer',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },
};

module.exports = { QUALITY_METRICS };
