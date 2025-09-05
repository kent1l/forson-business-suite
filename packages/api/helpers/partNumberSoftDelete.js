const db = require('../db');

let hasDeletedAtColumn = false;

(async function detectColumn() {
  try {
    const sql = `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='part_number' AND column_name='deleted_at'`;
    const res = await db.query(sql);
    hasDeletedAtColumn = res.rowCount > 0;
    if (!hasDeletedAtColumn) console.warn('[part_number] deleted_at column not found - soft delete disabled until migration runs.');
  } catch (e) {
    console.error('Failed checking part_number.deleted_at existence', e.message);
  }
})();

function activeAliasCondition(alias = 'pn') {
  return hasDeletedAtColumn ? `${alias}.deleted_at IS NULL` : '1=1';
}

function softDeleteSupported() {
  return hasDeletedAtColumn;
}

module.exports = { activeAliasCondition, softDeleteSupported };
