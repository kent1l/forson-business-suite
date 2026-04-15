const db = require('../db');

const ACTIONS = Object.freeze({
  UPSERT_PART: 'upsert_part',
  DELETE_PART: 'delete_part'
});

const enqueueEvent = async (action, entityId, metadata = null) => {
  if (!Object.values(ACTIONS).includes(action)) {
    throw new Error(`Invalid meili outbox action: ${action}`);
  }

  const sql = `
    INSERT INTO meili_sync_outbox (event_type, entity_type, entity_id, payload, status)
    VALUES ($1, 'part', $2, $3::jsonb, 'pending')
    RETURNING outbox_id
  `;

  const payload = metadata ? JSON.stringify(metadata) : null;
  const { rows } = await db.query(sql, [action, entityId, payload]);
  return rows[0]?.outbox_id;
};

const enqueuePartUpsert = async (partId, metadata = null) => {
  if (!partId) return null;
  return enqueueEvent(ACTIONS.UPSERT_PART, partId, metadata);
};

const enqueuePartDelete = async (partId, metadata = null) => {
  if (!partId) return null;
  return enqueueEvent(ACTIONS.DELETE_PART, partId, metadata);
};

module.exports = {
  ACTIONS,
  enqueuePartUpsert,
  enqueuePartDelete,
};
