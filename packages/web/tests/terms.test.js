import { 
    parsePaymentTermsDays, 
    formatPaymentTerms, 
    computeDueDate, 
    calculateDaysOverdue, 
    formatDueDate 
} from '../src/utils/terms.js';
import assert from 'assert';

try {
    console.log('🧪 Testing enhanced frontend payment terms utilities...\n');

    // Test parsePaymentTermsDays - enhanced version
    console.log('Testing parsePaymentTermsDays...');
    
    // Existing tests
    assert.strictEqual(parsePaymentTermsDays('Net 30'), 30);
    assert.strictEqual(parsePaymentTermsDays('30 days'), 30);
    assert.strictEqual(parsePaymentTermsDays('Due upon receipt'), 0);
    assert.strictEqual(parsePaymentTermsDays('Due on receipt'), 0);
    assert.strictEqual(parsePaymentTermsDays('Custom 45'), 45);
    assert.strictEqual(parsePaymentTermsDays(''), null);
    
    // Enhanced tests
    assert.strictEqual(parsePaymentTermsDays(30), 30, 'Should handle numeric input');
    assert.strictEqual(parsePaymentTermsDays(0), 0, 'Should handle zero');
    assert.strictEqual(parsePaymentTermsDays(-1), null, 'Should reject negative numbers');
    assert.strictEqual(parsePaymentTermsDays(10000), null, 'Should reject numbers > 9999');
    assert.strictEqual(parsePaymentTermsDays('Cash'), 0, 'Should handle cash terms');
    assert.strictEqual(parsePaymentTermsDays('COD'), 0, 'Should handle COD terms');
    assert.strictEqual(parsePaymentTermsDays('immediate'), 0, 'Should handle immediate terms');
    
    console.log('✅ parsePaymentTermsDays tests passed');

    // Test formatPaymentTerms
    console.log('Testing formatPaymentTerms...');
    
    assert.strictEqual(formatPaymentTerms(0), 'Due on receipt');
    assert.strictEqual(formatPaymentTerms(30), '30 days');
    assert.strictEqual(formatPaymentTerms('Net 30'), 'Net 30');
    assert.strictEqual(formatPaymentTerms(null), 'No terms specified');
    
    console.log('✅ formatPaymentTerms tests passed');

    // Test computeDueDate
    console.log('Testing computeDueDate...');
    
    const testDate = new Date('2025-09-16T12:00:00Z');
    const expectedDue30 = new Date('2025-10-16T12:00:00Z');
    const expectedDue0 = new Date('2025-09-16T12:00:00Z');
    
    assert.deepStrictEqual(computeDueDate(30, testDate), expectedDue30);
    assert.deepStrictEqual(computeDueDate(0, testDate), expectedDue0);
    assert.strictEqual(computeDueDate(-1, testDate), null);
    assert.strictEqual(computeDueDate(1.5, testDate), null);
    
    console.log('✅ computeDueDate tests passed');

    // Test calculateDaysOverdue
    console.log('Testing calculateDaysOverdue...');
    
    const currentDate = new Date('2025-09-16T12:00:00Z');
    const pastDue = new Date('2025-09-06T12:00:00Z'); // 10 days ago
    const futureDue = new Date('2025-09-26T12:00:00Z'); // 10 days from now
    
    assert.strictEqual(calculateDaysOverdue(pastDue, currentDate), 10);
    assert.strictEqual(calculateDaysOverdue(futureDue, currentDate), -10);
    assert.strictEqual(calculateDaysOverdue(currentDate, currentDate), 0);
    assert.strictEqual(calculateDaysOverdue(null, currentDate), 0);
    
    console.log('✅ calculateDaysOverdue tests passed');

    // Test formatDueDate
    console.log('Testing formatDueDate...');
    
    const testDueDate = new Date('2025-09-16T12:00:00Z');
    const formatted = formatDueDate(testDueDate, { showOverdue: false });
    assert.ok(formatted.includes('Sep'), 'Should format date');
    assert.ok(formatted.includes('16'), 'Should include day');
    assert.ok(formatted.includes('2025'), 'Should include year');
    
    assert.strictEqual(formatDueDate(null), 'No due date');
    assert.strictEqual(formatDueDate('invalid'), 'Invalid date');
    
    console.log('✅ formatDueDate tests passed');

    console.log('\n🎉 All enhanced frontend payment terms tests passed!');
    process.exit(0);
} catch (err) {
    console.error('❌ Frontend payment terms test failed:', err.message);
    console.error(err.stack);
    process.exit(1);
}
