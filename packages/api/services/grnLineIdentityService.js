const crypto = require('crypto');

/**
 * Validates and resolves line identities (line_uuid) for a goods receipt.
 * Ensures UUIDs are valid, unique, not hijacked across GRNs, and preserved across updates.
 */
async function resolveLineIdentities(client, grnId, lines, { isImportCommit = false, lineIdentityVersion = null } = {}) {
  // 1. Check if this GRN was created from an import
  let isImportedGrn = false;
  let existingUuids = new Set();

  if (grnId) {
    const { rows: importRows } = await client.query(
      'SELECT import_id FROM grn_import_review WHERE grn_id = $1',
      [grnId]
    );
    isImportedGrn = importRows.length > 0;

    const { rows: lineRows } = await client.query(
      'SELECT line_uuid FROM goods_receipt_line WHERE grn_id = $1',
      [grnId]
    );
    existingUuids = new Set(lineRows.map(r => r.line_uuid));
  }

  // 2. If it's an imported GRN being updated by a client without line_identity_version: 1
  if (isImportedGrn && !isImportCommit && lineIdentityVersion !== 1) {
    const anyMissingUuid = lines.some(l => !l.line_uuid);
    if (anyMissingUuid) {
      const err = new Error('Line identities are required to update an imported goods receipt. Please refresh.');
      err.statusCode = 409;
      err.code = 'GRN_LINE_IDENTITIES_REQUIRED';
      throw err;
    }
  }

  // 3. Check for duplicates within the incoming payload
  const seenUuids = new Set();
  const identityMappings = [];
  const resolvedLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let uuid = line.line_uuid || null;
    const clientKey = line.client_row_key || null;

    if (uuid) {
      if (seenUuids.has(uuid)) {
        const err = new Error(`Duplicate line_uuid '${uuid}' at line ${i + 1}.`);
        err.statusCode = 400;
        err.code = 'DUPLICATE_LINE_UUID';
        throw err;
      }
      seenUuids.add(uuid);

      // If updating an existing GRN, verify UUID belongs to this GRN (unless import commit)
      if (grnId && !isImportCommit && existingUuids.size > 0 && !existingUuids.has(uuid)) {
        // Check if this UUID exists anywhere else in goods_receipt_line
        const { rows: otherGrn } = await client.query(
          'SELECT grn_id FROM goods_receipt_line WHERE line_uuid = $1',
          [uuid]
        );
        if (otherGrn.length > 0) {
          const err = new Error(`line_uuid '${uuid}' belongs to another goods receipt.`);
          err.statusCode = 409;
          err.code = 'CROSS_GRN_LINE_UUID';
          throw err;
        }
      }
    } else {
      // Generate new UUID for new line
      uuid = crypto.randomUUID();
      seenUuids.add(uuid);
    }

    if (clientKey) {
      identityMappings.push({
        client_row_key: clientKey,
        line_uuid: uuid,
        part_id: line.part_id,
      });
    }

    resolvedLines.push({
      ...line,
      line_uuid: uuid,
    });
  }

  return {
    resolvedLines,
    identityMappings,
    isImportedGrn: isImportCommit || isImportedGrn,
  };
}

module.exports = {
  resolveLineIdentities,
};
