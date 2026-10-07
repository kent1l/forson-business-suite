'use strict';

const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { protect, hasPermission, userHasPermission } = require('../middleware/authMiddleware');
const cash = require('../services/cashDrawerService');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const bcrypt = require('bcrypt');

const router = express.Router();
router.use('/cash-drawers', (_req, res, next) => cash.enabled() ? next() : res.status(503).json({ code: 'CASH_DRAWER_DISABLED', message: 'Cash drawer rollout is not enabled.' }));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorResponse(res, error) {
  if (!error.status) console.error('Cash drawer operation failed:', error);
  return res.status(error.status || (error.code === '23505' ? 409 : 500)).json({ code: error.code || 'CASH_DRAWER_ERROR', message: error.status ? error.message : 'Cash drawer operation failed.' });
}

function csvCell(value) {
  const raw = String(value ?? '');
  const guarded = !/^-?\d+(\.\d+)?$/.test(raw) && /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replaceAll('"', '""')}"`;
}

async function requireApprovedRelease(client, { approvalId, session, amount, action, actorId }) {
  cash.cents(amount, { positive: true });
  const result = await client.query(`SELECT a.* FROM cash_approval a
    WHERE a.approval_id=$1 AND a.session_id=$2 AND a.action=$3 AND a.decision='APPROVED'
    AND a.bound_version=$4 AND a.bound_amount=$5 AND a.requester_id=$6
    AND a.reviewer_id<>$6 FOR UPDATE`,
  [approvalId || null, session.session_id, action, session.version, amount, actorId]);
  if (!result.rowCount) cash.fail(422, 'RELEASE_REVIEW_REQUIRED', 'An independent amount-bound release review is required.');
  const used = await client.query('SELECT 1 FROM cash_approval_use WHERE approval_id=$1', [approvalId]);
  if (used.rowCount) cash.fail(409, 'APPROVAL_USED', 'Release approval has already been used.');
  return result.rows[0];
}

async function useApproval(client, approvalId, movementId) {
  await client.query('INSERT INTO cash_approval_use(approval_id,movement_id) VALUES($1,$2)', [approvalId, movementId]);
}

function write(handler) {
  return async (req, res) => {
    const key = req.get('Idempotency-Key');
    if (!key || !UUID.test(key)) return res.status(400).json({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Send a UUID Idempotency-Key.' });
    const hash = crypto.createHash('sha256').update(JSON.stringify({ method: req.method, path: req.path, body: req.body })).digest('hex');
    let client;
    try {
      client = await db.getClient();
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
      const previous = await client.query('SELECT * FROM cash_request WHERE request_id=$1', [key]);
      if (previous.rowCount) {
        await client.query('COMMIT');
        if (previous.rows[0].actor_id !== req.user.employee_id || previous.rows[0].request_hash !== hash) {
          return res.status(409).json({ code: 'IDEMPOTENCY_CONFLICT', message: 'This key was used for a different request.' });
        }
        return res.status(previous.rows[0].status_code).json(previous.rows[0].response);
      }
      const [status, response] = await handler(client, req);
      await client.query('INSERT INTO cash_request(request_id,actor_id,request_hash,status_code,response) VALUES($1,$2,$3,$4,$5)',
        [key, req.user.employee_id, hash, status, JSON.stringify(response)]);
      await client.query('COMMIT');
      return res.status(status).json(response);
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      return errorResponse(res, error);
    } finally {
      client?.release();
    }
  };
}

router.get('/cash-drawers', protect, hasPermission('cash_drawer:view'), async (_req, res) => {
  try {
    const { rows } = await db.query(`SELECT d.*,s.session_id,s.status,s.business_date,s.custodian_id,s.version
      FROM cash_drawer d LEFT JOIN cash_drawer_session s ON s.drawer_id=d.drawer_id AND s.status IN ('OPEN','CLOSING')
      WHERE d.active=true ORDER BY d.name`);
    res.json({ data: rows });
  } catch (error) { errorResponse(res, error); }
});

router.get('/cash-drawers/custodians', protect, hasPermission('cash_drawer:open'), async (_req, res) => {
  try {
    const { rows } = await db.query(`SELECT e.employee_id, concat_ws(' ', e.first_name, e.last_name) AS name
      FROM employee e WHERE e.is_active=true AND (
        e.permission_level_id=10 OR EXISTS (
          SELECT 1 FROM role_permission rp JOIN permission p ON p.permission_id=rp.permission_id
          WHERE rp.permission_level_id=e.permission_level_id AND p.permission_key='cash_drawer:count'
        )
      ) ORDER BY e.first_name,e.last_name,e.employee_id`);
    res.json({ data: rows });
  } catch (error) { errorResponse(res, error); }
});

router.get('/cash-drawers/employees', protect, hasPermission('cash_drawer:view'), async (_req, res) => {
  try {
    const { rows } = await db.query(`SELECT employee_id,concat_ws(' ',first_name,last_name) AS name
      FROM employee WHERE is_active=true ORDER BY first_name,last_name,employee_id`);
    res.json({ data: rows });
  } catch (error) { errorResponse(res, error); }
});

router.get('/cash-drawers/sessions', protect, hasPermission('cash_drawer:view'), async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const { rows } = await db.query(`SELECT s.*,d.name AS drawer_name,
      concat_ws(' ', e.first_name, e.last_name) AS custodian_name,
      COALESCE((SELECT m.balance_after FROM cash_drawer_movement m WHERE m.session_id=s.session_id ORDER BY m.sequence DESC LIMIT 1),s.opening_amount) AS expected
      FROM cash_drawer_session s JOIN cash_drawer d USING(drawer_id) JOIN employee e ON e.employee_id=s.custodian_id
      WHERE ($1::bigint IS NULL OR s.drawer_id=$1) AND ($2::date IS NULL OR s.business_date=$2)
      AND ($3::text IS NULL OR s.status=$3)
      ORDER BY s.opened_at DESC LIMIT $4 OFFSET $5`,
    [req.query.drawer_id || null, req.query.business_date || null, req.query.status || null, limit, (page - 1) * limit]);
    res.json({ data: rows, page, limit });
  } catch (error) { errorResponse(res, error); }
});

router.post('/cash-drawers/:drawerId/sessions', protect, hasPermission('cash_drawer:open'), write(async (client, req) => {
  const { business_date, custodian_id, opening_lines, opening_sources, prior_session_id, reason, approval_id } = req.body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(business_date || '')) cash.fail(400, 'INVALID_DATE', 'Business date is required.');
  const opening = cash.countLines(opening_lines);
  const sources = Array.isArray(opening_sources) ? opening_sources : [];
  if (!sources.length || sources.length > 20 || sources.some(item => !['FRESH_FLOAT','PRIOR_RETAINED'].includes(item.kind))) {
    cash.fail(400, 'INVALID_OPENING_SOURCE', 'Select a verified opening source.');
  }
  const sourceTotal = sources.reduce((sum, item) => sum + cash.cents(item.amount), 0n);
  if (sourceTotal !== cash.cents(opening.total)) cash.fail(422, 'OPENING_MISMATCH', 'Opening sources must equal the physical count.');
  const custodian = await client.query(`SELECT 1 FROM employee e WHERE e.employee_id=$1 AND e.is_active=true AND (
    e.permission_level_id=10 OR EXISTS (
      SELECT 1 FROM role_permission rp JOIN permission p ON p.permission_id=rp.permission_id
      WHERE rp.permission_level_id=e.permission_level_id AND p.permission_key='cash_drawer:count'
    ))`, [custodian_id]);
  if (!custodian.rowCount) cash.fail(422, 'INVALID_CUSTODIAN', 'Select an active employee who can count cash.');
  const drawer = await client.query('SELECT drawer_id FROM cash_drawer WHERE drawer_id=$1 AND active=true FOR UPDATE', [req.params.drawerId]);
  if (!drawer.rowCount) cash.fail(404, 'DRAWER_NOT_FOUND', 'Drawer not found.');
  const latestClose = await client.query(`SELECT s.session_id FROM cash_session_close c
    JOIN cash_drawer_session s USING(session_id) WHERE s.drawer_id=$1 ORDER BY c.closed_at DESC,c.session_id DESC LIMIT 1`, [req.params.drawerId]);
  if (latestClose.rowCount && Number(latestClose.rows[0].session_id) !== Number(prior_session_id)) {
    cash.fail(422, 'PRIOR_SESSION_REQUIRED', 'Link the latest closed session before opening this drawer.');
  }
  if (!latestClose.rowCount && prior_session_id) cash.fail(422, 'INVALID_PRIOR_SESSION', 'No closed prior session exists for this drawer.');
  if (!prior_session_id && sources.some(item => item.kind === 'PRIOR_RETAINED')) cash.fail(422, 'INVALID_OPENING_SOURCE', 'Prior retained cash needs a linked closed session.');
  if (prior_session_id) {
    const prior = await client.query('SELECT c.retained_actual,s.drawer_id FROM cash_session_close c JOIN cash_drawer_session s USING(session_id) WHERE c.session_id=$1', [prior_session_id]);
    if (!prior.rowCount || Number(prior.rows[0].drawer_id) !== Number(req.params.drawerId)) cash.fail(422, 'INVALID_PRIOR_SESSION', 'Prior session must be closed on this drawer.');
    const retained = sources.filter(item => item.kind === 'PRIOR_RETAINED').reduce((sum, item) => sum + cash.cents(item.amount), 0n);
    const difference = retained - cash.cents(prior.rows[0].retained_actual, { signed: true });
    if (difference !== 0n) {
      const approval = await client.query(`SELECT reviewer_id FROM cash_approval WHERE approval_id=$1 AND session_id=$2
        AND action='OPENING_BRIDGE' AND bound_amount=$3 AND decision='APPROVED'`,
      [approval_id || null, prior_session_id, cash.money(difference)]);
      if (!reason || !approval.rowCount || approval.rows[0].reviewer_id === req.user.employee_id) {
        cash.fail(422, 'OPENING_BRIDGE_REQUIRED', 'Opening differs from retained custody; independent reviewed bridge is required.');
      }
    }
  }
  const code = `CD-${business_date.replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const { rows } = await client.query(`INSERT INTO cash_drawer_session
    (session_code,drawer_id,business_date,custodian_id,opening_amount,opening_source,prior_session_id,opened_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
  [code, req.params.drawerId, business_date, custodian_id, opening.total, JSON.stringify(sources), prior_session_id || null, req.user.employee_id]);
  const count = await client.query(`INSERT INTO cash_count
    (session_id,kind,status,cutoff_sequence,cutoff_version,expected,counter_id,notes)
    VALUES($1,'OPENING','DRAFT',0,0,$2,$3,$4) RETURNING count_id`,
  [rows[0].session_id, opening.total, req.user.employee_id, reason || null]);
  for (const line of opening.lines) await client.query('INSERT INTO cash_count_line VALUES($1,$2,$3,$4)', [count.rows[0].count_id, line.code, line.value, line.quantity]);
  await client.query("UPDATE cash_count SET status='SUBMITTED',counted=$2,variance=0,submitted_at=now() WHERE count_id=$1", [count.rows[0].count_id, opening.total]);
  await cash.audit(client, { sessionId: rows[0].session_id, targetType: 'SESSION', targetId: rows[0].session_id, action: 'OPEN', actorId: req.user.employee_id, reason, requestId: req.get('Idempotency-Key') });
  return [201, { data: { ...rows[0], opening_count_id: count.rows[0].count_id } }];
}));

router.get('/cash-drawers/sessions/:id', protect, hasPermission('cash_drawer:view'), async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT s.*,d.name AS drawer_name,
      concat_ws(' ', e.first_name, e.last_name) AS custodian_name,
      COALESCE((SELECT m.balance_after FROM cash_drawer_movement m WHERE m.session_id=s.session_id ORDER BY m.sequence DESC LIMIT 1),s.opening_amount) AS expected,
      (SELECT COALESCE(SUM(amount) FILTER(WHERE direction='IN'),0) FROM cash_drawer_movement m WHERE m.session_id=s.session_id) AS total_in,
      (SELECT COALESCE(SUM(amount) FILTER(WHERE direction='OUT'),0) FROM cash_drawer_movement m WHERE m.session_id=s.session_id) AS total_out,
      (SELECT row_to_json(c) FROM cash_count c WHERE c.session_id=s.session_id AND c.status='SUBMITTED' ORDER BY c.count_id DESC LIMIT 1) AS latest_count,
      (SELECT report_snapshot FROM cash_session_close x WHERE x.session_id=s.session_id) AS close_snapshot
      FROM cash_drawer_session s JOIN cash_drawer d USING(drawer_id) JOIN employee e ON e.employee_id=s.custodian_id WHERE s.session_id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Session not found.' });
    res.json({ data: rows[0] });
  } catch (error) { errorResponse(res, error); }
});

router.get('/cash-drawers/notebook-receipts', protect, hasPermission('cash_drawer:view'), async (_req, res) => {
  try {
    const { rows } = await db.query(`SELECT m.movement_id,m.session_id,m.sequence,m.physical_reference,m.description,
      m.amount,m.recorded_at,s.business_date,d.name AS drawer_name,
      (m.amount-COALESCE(SUM(l.amount_covered),0))::numeric(14,2) AS available_amount
      FROM cash_drawer_movement m
      JOIN cash_drawer_session s ON s.session_id=m.session_id
      JOIN cash_drawer d ON d.drawer_id=s.drawer_id
      LEFT JOIN cash_source_link l ON l.movement_id=m.movement_id
      WHERE m.category='NOTEBOOK_RECEIPT' AND m.direction='IN' AND m.reversal_of IS NULL
        AND NOT EXISTS (SELECT 1 FROM cash_drawer_movement r WHERE r.reversal_of=m.movement_id)
      GROUP BY m.movement_id,s.business_date,d.name
      HAVING m.amount-COALESCE(SUM(l.amount_covered),0)>0
      ORDER BY m.recorded_at DESC LIMIT 200`);
    res.json({ data: rows });
  } catch (error) { errorResponse(res, error); }
});

router.get('/cash-drawers/sessions/:id/movements', protect, hasPermission('cash_drawer:view'), async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const direction = ['IN','OUT'].includes(req.query.direction) ? req.query.direction : null;
    const category = typeof req.query.category === 'string' && req.query.category.length <= 40 ? req.query.category : null;
    const search = typeof req.query.search === 'string' && req.query.search.length <= 100 ? req.query.search.trim() : null;
    const operatorNumber = /^\d+$/.test(req.query.operator || '') ? Number(req.query.operator) : null;
    const operator = Number.isSafeInteger(operatorNumber) && operatorNumber <= 2147483647 ? operatorNumber : null;
    const source = ['AUTOMATIC','MANUAL','REVERSAL'].includes(req.query.source) ? req.query.source : null;
    const timeField = req.query.time_field === 'occurred_at' ? 'occurred_at' : 'recorded_at';
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : null;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : null;
    const filters = `m.session_id=$1 AND ($2::text IS NULL OR m.direction=$2)
      AND ($3::text IS NULL OR m.category=$3)
      AND ($4::text IS NULL OR m.description ILIKE '%'||$4||'%' OR m.source_event_key ILIKE '%'||$4||'%'
        OR m.physical_reference ILIKE '%'||$4||'%'
        OR m.counterparty ILIKE '%'||$4||'%' OR concat_ws(' ',e.first_name,e.last_name) ILIKE '%'||$4||'%')
      AND ($5::integer IS NULL OR m.actor_id=$5)
      AND ($6::text IS NULL OR CASE $6 WHEN 'REVERSAL' THEN m.reversal_of IS NOT NULL
        WHEN 'AUTOMATIC' THEN m.source_event_key IS NOT NULL AND m.reversal_of IS NULL
        ELSE m.source_event_key IS NULL AND m.reversal_of IS NULL END)
      AND ($7::date IS NULL OR (m.${timeField} AT TIME ZONE 'Asia/Manila')::date >= $7)
      AND ($8::date IS NULL OR (m.${timeField} AT TIME ZONE 'Asia/Manila')::date <= $8)`;
    const params = [req.params.id, direction, category, search, operator, source, from, to];
    const joins = `FROM cash_drawer_movement m JOIN employee e ON e.employee_id=m.actor_id`;
    const { rows } = await db.query(`SELECT m.*,COALESCE(ip.invoice_id,cn.invoice_id) AS invoice_id,i.invoice_number,i.invoice_date,cp.customer_id,ap.supplier_id,
      concat_ws(' ',e.first_name,e.last_name) AS operator_name
      ${joins}
      LEFT JOIN invoice_payments ip ON ip.payment_id=m.invoice_payment_id
      LEFT JOIN credit_note cn ON cn.cn_id=m.credit_note_id
      LEFT JOIN invoice i ON i.invoice_id=COALESCE(ip.invoice_id,cn.invoice_id)
      LEFT JOIN customer_payment cp ON cp.payment_id=m.customer_payment_id
      LEFT JOIN ap_payment ap ON ap.payment_id=m.ap_payment_id
      WHERE ${filters}
      ORDER BY m.sequence ASC LIMIT $9 OFFSET $10`, [...params, limit, (page - 1) * limit]);
    const total = await db.query(`SELECT COUNT(*)::int AS count ${joins} WHERE ${filters}`, params);
    res.json({ data: rows, page, limit, total: total.rows[0].count });
  } catch (error) { errorResponse(res, error); }
});

router.get('/cash-drawers/sessions/:id/counts', protect, hasPermission('cash_drawer:view'), async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT c.*,
      COALESCE((SELECT json_agg(json_build_object('code',l.denomination_code,'value',l.value_snapshot,'quantity',l.quantity) ORDER BY l.value_snapshot DESC)
       FROM cash_count_line l WHERE l.count_id=c.count_id),'[]'::json) AS lines
      FROM cash_count c WHERE c.session_id=$1 ORDER BY c.count_id DESC`, [req.params.id]);
    res.json({ data: rows });
  } catch (error) { errorResponse(res, error); }
});

router.get('/cash-drawers/sessions/:id/custody', protect, hasPermission('cash_drawer:view'), async (req, res) => {
  try {
    const [transfers, advances] = await Promise.all([
      db.query(`SELECT t.*,concat_ws(' ',e.first_name,e.last_name) AS recipient_name,
        COALESCE((SELECT json_agg(x ORDER BY x.event_id) FROM cash_transfer_event x WHERE x.transfer_id=t.transfer_id),'[]'::json) AS events
        FROM cash_transfer t JOIN employee e ON e.employee_id=t.recipient_id WHERE t.session_id=$1 ORDER BY t.transfer_id DESC`, [req.params.id]),
      db.query(`SELECT a.*,concat_ws(' ',e.first_name,e.last_name) AS employee_name,
        COALESCE((SELECT json_agg(x ORDER BY x.event_id) FROM cash_advance_event x WHERE x.advance_id=a.advance_id),'[]'::json) AS events
        FROM cash_advance a JOIN employee e ON e.employee_id=a.employee_id WHERE a.session_id=$1 ORDER BY a.advance_id DESC`, [req.params.id]),
    ]);
    res.json({ transfers: transfers.rows, advances: advances.rows });
  } catch (error) { errorResponse(res, error); }
});

router.post('/cash-drawers/sessions/:id/movements', protect, hasPermission('cash_drawer:move'), write(async (client, req) => {
  const { direction, category, amount, description, counterparty, physical_reference, expected_version, occurred_at, late_reason } = req.body;
  if (!['NOTEBOOK_RECEIPT','OTHER_RECEIPT','OWNER_DRAW','OTHER_RELEASE'].includes(category)) {
    cash.fail(400, 'INVALID_CATEGORY', 'Use an allowed manual cash category.');
  }
  if (['OWNER_DRAW','OTHER_RELEASE'].includes(category) && direction !== 'OUT') cash.fail(400, 'INVALID_DIRECTION', 'This category is an outflow.');
  if (category === 'NOTEBOOK_RECEIPT' && !String(physical_reference || '').trim()) {
    cash.fail(422, 'NOTEBOOK_REFERENCE_REQUIRED', 'Enter the notebook and page reference before recording cash.');
  }
  const session = await cash.lockSession(client, req.params.id, { version: expected_version });
  if (direction === 'OUT') await requireApprovedRelease(client, { approvalId: req.body.approval_id, session, amount,
    action: 'MANUAL_RELEASE', actorId: req.user.employee_id });
  const movement = await cash.postMovement(client, { sessionId: req.params.id, direction, category, amount,
    description, counterparty, physicalReference: physical_reference, actorId: req.user.employee_id, expectedVersion: expected_version,
    occurredAt: occurred_at, lateReason: late_reason, requestId: req.get('Idempotency-Key') });
  if (direction === 'OUT') await useApproval(client, req.body.approval_id, movement.movement_id);
  await cash.audit(client, { sessionId: req.params.id, targetType: 'MOVEMENT', targetId: movement.movement_id, action: 'POST', actorId: req.user.employee_id, requestId: req.get('Idempotency-Key') });
  return [201, { data: movement }];
}));

router.post('/cash-drawers/refund-disbursements', protect, hasPermission('cash_drawer:move'), hasPermission('invoicing:create'), write(async (client, req) => {
  const { session_id, credit_note_id, amount, method_id, expected_version } = req.body;
  await cash.lockSession(client, session_id, { version: expected_version });
  const creditNote = await client.query('SELECT cn_id,total_amount FROM credit_note WHERE cn_id=$1 FOR UPDATE', [credit_note_id]);
  if (!creditNote.rowCount) cash.fail(404, 'CREDIT_NOTE_NOT_FOUND', 'Credit note not found.');
  const method = await client.query("SELECT method_id FROM payment_methods WHERE method_id=$1 AND type='cash' AND enabled=true", [method_id]);
  if (!method.rowCount) cash.fail(422, 'INVALID_METHOD', 'Physical cash method required.');
  const prior = await client.query('SELECT COALESCE(SUM(amount),0) AS paid FROM refund_disbursement WHERE credit_note_id=$1', [credit_note_id]);
  if (cash.cents(prior.rows[0].paid) + cash.cents(amount, { positive: true }) > cash.cents(creditNote.rows[0].total_amount)) {
    cash.fail(422, 'REFUND_EXCEEDS_CREDIT', 'Refund disbursements exceed this credit note.');
  }
  const movement = await cash.postMovement(client, { sessionId: session_id, direction: 'OUT', amount,
    category: 'CASH_REFUND', description: `Cash refund for credit note ${credit_note_id}`,
    actorId: req.user.employee_id, sourceEventKey: `refund:${req.get('Idempotency-Key')}`,
    source: { creditNoteId: credit_note_id, methodId: method_id }, expectedVersion: expected_version });
  const { rows } = await client.query(`INSERT INTO refund_disbursement
    (credit_note_id,amount,method_id,movement_id,actor_id,request_id)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
  [credit_note_id, amount, method_id, movement.movement_id, req.user.employee_id, req.get('Idempotency-Key')]);
  return [201, { data: rows[0], movement }];
}));

router.post('/cash-drawers/sessions/:id/transfers', protect, hasPermission('cash_drawer:transfer'), write(async (client, req) => {
  const { amount, destination, recipient_id, expected_version } = req.body;
  const session = await cash.lockSession(client, req.params.id, { version: expected_version });
  await requireApprovedRelease(client, { approvalId: req.body.approval_id, session, amount, action: 'TRANSFER', actorId: req.user.employee_id });
  const recipient = await client.query('SELECT employee_id FROM employee WHERE employee_id=$1 AND is_active=true', [recipient_id]);
  if (!recipient.rowCount) cash.fail(422, 'RECIPIENT_REQUIRED', 'Choose an active recipient.');
  const movement = await cash.postMovement(client, { sessionId: session.session_id, direction: 'OUT', amount,
    category: 'TRANSFER', description: `Cash transfer to ${destination}`,
    counterparty: String(recipient_id), actorId: req.user.employee_id, requestId: req.get('Idempotency-Key'), expectedVersion: expected_version });
  const { rows } = await client.query(`INSERT INTO cash_transfer(session_id,release_movement_id,amount,destination,recipient_id)
    VALUES($1,$2,$3,$4,$5) RETURNING *`,
  [session.session_id, movement.movement_id, amount, cash.validText(destination, 200, true), recipient_id]);
  await useApproval(client, req.body.approval_id, movement.movement_id);
  return [201, { data: rows[0], movement }];
}));

router.post('/cash-drawers/transfers/:id/events', protect, hasPermission('cash_drawer:transfer'), write(async (client, req) => {
  const { stage, amount, evidence, receiving_session_id } = req.body;
  if (!['ACKNOWLEDGED','DEPOSITED','RETURNED','NOTE'].includes(stage)) cash.fail(400, 'INVALID_STAGE', 'Unknown transfer stage.');
  if (stage !== 'NOTE') cash.cents(amount, { positive: true });
  let receivingSession = null;
  if (stage === 'RETURNED') {
    receivingSession = await cash.lockSession(client, receiving_session_id);
  }
  const transferResult = await client.query('SELECT * FROM cash_transfer WHERE transfer_id=$1 FOR UPDATE', [req.params.id]);
  const transfer = transferResult.rows[0];
  if (!transfer) cash.fail(404, 'TRANSFER_NOT_FOUND', 'Transfer not found.');
  if (stage === 'ACKNOWLEDGED' && Number(transfer.recipient_id) !== Number(req.user.employee_id)) {
    cash.fail(403, 'RECIPIENT_REQUIRED', 'The named recipient must acknowledge custody.');
  }
  const aggregates = await client.query(`SELECT COALESCE(SUM(amount) FILTER(WHERE stage='ACKNOWLEDGED'),0) AS acknowledged,
    COALESCE(SUM(amount) FILTER(WHERE stage='DEPOSITED'),0) AS deposited,
    COALESCE(SUM(amount) FILTER(WHERE stage='RETURNED'),0) AS returned
    FROM cash_transfer_event WHERE transfer_id=$1`, [transfer.transfer_id]);
  const totals = aggregates.rows[0];
  const released = cash.cents(transfer.amount);
  const eventAmount = stage === 'NOTE' ? 0n : cash.cents(amount);
  if (stage === 'ACKNOWLEDGED' && cash.cents(totals.acknowledged) + eventAmount > released) cash.fail(422, 'TRANSFER_OVER_ACKNOWLEDGED', 'Acknowledgment exceeds release.');
  if (stage === 'DEPOSITED' && cash.cents(totals.deposited) + eventAmount > cash.cents(totals.acknowledged) - cash.cents(totals.returned)) cash.fail(422, 'TRANSFER_OVER_DEPOSITED', 'Deposit exceeds acknowledged remaining custody.');
  if (stage === 'RETURNED' && cash.cents(totals.returned) + eventAmount > released - cash.cents(totals.deposited)) cash.fail(422, 'TRANSFER_OVER_RETURNED', 'Return exceeds undeposited custody.');
  let movement = null;
  if (stage === 'RETURNED') {
    movement = await cash.postMovement(client, { sessionId: receivingSession.session_id, direction: 'IN', amount,
      category: 'TRANSFER_RETURN', description: `Returned transfer ${transfer.transfer_id}`,
      actorId: req.user.employee_id, sourceEventKey: `transfer_return:${req.get('Idempotency-Key')}` });
  }
  const { rows } = await client.query(`INSERT INTO cash_transfer_event
    (transfer_id,stage,amount,evidence,actor_id,receiving_movement_id,request_id)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
  [transfer.transfer_id, stage, cash.money(eventAmount), cash.validText(evidence, 500, stage !== 'NOTE'),
    req.user.employee_id, movement?.movement_id || null, req.get('Idempotency-Key')]);
  return [201, { data: rows[0], movement }];
}));

router.post('/cash-drawers/sessions/:id/advances', protect, hasPermission('cash_drawer:move'), write(async (client, req) => {
  const { employee_id, purpose, amount, due_date, expected_version } = req.body;
  const session = await cash.lockSession(client, req.params.id, { version: expected_version });
  await requireApprovedRelease(client, { approvalId: req.body.approval_id, session, amount, action: 'ADVANCE', actorId: req.user.employee_id });
  const employee = await client.query('SELECT employee_id FROM employee WHERE employee_id=$1 AND is_active=true', [employee_id]);
  if (!employee.rowCount) cash.fail(422, 'EMPLOYEE_REQUIRED', 'Choose an active employee.');
  const movement = await cash.postMovement(client, { sessionId: session.session_id, direction: 'OUT', amount,
    category: 'EMPLOYEE_ADVANCE', description: cash.validText(purpose, 500, true), counterparty: String(employee_id),
    actorId: req.user.employee_id, requestId: req.get('Idempotency-Key'), expectedVersion: expected_version });
  const { rows } = await client.query(`INSERT INTO cash_advance
    (session_id,release_movement_id,employee_id,amount,purpose,due_date)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
  [session.session_id, movement.movement_id, employee_id, amount, purpose, due_date || null]);
  await useApproval(client, req.body.approval_id, movement.movement_id);
  return [201, { data: rows[0], movement }];
}));

router.post('/cash-drawers/advances/:id/events', protect, hasPermission('cash_drawer:settle_advance'), write(async (client, req) => {
  const { kind, amount, expense_id, ap_payment_id, receiving_session_id, notes } = req.body;
  if (!['CONSUMPTION','RETURN','REIMBURSEMENT','SETTLEMENT'].includes(kind)) cash.fail(400, 'INVALID_ADVANCE_EVENT', 'Unknown advance event.');
  const targetSessionId = kind === 'RETURN' || kind === 'REIMBURSEMENT' ? receiving_session_id : null;
  if (targetSessionId) await cash.lockSession(client, targetSessionId);
  const advanceResult = await client.query('SELECT * FROM cash_advance WHERE advance_id=$1 FOR UPDATE', [req.params.id]);
  const advance = advanceResult.rows[0];
  if (!advance) cash.fail(404, 'ADVANCE_NOT_FOUND', 'Advance not found.');
  if (kind === 'CONSUMPTION') {
    if (Number(Boolean(expense_id)) + Number(Boolean(ap_payment_id)) !== 1) cash.fail(422, 'SOURCE_REQUIRED', 'Link exactly one expense or supplier payment.');
    const event = await cash.consumeAdvance(client, { advanceId: advance.advance_id,
      kind: expense_id ? 'expense' : 'ap', sourceId: expense_id || ap_payment_id, actorId: req.user.employee_id });
    if (cash.cents(amount, { positive: true }) !== cash.cents(event.amount)) cash.fail(422, 'CONSUMPTION_MISMATCH', 'Consumption must equal the linked source payment.');
    return [201, { data: event }];
  }
  const sums = await client.query(`SELECT COALESCE(SUM(amount) FILTER(WHERE kind='CONSUMPTION'),0) AS consumed,
    COALESCE(SUM(amount) FILTER(WHERE kind='RETURN'),0) AS returned,
    COUNT(*) FILTER(WHERE kind='SETTLEMENT') AS settled FROM cash_advance_event WHERE advance_id=$1`, [advance.advance_id]);
  const totals = sums.rows[0];
  if (Number(totals.settled)) cash.fail(409, 'ADVANCE_SETTLED', 'Advance is already settled.');
  // A reimbursement repays a separately employee-funded source. It does not
  // give the employee more of the original advance to account for.
  const outstanding = cash.cents(advance.amount) - cash.cents(totals.consumed) - cash.cents(totals.returned);
  const eventAmount = kind === 'SETTLEMENT' ? 0n : cash.cents(amount, { positive: true });
  if (kind === 'SETTLEMENT' && outstanding !== 0n) cash.fail(422, 'ADVANCE_OUTSTANDING', 'Advance still has outstanding custody.');
  if (['CONSUMPTION','RETURN'].includes(kind) && eventAmount > outstanding) cash.fail(422, 'ADVANCE_OVER_SETTLED', 'Amount exceeds outstanding custody.');
  let movement = null;
  if (kind === 'REIMBURSEMENT') {
    if (Number(Boolean(expense_id)) + Number(Boolean(ap_payment_id)) !== 1) cash.fail(422, 'SOURCE_REQUIRED', 'Reimbursement needs one verified expense or supplier payment.');
    const source = expense_id
      ? await client.query(`SELECT e.amount,pm.type AS method_type,e.payment_method_text FROM expense e
          LEFT JOIN payment_methods pm ON pm.method_id=e.payment_method_id
          WHERE e.expense_id=$1 AND e.is_void=false FOR UPDATE OF e`, [expense_id])
      : await client.query(`SELECT p.amount,pm.type AS method_type,p.pdc_status FROM ap_payment p
          LEFT JOIN payment_methods pm ON pm.method_id=p.method_id
          WHERE p.payment_id=$1 FOR UPDATE OF p`, [ap_payment_id]);
    const paid = source.rows[0];
    const physicalCash = paid && (paid.method_type === 'cash' || (expense_id && !paid.method_type && /^cash$/i.test(paid.payment_method_text || '')));
    if (!physicalCash || (ap_payment_id && paid.pdc_status !== 'CLEARED') || eventAmount !== cash.cents(paid.amount)) {
      cash.fail(422, 'INVALID_REIMBURSEMENT', 'Reimbursement must match a verified employee-paid cash source.');
    }
    const alreadyDrawerFunded = await client.query(`SELECT 1 FROM cash_drawer_movement
      WHERE ${expense_id ? 'expense_id' : 'ap_payment_id'}=$1`, [expense_id || ap_payment_id]);
    if (alreadyDrawerFunded.rowCount) cash.fail(409, 'ALREADY_DRAWER_FUNDED', 'Source was already paid from a drawer.');
    const alreadyAdvanceFunded = await client.query(`SELECT 1 FROM cash_advance_event
      WHERE ${expense_id ? 'expense_id' : 'ap_payment_id'}=$1`, [expense_id || ap_payment_id]);
    if (alreadyAdvanceFunded.rowCount) cash.fail(409, 'ALREADY_ADVANCE_FUNDED', 'Source is already linked to an advance.');
    const session = await cash.lockSession(client, targetSessionId);
    await requireApprovedRelease(client, { approvalId: req.body.approval_id, session, amount, action: 'REIMBURSEMENT', actorId: req.user.employee_id });
  }
  if (kind === 'RETURN' || kind === 'REIMBURSEMENT') {
    movement = await cash.postMovement(client, { sessionId: targetSessionId,
      direction: kind === 'RETURN' ? 'IN' : 'OUT', amount,
      category: kind === 'RETURN' ? 'ADVANCE_RETURN' : 'ADVANCE_REIMBURSEMENT',
      description: `${kind} for advance ${advance.advance_id}`, actorId: req.user.employee_id,
      sourceEventKey: `advance:${req.get('Idempotency-Key')}` });
    if (kind === 'REIMBURSEMENT') await useApproval(client, req.body.approval_id, movement.movement_id);
  }
  const { rows } = await client.query(`INSERT INTO cash_advance_event
    (advance_id,kind,amount,expense_id,ap_payment_id,movement_id,actor_id,request_id,notes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
  [advance.advance_id, kind, cash.money(eventAmount), expense_id || null, ap_payment_id || null,
    movement?.movement_id || null, req.user.employee_id, req.get('Idempotency-Key'), cash.validText(notes, 500)]);
  return [201, { data: rows[0], movement, outstanding: cash.money(kind === 'RETURN' ? outstanding - eventAmount : outstanding) }];
}));

router.post('/cash-drawers/movements/:id/reverse', protect, hasPermission('cash_drawer:correct'), write(async (client, req) => {
  const reason = cash.validText(req.body.reason, 1000, true);
  const originalRef = await client.query('SELECT session_id FROM cash_drawer_movement WHERE movement_id=$1', [req.params.id]);
  if (!originalRef.rowCount) cash.fail(404, 'MOVEMENT_NOT_FOUND', 'Movement not found.');
  const session = await cash.lockSession(client, originalRef.rows[0].session_id, { version: req.body.expected_version });
  const original = await client.query('SELECT * FROM cash_drawer_movement WHERE movement_id=$1 FOR UPDATE', [req.params.id]);
  const row = original.rows[0];
  if (row.customer_payment_id || row.invoice_payment_id || row.expense_id || row.ap_payment_id || row.credit_note_id || ['TRANSFER','EMPLOYEE_ADVANCE'].includes(row.category)) {
    cash.fail(422, 'SOURCE_CORRECTION_REQUIRED', 'Correct this movement through its source and custody workflow.');
  }
  const prior = await client.query('SELECT 1 FROM cash_drawer_movement WHERE reversal_of=$1', [req.params.id]);
  if (prior.rowCount) cash.fail(409, 'ALREADY_REVERSED', 'Movement has already been reversed.');
  const reversal = await cash.postMovement(client, { sessionId: session.session_id, direction: row.direction === 'IN' ? 'OUT' : 'IN',
    amount: row.amount, category: 'CORRECTION', description: reason, actorId: req.user.employee_id,
    reversalOf: row.movement_id, expectedVersion: req.body.expected_version, requestId: req.get('Idempotency-Key') });
  await cash.audit(client, { sessionId: session.session_id, targetType: 'MOVEMENT', targetId: row.movement_id,
    action: 'REVERSE', actorId: req.user.employee_id, reason, requestId: req.get('Idempotency-Key'), metadata: { reversal_id: reversal.movement_id } });
  return [201, { data: reversal }];
}));

router.post('/cash-drawers/sessions/:id/addenda', protect, hasPermission('cash_drawer:correct'), write(async (client, req) => {
  const reason = cash.validText(req.body.reason, 1000, true);
  const session = await client.query("SELECT session_id,status FROM cash_drawer_session WHERE session_id=$1", [req.params.id]);
  if (!session.rowCount || session.rows[0].status !== 'CLOSED') cash.fail(422, 'CLOSED_SESSION_REQUIRED', 'Addenda are for closed sessions.');
  await cash.audit(client, { sessionId: req.params.id, targetType: 'SESSION', targetId: req.params.id,
    action: 'ADDENDUM', actorId: req.user.employee_id, reason, requestId: req.get('Idempotency-Key'),
    metadata: { note: cash.validText(req.body.note, 1000, true), custody_bridge: req.body.custody_bridge || null } });
  return [201, { message: 'Addendum recorded. Original close remains unchanged.' }];
}));

router.post('/cash-drawers/sessions/:id/start-closing', protect, hasPermission('cash_drawer:close'), write(async (client, req) => {
  const session = await cash.lockSession(client, req.params.id, { version: req.body.expected_version });
  await client.query("UPDATE cash_drawer_session SET status='CLOSING',closing_by=$2,closing_at=now(),version=version+1 WHERE session_id=$1", [session.session_id, req.user.employee_id]);
  return [200, { data: { session_id: session.session_id, status: 'CLOSING', version: Number(session.version) + 1 } }];
}));

router.post('/cash-drawers/sessions/:id/cancel-closing', protect, hasPermission('cash_drawer:close'), write(async (client, req) => {
  const reason = cash.validText(req.body.reason, 1000, true);
  const session = await cash.lockSession(client, req.params.id, { version: req.body.expected_version, states: ['CLOSING'] });
  await client.query("UPDATE cash_count SET status='INVALIDATED',invalidated_at=now() WHERE session_id=$1 AND kind='CLOSING' AND status IN ('DRAFT','SUBMITTED')", [session.session_id]);
  await client.query("UPDATE cash_approval SET decision='REJECTED',decided_at=now(),reviewer_id=$2 WHERE session_id=$1 AND decision='PENDING'", [session.session_id, req.user.employee_id]);
  await client.query("UPDATE cash_drawer_session SET status='OPEN',count_window_expires_at=NULL,closing_by=NULL,closing_at=NULL,version=version+1 WHERE session_id=$1", [session.session_id]);
  await cash.audit(client, { sessionId: session.session_id, targetType: 'SESSION', targetId: session.session_id, action: 'CANCEL_CLOSING', actorId: req.user.employee_id, reason });
  return [200, { data: { session_id: session.session_id, status: 'OPEN', version: Number(session.version) + 1 } }];
}));

router.post('/cash-drawers/sessions/:id/counts/start', protect, hasPermission('cash_drawer:count'), write(async (client, req) => {
  const count = await cash.startCount(client, { sessionId: req.params.id, kind: req.body.kind, actorId: req.user.employee_id, expectedVersion: req.body.expected_version });
  return [201, { data: count }];
}));

router.post('/cash-drawers/counts/:id/submit', protect, hasPermission('cash_drawer:count'), write(async (client, req) => {
  const count = await cash.submitCount(client, { countId: req.params.id, lines: req.body.lines, notes: req.body.notes, actorId: req.user.employee_id });
  return [201, { data: count }];
}));

router.post('/cash-drawers/counts/:id/cancel', protect, hasPermission('cash_drawer:count'), write(async (client, req) => {
  const reason = cash.validText(req.body.reason, 1000, true);
  const found = await client.query('SELECT session_id FROM cash_count WHERE count_id=$1', [req.params.id]);
  if (!found.rowCount) cash.fail(404, 'COUNT_NOT_FOUND', 'Count not found.');
  const session = await cash.lockSession(client, found.rows[0].session_id, { states: ['OPEN','CLOSING'] });
  const updated = await client.query("UPDATE cash_count SET status='INVALIDATED',invalidated_at=now() WHERE count_id=$1 AND status='DRAFT' RETURNING *", [req.params.id]);
  if (!updated.rowCount) cash.fail(409, 'COUNT_STATE', 'Only a draft count may be cancelled.');
  await client.query('UPDATE cash_drawer_session SET count_window_expires_at=NULL,version=version+1 WHERE session_id=$1', [session.session_id]);
  await cash.audit(client, { sessionId: session.session_id, targetType: 'COUNT', targetId: req.params.id, action: 'CANCEL', actorId: req.user.employee_id, reason });
  return [200, { data: updated.rows[0] }];
}));

router.get('/cash-drawers/sessions/:id/approvals', protect, hasPermission('cash_drawer:view'), async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM cash_approval WHERE session_id=$1 ORDER BY approval_id DESC', [req.params.id]);
    res.json({ data: rows });
  } catch (error) { errorResponse(res, error); }
});

router.post('/cash-drawers/approvals', protect, hasPermission(['cash_drawer:close','cash_drawer:move','cash_drawer:transfer','cash_drawer:open','cash_drawer:settle_advance']), write(async (client, req) => {
  const { session_id, count_id, reason, expected_version, action, amount } = req.body;
  if (['MANUAL_RELEASE','TRANSFER','ADVANCE','REIMBURSEMENT'].includes(action)) {
    const required = action === 'TRANSFER' ? 'cash_drawer:transfer' : action === 'REIMBURSEMENT' ? 'cash_drawer:settle_advance' : 'cash_drawer:move';
    if (!userHasPermission(req, required)) cash.fail(403, 'FORBIDDEN', 'You cannot request this release.');
    const session = await cash.lockSession(client, session_id, { version: expected_version });
    cash.cents(amount, { positive: true });
    const { rows } = await client.query(`INSERT INTO cash_approval
      (session_id,action,bound_version,bound_amount,reason,requester_id)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [session_id, action, session.version, amount, cash.validText(reason, 1000, true), req.user.employee_id]);
    return [201, { data: rows[0] }];
  }
  if (action === 'OPENING_BRIDGE') {
    if (!userHasPermission(req, 'cash_drawer:open')) cash.fail(403, 'FORBIDDEN', 'You cannot request an opening bridge.');
    const prior = await client.query("SELECT * FROM cash_drawer_session WHERE session_id=$1 AND status='CLOSED' FOR SHARE", [session_id]);
    if (!prior.rowCount || Number(prior.rows[0].version) !== Number(expected_version)) cash.fail(409, 'STALE_SESSION', 'Prior close is missing or stale.');
    const signedAmount = cash.cents(amount, { signed: true });
    if (signedAmount === 0n) cash.fail(422, 'NO_BRIDGE', 'A nonzero custody difference is required.');
    const { rows } = await client.query(`INSERT INTO cash_approval
      (session_id,action,bound_version,bound_amount,reason,requester_id)
      VALUES($1,'OPENING_BRIDGE',$2,$3,$4,$5) RETURNING *`,
    [session_id, prior.rows[0].version, cash.money(signedAmount), cash.validText(reason, 1000, true), req.user.employee_id]);
    return [201, { data: rows[0] }];
  }
  const session = await cash.lockSession(client, session_id, { version: expected_version, states: ['CLOSING'] });
  if (!userHasPermission(req, 'cash_drawer:close')) cash.fail(403, 'FORBIDDEN', 'You cannot request closing review.');
  const count = await client.query("SELECT * FROM cash_count WHERE count_id=$1 AND session_id=$2 AND kind='CLOSING' AND status='SUBMITTED'", [count_id, session_id]);
  if (!count.rowCount) cash.fail(409, 'COUNT_STATE', 'A submitted closing count is required.');
  const newest = await client.query("SELECT MAX(count_id) AS count_id FROM cash_count WHERE session_id=$1 AND kind='CLOSING' AND status='SUBMITTED'", [session_id]);
  if (Number(newest.rows[0].count_id) !== Number(count_id)) cash.fail(409, 'STALE_COUNT', 'Review the latest closing count.');
  const { rows } = await client.query(`INSERT INTO cash_approval
    (session_id,action,count_id,bound_version,bound_amount,reason,requester_id)
    VALUES($1,'CLOSING_VARIANCE',$2,$3,$4,$5,$6) RETURNING *`,
  [session_id, count_id, session.version, count.rows[0].variance, cash.validText(reason, 1000, true), req.user.employee_id]);
  return [201, { data: rows[0] }];
}));

router.post('/cash-drawers/approvals/:id/decision', protect, hasPermission('cash_drawer:review'), write(async (client, req) => {
  const approvalRef = await client.query('SELECT session_id,action FROM cash_approval WHERE approval_id=$1', [req.params.id]);
  if (!approvalRef.rowCount) cash.fail(404, 'APPROVAL_NOT_FOUND', 'Approval not found.');
  const session = approvalRef.rows[0].action === 'OPENING_BRIDGE'
    ? (await client.query("SELECT * FROM cash_drawer_session WHERE session_id=$1 AND status='CLOSED'", [approvalRef.rows[0].session_id])).rows[0]
    : await cash.lockSession(client, approvalRef.rows[0].session_id,
      { states: approvalRef.rows[0].action === 'CLOSING_VARIANCE' ? ['CLOSING'] : ['OPEN'] });
  if (!session) cash.fail(409, 'SESSION_STATE', 'Approval target is no longer valid.');
  const decision = req.body.decision;
  if (!['APPROVED','REJECTED'].includes(decision)) cash.fail(400, 'INVALID_DECISION', 'Choose APPROVED or REJECTED.');
  const { rows } = await client.query(`UPDATE cash_approval SET decision=$2,reviewer_id=$3,decided_at=now()
    WHERE approval_id=$1 AND decision='PENDING' AND requester_id<>$3 AND bound_version=$4 RETURNING *`,
  [req.params.id, decision, req.user.employee_id, session.version]);
  if (!rows.length) cash.fail(409, 'STALE_APPROVAL', 'Approval is stale, already decided, or self review.');
  await cash.audit(client, { sessionId: session.session_id, targetType: 'APPROVAL', targetId: req.params.id, action: decision, actorId: req.user.employee_id, reason: req.body.reason });
  return [200, { data: rows[0] }];
}));

router.post('/cash-drawers/sessions/:id/close', protect, hasPermission('cash_drawer:close'), write(async (client, req) => {
  const session = await cash.lockSession(client, req.params.id, { version: req.body.expected_version, states: ['CLOSING'] });
  const countResult = await client.query("SELECT * FROM cash_count WHERE count_id=$1 AND session_id=$2 AND kind='CLOSING' AND status='SUBMITTED' FOR UPDATE", [req.body.count_id, session.session_id]);
  const count = countResult.rows[0];
  if (!count || Number(count.cutoff_sequence) !== Number(session.last_sequence)) cash.fail(409, 'STALE_COUNT', 'A fresh submitted closing count is required.');
  const newest = await client.query("SELECT MAX(count_id) AS count_id FROM cash_count WHERE session_id=$1 AND kind='CLOSING' AND status='SUBMITTED'", [session.session_id]);
  if (Number(newest.rows[0].count_id) !== Number(count.count_id)) cash.fail(409, 'STALE_COUNT', 'A recount superseded this closing count.');
  let reviewerId = null;
  if (cash.cents(count.variance, { signed: true }) !== 0n) {
    const approval = await client.query(`SELECT reviewer_id FROM cash_approval WHERE approval_id=$1 AND session_id=$2
      AND count_id=$3 AND action='CLOSING_VARIANCE' AND bound_amount=$4 AND decision='APPROVED'`,
    [req.body.approval_id, session.session_id, count.count_id, count.variance]);
    if (!approval.rowCount || approval.rows[0].reviewer_id === req.user.employee_id) cash.fail(422, 'REVIEW_REQUIRED', 'Independent manager review is required for a nonzero variance.');
    reviewerId = approval.rows[0].reviewer_id;
  }
  const totalResult = await client.query(`SELECT COALESCE(SUM(amount) FILTER(WHERE direction='IN'),0) AS total_in,
    COALESCE(SUM(amount) FILTER(WHERE direction='OUT'),0) AS total_out FROM cash_drawer_movement
    WHERE session_id=$1 AND sequence<=$2`, [session.session_id, count.cutoff_sequence]);
  const totals = totalResult.rows[0];
  const finalHandovers = req.body.handovers || [];
  if (!Array.isArray(finalHandovers) || finalHandovers.length > 20) cash.fail(400, 'INVALID_HANDOVERS', 'Provide at most 20 final handovers.');
  let handovers = 0n;
  for (const item of finalHandovers) {
    const amount = cash.cents(item.amount, { positive: true });
    handovers += amount;
    if (!Number.isSafeInteger(Number(item.recipient_id)) || !item.destination || typeof item.recipient_password !== 'string') cash.fail(400, 'INVALID_HANDOVER', 'Each handover needs a destination and recipient acknowledgment.');
    const recipient = await client.query('SELECT employee_id,password_hash,is_active FROM employee WHERE employee_id=$1', [item.recipient_id]);
    const account = recipient.rows[0];
    if (!account?.is_active || !account.password_hash || !(await bcrypt.compare(item.recipient_password, account.password_hash))) {
      cash.fail(403, 'RECIPIENT_AUTH_FAILED', 'Recipient credentials could not confirm custody.');
    }
  }
  const retainedActual = cash.cents(count.counted) - handovers;
  const retainedLedger = cash.cents(count.expected, { signed: true }) - handovers;
  if (retainedActual < 0n) cash.fail(422, 'HANDOVER_EXCEEDS_COUNT', 'Handover exceeds physical counted cash.');
  if (retainedLedger < 0n) cash.fail(422, 'HANDOVER_EXCEEDS_EXPECTED', 'Handover exceeds expected cash.');
  for (const item of finalHandovers) {
    const movement = await cash.postMovement(client, { sessionId: session.session_id, direction: 'OUT', amount: item.amount,
      category: 'FINAL_HANDOVER', description: `Final handover to ${item.destination}`, counterparty: String(item.recipient_id),
      actorId: req.user.employee_id, allowClosing: true });
    const transfer = await client.query(`INSERT INTO cash_transfer(session_id,release_movement_id,amount,destination,recipient_id)
      VALUES($1,$2,$3,$4,$5) RETURNING transfer_id`,
    [session.session_id, movement.movement_id, item.amount, cash.validText(item.destination, 200, true), item.recipient_id]);
    await client.query(`INSERT INTO cash_transfer_event(transfer_id,stage,amount,evidence,actor_id,request_id)
      VALUES($1,'ACKNOWLEDGED',$2,$3,$4,$5)`,
    [transfer.rows[0].transfer_id, item.amount, cash.validText(item.evidence, 500, true), item.recipient_id, crypto.randomUUID()]);
  }
  const snapshot = { session_code: session.session_code, count_id: count.count_id, cutoff_sequence: count.cutoff_sequence,
    opening: session.opening_amount, total_in: totals.total_in, total_out: totals.total_out,
    expected: count.expected, counted: count.counted, variance: count.variance,
    handovers: cash.money(handovers), retained_ledger: cash.money(retainedLedger), retained_actual: cash.money(retainedActual) };
  const { rows } = await client.query(`INSERT INTO cash_session_close
    (session_id,count_id,cutoff_sequence,opening,total_in,total_out,expected,counted,variance,handovers,
     retained_ledger,retained_actual,notes,custodian_id,reviewer_id,report_snapshot)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
  [session.session_id, count.count_id, count.cutoff_sequence, session.opening_amount, totals.total_in, totals.total_out,
    count.expected, count.counted, count.variance, snapshot.handovers, snapshot.retained_ledger, snapshot.retained_actual,
    cash.validText(req.body.notes, 2000), session.custodian_id, reviewerId, JSON.stringify(snapshot)]);
  await client.query("UPDATE cash_drawer_session SET status='CLOSED',closed_by=$2,closed_at=now(),version=version+1 WHERE session_id=$1", [session.session_id, req.user.employee_id]);
  await cash.audit(client, { sessionId: session.session_id, targetType: 'SESSION', targetId: session.session_id, action: 'CLOSE', actorId: req.user.employee_id });
  return [201, { data: rows[0] }];
}));

router.get('/cash-drawers/sessions/:id/report', protect, hasPermission('cash_drawer:export'), async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT c.report_snapshot,c.closed_at,
      concat_ws(' ',owner.first_name,owner.last_name) AS custodian_name,
      concat_ws(' ',reviewer.first_name,reviewer.last_name) AS reviewer_name
      FROM cash_session_close c JOIN employee owner ON owner.employee_id=c.custodian_id
      LEFT JOIN employee reviewer ON reviewer.employee_id=c.reviewer_id WHERE c.session_id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Closed report not found.' });
    const snapshot = rows[0].report_snapshot;
    const generatedAt = new Date().toISOString();
    const filename = `cash-drawer-${req.params.id}`;
    if (req.query.format === 'csv') {
      const movements = await db.query('SELECT sequence,recorded_at,category,description,physical_reference,direction,amount,balance_after FROM cash_drawer_movement WHERE session_id=$1 ORDER BY sequence', [req.params.id]);
      const lines = [['Field','Value'], ...Object.entries(snapshot).map(([key, value]) => [key, value]),
        ['Custodian', rows[0].custodian_name], ['Reviewer', rows[0].reviewer_name || 'None'],
        ['Closed at', rows[0].closed_at.toISOString()], ['Revision', '1'], ['Generated at', generatedAt],
        [], ['Sequence','Recorded at','Category','Description','Physical reference','Direction','Amount','Balance after'],
        ...movements.rows.map(m => [m.sequence, m.recorded_at?.toISOString(), m.category, m.description, m.physical_reference, m.direction, m.amount, m.balance_after])];
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.send(`\uFEFF${lines.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`);
    }
    if (req.query.format === 'pdf') {
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const page = pdf.addPage([595, 842]);
      page.drawText('Cash Drawer Daily Reconciliation', { x: 45, y: 790, size: 17, font });
      const lines = Object.entries(snapshot).map(([key, value]) => `${key.replaceAll('_', ' ')}: ${value}`);
      lines.push(`Custodian: ${rows[0].custodian_name}`, `Reviewer: ${rows[0].reviewer_name || 'none'}`,
        `Closed at: ${rows[0].closed_at.toISOString()}`);
      lines.forEach((line, index) => page.drawText(line.slice(0, 95), { x: 45, y: 755 - index * 23, size: 11, font }));
      page.drawText(`${snapshot.session_code}  |  Revision 1  |  Generated ${generatedAt}`.slice(0, 100),
        { x: 45, y: 34, size: 8, font });
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="${filename}.pdf"`);
      return res.send(Buffer.from(await pdf.save()));
    }
    res.json({ data: rows[0] });
  } catch (error) { errorResponse(res, error); }
});

module.exports = router;
