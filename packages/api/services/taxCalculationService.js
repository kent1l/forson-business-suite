const db = require('../db');

/**
 * Tax calculation service
 * Centralizes all tax computation logic for invoices and invoice lines
 */

const TAX_CALCULATION_VERSION = 'v1.0';

/**
 * Calculate tax for a single invoice line
 * @param {Object} line - Line item with quantity, sale_price, discount_amount
 * @param {Object} part - Part details with tax_rate_id, is_tax_inclusive_price
 * @param {Object} taxRates - Map of tax_rate_id to rate_percentage
 * @param {number} defaultTaxRate - Default tax rate percentage
 * @returns {Object} Tax calculation result
 */
function calculateLineTax(line, part, taxRates, defaultTaxRate) {
    const lineTotal = (line.quantity * line.sale_price) - (line.discount_amount || 0);
    const taxRateId = part.tax_rate_id;
    const taxRatePercentage = taxRates.get(taxRateId) || defaultTaxRate;
    const isTaxInclusive = part.is_tax_inclusive_price || false;
    
    let taxBase, taxAmount;
    
    if (isTaxInclusive) {
        // Tax inclusive: extract tax from total
        taxBase = lineTotal / (1 + taxRatePercentage);
        taxAmount = lineTotal - taxBase;
    } else {
        // Tax exclusive: add tax to base
        taxBase = lineTotal;
        taxAmount = lineTotal * taxRatePercentage;
    }
    
    // Round tax amount to 2 decimal places (per-line rounding policy)
    taxAmount = Math.round(taxAmount * 100) / 100;
    
    return {
        tax_rate_id: taxRateId,
        tax_rate_snapshot: taxRatePercentage,
        tax_base: parseFloat(taxBase.toFixed(4)), // Higher precision for internal calc
        tax_amount: taxAmount,
        is_tax_inclusive: isTaxInclusive,
        line_total: lineTotal
    };
}

/**
 * Calculate tax breakdown for an entire invoice
 * @param {Array} lines - Array of line items
 * @param {Array} parts - Array of part details
 * @param {number} selectedTaxRateId - Optional selected tax rate ID from frontend
 * @returns {Object} Complete tax calculation
 */
async function calculateInvoiceTax(lines, parts, selectedTaxRateId = null) {
    try {
        // Get default tax rate if not provided
        let defaultTaxRate = null;
        
        if (selectedTaxRateId) {
            // Use the selected tax rate as default
            const { rows: selectedRateRows } = await db.query(
                'SELECT rate_percentage FROM tax_rate WHERE tax_rate_id = $1',
                [selectedTaxRateId]
            );
            if (selectedRateRows.length > 0) {
                defaultTaxRate = parseFloat(selectedRateRows[0].rate_percentage);
            }
        }
        
        if (defaultTaxRate === null) {
            // Fall back to database default
            const { rows } = await db.query('SELECT rate_percentage FROM tax_rate WHERE is_default = true LIMIT 1');
            defaultTaxRate = rows.length > 0 ? parseFloat(rows[0].rate_percentage) : 0.12; // 12% fallback
        }
        
        // Get all tax rates for efficient lookup
        const { rows: taxRateRows } = await db.query('SELECT tax_rate_id, rate_percentage FROM tax_rate');
        const taxRates = new Map(taxRateRows.map(r => [r.tax_rate_id, parseFloat(r.rate_percentage)]));
        
        // Create parts lookup map
        const partsMap = new Map(parts.map(p => [p.part_id, p]));
        
        // Calculate tax for each line
        const lineCalculations = lines.map(line => {
            const part = partsMap.get(line.part_id);
            if (!part) {
                throw new Error(`Part not found: ${line.part_id}`);
            }
            
            const calculation = calculateLineTax(line, part, taxRates, defaultTaxRate);
            return {
                ...line,
                ...calculation
            };
        });
        
        // Calculate invoice totals
        const subtotalExTax = lineCalculations.reduce((sum, line) => sum + line.tax_base, 0);
        const taxTotal = lineCalculations.reduce((sum, line) => sum + line.tax_amount, 0);
        const total = subtotalExTax + taxTotal;
        
        // Group by tax rate for breakdown
        const taxBreakdown = new Map();
        lineCalculations.forEach(line => {
            const key = line.tax_rate_id || 'default';
            const existing = taxBreakdown.get(key) || {
                tax_rate_id: line.tax_rate_id,
                rate_name: null, // Will be populated from DB
                rate_percentage: line.tax_rate_snapshot,
                tax_base: 0,
                tax_amount: 0,
                line_count: 0
            };
            
            existing.tax_base += line.tax_base;
            existing.tax_amount += line.tax_amount;
            existing.line_count += 1;
            
            taxBreakdown.set(key, existing);
        });
        
        // Get rate names for breakdown
        const rateIds = Array.from(taxBreakdown.keys()).filter(id => id !== 'default');
        if (rateIds.length > 0) {
            const { rows: rateNames } = await db.query(
                'SELECT tax_rate_id, rate_name FROM tax_rate WHERE tax_rate_id = ANY($1)',
                [rateIds]
            );
            const rateNamesMap = new Map(rateNames.map(r => [r.tax_rate_id, r.rate_name]));
            
            taxBreakdown.forEach((breakdown, key) => {
                if (key !== 'default') {
                    breakdown.rate_name = rateNamesMap.get(breakdown.tax_rate_id) || 'Unknown';
                } else {
                    breakdown.rate_name = selectedTaxRateId ? 'Selected Rate' : 'Default Rate';
                }
            });
        }
        
        return {
            lines: lineCalculations,
            subtotal_ex_tax: Math.round(subtotalExTax * 100) / 100,
            tax_total: Math.round(taxTotal * 100) / 100,
            total_amount: Math.round(total * 100) / 100,
            tax_breakdown: Array.from(taxBreakdown.values()),
            tax_calculation_version: TAX_CALCULATION_VERSION
        };
        
    } catch (error) {
        console.error('Tax calculation error:', error);
        throw new Error(`Tax calculation failed: ${error.message}`);
    }
}

/**
 * Store tax breakdown in database
 * @param {number} invoiceId - Invoice ID
 * @param {Array} taxBreakdown - Tax breakdown array
 * @param {Object} client - Database client (for transactions)
 */
async function storeTaxBreakdown(invoiceId, taxBreakdown, client = db) {
    for (const breakdown of taxBreakdown) {
        await client.query(`
            INSERT INTO invoice_tax_breakdown (
                invoice_id, tax_rate_id, rate_name, rate_percentage, 
                tax_base, tax_amount, line_count
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (invoice_id, tax_rate_id) DO UPDATE SET
                rate_name = EXCLUDED.rate_name,
                rate_percentage = EXCLUDED.rate_percentage,
                tax_base = EXCLUDED.tax_base,
                tax_amount = EXCLUDED.tax_amount,
                line_count = EXCLUDED.line_count
        `, [
            invoiceId,
            breakdown.tax_rate_id,
            breakdown.rate_name,
            breakdown.rate_percentage,
            Math.round(breakdown.tax_base * 100) / 100,
            breakdown.tax_amount,
            breakdown.line_count
        ]);
    }
}

/**
 * Validate tax calculation consistency
 * @param {Object} calculation - Tax calculation result
 * @returns {boolean} True if valid
 */
function validateTaxCalculation(calculation) {
    const { lines, subtotal_ex_tax, tax_total, total_amount } = calculation;
    
    // Check line totals sum correctly
    const expectedSubtotal = lines.reduce((sum, line) => sum + line.tax_base, 0);
    const expectedTax = lines.reduce((sum, line) => sum + line.tax_amount, 0);
    const expectedTotal = expectedSubtotal + expectedTax;
    
    const subtotalDiff = Math.abs(subtotal_ex_tax - expectedSubtotal);
    const taxDiff = Math.abs(tax_total - expectedTax);
    const totalDiff = Math.abs(total_amount - expectedTotal);
    
    // Allow small rounding differences (1 cent)
    const tolerance = 0.01;
    
    if (subtotalDiff > tolerance || taxDiff > tolerance || totalDiff > tolerance) {
        console.error('Tax calculation validation failed:', {
            subtotal_diff: subtotalDiff,
            tax_diff: taxDiff,
            total_diff: totalDiff,
            calculation
        });
        return false;
    }
    
    return true;
}

module.exports = {
    calculateInvoiceTax,
    calculateLineTax,
    storeTaxBreakdown,
    validateTaxCalculation,
    TAX_CALCULATION_VERSION
};