const assert = require('node:assert');
const test = require('node:test');

const { compareVersions, isUpdateRequired } = require('../src/utils/version.ts');

test('compareVersions orders plain numeric versions', () => {
  assert.strictEqual(compareVersions('2.1.0', '2.0.0'), 1);
  assert.strictEqual(compareVersions('2.0.0', '2.1.0'), -1);
  assert.strictEqual(compareVersions('2.0.0', '2.0.0'), 0);
  // Segment-wise, not lexicographic: 2.10 is newer than 2.9.
  assert.strictEqual(compareVersions('2.10.0', '2.9.0'), 1);
  // Missing segments are zero.
  assert.strictEqual(compareVersions('2.1', '2.1.0'), 0);
});

test('compareVersions reports unparseable versions', () => {
  assert.strictEqual(compareVersions('latest', '2.0.0'), null);
  assert.strictEqual(compareVersions('2.0.0', ''), null);
});

test('an update is required only when the server is genuinely newer', () => {
  assert.strictEqual(isUpdateRequired('2.0.0', '2.1.0'), true);
});

test('a build ahead of the server is not locked out', () => {
  // The case that motivated this: a dev or preview build installed before the
  // server setting has been bumped. The old exact-mismatch check blocked it
  // before login, with no way through.
  assert.strictEqual(isUpdateRequired('2.1.0', '2.0.0'), false);
});

test('a matching version is not asked to update', () => {
  assert.strictEqual(isUpdateRequired('2.1.0', '2.1.0'), false);
  assert.strictEqual(isUpdateRequired('2.1', '2.1.0'), false);
});

test('a missing server setting never blocks the app', () => {
  assert.strictEqual(isUpdateRequired('2.1.0', ''), false);
  assert.strictEqual(isUpdateRequired('2.1.0', undefined), false);
});

test('an unparseable server version still works as a kill switch', () => {
  // Admins rely on this setting to stop every client; an odd value must not
  // silently disable the gate.
  assert.strictEqual(isUpdateRequired('2.1.0', 'MAINTENANCE'), true);
  assert.strictEqual(isUpdateRequired('2.1.0', '2.1.0-hotfix'), true);
});
