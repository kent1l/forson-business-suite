'use strict';

const express = require('express');
const db = require('../db');
const router = express.Router();
const { protect, hasPermission } = require('../middleware/authMiddleware');
const { syncPartWithMeili } = require('../meilisearch');
const { enqueuePartUpsert } = require('../services/meiliOutboxService');
const taxonomyIndex = require('../helpers/vehicleTaxonomyIndex');
const { parseFitmentText, buildShortlist } = require('../helpers/fitmentTextParser');
const { lookupKey } = require('../helpers/engineCodeGrammar');
const vehicleFitmentParserAI = require('../services/ai/features/vehicleFitmentParserAI');
const {
  validateNoClientVerificationFlags,
  validateAtomicAliasText,
  deriveIdentityAndQualifierModes,
} = require('../helpers/fitmentRuleSchema');
const fitmentReviewService = require('../services/fitmentReviewService');
const applicationRoutes = require('./applicationRoutes');

// GET /api/parts/:partId/applications
router.get('/parts/:partId/applications', protect, hasPermission('applications:view'), async (req, res) => {
  const { partId } = req.params;
  try {
    const query = `
      SELECT
        pa.part_app_id,
        pa.part_id,
        pa.application_id,
        pa.year_start,
        pa.year_end,
        pa.row_version,
        pa.legacy_rule_id AS rule_id,
        pa.legacy_claim_id AS claim_id,
        av.make,
        av.model,
        av.engine,
        av.make_id,
        av.model_id,
        av.engine_id,
        av.chassis_id,
        av.chassis,
        av.displacement_liters,
        av.fuel_type,
        COALESCE(vm.display_shorthand, false) AS display_shorthand,
        COALESCE(par.effect, 'include') AS effect,
        COALESCE(par.approval_status, av.approval_status, 'legacy_unverified') AS approval_status,
        COALESCE(par.evidence_status, 'legacy_unverified') AS evidence_status,
        par.make_mode,
        par.model_mode,
        par.chassis_mode,
        par.engine_mode,
        par.year_mode,
        par.market,
        par.variant_descriptor AS variant,
        par.position,
        par.drivetrain,
        par.transmission,
        par.generation
      FROM part_application pa
      JOIN application_view av ON pa.application_id = av.application_id
      LEFT JOIN vehicle_model vm ON vm.model_id = av.model_id
      LEFT JOIN part_application_rule par ON par.rule_id = pa.legacy_rule_id
      WHERE pa.part_id = $1
      ORDER BY av.make, av.model, av.engine, pa.year_start;
    `;
    const { rows } = await db.query(query, [partId]);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching part applications:', err.message);
    res.status(500).send('Server Error');
  }
});

// POST /api/parts/:partId/applications
router.post('/parts/:partId/applications', protect, hasPermission('applications:edit'), async (req, res) => {
  const { partId } = req.params;
  const body = req.body || {};

  const flagCheck = validateNoClientVerificationFlags(body);
  if (!flagCheck.valid) {
    return res.status(422).json({
      code: 'CLIENT_VERIFICATION_REJECTED',
      message: `Forbidden client verification fields: ${flagCheck.offendingKeys.join(', ')}`,
      client_verification_rejected: true,
    });
  }

  const rawYS = body.year_start !== undefined && body.year_start !== null && body.year_start !== '' ? Number(body.year_start) : null;
  const rawYE = body.year_end !== undefined && body.year_end !== null && body.year_end !== '' ? Number(body.year_end) : null;
  if ((rawYS !== null && !Number.isInteger(rawYS)) || (rawYE !== null && !Number.isInteger(rawYE))) {
    return res.status(400).json({ message: 'year_start and year_end must be integers' });
  }
  if (rawYS !== null && rawYE !== null && rawYS > rawYE) {
    return res.status(400).json({ message: 'year_start cannot be greater than year_end' });
  }

  const idempotencyKey = req.get('Idempotency-Key') || body.idempotency_key || null;
  const actorScope = `emp:${req.user?.employee_id || 'anon'}`;
  const endpointScope = `POST:/parts/${partId}/applications`;
  const requestHash = idempotencyKey
    ? fitmentReviewService.sha256(JSON.stringify({
        partId: Number(partId),
        application_id: body.application_id ?? null,
        make_id: body.make_id ?? null,
        model_id: body.model_id ?? null,
        chassis_id: body.chassis_id ?? null,
        engine_id: body.engine_id ?? null,
        year_start: rawYS,
        year_end: rawYE,
        effect: body.effect || 'include',
      }))
    : null;

  const client = await db.getClient();
  let syncOutboxQueued = false;
  let responseStatus = 201;
  let responseBody = null;

  try {
    await client.query('BEGIN');

    if (idempotencyKey) {
      const idemRes = await client.query(
        `SELECT response_status, response_body, request_hash
         FROM fitment_idempotency
         WHERE actor_scope = $1 AND endpoint_scope = $2 AND idempotency_key = $3
           AND expires_at > NOW()
         LIMIT 1`,
        [actorScope, endpointScope, String(idempotencyKey)]
      );
      if (idemRes.rows.length > 0) {
        if (idemRes.rows[0].request_hash !== requestHash) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            code: 'IDEMPOTENCY_KEY_CONFLICT',
            message: 'Idempotency-Key was already used with a different request payload',
          });
        }
        await client.query('COMMIT');
        return res.status(idemRes.rows[0].response_status).json({
          ...idemRes.rows[0].response_body,
          replayed: true,
        });
      }
    }

    let resolvedApplicationId = body.application_id != null ? Number(body.application_id) : null;
    let appRow = null;

    if (resolvedApplicationId != null) {
      if (!Number.isInteger(resolvedApplicationId) || resolvedApplicationId <= 0) {
        await client.query('ROLLBACK');
        return res.status(422).json({ code: 'INVALID_APPLICATION_ID', message: 'Invalid application_id' });
      }
      const appLookup = await client.query(
        'SELECT application_id, make_id, model_id, chassis_id, engine_id FROM application WHERE application_id = $1',
        [resolvedApplicationId]
      );
      if (!appLookup.rows.length) {
        await client.query('ROLLBACK');
        return res.status(422).json({ code: 'APPLICATION_NOT_FOUND', message: 'application_id not found' });
      }
      appRow = appLookup.rows[0];
    } else {
      const resolvedApp = await applicationRoutes.resolveAndFindOrCreateApplication(client, {
        ...body,
        derive_model_engine: false,
      });
      resolvedApplicationId = resolvedApp.application_id;
      appRow = {
        application_id: resolvedApp.application_id,
        make_id: resolvedApp.resolvedMakeId,
        model_id: resolvedApp.resolvedModelId,
        chassis_id: resolvedApp.resolvedChassisId,
        engine_id: resolvedApp.resolvedEngineId,
      };
    }

    const insertRes = await client.query(
      `INSERT INTO part_application (part_id, application_id, year_start, year_end)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (part_id, application_id) DO NOTHING
       RETURNING *`,
      [partId, resolvedApplicationId, rawYS, rawYE]
    );

    if (insertRes.rows.length > 0) {
      const newPa = insertRes.rows[0];
      const modes = deriveIdentityAndQualifierModes({
        ...body,
        make_id: appRow.make_id,
        model_id: appRow.model_id,
        chassis_id: appRow.chassis_id,
        engine_id: appRow.engine_id,
        year_start: rawYS,
        year_end: rawYE,
      });

      const claimRes = await client.query(
        `INSERT INTO fitment_claim (
           part_id, application_id, source_type, parser_mode, claim_effect,
           approval_status, evidence_status, created_by
         ) VALUES ($1, $2, 'manual_ui', 'manual', $3, 'needs_review', 'user_declared', $4)
         RETURNING claim_id`,
        [partId, resolvedApplicationId, body.effect === 'exclude' ? 'exclude' : 'include', req.user?.employee_id || null]
      );
      const claimId = claimRes.rows[0].claim_id;

      await client.query('SAVEPOINT sp_insert_rule');
      let ruleId = null;
      try {
        const ruleRes = await client.query(
          `INSERT INTO part_application_rule (
             part_id, application_id, claim_id, effect,
             make_mode, model_mode, chassis_mode, engine_mode,
             year_start, year_end, year_mode,
             market, market_mode, variant_descriptor, variant_mode,
             position, position_mode, drivetrain, drivetrain_mode,
             transmission, transmission_mode, fuel_type_qualifier, fuel_mode,
             displacement_liters_qualifier, displacement_mode, generation, generation_mode,
             approval_status, evidence_status, created_by, updated_by
           ) VALUES (
             $1, $2, $3, $4,
             $5, $6, $7, $8,
             $9, $10, $11,
             $12, $13, $14, $15,
             $16, $17, $18, $19,
             $20, $21, $22, $23,
             $24, $25, $26, $27,
             'needs_review', 'user_declared', $28, $28
           )
           ON CONFLICT DO NOTHING
           RETURNING rule_id`,
          [
            partId,
            resolvedApplicationId,
            claimId,
            body.effect === 'exclude' ? 'exclude' : 'include',
            modes.make_mode,
            modes.model_mode,
            modes.chassis_mode,
            modes.engine_mode,
            rawYS,
            rawYE,
            modes.year_mode,
            modes.market,
            modes.market_mode,
            modes.variant_descriptor,
            modes.variant_mode,
            modes.position,
            modes.position_mode,
            modes.drivetrain,
            modes.drivetrain_mode,
            modes.transmission,
            modes.transmission_mode,
            modes.fuel_type_qualifier,
            modes.fuel_mode,
            modes.displacement_liters_qualifier,
            modes.displacement_mode,
            modes.generation,
            modes.generation_mode,
            req.user?.employee_id || null,
          ]
        );
        await client.query('RELEASE SAVEPOINT sp_insert_rule');
        if (ruleRes.rows.length > 0) ruleId = ruleRes.rows[0].rule_id;
      } catch (_ruleErr) {
        await client.query('ROLLBACK TO SAVEPOINT sp_insert_rule');
      }

      if (!ruleId) {
        const existingRule = await client.query(
          `SELECT rule_id FROM part_application_rule
           WHERE part_id = $1 AND application_id = $2 AND is_active = TRUE
           ORDER BY rule_id ASC LIMIT 1`,
          [partId, resolvedApplicationId]
        );
        if (existingRule.rows.length > 0) ruleId = existingRule.rows[0].rule_id;
      }

      await client.query(
        `UPDATE part_application
         SET legacy_claim_id = $1, legacy_rule_id = $2
         WHERE part_app_id = $3`,
        [claimId, ruleId, newPa.part_app_id]
      );

      // Only derive vehicle_engine_fitment on newly inserted inclusion links (Fixes F10 / H03)
      if (appRow.model_id && appRow.engine_id && body.effect !== 'exclude') {
        await applicationRoutes.deriveVehicleEngineFitment(
          client,
          appRow.model_id,
          appRow.engine_id,
          rawYS,
          rawYE
        );
      }

      // Pass transactional client to enqueuePartUpsert so we never starve the connection pool (Fixes F18 / H05)
      syncOutboxQueued = await enqueuePartUpsert(partId, { source: 'part_application_add' }, client);

      responseStatus = 201;
      responseBody = {
        ...newPa,
        legacy_claim_id: claimId,
        legacy_rule_id: ruleId,
        rule_id: ruleId,
        outcome: 'saved',
        existing: false,
      };
    } else {
      // Duplicate link: do NOT widen vehicle_engine_fitment years; return deterministic existing row (H03 / A12)
      const existingPaRes = await client.query(
        `SELECT * FROM part_application
         WHERE part_id = $1 AND application_id = $2
         LIMIT 1`,
        [partId, resolvedApplicationId]
      );
      const existingPa = existingPaRes.rows[0] || {
        part_id: Number(partId),
        application_id: resolvedApplicationId,
        year_start: rawYS,
        year_end: rawYE,
      };
      responseStatus = 200;
      responseBody = {
        ...existingPa,
        rule_id: existingPa.legacy_rule_id || null,
        outcome: 'existing',
        existing: true,
      };
    }

    if (idempotencyKey && responseBody) {
      await client.query(
        `INSERT INTO fitment_idempotency
           (actor_scope, endpoint_scope, idempotency_key, request_hash, response_status, response_body)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (actor_scope, endpoint_scope, idempotency_key) DO NOTHING`,
        [actorScope, endpointScope, String(idempotencyKey), requestHash, responseStatus, JSON.stringify(responseBody)]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) {
      return res.status(err.status).json({
        code: err.code || 'VALIDATION_ERROR',
        message: err.message,
        ...(err.details || {}),
      });
    }
    console.error('Error adding part application:', err.message);
    return res.status(500).send('Server Error');
  } finally {
    client.release();
  }

  if (responseStatus === 201) {
    taxonomyIndex.invalidate();
    if (!syncOutboxQueued && process.env.DISABLE_MEILI_OUTBOX_WORKER !== 'true') {
      try {
        await syncPartWithMeili(partId);
      } catch (meiliErr) {
        console.warn('Meili sync fallback failed:', meiliErr.message);
      }
    }
  }

  return res.status(responseStatus).json(responseBody);
});

// PUT /api/part-applications/:partAppId
router.put('/part-applications/:partAppId', protect, hasPermission('applications:edit'), async (req, res) => {
  const { partAppId } = req.params;
  const body = req.body || {};
  const flagCheck = validateNoClientVerificationFlags(body);
  const expectedVersion = body.expected_rule_version ?? body.expected_version ?? null;

  const client = await db.getClient();
  let partIdForSync = null;
  let syncOutboxQueued = false;
  let updatedRow = null;

  try {
    await client.query('BEGIN');

    const currentRes = await client.query(
      `SELECT pa.*, par.row_version AS rule_row_version
       FROM part_application pa
       LEFT JOIN part_application_rule par ON par.rule_id = pa.legacy_rule_id
       WHERE pa.part_app_id = $1
       FOR UPDATE OF pa`,
      [partAppId]
    );

    if (currentRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Part application link not found.' });
    }

    const current = currentRes.rows[0];
    const currentVersion = Number(current.rule_row_version ?? current.row_version ?? 1);

    if (expectedVersion !== null && Number(expectedVersion) !== currentVersion) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        code: 'STALE_RULE',
        message: `Expected version ${expectedVersion} does not match current version ${currentVersion}`,
        current_version: currentVersion,
        client_verification_rejected: !flagCheck.valid,
      });
    }

    if (!flagCheck.valid) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        code: 'CLIENT_VERIFICATION_REJECTED',
        message: `Forbidden client verification fields: ${flagCheck.offendingKeys.join(', ')}`,
        client_verification_rejected: true,
      });
    }

    const rawYS = body.year_start !== undefined
      ? (body.year_start !== null && body.year_start !== '' ? Number(body.year_start) : null)
      : current.year_start;
    const rawYE = body.year_end !== undefined
      ? (body.year_end !== null && body.year_end !== '' ? Number(body.year_end) : null)
      : current.year_end;

    if ((rawYS !== null && !Number.isInteger(rawYS)) || (rawYE !== null && !Number.isInteger(rawYE))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'year_start and year_end must be integers' });
    }
    if (rawYS !== null && rawYE !== null && rawYS > rawYE) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'year_start cannot be greater than year_end' });
    }

    const updPa = await client.query(
      'UPDATE part_application SET year_start = $1, year_end = $2 WHERE part_app_id = $3 RETURNING *',
      [rawYS, rawYE, partAppId]
    );
    updatedRow = updPa.rows[0];
    partIdForSync = updatedRow.part_id;

    if (updatedRow.legacy_rule_id) {
      await client.query(
        `UPDATE part_application_rule
         SET year_start = $1,
             year_end = $2,
             year_mode = CASE WHEN $1 IS NOT NULL OR $2 IS NOT NULL THEN 'specified' ELSE 'not_supplied' END,
             updated_by = COALESCE($3, updated_by)
         WHERE rule_id = $4`,
        [rawYS, rawYE, req.user?.employee_id || null, updatedRow.legacy_rule_id]
      );
    }

    const appRes = await client.query(
      'SELECT model_id, engine_id FROM application WHERE application_id = $1',
      [updatedRow.application_id]
    );
    if (appRes.rows.length && appRes.rows[0].model_id && appRes.rows[0].engine_id) {
      await applicationRoutes.deriveVehicleEngineFitment(
        client,
        appRes.rows[0].model_id,
        appRes.rows[0].engine_id,
        rawYS,
        rawYE
      );
    }

    syncOutboxQueued = await enqueuePartUpsert(partIdForSync, { source: 'part_application_update' }, client);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updating part application:', err.message);
    return res.status(500).send('Server Error');
  } finally {
    client.release();
  }

  taxonomyIndex.invalidate();
  if (!syncOutboxQueued && partIdForSync && process.env.DISABLE_MEILI_OUTBOX_WORKER !== 'true') {
    try {
      await syncPartWithMeili(partIdForSync);
    } catch (meiliErr) {
      console.warn('Meili sync fallback failed:', meiliErr.message);
    }
  }

  return res.json(updatedRow);
});

// PUT /api/parts/:partId/application-rules/:ruleId
router.put('/parts/:partId/application-rules/:ruleId', protect, hasPermission('applications:edit'), async (req, res) => {
  const { partId, ruleId } = req.params;
  const body = req.body || {};
  const flagCheck = validateNoClientVerificationFlags(body);
  const expectedVersion = body.expected_rule_version ?? body.expected_version ?? null;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const curRes = await client.query(
      'SELECT * FROM part_application_rule WHERE rule_id = $1 AND part_id = $2 FOR UPDATE',
      [ruleId, partId]
    );
    if (curRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Fitment rule not found' });
    }
    const cur = curRes.rows[0];
    if (expectedVersion !== null && Number(expectedVersion) !== Number(cur.row_version)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        code: 'STALE_RULE',
        message: 'Rule version mismatch',
        current_version: cur.row_version,
        client_verification_rejected: !flagCheck.valid,
      });
    }
    if (!flagCheck.valid) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        code: 'CLIENT_VERIFICATION_REJECTED',
        message: `Forbidden client verification fields: ${flagCheck.offendingKeys.join(', ')}`,
        client_verification_rejected: true,
      });
    }

    const upd = await client.query(
      `UPDATE part_application_rule
       SET year_start = COALESCE($1, year_start),
           year_end = COALESCE($2, year_end),
           market = COALESCE($3, market),
           variant_descriptor = COALESCE($4, variant_descriptor),
           position = COALESCE($5, position),
           drivetrain = COALESCE($6, drivetrain),
           transmission = COALESCE($7, transmission),
           notes = COALESCE($8, notes),
           updated_by = COALESCE($9, updated_by)
       WHERE rule_id = $10
       RETURNING *`,
      [
        body.year_start !== undefined ? body.year_start : null,
        body.year_end !== undefined ? body.year_end : null,
        body.market !== undefined ? body.market : null,
        body.variant !== undefined ? body.variant : null,
        body.position !== undefined ? body.position : null,
        body.drivetrain !== undefined ? body.drivetrain : null,
        body.transmission !== undefined ? body.transmission : null,
        body.notes !== undefined ? body.notes : null,
        req.user?.employee_id || null,
        ruleId,
      ]
    );
    await enqueuePartUpsert(partId, { source: 'part_application_rule_update' }, client);
    await client.query('COMMIT');
    return res.json(upd.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updating part application rule:', err.message);
    return res.status(500).send('Server Error');
  } finally {
    client.release();
  }
});

// DELETE /api/part-applications/:partAppId
router.delete('/part-applications/:partAppId', protect, hasPermission('applications:edit'), async (req, res) => {
  const { partAppId } = req.params;
  const client = await db.getClient();
  let partIdForSync = null;
  let syncOutboxQueued = false;

  try {
    await client.query('BEGIN');
    const findPart = await client.query(
      'SELECT part_id, legacy_rule_id FROM part_application WHERE part_app_id = $1 FOR UPDATE',
      [partAppId]
    );
    if (findPart.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Part application link not found.' });
    }
    partIdForSync = findPart.rows[0].part_id;
    const ruleId = findPart.rows[0].legacy_rule_id;

    await client.query('DELETE FROM part_application WHERE part_app_id = $1', [partAppId]);
    if (ruleId) {
      await client.query(
        'UPDATE part_application_rule SET is_active = FALSE WHERE rule_id = $1',
        [ruleId]
      );
    }

    syncOutboxQueued = await enqueuePartUpsert(partIdForSync, { source: 'part_application_delete' }, client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error deleting part application:', err.message);
    return res.status(500).send('Server Error');
  } finally {
    client.release();
  }

  if (!syncOutboxQueued && partIdForSync && process.env.DISABLE_MEILI_OUTBOX_WORKER !== 'true') {
    try {
      await syncPartWithMeili(partIdForSync);
    } catch (meiliErr) {
      console.warn('Meili sync fallback failed:', meiliErr.message);
    }
  }
  return res.json({ message: 'Application unlinked from part.' });
});

// DELETE /api/parts/:partId/applications/:appId
router.delete('/parts/:partId/applications/:appId', protect, hasPermission('applications:edit'), async (req, res) => {
  const { partId, appId } = req.params;
  const client = await db.getClient();
  let syncOutboxQueued = false;

  try {
    await client.query('BEGIN');
    const deleteOp = await client.query(
      'DELETE FROM part_application WHERE part_id = $1 AND application_id = $2 RETURNING legacy_rule_id',
      [partId, appId]
    );
    if (deleteOp.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Application link not found.' });
    }
    const ruleId = deleteOp.rows[0]?.legacy_rule_id;
    if (ruleId) {
      await client.query('UPDATE part_application_rule SET is_active = FALSE WHERE rule_id = $1', [ruleId]);
    }
    syncOutboxQueued = await enqueuePartUpsert(partId, { source: 'partApplicationRoutes.delete' }, client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error deleting application link:', err.message);
    return res.status(500).send('Server Error');
  } finally {
    client.release();
  }

  if (!syncOutboxQueued && process.env.DISABLE_MEILI_OUTBOX_WORKER !== 'true') {
    try {
      await syncPartWithMeili(partId);
    } catch (meiliErr) {
      console.warn('Meili sync fallback failed:', meiliErr.message);
    }
  }

  return res.json({ message: 'Application link deleted successfully.' });
});

/**
 * Merge deterministic parser candidates with AI fallback candidates.
 * NOTE: Keep top-level declaration and closing brace at column 0 for Phase 0 baseline harness compatibility.
 */
function mergeFitmentCandidates(localRows, aiRows) {
  const rank = { high: 3, medium: 2, low: 1 };
  const nKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const cKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '');

  const allInput = [...(localRows || []), ...(aiRows || [])].filter(Boolean);
  const makeIdByModelId = new Map();
  const makeNameByModelId = new Map();
  const makeIdByName = new Map();
  const modelIdByName = new Map();
  const engineIdByCode = new Map();

  for (const r of allInput) {
    if (r.model_id != null && r.make_id != null) {
      makeIdByModelId.set(Number(r.model_id), Number(r.make_id));
      if (r.make) makeNameByModelId.set(Number(r.model_id), r.make);
    }
    if (r.make_id != null && r.make) {
      makeIdByName.set(nKey(r.make), Number(r.make_id));
    }
    if (r.model_id != null && r.model) {
      modelIdByName.set(`${r.make_id ?? ''}:${nKey(r.model)}`, Number(r.model_id));
      if (!modelIdByName.has(`:${nKey(r.model)}`)) {
        modelIdByName.set(`:${nKey(r.model)}`, Number(r.model_id));
      }
    }
    if (r.engine_id != null && r.engine) {
      engineIdByCode.set(cKey(r.engine), Number(r.engine_id));
    }
  }

  const normalizeRow = (r, origin) => {
    const copy = { ...r, _origin: r._origin || origin };
    if (copy.make_id == null && copy.model_id != null && makeIdByModelId.has(Number(copy.model_id))) {
      copy.make_id = makeIdByModelId.get(Number(copy.model_id));
      if (!copy.make && makeNameByModelId.has(Number(copy.model_id))) {
        copy.make = makeNameByModelId.get(Number(copy.model_id));
      }
    }
    if (copy.make_id == null && copy.make && makeIdByName.has(nKey(copy.make))) {
      copy.make_id = makeIdByName.get(nKey(copy.make));
    }
    if (copy.model_id == null && copy.model) {
      const scoped = modelIdByName.get(`${copy.make_id ?? ''}:${nKey(copy.model)}`);
      const unscoped = modelIdByName.get(`:${nKey(copy.model)}`);
      if (scoped != null) copy.model_id = scoped;
      else if (unscoped != null) copy.model_id = unscoped;
    }
    if (copy.engine_id == null && copy.engine && engineIdByCode.has(cKey(copy.engine))) {
      copy.engine_id = engineIdByCode.get(cKey(copy.engine));
    }
    return copy;
  };

  const keyOf = (r) => [
    r.effect || 'include',
    r.make_id ?? nKey(r.make),
    r.model_id ?? nKey(r.model),
    r.chassis_id ?? cKey(r.chassis),
    r.engine_id ?? cKey(r.engine),
    r.year_start ?? '',
    r.year_end ?? '',
    nKey(r.fuel_type),
    r.displacement_liters ?? '',
    nKey(r.market),
    nKey(r.variant),
    nKey(r.position),
    nKey(r.drivetrain),
    nKey(r.transmission),
    nKey(r.generation),
  ].join('|');

  const vehicleAnchorKey = (r) => [
    r.make_id ?? nKey(r.make),
    r.model_id ?? nKey(r.model),
    r.year_start ?? '',
    r.year_end ?? '',
  ].join('|');

  const map = new Map();
  for (const raw of localRows || []) {
    const r = normalizeRow(raw, 'local');
    map.set(keyOf(r), r);
  }
  for (const raw of aiRows || []) {
    const r = normalizeRow(raw, 'ai');
    const k = keyOf(r);
    const existing = map.get(k);
    if (!existing) {
      map.set(k, r);
    } else {
      const merged = (rank[r.confidence] || 0) > (rank[existing.confidence] || 0)
        ? { ...existing, ...r }
        : { ...r, ...existing };
      merged.make_id = existing.make_id ?? r.make_id ?? null;
      merged.make = existing.make ?? r.make ?? null;
      merged.model_id = existing.model_id ?? r.model_id ?? null;
      merged.model = existing.model ?? r.model ?? null;
      merged.engine_id = existing.engine_id ?? r.engine_id ?? null;
      merged.engine = existing.engine ?? r.engine ?? null;
      merged._origin = 'merged';
      map.set(k, merged);
    }
  }

  const out = Array.from(map.values());

  const anchorBuckets = new Map();
  for (const row of out) {
    const ak = vehicleAnchorKey(row);
    if (!anchorBuckets.has(ak)) anchorBuckets.set(ak, []);
    anchorBuckets.get(ak).push(row);
  }
  let groupSeq = 1;
  for (const [, bucket] of anchorBuckets.entries()) {
    if (bucket.length > 1) {
      const gid = `alt_grp_${groupSeq++}`;
      for (const row of bucket) {
        if (!row.alternative_group_id) row.alternative_group_id = gid;
      }
    }
  }

  return out;
}

// POST /api/applications/parse-fitment-text
router.post('/applications/parse-fitment-text', protect, hasPermission('applications:edit'), async (req, res) => {
  const rawText = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!rawText) {
    return res.status(400).json({ message: 'text is required' });
  }
  if (rawText.length > 2000) {
    return res.status(400).json({ message: 'text must be 2000 characters or fewer' });
  }

  try {
    const index = await taxonomyIndex.getIndex();
    const local = parseFitmentText(rawText, index);

    let fitments = local.fitments;
    let residue = local.residue;
    let source = 'local';
    let aiUsed = false;

    if (!local.safeForLocalOnly && req.body?.disable_ai !== true && process.env.JEV_ENABLED !== 'false') {
      try {
        const shortlist = buildShortlist(local.residue, index, 8);
        const shortlistSize =
          shortlist.makes.length + shortlist.models.length + shortlist.engines.length;
        const aiResult = await vehicleFitmentParserAI.parseFitmentText(
          rawText,
          shortlistSize > 0 ? { grounding: shortlist } : {}
        );
        fitments = mergeFitmentCandidates(local.fitments, aiResult.fitments || []);
        residue = aiResult.unparsed_tokens || local.residue || [];
        source = local.fitments.length > 0 ? 'hybrid' : 'ai';
        aiUsed = true;
      } catch (aiErr) {
        console.warn('[parse-fitment-text] AI fallback failed, returning local parse:', aiErr.message);
      }
    }

    let reviewSession = null;
    try {
      reviewSession = await fitmentReviewService.createOrUpdateReviewSession({
        partId: req.body?.part_id ?? null,
        rawText,
        fitments,
        residue,
        source,
        taxonomyVersion: index.taxonomyVersion || 1,
        userId: req.user?.employee_id || null,
      });
    } catch (revErr) {
      console.warn('[parse-fitment-text] Review session persistence skipped:', revErr.message);
    }

    const finalFitments = reviewSession
      ? reviewSession.candidates.filter((c) => c.disposition !== 'dismissed')
      : fitments;

    return res.json({
      fitments: finalFitments,
      residue,
      source,
      ai_used: aiUsed,
      review_id: reviewSession ? reviewSession.review_id : null,
      taxonomy_version: index.taxonomyVersion || 1,
      candidates: reviewSession ? reviewSession.candidates : fitments,
    });
  } catch (err) {
    console.error('Error parsing fitment text:', err.message);
    res.status(500).send('Server Error');
  }
});

// GET /api/applications/display-dictionary
router.get('/applications/display-dictionary', protect, hasPermission('applications:view'), async (_req, res) => {
  try {
    const index = await taxonomyIndex.getIndex();

    const makes = {};
    for (const m of index.makes || []) {
      if (m.display_short) makes[m.make_name] = m.display_short;
    }

    const models = {};
    const modelMakeCount = new Map();
    for (const m of index.models || []) {
      if (m.display_short) models[m.model_name] = m.display_short;
      const key = String(m.model_name).trim().toLowerCase();
      if (!modelMakeCount.has(key)) modelMakeCount.set(key, new Set());
      modelMakeCount.get(key).add(m.make_id);
    }

    const engines = {};
    for (const e of index.engines || []) {
      if (e.display_short) engines[e.engine_code] = e.display_short;
    }

    const ambiguousModels = [...modelMakeCount.entries()]
      .filter(([, makeIds]) => makeIds.size > 1)
      .map(([name]) => name);

    res.json({ makes, models, engines, ambiguousModels });
  } catch (err) {
    console.error('Error in /applications/display-dictionary:', err.message);
    res.status(500).send('Server Error');
  }
});

// PATCH /api/applications/fitment-reviews/:reviewId
router.patch('/applications/fitment-reviews/:reviewId', protect, hasPermission('applications:edit'), async (req, res) => {
  try {
    const result = await fitmentReviewService.patchReviewSession(
      req.params.reviewId,
      req.body || {},
      req.user?.employee_id || null
    );
    return res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        code: err.code || 'REVIEW_ERROR',
        message: err.message,
      });
    }
    console.error('Error patching fitment review session:', err.message);
    return res.status(500).send('Server Error');
  }
});

// POST /api/applications/fitment-research
router.post('/applications/fitment-research', protect, hasPermission('applications:edit'), async (req, res) => {
  try {
    const job = await fitmentReviewService.createResearchJob(req.body || {}, req.user?.employee_id || null);
    return res.status(201).json(job);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        code: err.code || 'RESEARCH_ERROR',
        message: err.message,
        ...(err.details || {}),
      });
    }
    console.error('Error creating fitment research job:', err.message);
    return res.status(500).send('Server Error');
  }
});

// GET /api/applications/fitment-research/:jobId
router.get('/applications/fitment-research/:jobId', protect, hasPermission('applications:view'), async (req, res) => {
  try {
    const job = await fitmentReviewService.getResearchJob(req.params.jobId);
    return res.json(job);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    console.error('Error fetching fitment research job:', err.message);
    return res.status(500).send('Server Error');
  }
});

// POST /api/applications/fitment-evidence/:evidenceId/approval
router.post(
  '/applications/fitment-evidence/:evidenceId/approval',
  protect,
  hasPermission('applications:approve'),
  async (req, res) => {
    const evidenceId = Number(req.params.evidenceId);
    const { decision = 'approved', reason = null } = req.body || {};
    if (!Number.isInteger(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({ message: 'Invalid evidenceId' });
    }
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ message: 'decision must be approved or rejected' });
    }
    try {
      const evStatus = decision === 'approved' ? 'sourced_verified' : 'rejected';
      const { rows } = await db.query(
        `UPDATE fitment_evidence
         SET approval_status = $1,
             evidence_status = $2,
             reviewer_id = $3,
             reviewed_at = NOW(),
             review_reason = $4,
             row_version = row_version + 1,
             updated_at = NOW()
         WHERE evidence_id = $5
         RETURNING *`,
        [decision, evStatus, req.user?.employee_id || null, reason, evidenceId]
      );
      if (!rows.length) {
        return res.status(404).json({ message: 'Evidence item not found' });
      }
      await db.query(
        `INSERT INTO fitment_audit (entity_type, entity_id, action, actor_id, reason, after_state)
         VALUES ('fitment_evidence', $1, $2, $3, $4, $5::jsonb)`,
        [evidenceId, `evidence_${decision}`, req.user?.employee_id || null, reason, JSON.stringify(rows[0])]
      );
      return res.json(rows[0]);
    } catch (err) {
      console.error('Error approving fitment evidence:', err.message);
      return res.status(500).send('Server Error');
    }
  }
);

// POST /api/applications/fitment-corrections
router.post('/applications/fitment-corrections', protect, hasPermission('applications:edit'), async (req, res) => {
  try {
    const row = await fitmentReviewService.createCorrection(req.body || {}, req.user?.employee_id || null);
    return res.status(201).json(row);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    console.error('Error recording fitment correction:', err.message);
    return res.status(500).send('Server Error');
  }
});

// POST /api/applications/fitment-alias
router.post('/applications/fitment-alias', protect, hasPermission('applications:edit'), async (req, res) => {
  const body = req.body || {};
  const alias_text = body.alias_text;
  const alias_kind = body.alias_kind || 'canonical_synonym';
  const require_approval = Boolean(body.require_approval);

  // Support both { type, target_id, alias_text } and legacy { alias_text, make_id, model_id, engine_id }
  let type = body.type;
  let id = body.target_id != null ? Number(body.target_id) : null;
  let explicitMakeId = body.make_id != null ? Number(body.make_id) : null;

  if (!type) {
    const providedTargets = [
      body.make_id != null ? ['make', Number(body.make_id)] : null,
      body.model_id != null ? ['model', Number(body.model_id)] : null,
      body.engine_id != null ? ['engine', Number(body.engine_id)] : null,
    ].filter(Boolean);

    if (providedTargets.length !== 1) {
      return res.status(400).json({ message: 'Exactly one of make_id, model_id or engine_id (or type + target_id) is required.' });
    }
    type = providedTargets[0][0];
    id = providedTargets[0][1];
    if (type !== 'model') explicitMakeId = null;
  }

  if (!['make', 'model', 'engine'].includes(type)) {
    return res.status(400).json({ message: 'type must be one of make, model, engine' });
  }
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: 'target_id must be a positive integer' });
  }

  try {
    const index = await taxonomyIndex.getIndex();
    const atomicCheck = validateAtomicAliasText(alias_text, type, index);
    if (!atomicCheck.ok) {
      return res.status(422).json({
        code: atomicCheck.code,
        message: atomicCheck.message,
      });
    }

    const clean = atomicCheck.normalized;
    const key = type === 'engine' ? lookupKey(clean) : taxonomyIndex.nameKey(clean);
    if (!key || key.length < 2) {
      return res.status(422).json({ code: 'ALIAS_TOO_SHORT', message: 'alias_text is too short after normalization' });
    }

    // Never allow a learned alias to shadow a real canonical name
    const collision = await db.query(
      `SELECT 1 FROM engine WHERE upper(engine_code) = upper($1)
       UNION ALL SELECT 1 FROM vehicle_make WHERE upper(make_name) = upper($1)
       UNION ALL SELECT 1 FROM vehicle_model WHERE upper(model_name) = upper($1)`,
      [clean]
    );
    if (collision.rows.length) {
      return res.status(409).json({ code: 'CANONICAL_NAME_COLLISION', message: 'That text is already a canonical taxonomy name.' });
    }

    const status = require_approval ? 'pending_review' : 'approved';
    let row = null;

    if (type === 'make') {
      const exists = await db.query('SELECT 1 FROM vehicle_make WHERE make_id = $1', [id]);
      if (!exists.rows.length) {
        return res.status(404).json({ message: 'Target taxonomy row not found.' });
      }
      const ins = await db.query(
        `INSERT INTO vehicle_make_alias (make_id, alias_text, source, status, alias_kind)
         VALUES ($1, $2, 'learned', $3, $4)
         ON CONFLICT DO NOTHING
         RETURNING alias_id, make_id AS target_id, alias_text, status, alias_kind`,
        [id, clean, status, alias_kind]
      );
      row = ins.rows[0] || { target_id: id, alias_text: clean, status, alias_kind };
    } else if (type === 'model') {
      let resolvedMakeId = explicitMakeId;
      const mLookup = await db.query('SELECT make_id FROM vehicle_model WHERE model_id = $1', [id]);
      if (!mLookup.rows.length) {
        return res.status(404).json({ message: 'Target taxonomy row not found.' });
      }
      if (!resolvedMakeId) {
        resolvedMakeId = mLookup.rows[0].make_id;
      }
      const ins = await db.query(
        `INSERT INTO vehicle_model_alias (model_id, make_id, alias_text, source, status, alias_kind)
         VALUES ($1, $2, $3, 'learned', $4, $5)
         ON CONFLICT DO NOTHING
         RETURNING alias_id, model_id AS target_id, make_id, alias_text, status, alias_kind`,
        [id, resolvedMakeId, clean, status, alias_kind]
      );
      row = ins.rows[0] || { target_id: id, make_id: resolvedMakeId, alias_text: clean, status, alias_kind };
    } else {
      const exists = await db.query('SELECT 1 FROM engine WHERE engine_id = $1', [id]);
      if (!exists.rows.length) {
        return res.status(404).json({ message: 'Target taxonomy row not found.' });
      }
      const ins = await db.query(
        `INSERT INTO engine_alias (engine_id, alias_text, source, status, alias_kind)
         VALUES ($1, $2, 'learned', $3, $4)
         ON CONFLICT DO NOTHING
         RETURNING alias_id, engine_id AS target_id, alias_text, status, alias_kind`,
        [id, clean, status, alias_kind]
      );
      row = ins.rows[0] || { target_id: id, alias_text: clean, status, alias_kind };
    }

    taxonomyIndex.invalidate();
    res.status(201).json({ type, message: 'Alias recorded.', ...row });
  } catch (err) {
    console.error('Error saving fitment alias:', err.message);
    res.status(500).send('Server Error');
  }
});

// PUT /api/applications/fitment-alias/:aliasId/approval
router.put(
  '/applications/fitment-alias/:aliasId/approval',
  protect,
  hasPermission('applications:approve'),
  async (req, res) => {
    const aliasId = Number(req.params.aliasId);
    const { type = 'model', status = 'approved', reason = null } = req.body || {};
    if (!Number.isInteger(aliasId) || aliasId <= 0) {
      return res.status(400).json({ message: 'Invalid aliasId' });
    }
    if (!['make', 'model', 'engine'].includes(type)) {
      return res.status(400).json({ message: 'type must be make, model, or engine' });
    }
    if (!['approved', 'rejected', 'disabled'].includes(status)) {
      return res.status(400).json({ message: 'status must be approved, rejected, or disabled' });
    }
    const table = type === 'make' ? 'vehicle_make_alias' : type === 'model' ? 'vehicle_model_alias' : 'engine_alias';
    try {
      const { rows } = await db.query(
        `UPDATE ${table}
         SET status = $1,
             reviewer_id = $2,
             reviewed_at = NOW(),
             reason = $3,
             row_version = row_version + 1
         WHERE alias_id = $4
         RETURNING *`,
        [status, req.user?.employee_id || null, reason, aliasId]
      );
      if (!rows.length) {
        return res.status(404).json({ message: 'Alias not found' });
      }
      taxonomyIndex.invalidate();
      return res.json({ type, ...rows[0] });
    } catch (err) {
      console.error('Error updating alias approval:', err.message);
      return res.status(500).send('Server Error');
    }
  }
);

// POST /api/reindex/parts
router.post('/reindex/parts', protect, hasPermission('applications:edit'), async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT DISTINCT p.part_id FROM part p LEFT JOIN part_application pa ON p.part_id = pa.part_id');
    for (const row of rows) {
      await enqueuePartUpsert(row.part_id, { source: 'partApplicationRoutes.reindex' });
    }
    res.json({ indexed: rows.length });
  } catch (err) {
    console.error('Parts reindex failed:', err.message);
    res.status(500).json({ error: 'Reindex failed' });
  }
});

router.mergeFitmentCandidates = mergeFitmentCandidates;

module.exports = router;
