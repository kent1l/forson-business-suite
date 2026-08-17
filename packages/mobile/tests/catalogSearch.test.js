const assert = require('node:assert');
const test = require('node:test');

const { buildMatchExpression } = require('../src/offline/catalogSearchQuery.ts');

test('nothing searchable yields null rather than an unbounded query', () => {
  assert.strictEqual(buildMatchExpression(''), null);
  assert.strictEqual(buildMatchExpression('   '), null);
  assert.strictEqual(buildMatchExpression('---'), null);
  assert.strictEqual(buildMatchExpression(undefined), null);
});

test('a single word becomes a quoted prefix term', () => {
  assert.strictEqual(buildMatchExpression('musashi'), '"musashi"*');
});

test('case is normalised so scanning and typing agree', () => {
  assert.strictEqual(buildMatchExpression('MUSASHI'), buildMatchExpression('musashi'));
});

test('part numbers split on punctuation instead of being read as operators', () => {
  // The case that would otherwise parse as a chain of NOT operators.
  assert.strictEqual(
    buildMatchExpression('9-09924-415-0'),
    '"9"* AND "09924"* AND "415"* AND "0"*'
  );
  assert.strictEqual(
    buildMatchExpression('OISE-MUSA-0001'),
    '"oise"* AND "musa"* AND "0001"*'
  );
});

test('extra words narrow the search', () => {
  assert.strictEqual(buildMatchExpression('oil seal'), '"oil"* AND "seal"*');
});

test('FTS operators typed by a user are quoted into literals, not honoured', () => {
  // Each of these would change the query semantics if it survived unquoted.
  assert.strictEqual(buildMatchExpression('a OR b'), '"a"* AND "or"* AND "b"*');
  assert.strictEqual(buildMatchExpression('a NOT b'), '"a"* AND "not"* AND "b"*');
  assert.strictEqual(buildMatchExpression('NEAR(a b)'), '"near"* AND "a"* AND "b"*');
});

test('quotes and backslashes cannot escape the generated term', () => {
  // A stray quote would otherwise close the literal and reopen it as syntax.
  assert.strictEqual(buildMatchExpression('a" OR "1"="1'), '"a"* AND "or"* AND "1"* AND "1"*');
  assert.strictEqual(buildMatchExpression('\\'), null);
  assert.strictEqual(buildMatchExpression('"'), null);
  assert.strictEqual(buildMatchExpression("'; DROP TABLE parts;--"), '"drop"* AND "table"* AND "parts"*');
});

test('every emitted token is a closed quoted literal', () => {
  const inputs = ['9-09924-415-0', 'a" OR "1', 'NEAR(x', '***', 'foo bar baz'];
  for (const input of inputs) {
    const out = buildMatchExpression(input);
    if (out === null) continue;
    // An odd number of quotes would mean a term escaped its literal.
    const quotes = (out.match(/"/g) || []).length;
    assert.strictEqual(quotes % 2, 0, `unbalanced quotes for ${input}: ${out}`);
    for (const term of out.split(' AND ')) {
      assert.match(term, /^"[a-z0-9]+"\*$/, `unexpected term ${term} for ${input}`);
    }
  }
});
