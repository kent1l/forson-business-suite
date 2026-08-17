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
    'pos-stage-sale': entry({
      kind: 'pos-stage-sale',
      body: { customer_id: 1, lines: [{ part_id: 5, quantity: 1, sale_price: 100 }] },
      meta: { customerName: 'Juan Cruz', grandTotal: 100, lineCount: 1 },
    }),
    'stock-adjust': entry({
      kind: 'stock-adjust',
      body: { part_id: 5, quantity: -2 },
      meta: { displayName: 'Brake Pad' },
    }),
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

/**
 * A staged sale and a stock adjustment are both safe to replay only because the
 * server recognises the client-generated key in the body. If a retry ever sent
 * a different one, staging would duplicate the sale and the adjustment would
 * move stock twice -- so the body must survive the queue completely unaltered.
 */
test('queued sales and adjustments replay with their idempotency key intact', () => {
  const saleBody = {
    customer_id: 1,
    lines: [{ part_id: 5, quantity: 2, sale_price: 100 }],
    client_ref: 'deadbeef-1111-2222-3333-444455556666',
    captured_at: '2026-08-17T14:00:00.000Z',
  };
  const saleReq = MUTATIONS['pos-stage-sale'].request(entry({ kind: 'pos-stage-sale', body: saleBody }));
  assert.strictEqual(saleReq.method, 'POST');
  assert.strictEqual(saleReq.url, '/sales/staging');
  assert.deepStrictEqual(saleReq.data, saleBody);

  const adjBody = {
    part_id: 5,
    quantity: -2,
    client_ref: 'deadbeef-9999-8888-7777-666655554444',
    captured_at: '2026-08-17T14:00:00.000Z',
  };
  const adjReq = MUTATIONS['stock-adjust'].request(entry({ kind: 'stock-adjust', body: adjBody }));
  assert.strictEqual(adjReq.method, 'POST');
  assert.strictEqual(adjReq.url, '/inventory/adjust');
  assert.deepStrictEqual(adjReq.data, adjBody);
});

/**
 * Both endpoints answer a replay with 200 and the original record, so there is
 * no rejection that means "already done". Declaring one would be misleading.
 */
test('the sale and adjustment kinds deliberately declare no already-applied status', () => {
  assert.strictEqual(MUTATIONS['pos-stage-sale'].isAlreadyApplied, undefined);
  assert.strictEqual(MUTATIONS['stock-adjust'].isAlreadyApplied, undefined);
});

test('a queued sale carries the moment the customer actually paid', () => {
  const captured = '2026-08-17T14:00:00.000Z';
  const req = MUTATIONS['pos-stage-sale'].request(
    entry({ kind: 'pos-stage-sale', body: { captured_at: captured } }),
  );
  // Otherwise the server stamps the flush time and a sale rung up during a
  // blackout is dated -- and so invoiced -- hours after it happened.
  assert.strictEqual(req.data.captured_at, captured);
});

test('new kinds classify failures the same way as the rest of the queue', () => {
  for (const kind of ['pos-stage-sale', 'stock-adjust']) {
    // No response at all: the server is unreachable, so keep it and retry.
    assert.strictEqual(classifyError(kind, axiosError(null)), 'retry');
    assert.strictEqual(classifyError(kind, axiosError(503)), 'retry');
    // The server heard us and refused; retrying forever would just hide it.
    assert.strictEqual(classifyError(kind, axiosError(400)), 'give-up');
    // A dead session must pause the whole queue rather than burn attempts.
    assert.strictEqual(classifyError(kind, axiosError(401)), 'auth');
  }
});

test('an adjustment describes its direction so the outbox is readable', () => {
  const add = MUTATIONS['stock-adjust'].describe(
    entry({ kind: 'stock-adjust', body: { part_id: 5, quantity: 3 }, meta: { displayName: 'Brake Pad' } }),
  );
  const remove = MUTATIONS['stock-adjust'].describe(
    entry({ kind: 'stock-adjust', body: { part_id: 5, quantity: -3 }, meta: { displayName: 'Brake Pad' } }),
  );
  assert.ok(add.includes('+3'), `expected a signed increase, got: ${add}`);
  assert.ok(remove.includes('-3'), `expected a signed decrease, got: ${remove}`);
});

test('a sale with no customer name still describes itself', () => {
  const text = MUTATIONS['pos-stage-sale'].describe(
    entry({ kind: 'pos-stage-sale', body: {}, meta: { grandTotal: 250 } }),
  );
  assert.ok(!text.includes('undefined'), `description leaked an undefined: ${text}`);
  assert.ok(text.includes('walk-in'), `expected a walk-in fallback, got: ${text}`);
});
