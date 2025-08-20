import { parsePaymentTermsDays } from '../src/utils/terms.js';
import assert from 'assert';

try {
  assert.strictEqual(parsePaymentTermsDays('Net 30'), 30);
  assert.strictEqual(parsePaymentTermsDays('30 days'), 30);
  assert.strictEqual(parsePaymentTermsDays('Due upon receipt'), 0);
  assert.strictEqual(parsePaymentTermsDays('Due on receipt'), 0);
  assert.strictEqual(parsePaymentTermsDays('Custom 45'), 45);
  assert.strictEqual(parsePaymentTermsDays(''), null);
  console.log('terms util tests passed');
  process.exit(0);
} catch (err) {
  console.error('terms util test failed', err);
  process.exit(1);
}
