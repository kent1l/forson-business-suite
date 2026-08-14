const assert = require('node:assert');
const test = require('node:test');

const {
  pendingEntries, applyAttempt, backoffMs, MAX_ATTEMPTS,
} = require('../src/offline/queueLogic.ts');
const { classifyError, MUTATIONS } = require('../src/offline/mutations.ts');

const entry = (over = {}) => ({
  id: 'e1',
  kind: 'time-punch',
  ownerEmployeeId: 42,
  body: {},
  createdAt: '2026-08-14T08:00:00.000Z',
  attempts: 0,
  lastError: null,
  status: 'pending',
  ...over,
});

const axiosError = (status) => ({
  isAxiosError: true,
  message: status ? `Request failed with status code ${status}` : 'Network Error',
  response: status ? { status } : undefined,
});

test('pendingEntries drains oldest first', () => {
  const list = [
    entry({ id: 'b', createdAt: '2026-08-14T09:00:00.000Z' }),
    entry({ id: 'a', createdAt: '2026-08-14T08:00:00.000Z' }),
    entry({ id: 'c', createdAt: '2026-08-14T10:00:00.000Z' }),
  ];
  assert.deepStrictEqual(pendingEntries(list, 42).map((e) => e.id), ['a', 'b', 'c']);
});

test('pendingEntries skips entries parked for attention', () => {
  const list = [entry({ id: 'ok' }), entry({ id: 'stuck', status: 'needs-attention' })];
  assert.deepStrictEqual(pendingEntries(list, 42).map((e) => e.id), ['ok']);
});

test('pendingEntries never flushes another employee\'s queued work', () => {
  // A punch queued by employee 42 must not be sent while employee 7 is signed
  // in: the server attributes it to whoever the token belongs to, so this would
  // silently record 42's clock-in against 7.
  const list = [entry({ id: 'mine', ownerEmployeeId: 7 }), entry({ id: 'theirs', ownerEmployeeId: 42 })];
  assert.deepStrictEqual(pendingEntries(list, 7).map((e) => e.id), ['mine']);
});

test('another employee\'s entries are held, not discarded', () => {
  const list = [entry({ id: 'theirs', ownerEmployeeId: 42 })];
  assert.strictEqual(pendingEntries(list, 7).length, 0);
  // Still there for when they sign back in on this shared phone.
  assert.strictEqual(pendingEntries(list, 42).length, 1);
});

test('entries queued before an owner was known are still drained', () => {
  const list = [entry({ id: 'legacy', ownerEmployeeId: null })];
  assert.strictEqual(pendingEntries(list, 7).length, 1);
});

test('applyAttempt parks an entry once attempts run out', () => {
  let e = entry();
  for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) e = applyAttempt(e, 'Network Error');
  assert.strictEqual(e.status, 'pending', 'should still be retrying below the cap');

  e = applyAttempt(e, 'Network Error');
  assert.strictEqual(e.attempts, MAX_ATTEMPTS);
  assert.strictEqual(e.status, 'needs-attention', 'must surface rather than retry forever');
  assert.strictEqual(e.lastError, 'Network Error');
});

test('backoff grows but stays capped', () => {
  assert.strictEqual(backoffMs(0), 1000);
  assert.strictEqual(backoffMs(3), 8000);
  assert.strictEqual(backoffMs(99), 60000, 'must not overflow into an unreachable delay');
});

test('a network failure is retried, not given up on', () => {
  assert.strictEqual(classifyError('time-punch', axiosError(undefined)), 'retry');
  assert.strictEqual(classifyError('time-punch', axiosError(503)), 'retry');
  assert.strictEqual(classifyError('time-punch', axiosError(429)), 'retry');
});

test('a duplicate punch counts as already applied', () => {
  // The API answers a repeated client_punch_id with 409, which means the punch
  // is on the server -- the entry has succeeded and must leave the queue.
  assert.strictEqual(classifyError('time-punch', axiosError(409)), 'already-applied');
});

test('a re-submitted cycle count counts as already applied', () => {
  // The submit route only accepts a line still PENDING, so a replay 404s. That
  // is the line already being counted, not a failure.
  assert.strictEqual(classifyError('cycle-count-submit', axiosError(404)), 'already-applied');
});

test('an overlapping leave request counts as already filed', () => {
  assert.strictEqual(classifyError('leave-request', axiosError(409)), 'already-applied');
});

test('a 404 on a punch is a real failure, not an already-applied case', () => {
  // Only cycle-count-submit may read 404 that way; sharing the rule across
  // kinds would silently drop punches the server never received.
  assert.strictEqual(classifyError('time-punch', axiosError(404)), 'give-up');
});

test('a rejected request is parked rather than retried forever', () => {
  assert.strictEqual(classifyError('time-punch', axiosError(400)), 'give-up');
  assert.strictEqual(classifyError('time-punch', axiosError(403)), 'give-up');
});

test('an expired session pauses the whole queue', () => {
  assert.strictEqual(classifyError('time-punch', axiosError(401)), 'auth');
});

test('every queued kind builds a request and describes itself', () => {
  const samples = {
    'cycle-count-submit': entry({ kind: 'cycle-count-submit', body: { counted_qty: 3 }, meta: { lineId: 5, displayName: 'Brake Pad' } }),
    'cycle-count-edit': entry({ kind: 'cycle-count-edit', body: { counted_qty: 4 }, meta: { lineId: 5 } }),
    'time-punch': entry({ kind: 'time-punch', body: { direction: 'IN', punch_at: '2026-08-14T08:00:00.000Z' } }),
    'leave-request': entry({ kind: 'leave-request', body: { date_from: '2026-09-01', date_to: '2026-09-02' } }),
  };

  for (const [kind, sample] of Object.entries(samples)) {
    const def = MUTATIONS[kind];
    assert.ok(def, `${kind} must be registered`);

    const req = def.request(sample);
    assert.ok(req.url && req.method, `${kind} must produce a request`);

    const text = def.describe(sample);
    assert.ok(text && text.length > 0, `${kind} must describe itself for the outbox screen`);
    assert.ok(!text.includes('undefined'), `${kind} description leaked an undefined: ${text}`);
  }
});

test('a queued punch carries the time it was taken', () => {
  const captured = '2026-08-14T08:00:00.000Z';
  const req = MUTATIONS['time-punch'].request(entry({ body: { direction: 'IN', punch_at: captured } }));
  // Without this the server would stamp the flush time, and a morning clock-in
  // synced in the afternoon would be paid from the wrong hour.
  assert.strictEqual(req.data.punch_at, captured);
});
