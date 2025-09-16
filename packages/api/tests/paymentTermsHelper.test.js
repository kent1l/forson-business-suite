// Payment Terms Helper Tests
// Comprehensive unit tests for payment terms validation and parsing

const assert = require('assert');
const {
    parsePaymentTermsDays,
    computeDueDate,
    validatePaymentTerms,
    formatPaymentTerms,
    calculateDaysOverdue
} = require('../helpers/paymentTermsHelper');

function runTests() {
    console.log('🧪 Running Payment Terms Helper Tests...\n');

    // Test parsePaymentTermsDays
    console.log('Testing parsePaymentTermsDays...');
    
    // Numeric input
    assert.strictEqual(parsePaymentTermsDays(30), 30, 'Should handle numeric input');
    assert.strictEqual(parsePaymentTermsDays(0), 0, 'Should handle zero');
    assert.strictEqual(parsePaymentTermsDays(-1), null, 'Should reject negative numbers');
    assert.strictEqual(parsePaymentTermsDays(10000), null, 'Should reject numbers > 9999');
    assert.strictEqual(parsePaymentTermsDays(1.5), null, 'Should reject non-integers');
    
    // String input
    assert.strictEqual(parsePaymentTermsDays('Net 30'), 30, 'Should parse "Net 30"');
    assert.strictEqual(parsePaymentTermsDays('30 days'), 30, 'Should parse "30 days"');
    assert.strictEqual(parsePaymentTermsDays('Payment due in 45 days'), 45, 'Should extract number from text');
    assert.strictEqual(parsePaymentTermsDays('COD'), 0, 'Should parse COD as immediate payment');
    assert.strictEqual(parsePaymentTermsDays('Due upon receipt'), 0, 'Should handle immediate payment phrases');
    assert.strictEqual(parsePaymentTermsDays('Due on receipt'), 0, 'Should handle receipt phrases');
    assert.strictEqual(parsePaymentTermsDays('Cash'), 0, 'Should handle cash terms');
    assert.strictEqual(parsePaymentTermsDays(''), null, 'Should handle empty string');
    assert.strictEqual(parsePaymentTermsDays(null), null, 'Should handle null');
    assert.strictEqual(parsePaymentTermsDays(undefined), null, 'Should handle undefined');
    
    console.log('✅ parsePaymentTermsDays tests passed\n');

    // Test computeDueDate
    console.log('Testing computeDueDate...');
    
    const testDate = new Date('2025-09-16T12:00:00Z');
    const expectedDue30 = new Date('2025-10-16T12:00:00Z');
    const expectedDue0 = new Date('2025-09-16T12:00:00Z');
    
    assert.deepStrictEqual(computeDueDate(30, testDate), expectedDue30, 'Should compute due date for 30 days');
    assert.deepStrictEqual(computeDueDate(0, testDate), expectedDue0, 'Should handle immediate payment');
    assert.strictEqual(computeDueDate(-1, testDate), null, 'Should reject negative days');
    assert.strictEqual(computeDueDate(1.5, testDate), null, 'Should reject non-integer days');
    assert.strictEqual(computeDueDate(30, 'invalid'), null, 'Should reject invalid date');
    assert.strictEqual(computeDueDate(30, null), null, 'Should reject null date');
    
    console.log('✅ computeDueDate tests passed\n');

    // Test validatePaymentTerms
    console.log('Testing validatePaymentTerms...');
    
    // Valid cases
    let result = validatePaymentTerms({ payment_terms_days: 30 });
    assert.strictEqual(result.isValid, true, 'Should validate explicit days');
    assert.strictEqual(result.canonicalDays, 30, 'Should extract canonical days');
    assert.ok(result.dueDate, 'Should compute due date');
    
    result = validatePaymentTerms({ terms: 'Net 30' });
    assert.strictEqual(result.isValid, true, 'Should validate parsed terms');
    assert.strictEqual(result.canonicalDays, 30, 'Should parse from terms');
    
    result = validatePaymentTerms({ terms: 'Due on receipt' });
    assert.strictEqual(result.isValid, true, 'Should validate immediate terms');
    assert.strictEqual(result.canonicalDays, 0, 'Should parse immediate as 0');
    
    // Priority test: explicit payment_terms_days takes precedence
    result = validatePaymentTerms({ payment_terms_days: 45, terms: 'Net 30' });
    assert.strictEqual(result.canonicalDays, 45, 'Explicit days should take precedence');
    
    // Invalid cases
    result = validatePaymentTerms({ payment_terms_days: -1 });
    assert.strictEqual(result.isValid, false, 'Should reject negative days');
    assert.ok(result.errors.length > 0, 'Should have error messages');
    
    result = validatePaymentTerms({ payment_terms_days: 10000 });
    assert.strictEqual(result.isValid, false, 'Should reject overly large days');
    
    result = validatePaymentTerms({ terms: 'Invalid unparseable terms' });
    assert.strictEqual(result.isValid, false, 'Should reject unparseable terms');
    
    // Empty input should be valid (no terms specified)
    result = validatePaymentTerms({});
    assert.strictEqual(result.isValid, true, 'Empty input should be valid');
    assert.strictEqual(result.canonicalDays, null, 'Should have null canonical days');
    
    console.log('✅ validatePaymentTerms tests passed\n');

    // Test formatPaymentTerms
    console.log('Testing formatPaymentTerms...');
    
    assert.strictEqual(formatPaymentTerms(0), 'Due on receipt', 'Should format immediate payment');
    assert.strictEqual(formatPaymentTerms(30), '30 days', 'Should format days');
    assert.strictEqual(formatPaymentTerms('Net 30'), 'Net 30', 'Should pass through string');
    assert.strictEqual(formatPaymentTerms(null), 'No terms specified', 'Should handle null');
    assert.strictEqual(formatPaymentTerms(undefined), 'No terms specified', 'Should handle undefined');
    
    console.log('✅ formatPaymentTerms tests passed\n');

    // Test calculateDaysOverdue
    console.log('Testing calculateDaysOverdue...');
    
    const currentDate = new Date('2025-09-16T12:00:00Z');
    const pastDue = new Date('2025-09-06T12:00:00Z'); // 10 days ago
    const futureDue = new Date('2025-09-26T12:00:00Z'); // 10 days from now
    
    assert.strictEqual(calculateDaysOverdue(pastDue, currentDate), 10, 'Should calculate overdue days');
    assert.strictEqual(calculateDaysOverdue(futureDue, currentDate), -10, 'Should handle future due dates');
    assert.strictEqual(calculateDaysOverdue(currentDate, currentDate), 0, 'Should handle same date');
    assert.strictEqual(calculateDaysOverdue(null, currentDate), 0, 'Should handle null due date');
    assert.strictEqual(calculateDaysOverdue('invalid', currentDate), 0, 'Should handle invalid due date');
    
    console.log('✅ calculateDaysOverdue tests passed\n');

    console.log('🎉 All Payment Terms Helper tests passed!');
}

// Integration test for typical invoice creation flow
function runIntegrationTests() {
    console.log('\n🔧 Running Integration Tests...\n');

    console.log('Testing typical invoice creation scenarios...');
    
    // Scenario 1: Explicit payment terms
    let validation = validatePaymentTerms({
        payment_terms_days: 30,
        invoice_date: '2025-09-16T12:00:00Z'
    });
    assert.strictEqual(validation.isValid, true, 'Should validate typical invoice');
    assert.strictEqual(validation.canonicalDays, 30, 'Should extract days');
    assert.ok(validation.dueDate.includes('2025-10-16'), 'Should compute correct due date');
    
    // Scenario 2: Text-based terms
    validation = validatePaymentTerms({
        terms: 'Net 15',
        invoice_date: '2025-09-16T12:00:00Z'
    });
    assert.strictEqual(validation.isValid, true, 'Should validate text terms');
    assert.strictEqual(validation.canonicalDays, 15, 'Should parse text correctly');
    
    // Scenario 3: Immediate payment
    validation = validatePaymentTerms({
        terms: 'Cash on delivery',
        invoice_date: '2025-09-16T12:00:00Z'
    });
    assert.strictEqual(validation.isValid, true, 'Should validate COD terms');
    assert.strictEqual(validation.canonicalDays, 0, 'Should parse COD as immediate');
    
    // Scenario 4: Invalid input handling
    validation = validatePaymentTerms({
        payment_terms_days: 'invalid',
        terms: 'Unparseable terms'
    });
    assert.strictEqual(validation.isValid, false, 'Should reject invalid inputs');
    assert.ok(validation.errors.length > 0, 'Should provide error messages');
    
    console.log('✅ Integration tests passed\n');

    console.log('🎉 All tests completed successfully!');
}

// Run the tests
if (require.main === module) {
    try {
        runTests();
        runIntegrationTests();
        process.exit(0);
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

module.exports = { runTests, runIntegrationTests };