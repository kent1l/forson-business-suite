const crypto = require('crypto');

/**
 * Service to handle server-enforced idempotency for receiving and payment operations.
 */
async function beginOperation(client, { requestId, actorId, operation, payload }) {
  if (!requestId) return null;
  const trimmed = String(requestId).trim();
  if (!trimmed) return null;

  const payloadHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ operation, payload: payload || {} }))
    .digest('hex');

  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ap_op:${trimmed}`]);

  const { rows } = await client.query(
    `SELECT actor_id, operation, payload_hash, status_code, response
     FROM ap_operation_idempotency
     WHERE request_id = $1`,
    [trimmed],
  );

  if (rows.length > 0) {
    const prev = rows[0];
    if (
      Number(prev.actor_id) !== Number(actorId) ||
      prev.operation !== operation ||
      prev.payload_hash !== payloadHash ||
      prev.status_code === 202
    ) {
      const err = new Error('This Idempotency-Key was already used with different parameters or by another user.');
      err.statusCode = 409;
      err.code = 'IDEMPOTENCY_CONFLICT';
      throw err;
    }

    const replayErr = new Error('Idempotent request replay');
    replayErr.isReplay = true;
    replayErr.statusCode = prev.status_code;
    replayErr.response = prev.response;
    throw replayErr;
  }

  await client.query(
    `INSERT INTO ap_operation_idempotency
       (request_id, actor_id, operation, payload_hash, status_code, response)
     VALUES ($1, $2, $3, $4, 202, '{"pending":true}'::jsonb)`,
    [trimmed, actorId, operation, payloadHash],
  );

  return trimmed;
}

async function finishOperation(client, { requestId, statusCode, responseBody }) {
  if (!requestId) return;
  await client.query(
    `UPDATE ap_operation_idempotency
     SET status_code = $2, response = $3::jsonb
     WHERE request_id = $1`,
    [requestId, statusCode, JSON.stringify(responseBody || {})],
  );
}

module.exports = {
  beginOperation,
  finishOperation,
};
