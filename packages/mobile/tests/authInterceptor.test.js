const assert = require('node:assert');
const test = require('node:test');

/**
 * The rule deciding whether a 401 means "your session ended" or "those
 * credentials are wrong".
 *
 * Getting this wrong is not cosmetic. The session-ended path calls logout(),
 * which clears the persisted query cache and cancels the pending clock-out
 * reminder. Running it for a failed sign-in meant one mistyped password -- by
 * someone who was not signed in at all -- could cancel a colleague's reminder on
 * a shared phone.
 *
 * Mirrors isAuthAttempt in src/api/client.js. Kept as a plain predicate so it
 * can be checked without standing up axios and the whole store graph.
 */
const isAuthAttempt = (config) => {
  const url = config?.url ?? '';
  return /(^|\/)login\/?($|\?)/.test(url);
};

test('a failed sign-in is not treated as an expired session', () => {
  assert.strictEqual(isAuthAttempt({ url: '/login' }), true);
  assert.strictEqual(isAuthAttempt({ url: 'login' }), true);
  assert.strictEqual(isAuthAttempt({ url: '/login/' }), true);
  assert.strictEqual(isAuthAttempt({ url: '/api/login' }), true);
  assert.strictEqual(isAuthAttempt({ url: '/login?next=1' }), true);
});

test('an expired token on any real endpoint still logs the user out', () => {
  for (const url of [
    '/auth/me',
    '/dtr/punch',
    '/dtr/punch/state',
    '/payroll/me/payslips',
    '/inventory/cycle-count/my-tasks',
    '/sales/staging',
  ]) {
    assert.strictEqual(isAuthAttempt({ url }), false, `${url} must still trigger logout`);
  }
});

test('an endpoint merely containing the word login is not exempted', () => {
  // A path like /login-history would otherwise slip through and leave a dead
  // session in place.
  assert.strictEqual(isAuthAttempt({ url: '/login-history' }), false);
  assert.strictEqual(isAuthAttempt({ url: '/employee/logins' }), false);
  assert.strictEqual(isAuthAttempt({ url: '/relogin' }), false);
});

test('a request with no url is treated as a session failure', () => {
  // Fail safe: if we cannot tell what was called, logging out is the
  // conservative outcome.
  assert.strictEqual(isAuthAttempt(undefined), false);
  assert.strictEqual(isAuthAttempt({}), false);
});
