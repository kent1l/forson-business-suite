'use strict';

/**
 * Generate the web package's copy of the goods receipt costing module.
 *
 * The UI has to recompute landed cost, freight allocation and suggested prices on every
 * keystroke, so it cannot round-trip to the API for them — but two hand-maintained
 * implementations of the same money arithmetic would drift, and the drift would be
 * invisible until a receipt posted at a cost the encoder never saw.
 *
 * There is no shared workspace package to put the module in (packages/ holds only api,
 * web and mobile), and the web build cannot reach across into packages/api. So the
 * CommonJS module is the single source of truth and the ESM copy is generated from it
 * by mechanical transformation. tests/grnCostingWebMirror.test.js re-runs this and
 * fails if the committed copy differs, which makes the drift a CI failure rather than a
 * production surprise.
 *
 * Usage: node scripts/generateWebGrnCosting.js [--check]
 */

const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '..', 'services', 'grnCostingService.js');
const TARGET = path.join(__dirname, '..', '..', 'web', 'src', 'utils', 'grnCosting.js');

const HEADER = `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Mirrors packages/api/services/grnCostingService.js so the goods receipt screen can
// recompute landed cost and freight allocation live, without a round trip. Regenerate
// with:  node packages/api/scripts/generateWebGrnCosting.js
//
// packages/api/tests/grnCostingWebMirror.test.js fails if this file drifts from its
// source, so edit the source and regenerate — never edit this copy.

`;

function generate() {
  const source = fs.readFileSync(SOURCE, 'utf8');

  // The module ends with a single `module.exports = { … };` listing every public name.
  const exportMatch = source.match(/module\.exports = \{([\s\S]*?)\};\s*$/);
  if (!exportMatch) {
    throw new Error('Expected grnCostingService.js to end with a module.exports object literal.');
  }

  const names = exportMatch[1]
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);

  const body = source
    .slice(0, exportMatch.index)
    .replace(/^'use strict';\n+/, '')
    .trimEnd();

  return `${HEADER}${body}\n\nexport {\n${names.map((n) => `  ${n},`).join('\n')}\n};\n`;
}

const generated = generate();

if (process.argv.includes('--check')) {
  const existing = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
  if (existing !== generated) {
    console.error(`${TARGET} is out of date. Run: node packages/api/scripts/generateWebGrnCosting.js`);
    process.exit(1);
  }
  console.log('web grnCosting mirror is up to date.');
} else {
  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  fs.writeFileSync(TARGET, generated);
  console.log(`Wrote ${TARGET}`);
}

module.exports = { generate, TARGET };
