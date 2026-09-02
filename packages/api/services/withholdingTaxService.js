const db = require('../db');

/**
 * Withholding tax on sales (BIR Forms 2307 and 2306).
 *
 * Customers designated by BIR as withholding agents, and all government buyers,
 * deduct tax at source and remit it under our TIN. This module computes what
 * they are expected to deduct.
 *
 * The one rule everything here depends on: **the base is the VAT-EXCLUSIVE
 * amount**, never the invoice total. Withholding is a tax on income, not a tax
 * on the sale, so it is computed on the same `tax_base` figures that
 * taxCalculationService.js already produces and that the invoice prints as
 * "VATable Sales".
 *
 * Nothing here changes the invoice total. Withholding only changes how the
 * receivable is settled: partly in cash, partly by tax certificate.
 *
 * See also: packages/api/services/taxCalculationService.js, which owns the VAT
 * split that produces the base used below.
 */

const WITHHOLDING_CALCULATION_VERSION = 'v1.0';

const DEFAULTS = Object.freeze({
    EWT_RATE_GOODS: 0.01,
    EWT_RATE_SERVICES: 0.02,
    WITHHOLDING_VAT_RATE_GOV: 0.05,
    EWT_ATC_GOODS: 'WC158',
    EWT_ATC_SERVICES: 'WC160',
    WITHHOLDING_VAT_ATC_GOV: 'WV010',
});

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Read a configured rate as a decimal fraction (0.01 = 1%).
 *
 * Same reasoning as normalizeStoredRate in taxCalculationService.js: a value
 * outside [0, 1] is bad configuration, not a different unit, so it is surfaced
 * and clamped rather than silently rescaled.
 */
function normalizeRate(rawValue, fallback, label) {
    if (rawValue === null || rawValue === undefined || rawValue === '') return fallback;
    const rate = parseFloat(rawValue);
    if (!Number.isFinite(rate)) {
        console.error(`Withholding rate for ${label} is not a number (${rawValue}); falling back to ${fallback}.`);
        return fallback;
    }
    if (rate < 0 || rate > 1) {
        const clamped = Math.min(Math.max(rate, 0), 1);
        console.error(`Withholding rate for ${label} is ${rate}, outside the expected 0-1 fraction range. Clamping to ${clamped}. Fix the stored setting.`);
        return clamped;
    }
    return rate;
}

/**
 * Load rates and ATC codes from settings, falling back to the statutory
 * defaults. Rates live in settings because BIR revises them.
 */
async function loadWithholdingConfig(client = db) {
    const { rows } = await client.query(
        `SELECT setting_key, setting_value FROM settings WHERE setting_key IN
         ('EWT_RATE_GOODS','EWT_RATE_SERVICES','WITHHOLDING_VAT_RATE_GOV',
          'EWT_ATC_GOODS','EWT_ATC_SERVICES','WITHHOLDING_VAT_ATC_GOV')`
    );
    const s = new Map(rows.map(r => [r.setting_key, r.setting_value]));

    return {
        ewtRateGoods: normalizeRate(s.get('EWT_RATE_GOODS'), DEFAULTS.EWT_RATE_GOODS, 'EWT_RATE_GOODS'),
        ewtRateServices: normalizeRate(s.get('EWT_RATE_SERVICES'), DEFAULTS.EWT_RATE_SERVICES, 'EWT_RATE_SERVICES'),
        vatRateGov: normalizeRate(s.get('WITHHOLDING_VAT_RATE_GOV'), DEFAULTS.WITHHOLDING_VAT_RATE_GOV, 'WITHHOLDING_VAT_RATE_GOV'),
        atcGoods: s.get('EWT_ATC_GOODS') || DEFAULTS.EWT_ATC_GOODS,
        atcServices: s.get('EWT_ATC_SERVICES') || DEFAULTS.EWT_ATC_SERVICES,
        atcVatGov: s.get('WITHHOLDING_VAT_ATC_GOV') || DEFAULTS.WITHHOLDING_VAT_ATC_GOV,
    };
}

/**
 * Split an invoice's VAT-exclusive base into the goods and services portions.
 *
 * Goods and services are withheld at different rates and appear as separate ATC
 * lines on the certificate, so their bases must be kept apart and each rounded
 * independently. Blending them into one base and applying an average rate would
 * produce a figure that cannot be reconciled against the customer's own 2307.
 *
 * @param {Array} lines - Invoice lines carrying `tax_base` and `part_id`
 * @param {Array} parts - Part rows carrying `part_id` and `is_service`
 */
function splitBaseByClass(lines, parts) {
    const serviceFlags = new Map((parts || []).map(p => [p.part_id, Boolean(p.is_service)]));

    let baseGoods = 0;
    let baseServices = 0;

    for (const line of lines || []) {
        const base = Number(line.tax_base) || 0;
        if (serviceFlags.get(line.part_id)) baseServices += base;
        else baseGoods += base;
    }

    return { baseGoods: round2(baseGoods), baseServices: round2(baseServices) };
}

/**
 * Compute the tax a withholding customer is expected to deduct from an invoice.
 *
 * @param {Object} args
 * @param {Array}  args.lines     - Invoice lines with `tax_base` and `part_id`
 * @param {Array}  args.parts     - Part rows with `part_id` and `is_service`
 * @param {Object} args.customer  - { is_withholding_agent, customer_type }
 * @param {Object} args.config    - From loadWithholdingConfig()
 * @returns {{ applicable: boolean, components: Array, total_withheld: number,
 *             ewt_total: number, vat_withheld_total: number,
 *             base_goods: number, base_services: number }}
 *          `components` is one entry per ATC line, ready to persist as
 *          withholding_tax_line rows.
 */
function computeWithholding({ lines, parts, customer, config }) {
    const empty = {
        applicable: false,
        components: [],
        total_withheld: 0,
        ewt_total: 0,
        vat_withheld_total: 0,
        base_goods: 0,
        base_services: 0,
        calculation_version: WITHHOLDING_CALCULATION_VERSION,
    };

    if (!customer || !customer.is_withholding_agent) return empty;

    const { baseGoods, baseServices } = splitBaseByClass(lines, parts);
    if (baseGoods <= 0 && baseServices <= 0) return empty;

    const isGovernment = customer.customer_type === 'GOVERNMENT';
    const components = [];

    // --- Expanded withholding tax (income tax, Form 2307) -----------------
    // Rounded per class, because each is its own line on the certificate.
    if (baseGoods > 0) {
        components.push({
            withholding_type: 'EWT_GOODS',
            treatment: 'INCOME_TAX_CREDITABLE',
            certificate_type: '2307',
            atc_code: config.atcGoods,
            rate_snapshot: config.ewtRateGoods,
            tax_base: baseGoods,
            expected_withheld: round2(baseGoods * config.ewtRateGoods),
        });
    }
    if (baseServices > 0) {
        components.push({
            withholding_type: 'EWT_SERVICES',
            treatment: 'INCOME_TAX_CREDITABLE',
            certificate_type: '2307',
            atc_code: config.atcServices,
            rate_snapshot: config.ewtRateServices,
            tax_base: baseServices,
            expected_withheld: round2(baseServices * config.ewtRateServices),
        });
    }

    // --- Withholding VAT (government buyers only) -------------------------
    // Computed on the whole VATable base, goods and services alike, since it is
    // a tax on the VAT rather than on the income. Treated as creditable: TRAIN
    // shifted this from a final to a creditable system effective 1 Jan 2021.
    if (isGovernment) {
        const vatBase = round2(baseGoods + baseServices);
        if (vatBase > 0) {
            components.push({
                withholding_type: 'VAT_GOV',
                treatment: 'VAT_CREDITABLE',
                certificate_type: '2306',
                atc_code: config.atcVatGov,
                rate_snapshot: config.vatRateGov,
                tax_base: vatBase,
                expected_withheld: round2(vatBase * config.vatRateGov),
            });
        }
    }

    const ewtTotal = round2(components
        .filter(c => c.treatment === 'INCOME_TAX_CREDITABLE')
        .reduce((sum, c) => sum + c.expected_withheld, 0));
    const vatTotal = round2(components
        .filter(c => c.treatment !== 'INCOME_TAX_CREDITABLE')
        .reduce((sum, c) => sum + c.expected_withheld, 0));

    return {
        applicable: components.length > 0,
        components,
        ewt_total: ewtTotal,
        vat_withheld_total: vatTotal,
        total_withheld: round2(ewtTotal + vatTotal),
        base_goods: baseGoods,
        base_services: baseServices,
        calculation_version: WITHHOLDING_CALCULATION_VERSION,
    };
}

/**
 * Convenience wrapper: load config, then compute.
 */
async function computeWithholdingForInvoice({ lines, parts, customer }, client = db) {
    const config = await loadWithholdingConfig(client);
    return computeWithholding({ lines, parts, customer, config });
}

/**
 * The largest deduction that could be an honest mistake rather than an error.
 *
 * `actual_withheld` has to be free to differ from expected -- it routinely does --
 * but "free to differ" cannot mean unbounded, or the withholding channel becomes a
 * way to write off any amount of a receivable with no approval and no audit trail.
 *
 * The ceiling comes from the known failure mode rather than an invented tolerance:
 * customers who get this wrong almost always apply the rate to the VAT-INCLUSIVE
 * invoice total instead of the VAT-exclusive base. That overstates the deduction by
 * exactly the VAT fraction, and it is the largest plausible overstatement there is.
 * Scaling the correct figure by total/base reproduces it precisely, whatever the
 * rate mix.
 *
 * Anything above this line is not a rounding difference or a rate disagreement --
 * it is a keying error or an unauthorised write-off, and it should be rejected so a
 * human looks at it.
 */
function computeWithholdingCeiling(result, invoiceTotal) {
    const baseTotal = round2(Number(result.base_goods || 0) + Number(result.base_services || 0));
    const total = Number(invoiceTotal) || 0;
    if (baseTotal <= 0 || total <= 0) return 0;
    if (total <= baseTotal) return result.total_withheld;
    return round2(result.total_withheld * (total / baseTotal));
}

/**
 * Spread the amount actually withheld across the expected ATC components.
 *
 * The customer hands over one number. The certificate, and the BIR alphalist behind
 * it, need that number broken out by ATC line. Splitting it in proportion to the
 * expected figures preserves the goods/services/VAT mix we computed while making the
 * parts add up to what was really deducted.
 *
 * The final component absorbs the rounding remainder so the components sum to the
 * actual total exactly. Without that the parts can miss the whole by a centavo, and
 * a register that is off by a centavo is a register the bookkeeper cannot file.
 */
function allocateActualAcrossComponents(components, actualTotal) {
    const actual = round2(Number(actualTotal) || 0);
    const expectedTotal = round2(components.reduce((sum, c) => sum + Number(c.expected_withheld), 0));

    if (components.length === 0) return [];
    if (expectedTotal <= 0) {
        return components.map((c, i) => ({ ...c, actual_withheld: i === 0 ? actual : 0 }));
    }

    let running = 0;
    return components.map((c, i) => {
        const isLast = i === components.length - 1;
        const share = isLast
            ? round2(actual - running)
            : round2(actual * (Number(c.expected_withheld) / expectedTotal));
        running = round2(running + share);
        return { ...c, actual_withheld: share };
    });
}

/**
 * Assemble everything needed to compute withholding for an invoice that already
 * exists -- used when tax is withheld on a later AR collection rather than at the
 * counter.
 *
 * Reads tax_base off invoice_line rather than recomputing it. The base was frozen
 * when the invoice was raised; recomputing it now against current part or rate
 * settings could produce a different figure than the invoice the customer is
 * holding, and it is their copy that the certificate will be reconciled against.
 */
async function loadInvoiceWithholdingContext(client, invoiceId) {
    const { rows: invoiceRows } = await client.query(`
        SELECT i.invoice_id, i.invoice_number, i.total_amount, i.customer_id,
               c.is_withholding_agent, c.customer_type, c.tin, c.registered_name
        FROM invoice i
        JOIN customer c ON c.customer_id = i.customer_id
        WHERE i.invoice_id = $1
    `, [invoiceId]);
    if (invoiceRows.length === 0) return null;

    const { rows: lines } = await client.query(`
        SELECT il.part_id, il.tax_base, COALESCE(p.is_service, false) AS is_service
        FROM invoice_line il
        LEFT JOIN part p ON p.part_id = il.part_id
        WHERE il.invoice_id = $1
    `, [invoiceId]);

    return {
        invoice: invoiceRows[0],
        customer: invoiceRows[0],
        lines,
        // is_service already travels on each line, so the parts lookup is built
        // from the same rows rather than fetched a second time.
        parts: lines.map(l => ({ part_id: l.part_id, is_service: l.is_service })),
    };
}

/**
 * Total already withheld against an invoice, so a second collection cannot withhold
 * against the same base twice.
 */
async function sumWithheldForInvoice(client, invoiceId) {
    const { rows } = await client.query(
        'SELECT COALESCE(SUM(actual_withheld), 0) AS total FROM withholding_tax_line WHERE invoice_id = $1',
        [invoiceId]
    );
    return round2(Number(rows[0].total));
}

/**
 * Persist the withholding actually deducted, against the payment that settled it.
 *
 * `actual_withheld` defaults to the expected figure but is passed separately
 * because the two routinely differ -- most often because the customer withheld
 * on the VAT-inclusive total. The receivable must settle on what the customer
 * actually deducted, so the caller supplies the real amount.
 */
async function recordWithholdingLines(client, { invoiceId, customerId, paymentId = null, customerPaymentId = null, components, employeeId, notes = null }) {
    const inserted = [];
    for (const c of components) {
        const actual = c.actual_withheld !== undefined && c.actual_withheld !== null
            ? Number(c.actual_withheld)
            : Number(c.expected_withheld);

        const { rows } = await client.query(`
            INSERT INTO withholding_tax_line (
                invoice_id, customer_id, payment_id, customer_payment_id, withholding_type, treatment,
                atc_code, rate_snapshot, tax_base, expected_withheld, actual_withheld, created_by, notes
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            RETURNING wt_line_id
        `, [
            invoiceId, customerId, paymentId, customerPaymentId, c.withholding_type, c.treatment,
            c.atc_code, c.rate_snapshot, c.tax_base, c.expected_withheld, actual, employeeId || null, notes,
        ]);
        inserted.push(rows[0].wt_line_id);
    }
    return inserted;
}

module.exports = {
    computeWithholding,
    computeWithholdingCeiling,
    allocateActualAcrossComponents,
    loadInvoiceWithholdingContext,
    sumWithheldForInvoice,
    computeWithholdingForInvoice,
    loadWithholdingConfig,
    recordWithholdingLines,
    splitBaseByClass,
    WITHHOLDING_CALCULATION_VERSION,
    DEFAULTS,
};
