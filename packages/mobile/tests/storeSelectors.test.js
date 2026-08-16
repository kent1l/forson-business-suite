const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Guards against a Zustand v5 footgun that cost a render loop.
 *
 * Zustand reads through useSyncExternalStore, which compares each snapshot by
 * reference. A selector whose body builds a new array — anything ending in
 * `.filter(...)`, `.map(...)` and friends — returns a different reference every
 * call, so the snapshot never compares equal, the component re-renders, and
 * React eventually aborts the tree with "Maximum update depth exceeded". The
 * screen is simply dead, and the stack trace points at the hook rather than the
 * selector, which makes it slow to find.
 *
 * Deriving outside the selector — select the stored value, then useMemo — keeps
 * the reference stable.
 *
 * This walks the source rather than rendering, because the failure only
 * reproduces inside React's commit loop.
 */

const SRC = path.join(__dirname, '..', 'src');
const STORE_HOOK = /\buse[A-Z]\w*Store\s*\(/g;

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [full] : [];
  });

/** The text of the call's arguments, found by matching parens rather than guessing. */
const readCallArgs = (source, openParenIndex) => {
  let depth = 0;
  for (let i = openParenIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openParenIndex + 1, i);
    }
  }
  return null;
};

const buildsNewCollection = (selector) => {
  const arrow = selector.indexOf('=>');
  if (arrow === -1) return false;
  const body = selector.slice(arrow + 2).trim().replace(/,$/, '').trim();

  // A returned array or object literal is a fresh reference every call.
  if (/^[[{]/.test(body)) return true;

  // So is the result of any method that allocates a new collection.
  return /\.(filter|map|slice|concat|sort|reverse|flatMap|reduce)\s*\(/.test(body)
    // ...unless the expression narrows to a primitive afterwards.
    && !/\)\s*\.\s*(length|size)\s*$/.test(body)
    && !/^\s*!{0,2}\s*Boolean\(/.test(body);
};

const findOffenders = (source, label) => {
  const offenders = [];
  STORE_HOOK.lastIndex = 0;
  let match;
  while ((match = STORE_HOOK.exec(source)) !== null) {
    const open = match.index + match[0].length - 1;
    const args = readCallArgs(source, open);
    if (args && buildsNewCollection(args)) {
      offenders.push(`${label}:${source.slice(0, match.index).split('\n').length}`);
    }
  }
  return offenders;
};

test('the check itself detects a selector that builds a new array', () => {
  const bad = `
    const queued = useOutboxStore((s) =>
      s.entries.filter((e) => e.kind === 'time-punch' && e.status === 'pending'),
    );
  `;
  assert.deepStrictEqual(findOffenders(bad, 'sample'), ['sample:2']);
});

test('the check accepts selectors that are already safe', () => {
  const good = [
    "const entries = useOutboxStore((s) => s.entries);",
    "const n = useOutboxStore((s) => s.entries.filter((e) => e.status === 'pending').length);",
    "const hydrate = useOutboxStore((s) => s.hydrate);",
    "const user = useAuthStore((s) => s.user);",
  ].join('\n');
  assert.deepStrictEqual(findOffenders(good, 'sample'), []);
});

test('no store selector in the app builds a new collection', () => {
  const offenders = walk(SRC).flatMap((file) =>
    findOffenders(fs.readFileSync(file, 'utf8'), path.relative(SRC, file)),
  );

  assert.deepStrictEqual(
    offenders,
    [],
    'These selectors allocate on every call and will loop at runtime.\n'
      + 'Select the stored value and derive it with useMemo instead:\n  '
      + offenders.join('\n  '),
  );
});
