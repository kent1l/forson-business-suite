/**
 * Client-side tax preview for the cart / invoice builder.
 *
 * This mirrors the server's calculation in
 * `packages/api/services/taxCalculationService.js` (`calculateLineTax` and
 * `computeTaxForBase`) so the operator sees the right total before submitting.
 * The server always recomputes authoritatively on save and both callers
 * overwrite these figures with the server's response afterwards, so this is a
 * display aid, never the stored value.
 *
 * If the rounding or rate handling in taxCalculationService.js changes, change
 * it here too -- there is no shared package between the API and the web app, so
 * the two are kept in step by hand.
 */

/**
 * Read a tax rate as a decimal fraction (0.12 = 12%).
 *
 * The tax_rate table constrains rate_percentage to [0, 1], so a value outside
 * that range means bad data rather than a different unit. Clamp and say so
 * rather than guessing the operator meant percent -- guessing misreads a rate
 * of 1 ("1%") as 100%.
 */
const normalizeRate = (r) => {
    if (r === null || r === undefined || r === '') return 0;
    const num = parseFloat(r);
    if (!Number.isFinite(num)) return 0;
    if (num < 0 || num > 1) {
        const clamped = Math.min(Math.max(num, 0), 1);
        console.error(`[TAX] Rate ${num} is outside the expected 0-1 fraction range; clamping to ${clamped}. Check the stored rate_percentage.`);
        return clamped;
    }
    return num;
};

/**
 * @param {Array} lines - Cart lines: quantity, sale_price, discount_amount, tax_rate_id, is_tax_inclusive_price
 * @param {Array} taxRates - Tax rate rows from /tax-rates
 * @param {Object|null} selectedTaxRate - The rate chosen for the sale, if any
 * @param {string} logLabel - Tag used when warning about an anomaly
 * @returns {{subtotal: number, tax: number, total: number, grossSubtotal: number, hasInclusive: boolean, anomaly: Object|null}}
 *   `subtotal` is net of tax; `grossSubtotal` is the sum of the line totals as entered.
 */
export function computeTaxPreview(lines, taxRates, selectedTaxRate, logLabel = 'TAX') {
    const rateList = Array.isArray(taxRates) ? taxRates : [];
    const taxRatesMap = new Map(rateList.map(rate => [rate.tax_rate_id, normalizeRate(rate.rate_percentage)]));
    const defaultTaxRate = normalizeRate(rateList.find(r => r.is_default)?.rate_percentage ?? 0);
    const selectedTaxRatePercentage = normalizeRate(selectedTaxRate?.rate_percentage ?? defaultTaxRate);

    let netSubtotal = 0;      // Sum of tax bases (exclusive of tax)
    let grossSubtotal = 0;    // Sum of the line totals as entered
    let calculatedTax = 0;
    let hasInclusive = false;

    (lines || []).forEach(line => {
        const lineTotal = (line.quantity * line.sale_price) - (line.discount_amount || 0);
        grossSubtotal += lineTotal;

        let ratePercentage = taxRatesMap.get(line.tax_rate_id);
        if (ratePercentage === undefined || ratePercentage === null) ratePercentage = selectedTaxRatePercentage;

        let taxBase, taxAmount;
        if (line.is_tax_inclusive_price) {
            hasInclusive = true;
            taxBase = lineTotal / (1 + ratePercentage);
            taxAmount = lineTotal - taxBase;
            taxAmount = Math.round(taxAmount * 100) / 100; // per-line rounding
            taxBase = lineTotal - taxAmount;
        } else {
            taxBase = lineTotal;
            taxAmount = lineTotal * ratePercentage;
            taxAmount = Math.round(taxAmount * 100) / 100; // per-line rounding
        }

        netSubtotal += taxBase;
        calculatedTax += taxAmount;
    });

    const roundedNetSubtotal = Math.round(netSubtotal * 100) / 100;
    const roundedGrossSubtotal = Math.round(grossSubtotal * 100) / 100;
    const total = Math.round((roundedNetSubtotal + calculatedTax) * 100) / 100;

    // Anomaly checks: a tax share this large, or a total that cannot be
    // recomposed from its parts, means something is wrong with the rate data.
    let anomaly = null;
    if (roundedNetSubtotal > 0) {
        const effectiveRate = calculatedTax / roundedNetSubtotal;
        if (effectiveRate > 1) {
            anomaly = {
                type: 'HIGH_EFFECTIVE_RATE',
                effectiveRate,
                netSubtotal: roundedNetSubtotal,
                tax: calculatedTax,
                grossSubtotal: roundedGrossSubtotal
            };
        }
    }
    if (!anomaly && Math.abs(total - roundedGrossSubtotal) > 0.05) {
        anomaly = {
            type: 'RECOMPOSE_MISMATCH',
            netSubtotal: roundedNetSubtotal,
            tax: calculatedTax,
            recomposed: total,
            grossSubtotal: roundedGrossSubtotal
        };
    }
    if (anomaly) {
        console.warn(`[${logLabel}][TAX][ANOMALY]`, anomaly);
    }

    return {
        subtotal: roundedNetSubtotal,
        tax: Math.round(calculatedTax * 100) / 100,
        total,
        grossSubtotal: roundedGrossSubtotal,
        hasInclusive,
        anomaly
    };
}

export default computeTaxPreview;
