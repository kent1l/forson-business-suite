'use strict';

const crypto = require('node:crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DENOMINATIONS = Object.freeze({
  PHP_1000: 100000, PHP_500: 50000, PHP_200: 20000, PHP_100: 10000,
  PHP_50: 5000, PHP_20: 2000, PHP_10: 1000, PHP_5: 500,
  PHP_1: 100, PHP_050: 50, PHP_025: 25, PHP_010: 10, PHP_005: 5,
  PHP_001: 1,
});

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function cents(value, { positive = false, signed = false } = {}) {
  if (typeof value !== 'string' || !(signed ? /^-?(0|[1-9]\d{0,11})(\.\d{1,2})?$/ : /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/).test(value)) {
    fail(400, 'INVALID_AMOUNT', 'Amount must be a decimal string with at most two decimal places.');
  }
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (result > 99999999999999n || (positive && result <= 0n)) {
    fail(400, 'INVALID_AMOUNT', 'Amount is outside the allowed range.');
  }
  return negative ? -result : result;
}

function money(value) {
  const n = BigInt(value);
  return `${n < 0n ? '-' : ''}${(n < 0n ? -n : n) / 100n}.${String((n < 0n ? -n : n) % 100n).padStart(2, '0')}`;
}

function countLines(lines) {
  if (!Array.isArray(lines) || !lines.length) fail(400, 'COUNT_LINES_REQUIRED', 'Enter denomination quantities.');
  let total = 0n;
  const seen = new Set();
  const normalized = lines.map(line => {
    const code = line?.code;
    if (!Object.hasOwn(DENOMINATIONS, code) || seen.has(code) || !Number.isSafeInteger(line.quantity) || line.quantity < 0 || line.quantity > 1000000) {
      fail(400, 'INVALID_DENOMINATION', 'Invalid or duplicate denomination quantity.');
    }
    seen.add(code);
    total += BigInt(DENOMINATIONS[code]) * BigInt(line.quantity);
    if (total > 99999999999999n) fail(400, 'COUNT_OVERFLOW', 'Count exceeds the supported amount.');
    return { code, value: money(BigInt(DENOMINATIONS[code])), quantity: line.quantity };
  });
  return { total: money(total), lines: normalized };
}

function validText(value, max, required = false) {
  const text = typeof value === 'string' ? value.trim() : '';
  if ((required && !text) || text.length > max) fail(400, 'INVALID_TEXT', `Text must be ${required ? 'present and ' : ''}at most ${max} characters.`);
  return text || null;
}

async function lockSession(client, sessionId, { version, states = ['OPEN'] } = {}) {
  const { rows } = await client.query('SELECT * FROM cash_drawer_session WHERE session_id=$1 FOR UPDATE', [sessionId]);
  const session = rows[0];
  if (!session) fail(404, 'SESSION_NOT_FOUND', 'Cash drawer session not found.');
  if (!states.includes(session.status)) fail(409, 'SESSION_STATE', `Session is ${session.status}.`);
  if (version !== undefined && Number(version) !== Number(session.version)) fail(409, 'STALE_VERSION', 'Drawer changed. Refresh and try again.');
  return session;
}

async function currentBalance(client, session) {
  const { rows } = await client.query('SELECT balance_after FROM cash_drawer_movement WHERE session_id=$1 ORDER BY sequence DESC LIMIT 1', [session.session_id]);
  return rows[0] ? cents(rows[0].balance_after, { signed: true }) : cents(session.opening_amount);
}

async function postMovement(client, input) {
  const { sessionId, direction, amount, category, description, counterparty, actorId, sourceEventKey,
    requestId, occurredAt, lateReason, source = {}, expectedVersion, allowClosing = false, reversalOf } = input;
  if (!['IN', 'OUT'].includes(direction)) fail(400, 'INVALID_DIRECTION', 'Direction must be IN or OUT.');
  const amountCents = cents(amount, { positive: true });
  const session = await lockSession(client, sessionId, { version: expectedVersion, states: allowClosing ? ['OPEN', 'CLOSING'] : ['OPEN'] });
  if (session.count_window_expires_at && new Date(session.count_window_expires_at) > new Date()) {
    fail(409, 'COUNT_PAUSED', 'Cash writes are paused for a count.');
  }
  if (occurredAt && (Number.isNaN(Date.parse(occurredAt)) || new Date(occurredAt) > new Date(Date.now() + 60000))) {
    fail(400, 'INVALID_OCCURRED_AT', 'Event time must be valid and cannot be in the future.');
  }
  if (occurredAt && new Date(occurredAt) < new Date(session.opened_at) && !lateReason) {
    fail(422, 'LATE_REASON_REQUIRED', 'A reason is required for an event before opening.');
  }
  const before = await currentBalance(client, session);
  const after = direction === 'IN' ? before + amountCents : before - amountCents;
  if (direction === 'OUT' && after < 0n) fail(422, 'INSUFFICIENT_CASH', 'Expected cash is insufficient for this release.');
  const { rows } = await client.query(
    `INSERT INTO cash_drawer_movement
       (session_id,sequence,direction,amount,balance_after,category,description,counterparty,actor_id,
        source_event_key,request_id,occurred_at,late_reason,customer_payment_id,invoice_payment_id,
        expense_id,ap_payment_id,credit_note_id,method_id,reversal_of)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,now()),$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING *`,
    [sessionId, Number(session.last_sequence) + 1, direction, amount, money(after),
      validText(category, 40, true), validText(description, 500, true), validText(counterparty, 200), actorId,
      sourceEventKey || null, requestId || null, occurredAt || null, validText(lateReason, 500),
      source.customerPaymentId || null, source.invoicePaymentId || null, source.expenseId || null,
      source.apPaymentId || null, source.creditNoteId || null, source.methodId || null, reversalOf || null]
  );
  await client.query('UPDATE cash_drawer_session SET last_sequence=last_sequence+1,version=version+1 WHERE session_id=$1', [sessionId]);
  return { ...rows[0], version: Number(session.version) + 1 };
}

async function startCount(client, { sessionId, kind, actorId, expectedVersion }) {
  if (!['MIDDAY', 'CLOSING'].includes(kind)) fail(400, 'INVALID_COUNT_KIND', 'Count kind must be MIDDAY or CLOSING.');
  const session = await lockSession(client, sessionId, { version: expectedVersion, states: kind === 'CLOSING' ? ['CLOSING'] : ['OPEN'] });
  const existing = await client.query("SELECT count_id FROM cash_count WHERE session_id=$1 AND status='DRAFT'", [sessionId]);
  if (existing.rowCount) fail(409, 'COUNT_IN_PROGRESS', 'A count is already in progress.');
  const expected = money(await currentBalance(client, session));
  const { rows } = await client.query(
    `INSERT INTO cash_count(session_id,kind,cutoff_sequence,cutoff_version,expected,counter_id)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [sessionId, kind, session.last_sequence, Number(session.version) + 1, expected, actorId]
  );
  await client.query("UPDATE cash_drawer_session SET count_window_expires_at=now()+interval '20 minutes',version=version+1 WHERE session_id=$1", [sessionId]);
  return rows[0];
}

async function submitCount(client, { countId, lines, notes, actorId }) {
  const countResult = await client.query('SELECT session_id FROM cash_count WHERE count_id=$1', [countId]);
  if (!countResult.rowCount) fail(404, 'COUNT_NOT_FOUND', 'Count not found.');
  const session = await lockSession(client, countResult.rows[0].session_id, { states: ['OPEN', 'CLOSING'] });
  const { rows } = await client.query('SELECT * FROM cash_count WHERE count_id=$1 FOR UPDATE', [countId]);
  const count = rows[0];
  if (count.status !== 'DRAFT') fail(409, 'COUNT_STATE', 'Count is already submitted or cancelled.');
  if (count.counter_id !== actorId) fail(403, 'COUNT_OWNER', 'Only the counter may submit this count.');
  if (!session.count_window_expires_at || new Date(session.count_window_expires_at) < new Date()) fail(409, 'COUNT_EXPIRED', 'Count window expired; start a new count.');
  if (Number(session.last_sequence) !== Number(count.cutoff_sequence) || Number(session.version) !== Number(count.cutoff_version)) {
    fail(409, 'STALE_COUNT', 'Cash changed since the count began.');
  }
  const result = countLines(lines);
  for (const line of result.lines) {
    await client.query('INSERT INTO cash_count_line(count_id,denomination_code,value_snapshot,quantity) VALUES($1,$2,$3,$4)',
      [countId, line.code, line.value, line.quantity]);
  }
  const variance = money(cents(result.total) - cents(count.expected, { signed: true }));
  const submitted = await client.query(
    `UPDATE cash_count SET status='SUBMITTED',counted=$2,variance=$3,notes=$4,submitted_at=now()
     WHERE count_id=$1 RETURNING *`, [countId, result.total, variance, validText(notes, 1000)]);
  await client.query('UPDATE cash_drawer_session SET count_window_expires_at=NULL,version=version+1 WHERE session_id=$1', [session.session_id]);
  return submitted.rows[0];
}

async function audit(client, { sessionId, targetType, targetId, action, actorId, reason, requestId, metadata = {} }) {
  await client.query(
    'INSERT INTO cash_audit_event(session_id,target_type,target_id,action,actor_id,request_id,reason,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [sessionId || null, targetType, targetId, action, actorId, requestId || null, reason || null, JSON.stringify(metadata)]);
}

function enabled() { return process.env.ENABLE_CASH_DRAWER === 'true'; }
function userCanPost(user) { return Number(user?.permission_level_id) === 10 || user?.permissions?.includes('cash_drawer:move'); }

async function beginSourceRequest(client, req) {
  if (!enabled() || (!req.body?.cash_session_id && req.body?.funding_source !== 'ADVANCE')) return null;
  const requestId = req.get('Idempotency-Key');
  if (!requestId || !UUID.test(requestId)) fail(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send a UUID Idempotency-Key for this cash source write.');
  const hash = crypto.createHash('sha256').update(JSON.stringify({ method: req.method, path: req.path, body: req.body })).digest('hex');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [requestId]);
  const previous = await client.query('SELECT actor_id,request_hash,status_code,response FROM cash_request WHERE request_id=$1', [requestId]);
  if (previous.rowCount) {
    const old = previous.rows[0];
    if (Number(old.actor_id) !== Number(req.user.employee_id) || old.request_hash !== hash || old.status_code === 202) {
      fail(409, 'IDEMPOTENCY_CONFLICT', 'This request key was already used.');
    }
    const replay = new Error('Request already completed.');
    replay.replay = { status: old.status_code, body: old.response };
    throw replay;
  }
  await client.query('INSERT INTO cash_request(request_id,actor_id,request_hash,status_code,response) VALUES($1,$2,$3,202,$4)',
    [requestId, req.user.employee_id, hash, JSON.stringify({ pending: true })]);
  return requestId;
}

async function finishSourceRequest(client, requestId, status, body) {
  if (!requestId) return;
  await client.query('UPDATE cash_request SET status_code=$2,response=$3 WHERE request_id=$1', [requestId, status, JSON.stringify(body)]);
}

async function reserveSourceSession(client, sessionId) {
  if (!enabled() || !sessionId) return;
  // Lock before the source document: every integrated writer uses this order.
  const result = await client.query('SELECT session_id FROM cash_drawer_session WHERE session_id=$1 FOR UPDATE', [sessionId]);
  if (!result.rowCount) fail(404, 'SESSION_NOT_FOUND', 'Cash drawer session not found.');
}

async function postSourcePayment(client, { kind, sourceId, sessionId, actorId, fundingSource, notebookReceiptId, coveredAmount, canPost }) {
  if (!enabled()) return null;
  const sources = {
    invoice: { table: 'invoice_payments', id: 'payment_id', amount: 'amount_paid', field: 'invoicePaymentId' },
    customer: { table: 'customer_payment', id: 'payment_id', amount: 'amount', field: 'customerPaymentId' },
    ap: { table: 'ap_payment', id: 'payment_id', amount: 'amount', field: 'apPaymentId' },
    expense: { table: 'expense', id: 'expense_id', amount: 'amount', field: 'expenseId' },
  };
  const source = sources[kind];
  if (!source) fail(500, 'INVALID_SOURCE_KIND', 'Unknown cash source.');
  let row;
  if (kind === 'expense') {
    const { rows } = await client.query(`SELECT e.expense_id,e.amount,pm.type AS method_type,e.payment_method_text,e.is_void
      FROM expense e LEFT JOIN payment_methods pm ON pm.method_id=e.payment_method_id WHERE e.expense_id=$1`, [sourceId]);
    row = rows[0];
  } else {
    const { rows } = await client.query(`SELECT p.${source.id} AS source_id,p.${source.amount} AS amount,
      pm.type AS method_type,pm.method_id,${kind === 'invoice' ? 'p.payment_status' : 'p.pdc_status'} AS settlement_status
      FROM ${source.table} p JOIN payment_methods pm ON pm.method_id=p.method_id WHERE p.${source.id}=$1`, [sourceId]);
    row = rows[0];
  }
  if (!row) fail(404, 'SOURCE_NOT_FOUND', 'Cash source not found.');
  if (kind === 'expense' || kind === 'ap') {
    const physicalCash = row.method_type === 'cash' || (kind === 'expense' && !row.method_type && /^cash$/i.test(row.payment_method_text || ''));
    if (physicalCash && !['DRAWER','ADVANCE','OTHER'].includes(fundingSource)) fail(422, 'FUNDING_REQUIRED', 'Select the source of physical cash.');
    if (!physicalCash && ['DRAWER','ADVANCE'].includes(fundingSource)) fail(422, 'INVALID_FUNDING', 'Drawer or advance funding requires a physical cash method.');
    if (fundingSource !== 'DRAWER') return null;
  } else if (row.method_type !== 'cash') return null;
  if (kind === 'invoice' && row.settlement_status !== 'settled') fail(422, 'CASH_NOT_SETTLED', 'Physical cash payment must be settled.');
  if (['customer','ap'].includes(kind) && row.settlement_status !== 'CLEARED') fail(422, 'CASH_NOT_CLEARED', 'Physical cash payment must be cleared.');
  if (kind === 'expense' && row.is_void) fail(422, 'VOID_EXPENSE', 'Voided expense cannot fund a cash movement.');
  if (!canPost) fail(403, 'DRAWER_PERMISSION_REQUIRED', 'Cash drawer posting permission is required.');
  const amount = row.amount;
  const normalized = typeof amount === 'string' ? amount : Number(amount).toFixed(2);
  if (cents(normalized) === 0n) return null;
  const sourceKey = `${kind}:${sourceId}`;
  let uncovered = cents(normalized);
  if (notebookReceiptId) {
    if (!['invoice','customer'].includes(kind)) fail(422, 'INVALID_NOTEBOOK_LINK', 'Only customer receipts can cover notebook cash.');
    const receiptResult = await client.query('SELECT * FROM cash_drawer_movement WHERE movement_id=$1 FOR UPDATE', [notebookReceiptId]);
    const receipt = receiptResult.rows[0];
    if (!receipt || receipt.category !== 'NOTEBOOK_RECEIPT' || receipt.direction !== 'IN') fail(422, 'INVALID_NOTEBOOK_LINK', 'Referenced movement is not a notebook receipt.');
    const coverage = cents(coveredAmount, { positive: true });
    const used = await client.query('SELECT COALESCE(SUM(amount_covered),0) AS amount FROM cash_source_link WHERE movement_id=$1', [notebookReceiptId]);
    if (coverage > uncovered || coverage + cents(used.rows[0].amount) > cents(receipt.amount)) fail(422, 'NOTEBOOK_OVER_COVERED', 'Notebook coverage exceeds the original physical receipt.');
    await client.query(`INSERT INTO cash_source_link
      (canonical_event_key,movement_id,customer_payment_id,invoice_payment_id,amount_covered,purpose,linked_by)
      VALUES($1,$2,$3,$4,$5,'NOTEBOOK_RECONCILIATION',$6)`,
    [sourceKey, notebookReceiptId, kind === 'customer' ? sourceId : null, kind === 'invoice' ? sourceId : null,
      money(coverage), actorId]);
    uncovered -= coverage;
  } else if (coveredAmount !== undefined) {
    fail(422, 'NOTEBOOK_RECEIPT_REQUIRED', 'Select the notebook receipt being covered.');
  }
  if (uncovered === 0n) return null;
  if (!sessionId) fail(422, 'DRAWER_SESSION_REQUIRED', 'Select an open cash drawer session for additional cash.');
  return postMovement(client, { sessionId, direction: ['ap','expense'].includes(kind) ? 'OUT' : 'IN',
    amount: money(uncovered), category: ({ invoice: 'SALE', customer: 'AR_RECEIPT', ap: 'SUPPLIER_PAYMENT', expense: 'EXPENSE' })[kind],
    description: `Physical cash ${kind} ${sourceId}`, actorId, sourceEventKey: sourceKey,
    source: { [source.field]: sourceId, methodId: row.method_id || null } });
}

async function reserveAdvance(client, advanceId) {
  if (!enabled()) return;
  if (!advanceId) fail(422, 'ADVANCE_REQUIRED', 'Select the employee advance funding this payment.');
  const result = await client.query('SELECT advance_id FROM cash_advance WHERE advance_id=$1 FOR UPDATE', [advanceId]);
  if (!result.rowCount) fail(404, 'ADVANCE_NOT_FOUND', 'Advance not found.');
}

async function consumeAdvance(client, { advanceId, kind, sourceId, actorId }) {
  if (!enabled()) return null;
  if (!['expense','ap'].includes(kind)) fail(400, 'INVALID_ADVANCE_SOURCE', 'Advance consumption must link an expense or supplier payment.');
  const advance = await client.query('SELECT * FROM cash_advance WHERE advance_id=$1 FOR UPDATE', [advanceId]);
  if (!advance.rowCount) fail(404, 'ADVANCE_NOT_FOUND', 'Advance not found.');
  const table = kind === 'expense' ? 'expense' : 'ap_payment';
  const idColumn = kind === 'expense' ? 'expense_id' : 'payment_id';
  const { rows } = await client.query(`SELECT s.amount,pm.type AS method_type,${kind === 'expense' ? 's.payment_method_text' : 'NULL::text AS payment_method_text'}
    FROM ${table} s LEFT JOIN payment_methods pm ON pm.method_id=s.${kind === 'expense' ? 'payment_method_id' : 'method_id'}
    WHERE s.${idColumn}=$1`, [sourceId]);
  const source = rows[0];
  if (!source || (source.method_type !== 'cash' && !(kind === 'expense' && /^cash$/i.test(source.payment_method_text || '')))) {
    fail(422, 'INVALID_ADVANCE_SOURCE', 'Advance consumption must link a physical cash payment.');
  }
  const doublePost = await client.query(`SELECT 1 FROM cash_drawer_movement WHERE ${kind === 'expense' ? 'expense_id' : 'ap_payment_id'}=$1`, [sourceId]);
  if (doublePost.rowCount) fail(409, 'ALREADY_DRAWER_FUNDED', 'Source was already paid from a drawer.');
  const totals = await client.query(`SELECT COALESCE(SUM(amount) FILTER(WHERE kind='CONSUMPTION'),0) AS consumed,
    COALESCE(SUM(amount) FILTER(WHERE kind='RETURN'),0) AS returned,
    COALESCE(SUM(amount) FILTER(WHERE kind='REIMBURSEMENT'),0) AS reimbursed,
    COUNT(*) FILTER(WHERE kind='SETTLEMENT') AS settled FROM cash_advance_event WHERE advance_id=$1`, [advanceId]);
  const t = totals.rows[0];
  if (Number(t.settled)) fail(409, 'ADVANCE_SETTLED', 'Advance is already settled.');
  const available = cents(advance.rows[0].amount) + cents(t.reimbursed) - cents(t.consumed) - cents(t.returned);
  if (cents(source.amount) > available) fail(422, 'ADVANCE_INSUFFICIENT', 'Advance has insufficient unspent cash.');
  const result = await client.query(`INSERT INTO cash_advance_event
    (advance_id,kind,amount,expense_id,ap_payment_id,actor_id,request_id,notes)
    VALUES($1,'CONSUMPTION',$2,$3,$4,$5,gen_random_uuid(),$6) RETURNING *`,
  [advanceId, source.amount, kind === 'expense' ? sourceId : null, kind === 'ap' ? sourceId : null, actorId, `Funded ${kind} ${sourceId}`]);
  return result.rows[0];
}

module.exports = { DENOMINATIONS, cents, money, countLines, validText, fail, lockSession, currentBalance, postMovement, startCount, submitCount, audit, enabled, userCanPost, reserveSourceSession, postSourcePayment, reserveAdvance, consumeAdvance, beginSourceRequest, finishSourceRequest };
