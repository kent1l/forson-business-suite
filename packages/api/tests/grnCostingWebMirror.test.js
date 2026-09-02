const fs = require('fs');
const { generate, TARGET } = require('../scripts/generateWebGrnCosting');

// The goods receipt screen recomputes landed cost live, so the same arithmetic exists
// in packages/web. It is generated, not written twice — this test is what makes that
// guarantee real: edit the service and forget to regenerate, and CI says so here rather
// than a receipt posting at a cost nobody saw on screen.
describe('web mirror of grnCostingService', () => {
  test('packages/web/src/utils/grnCosting.js is in sync with its source', () => {
    expect(fs.existsSync(TARGET)).toBe(true);
    expect(fs.readFileSync(TARGET, 'utf8')).toBe(generate());
  });

  test('the generated module is ESM and exports the whole public surface', () => {
    const generated = generate();
    expect(generated).not.toMatch(/module\.exports/);
    expect(generated).toMatch(/^export \{$/m);
    ['computeCosting', 'distributeByWeight', 'priceFromMarkup', 'markupFromPrice',
      'DEFAULT_MARKUP_PERCENT', 'MIN_MARKUP_PERCENT', 'REJECTION_REASONS'].forEach((name) => {
      expect(generated).toContain(`  ${name},`);
    });
  });
});
