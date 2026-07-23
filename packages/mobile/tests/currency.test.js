const assert = require('node:assert');
const test = require('node:test');

function formatPHP(amount) {
  const parsed = typeof amount === 'string' ? parseFloat(amount) : amount;
  const val = typeof parsed === 'number' && !isNaN(parsed) ? parsed : 0;
  return `₱${val.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

test('formatPHP formats numbers into PHP currency format', () => {
  assert.strictEqual(formatPHP(1234.5), '₱1,234.50');
  assert.strictEqual(formatPHP('99.9'), '₱99.90');
  assert.strictEqual(formatPHP(0), '₱0.00');
  assert.strictEqual(formatPHP('invalid'), '₱0.00');
  assert.strictEqual(formatPHP(null), '₱0.00');
});
