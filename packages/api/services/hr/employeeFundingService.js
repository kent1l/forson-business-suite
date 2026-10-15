'use strict';

const cash = require('../cashDrawerService');
async function record(client, {
  funding,
  amount,
  direction,
  ownerKey,
  actor
}) {
  cash.cents(amount, {
    positive: true
  });
  const evidence = cash.validText(funding?.evidence, 2000, true);
  const occurred = funding?.occurred_at;
  if (!occurred || !Number.isFinite(Date.parse(occurred)) || Date.parse(occurred) > Date.now() + 60000) cash.fail(400, 'INVALID_OCCURRED_AT', 'Enter the actual funding occurrence time.');
  let movement = null;
  if (funding.method === 'CASH') {
    if (!cash.enabled()) cash.fail(503, 'DRAWER_DISABLED', 'Cash tracking must be enabled for employee cash settlement.');
    if (!cash.userCanPost(actor)) cash.fail(403, 'DRAWER_PERMISSION', 'Cash drawer movement permission is required.');
    const session = await cash.lockSession(client, funding.session_id, {
      version: funding.version
    });
    if (Number(session.custodian_id) !== Number(actor.employee_id)) cash.fail(403, 'DRAWER_CUSTODY', 'Use your own open drawer session.');
    if (direction === 'OUT') {
      const {
        rows: [approval]
      } = await client.query(`SELECT * FROM cash_approval WHERE approval_id=$1 AND session_id=$2 AND action='MANUAL_RELEASE' AND decision='APPROVED' AND bound_version=$3 AND bound_amount=$4 AND requester_id=$5 AND reviewer_id<>$5 FOR UPDATE`, [funding.approval_id, session.session_id, session.version, amount, actor.employee_id]);
      if (!approval) cash.fail(422, 'RELEASE_REVIEW_REQUIRED', 'An independent amount-bound cash release approval is required.');
      if ((await client.query('SELECT 1 FROM cash_approval_use WHERE approval_id=$1', [approval.approval_id])).rowCount) cash.fail(409, 'APPROVAL_USED', 'Cash release approval was already used.');
    }
    movement = await cash.postMovement(client, {
      sessionId: session.session_id,
      direction,
      amount,
      category: direction === 'OUT' ? 'EMPLOYEE_RELEASE' : 'EMPLOYEE_COLLECTION',
      description: ownerKey,
      actorId: actor.employee_id,
      sourceEventKey: `employee-finance:${ownerKey}`,
      occurredAt: occurred,
      lateReason: funding.late_reason,
      physicalReference: funding.external_reference,
      expectedVersion: funding.version
    });
    if (direction === 'OUT') await client.query('INSERT INTO cash_approval_use(approval_id,movement_id) VALUES($1,$2)', [funding.approval_id, movement.movement_id]);
  } else if (funding.method === 'BANK') {
    if (funding.confirmed !== true) cash.fail(422, 'FUNDING_UNCONFIRMED', 'Confirm the bank outcome from bank evidence before posting.');
    cash.validText(funding.external_reference, 200, true);
    const bank = await client.query('SELECT 1 FROM bank_account WHERE bank_account_id=$1 AND is_active AND currency=\'PHP\'', [funding.bank_account_id]);
    if (!bank.rowCount) cash.fail(422, 'BANK_ACCOUNT_REQUIRED', 'Select an active PHP bank account.');
  } else cash.fail(400, 'INVALID_METHOD', 'Choose CASH or BANK funding.');
  const {
    rows: [row]
  } = await client.query(`INSERT INTO employee_finance_funding(direction,amount,method,movement_id,bank_account_id,external_reference,evidence,occurred_at,actor_id,owner_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [direction, amount, funding.method, movement?.movement_id || null, funding.method === 'BANK' ? funding.bank_account_id : null, funding.external_reference || null, evidence, occurred, actor.employee_id, ownerKey]);
  return row;
}
module.exports = {
  record
};
