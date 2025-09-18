#!/usr/bin/env node

/**
 * Tax Implementation Demo
 * Shows the new tax calculation system in action
 */

console.log('🧾 Forson Business Suite - Tax Implementation Demo\n');

// Mock data for demonstration
const mockLines = [
    { part_id: 1, quantity: 2, sale_price: 100.00, discount_amount: 0 },
    { part_id: 2, quantity: 1, sale_price: 50.00, discount_amount: 5.00 }
];

const mockParts = [
    { part_id: 1, tax_rate_id: 1, is_tax_inclusive_price: false },
    { part_id: 2, tax_rate_id: 1, is_tax_inclusive_price: true }
];

const mockTaxRates = new Map([[1, 0.12]]); // 12% VAT
const defaultTaxRate = 0.12;

// Import calculation functions (would normally be from service)
function calculateLineTax(line, part, taxRates, defaultTaxRate) {
    const lineTotal = (line.quantity * line.sale_price) - (line.discount_amount || 0);
    const taxRateId = part.tax_rate_id;
    const taxRatePercentage = taxRates.get(taxRateId) || defaultTaxRate;
    const isTaxInclusive = part.is_tax_inclusive_price || false;
    
    let taxBase, taxAmount;
    
    if (isTaxInclusive) {
        taxBase = lineTotal / (1 + taxRatePercentage);
        taxAmount = lineTotal - taxBase;
    } else {
        taxBase = lineTotal;
        taxAmount = lineTotal * taxRatePercentage;
    }
    
    taxAmount = Math.round(taxAmount * 100) / 100;
    
    return {
        tax_rate_id: taxRateId,
        tax_rate_snapshot: taxRatePercentage,
        tax_base: parseFloat(taxBase.toFixed(4)),
        tax_amount: taxAmount,
        is_tax_inclusive: isTaxInclusive,
        line_total: lineTotal
    };
}

console.log('📋 Invoice Lines:');
mockLines.forEach((line, i) => {
    const part = mockParts[i];
    console.log(`  Line ${i + 1}: ${line.quantity} × $${line.sale_price} ${line.discount_amount ? `(- $${line.discount_amount} discount)` : ''}`);
    console.log(`    Part: Tax ${part.is_tax_inclusive_price ? 'Inclusive' : 'Exclusive'}, Rate ID: ${part.tax_rate_id}`);
});

console.log('\n💰 Tax Calculations:');
let totalSubtotal = 0;
let totalTax = 0;

mockLines.forEach((line, i) => {
    const part = mockParts[i];
    const calc = calculateLineTax(line, part, mockTaxRates, defaultTaxRate);
    
    console.log(`  Line ${i + 1}:`);
    console.log(`    Line Total: $${calc.line_total.toFixed(2)}`);
    console.log(`    Tax Base: $${calc.tax_base.toFixed(2)}`);
    console.log(`    Tax Amount: $${calc.tax_amount.toFixed(2)} (${(calc.tax_rate_snapshot * 100).toFixed(1)}%)`);
    console.log(`    Tax ${calc.is_tax_inclusive ? 'extracted from' : 'added to'} price`);
    
    totalSubtotal += calc.tax_base;
    totalTax += calc.tax_amount;
});

const grandTotal = totalSubtotal + totalTax;

console.log('\n📊 Invoice Summary:');
console.log(`  Subtotal (ex-tax): $${totalSubtotal.toFixed(2)}`);
console.log(`  Tax Total:         $${totalTax.toFixed(2)}`);
console.log(`  Grand Total:       $${grandTotal.toFixed(2)}`);

console.log('\n🏛️ Database Storage:');
console.log('  ✅ invoice.subtotal_ex_tax: $' + totalSubtotal.toFixed(2));
console.log('  ✅ invoice.tax_total: $' + totalTax.toFixed(2));
console.log('  ✅ invoice.total_amount: $' + grandTotal.toFixed(2));
console.log('  ✅ invoice_line.tax_rate_snapshot: preserved per line');
console.log('  ✅ invoice_tax_breakdown: aggregated by rate');

console.log('\n🔧 Implementation Features:');
console.log('  ✅ Backend tax calculation (centralized)');
console.log('  ✅ Per-line tax snapshots (audit trail)');
console.log('  ✅ Tax-inclusive & exclusive support');
console.log('  ✅ Rounding policy (per-line, 2 decimals)');
console.log('  ✅ Tax breakdown for reporting');
console.log('  ✅ Settings UI for tax rate management');
console.log('  ✅ Historical data backfill capability');
console.log('  ✅ Comprehensive tax reporting endpoints');

console.log('\n📈 Benefits:');
console.log('  • Accurate tax tracking & audit trails');
console.log('  • Consistent calculations across POS & invoicing');
console.log('  • Flexible tax rates per product');
console.log('  • Compliance-ready reporting');
console.log('  • Performance-optimized queries');

console.log('\n🚀 Ready for production deployment!');
console.log('\nNext steps:');
console.log('  1. Run database migrations');
console.log('  2. Deploy backend changes');
console.log('  3. Update frontend (POS & Settings)');
console.log('  4. Backfill historical data (optional)');
console.log('  5. Monitor and validate calculations');

console.log('\n📚 See TAX_IMPLEMENTATION.md for complete deployment guide.');