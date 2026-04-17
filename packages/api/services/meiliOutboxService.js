const db = require('../db');

const ACTIONS = Object.freeze({
  UPSERT_PART: 'upsert_part',
  DELETE_PART: 'delete_part'
});

const enrichMetadata = (metadata = null) => {
  const base = metadata && typeof metadata === 'object' ? { ...metadata } : {};
  if (!base.event_created_at) {
    base.event_created_at = new Date().toISOString();
  }
  return base;
};

const enqueueEvent = async (action, entityId, metadata = null) => {
  if (!Object.values(ACTIONS).includes(action)) {
    throw new Error(`Invalid meili outbox action: ${action}`);
  }

  const sql = `
    INSERT INTO meili_sync_outbox (event_type, entity_type, entity_id, payload, status)
    VALUES ($1, 'part', $2, $3::jsonb, 'pending')
    RETURNING outbox_id
  `;

  const payload = JSON.stringify(enrichMetadata(metadata));
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
