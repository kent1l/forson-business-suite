'use strict';

const express = require('express');
const db = require('../db');
const router = express.Router();
const { protect, hasPermission } = require('../middleware/authMiddleware');
const { parsePaginationQuery, paginatedResponse } = require('../helpers/pagination');
const { canonicalizeEngineCode, lookupKey } = require('../helpers/engineCodeGrammar');
const taxonomyIndex = require('../helpers/vehicleTaxonomyIndex');
const {
  nameKey,
  validateNoClientVerificationFlags,
  deriveIdentityAndQualifierModes,
} = require('../helpers/fitmentRuleSchema');

function httpError(status, code, message, details = undefined) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  if (details !== undefined) err.details = details;
  return err;
}

const VALID_FUEL_TYPES = new Set(['diesel', 'gasoline', 'hybrid', 'electric', 'lpg', 'other']);

function normalizeDisp(val) {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0 || n >= 20) return null;
  return Number(n.toFixed(1));
}

function normalizeFuel(val) {
  if (!val || typeof val !== 'string') return null;
  const lower = val.trim().toLowerCase();
  return VALID_FUEL_TYPES.has(lower) ? lower : null;
}

async function resolveMake(client, { make_id, make }) {
  const hasId = make_id !== undefined && make_id !== null && make_id !== '';
  const cleanName = typeof make === 'string' ? make.trim() : '';

  if (hasId) {
    const id = Number(make_id);
    if (!Number.isInteger(id) || id <= 0) {
      throw httpError(422, 'INVALID_MAKE_ID', 'Invalid make_id');
    }
    const { rows } = await client.query(
      'SELECT make_id, make_name FROM vehicle_make WHERE make_id = $1',
      [id]
    );
    if (!rows.length) {
      throw httpError(422, 'MAKE_NOT_FOUND', `make_id ${id} does not exist`);
    }
    if (cleanName) {
      const suppliedKey = nameKey(cleanName);
      const canonKey = nameKey(rows[0].make_name);
      if (suppliedKey !== canonKey) {
        const aliasHit = await client.query(
          `SELECT 1 FROM vehicle_make_alias
           WHERE make_id = $1
             AND regexp_replace(lower(alias_text), '[^a-z0-9]+', '', 'g') = $2
             AND COALESCE(status, 'approved') = 'approved'
           LIMIT 1`,
          [id, suppliedKey]
        );
        if (!aliasHit.rows.length) {
          throw httpError(
            422,
            'IDENTITY_MISMATCH',
            `make_id ${id} (${rows[0].make_name}) does not match supplied make "${cleanName}"`
          );
        }
      }
    }
    return rows[0].make_id;
  }

  if (!cleanName) return null;

  const existing = await client.query(
    'SELECT make_id FROM vehicle_make WHERE lower(btrim(make_name)) = lower(btrim($1)) LIMIT 1',
    [cleanName]
  );
  if (existing.rows.length) return existing.rows[0].make_id;

  await client.query('SAVEPOINT sp_resolve_make');
  try {
    const ins = await client.query(
      'INSERT INTO vehicle_make (make_name) VALUES ($1) RETURNING make_id',
      [cleanName]
    );
    await client.query('RELEASE SAVEPOINT sp_resolve_make');
    return ins.rows[0].make_id;
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT sp_resolve_make');
    if (err.code === '23505') {
      const retry = await client.query(
        'SELECT make_id FROM vehicle_make WHERE lower(btrim(make_name)) = lower(btrim($1)) LIMIT 1',
        [cleanName]
      );
      if (retry.rows.length) return retry.rows[0].make_id;
    }
    throw err;
  }
}

async function resolveModel(client, { model_id, model, make_id }) {
  const hasId = model_id !== undefined && model_id !== null && model_id !== '';
  const cleanName = typeof model === 'string' ? model.trim() : '';

  if (hasId) {
    const id = Number(model_id);
    if (!Number.isInteger(id) || id <= 0) {
      throw httpError(422, 'INVALID_MODEL_ID', 'Invalid model_id');
    }
    const { rows } = await client.query(
      'SELECT model_id, make_id, model_name FROM vehicle_model WHERE model_id = $1',
      [id]
    );
    if (!rows.length) {
      throw httpError(422, 'MODEL_NOT_FOUND', `model_id ${id} does not exist`);
    }
    if (make_id !== null && make_id !== undefined && Number(rows[0].make_id) !== Number(make_id)) {
      throw httpError(
        422,
        'IDENTITY_MISMATCH',
        `model_id ${id} belongs to make_id ${rows[0].make_id}, not make_id ${make_id}`
      );
    }
    if (cleanName) {
      const suppliedKey = nameKey(cleanName);
      const canonKey = nameKey(rows[0].model_name);
      if (suppliedKey !== canonKey) {
        const aliasHit = await client.query(
          `SELECT 1 FROM vehicle_model_alias
           WHERE model_id = $1
             AND regexp_replace(lower(alias_text), '[^a-z0-9]+', '', 'g') = $2
             AND COALESCE(status, 'approved') = 'approved'
           LIMIT 1`,
          [id, suppliedKey]
        );
        if (!aliasHit.rows.length) {
          throw httpError(
            422,
            'IDENTITY_MISMATCH',
            `model_id ${id} (${rows[0].model_name}) does not match supplied model "${cleanName}"`
          );
        }
      }
    }
    return { model_id: rows[0].model_id, derived_make_id: rows[0].make_id };
  }

  if (!cleanName) return { model_id: null, derived_make_id: make_id ?? null };
  if (!make_id) {
    throw httpError(400, 'MODEL_REQUIRES_MAKE', 'Cannot create or resolve a vehicle model without a make');
  }

  const existing = await client.query(
    'SELECT model_id, make_id FROM vehicle_model WHERE make_id = $1 AND lower(btrim(model_name)) = lower(btrim($2)) LIMIT 1',
    [make_id, cleanName]
  );
  if (existing.rows.length) {
    return { model_id: existing.rows[0].model_id, derived_make_id: existing.rows[0].make_id };
  }

  await client.query('SAVEPOINT sp_resolve_model');
  try {
    const ins = await client.query(
      'INSERT INTO vehicle_model (make_id, model_name) VALUES ($1, $2) RETURNING model_id, make_id',
      [make_id, cleanName]
    );
    await client.query('RELEASE SAVEPOINT sp_resolve_model');
    return { model_id: ins.rows[0].model_id, derived_make_id: ins.rows[0].make_id };
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT sp_resolve_model');
    if (err.code === '23505') {
      const retry = await client.query(
        'SELECT model_id, make_id FROM vehicle_model WHERE make_id = $1 AND lower(btrim(model_name)) = lower(btrim($2)) LIMIT 1',
        [make_id, cleanName]
      );
      if (retry.rows.length) {
        return { model_id: retry.rows[0].model_id, derived_make_id: retry.rows[0].make_id };
      }
    }
    throw err;
  }
}

async function resolveEngine(client, { engine_id, engine, displacement_liters, fuel_type }) {
  const disp = normalizeDisp(displacement_liters);
  const fuel = normalizeFuel(fuel_type);
  const hasId = engine_id !== undefined && engine_id !== null && engine_id !== '';
  const cleanCode = typeof engine === 'string' ? engine.trim() : '';

  if (hasId) {
    const id = Number(engine_id);
    if (!Number.isInteger(id) || id <= 0) {
      throw httpError(422, 'INVALID_ENGINE_ID', 'Invalid engine_id');
    }
    const { rows } = await client.query(
      'SELECT engine_id, engine_code FROM engine WHERE engine_id = $1',
      [id]
    );
    if (!rows.length) {
      throw httpError(422, 'ENGINE_NOT_FOUND', `engine_id ${id} does not exist`);
    }
    if (cleanCode) {
      const suppliedKey = lookupKey(cleanCode);
      const canonKey = lookupKey(rows[0].engine_code);
      if (suppliedKey !== canonKey) {
        const aliasHit = await client.query(
          `SELECT 1 FROM engine_alias
           WHERE engine_id = $1
             AND regexp_replace(upper(alias_text), '[^A-Z0-9]+', '', 'g') = $2
             AND COALESCE(status, 'approved') = 'approved'
           LIMIT 1`,
          [id, suppliedKey]
        );
        if (!aliasHit.rows.length) {
          throw httpError(
            422,
            'IDENTITY_MISMATCH',
            `engine_id ${id} (${rows[0].engine_code}) does not match supplied engine "${cleanCode}"`
          );
        }
      }
    }
    if (disp !== null || fuel !== null) {
      await client.query(
        `UPDATE engine
         SET displacement_liters = COALESCE(displacement_liters, $1),
             fuel_type           = COALESCE(fuel_type, $2)
         WHERE engine_id = $3
           AND (displacement_liters IS NULL OR fuel_type IS NULL)`,
        [disp, fuel, id]
      );
    }
    return rows[0].engine_id;
  }

  if (!cleanCode) return null;

  const { valid, canonical, reason } = canonicalizeEngineCode(cleanCode);
  if (!valid || !canonical) {
    throw httpError(400, 'INVALID_ENGINE_CODE', reason || `Invalid engine code "${cleanCode}"`);
  }

  const key = lookupKey(canonical);
  const existing = await client.query(
    `SELECT engine_id
     FROM engine
     WHERE regexp_replace(upper(btrim(engine_code)), '[-\\s]+', '', 'g') = $1
     ORDER BY CASE WHEN upper(btrim(engine_code)) = $2 THEN 0 ELSE 1 END, engine_id ASC
     LIMIT 1`,
    [key, canonical]
  );

  let resolvedId = null;
  if (existing.rows.length) {
    resolvedId = existing.rows[0].engine_id;
  } else {
    await client.query('SAVEPOINT sp_resolve_engine');
    try {
      const ins = await client.query(
        `INSERT INTO engine (engine_code, displacement_liters, fuel_type)
         VALUES ($1, $2, $3)
         RETURNING engine_id`,
        [canonical, disp, fuel]
      );
      await client.query('RELEASE SAVEPOINT sp_resolve_engine');
      return ins.rows[0].engine_id;
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT sp_resolve_engine');
      if (err.code === '23505') {
        const retry = await client.query(
          'SELECT engine_id FROM engine WHERE lower(btrim(engine_code)) = lower(btrim($1)) LIMIT 1',
          [canonical]
        );
        if (retry.rows.length) resolvedId = retry.rows[0].engine_id;
      } else {
        throw err;
      }
    }
  }

  if (resolvedId && (disp !== null || fuel !== null)) {
    await client.query(
      `UPDATE engine
       SET displacement_liters = COALESCE(displacement_liters, $1),
           fuel_type           = COALESCE(fuel_type, $2)
       WHERE engine_id = $3
         AND (displacement_liters IS NULL OR fuel_type IS NULL)`,
      [disp, fuel, resolvedId]
    );
  }
  return resolvedId;
}

async function resolveChassis(client, { chassis_id, chassis, model_id, generation = null, market = null }) {
  const hasId = chassis_id !== undefined && chassis_id !== null && chassis_id !== '';
  const cleanCode = typeof chassis === 'string' ? chassis.trim() : '';

  if (hasId) {
    const id = Number(chassis_id);
    if (!Number.isInteger(id) || id <= 0) {
      throw httpError(422, 'INVALID_CHASSIS_ID', 'Invalid chassis_id');
    }
    const { rows } = await client.query(
      'SELECT chassis_id, model_id, chassis_code FROM vehicle_chassis WHERE chassis_id = $1',
      [id]
    );
    if (!rows.length) {
      throw httpError(422, 'CHASSIS_NOT_FOUND', `chassis_id ${id} does not exist`);
    }
    if (model_id != null && rows[0].model_id != null && Number(rows[0].model_id) !== Number(model_id)) {
      throw httpError(
        422,
        'IDENTITY_MISMATCH',
        `chassis_id ${id} belongs to model_id ${rows[0].model_id}, not model_id ${model_id}`
      );
    }
    if (cleanCode && lookupKey(cleanCode) !== lookupKey(rows[0].chassis_code)) {
      throw httpError(
        422,
        'IDENTITY_MISMATCH',
        `chassis_id ${id} (${rows[0].chassis_code}) does not match supplied chassis "${cleanCode}"`
      );
    }
    return {
      chassis_id: rows[0].chassis_id,
      derived_model_id: rows[0].model_id ?? null,
    };
  }

  if (!cleanCode) return { chassis_id: null, derived_model_id: model_id ?? null };

  const existing = await client.query(
    `SELECT chassis_id, model_id
     FROM vehicle_chassis
     WHERE model_id IS NOT DISTINCT FROM $1
       AND lower(btrim(chassis_code)) = lower(btrim($2))
     LIMIT 1`,
    [model_id ?? null, cleanCode]
  );
  if (existing.rows.length) {
    return {
      chassis_id: existing.rows[0].chassis_id,
      derived_model_id: existing.rows[0].model_id ?? null,
    };
  }

  await client.query('SAVEPOINT sp_resolve_chassis');
  try {
    const identityKey = lookupKey(cleanCode) || cleanCode.toUpperCase();
    const ins = await client.query(
      `INSERT INTO vehicle_chassis (model_id, chassis_code, identity_key, generation, market, identity_status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING chassis_id, model_id`,
      [
        model_id ?? null,
        cleanCode,
        identityKey,
        generation || null,
        market || null,
        model_id != null ? 'legacy_unverified' : 'needs_review',
      ]
    );
    await client.query('RELEASE SAVEPOINT sp_resolve_chassis');
    return {
      chassis_id: ins.rows[0].chassis_id,
      derived_model_id: ins.rows[0].model_id ?? null,
    };
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT sp_resolve_chassis');
    if (err.code === '23505') {
      const retry = await client.query(
        `SELECT chassis_id, model_id
         FROM vehicle_chassis
         WHERE model_id IS NOT DISTINCT FROM $1
           AND lower(btrim(chassis_code)) = lower(btrim($2))
         LIMIT 1`,
        [model_id ?? null, cleanCode]
      );
      if (retry.rows.length) {
        return {
          chassis_id: retry.rows[0].chassis_id,
          derived_model_id: retry.rows[0].model_id ?? null,
        };
      }
    }
    throw err;
  }
}

async function deriveVehicleEngineFitment(client, modelId, engineId, yearStart = null, yearEnd = null) {
  if (!modelId || !engineId) return;
  const ys = Number.isInteger(yearStart) ? yearStart : null;
  const ye = Number.isInteger(yearEnd) ? yearEnd : null;
  await client.query(
    `INSERT INTO vehicle_engine_fitment (model_id, engine_id, year_start, year_end)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (model_id, engine_id) DO UPDATE
     SET year_start = CASE
                        WHEN vehicle_engine_fitment.year_start IS NULL THEN EXCLUDED.year_start
                        WHEN EXCLUDED.year_start IS NULL THEN vehicle_engine_fitment.year_start
                        ELSE LEAST(vehicle_engine_fitment.year_start, EXCLUDED.year_start)
                      END,
         year_end   = CASE
                        WHEN vehicle_engine_fitment.year_end IS NULL THEN EXCLUDED.year_end
                        WHEN EXCLUDED.year_end IS NULL THEN vehicle_engine_fitment.year_end
                        ELSE GREATEST(vehicle_engine_fitment.year_end, EXCLUDED.year_end)
                      END`,
    [modelId, engineId, ys, ye]
  );
}

async function findApplication(client, makeId, modelId, engineId, chassisId = null) {
  const { rows } = await client.query(
    `SELECT application_id
     FROM application
     WHERE make_id IS NOT DISTINCT FROM $1
       AND model_id IS NOT DISTINCT FROM $2
       AND engine_id IS NOT DISTINCT FROM $3
       AND chassis_id IS NOT DISTINCT FROM $4
     ORDER BY application_id ASC
     LIMIT 1`,
    [makeId ?? null, modelId ?? null, engineId ?? null, chassisId ?? null]
  );
  return rows.length ? rows[0].application_id : null;
}

function enrichApplicationRow(row) {
  if (!row) return row;
  const modes = deriveIdentityAndQualifierModes(row);
  const isMakeOnly = row.make_id != null && row.model_id == null && row.engine_id == null && row.chassis_id == null;
  const isChassisOnlyWithoutModel = row.chassis_id != null && row.model_id == null;
  const approvalStatus = (isMakeOnly || isChassisOnlyWithoutModel || row.identity_status === 'needs_review')
    ? 'needs_review'
    : (row.approval_status || (row.identity_status === 'verified' ? 'approved' : 'needs_review'));
  return {
    ...row,
    approval_status: approvalStatus,
    identity_modes: modes.identity_modes,
  };
}

/**
 * Shared transactional helper to resolve make/model/chassis/engine and find or create an `application` row.
 * Used by `applicationRoutes`, `partApplicationRoutes`, and `partRoutes` so all write paths enforce
 * identical ID/name/parent validation (`H01`, `H02`, `H04`, `H12`, `H13`, `A13`–`A15`).
 */
async function resolveAndFindOrCreateApplication(client, payload = {}) {
  const flagCheck = validateNoClientVerificationFlags(payload);
  if (!flagCheck.valid) {
    throw httpError(
      422,
      'CLIENT_VERIFICATION_REJECTED',
      `Forbidden client verification fields: ${flagCheck.offendingKeys.join(', ')}`,
      { client_verification_rejected: true }
    );
  }

  let resolvedMakeId = await resolveMake(client, payload);
  const modelRes = await resolveModel(client, {
    model_id: payload.model_id,
    model: payload.model,
    make_id: resolvedMakeId,
  });
  let resolvedModelId = modelRes.model_id;
  if (resolvedMakeId == null && modelRes.derived_make_id != null) {
    resolvedMakeId = modelRes.derived_make_id;
  }

  const chassisRes = await resolveChassis(client, {
    chassis_id: payload.chassis_id,
    chassis: payload.chassis,
    model_id: resolvedModelId,
    generation: payload.generation,
    market: payload.market,
  });
  const resolvedChassisId = chassisRes.chassis_id;
  if (resolvedModelId == null && chassisRes.derived_model_id != null) {
    resolvedModelId = chassisRes.derived_model_id;
    const mRow = await client.query('SELECT make_id FROM vehicle_model WHERE model_id = $1', [resolvedModelId]);
    if (mRow.rows.length && resolvedMakeId == null) {
      resolvedMakeId = mRow.rows[0].make_id;
    }
  }

  const resolvedEngineId = await resolveEngine(client, payload);

  if (!resolvedMakeId && !resolvedModelId && !resolvedEngineId && !resolvedChassisId) {
    throw httpError(400, 'EMPTY_APPLICATION_SCOPE', 'At least one of make, model, chassis, or engine is required');
  }

  let applicationId = await findApplication(client, resolvedMakeId, resolvedModelId, resolvedEngineId, resolvedChassisId);
  let created = false;

  if (!applicationId) {
    const isMakeOnly = resolvedMakeId != null && resolvedModelId == null && resolvedEngineId == null && resolvedChassisId == null;
    const isChassisOnly = resolvedChassisId != null && resolvedModelId == null;
    const initialStatus = (isMakeOnly || isChassisOnly) ? 'needs_review' : 'legacy_unverified';

    await client.query('SAVEPOINT sp_create_application');
    try {
      const ins = await client.query(
        `INSERT INTO application (make_id, model_id, engine_id, chassis_id, identity_status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING application_id`,
        [resolvedMakeId, resolvedModelId, resolvedEngineId, resolvedChassisId, initialStatus]
      );
      await client.query('RELEASE SAVEPOINT sp_create_application');
      applicationId = ins.rows[0].application_id;
      created = true;
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT sp_create_application');
      if (err.code === '23505') {
        applicationId = await findApplication(client, resolvedMakeId, resolvedModelId, resolvedEngineId, resolvedChassisId);
      } else {
        throw err;
      }
    }
  }

  // Only derive vehicle_engine_fitment when explicitly confirmed or non-conflicting
  if (resolvedModelId && resolvedEngineId && payload.derive_model_engine !== false) {
    await deriveVehicleEngineFitment(
      client,
      resolvedModelId,
      resolvedEngineId,
      payload.year_start ?? null,
      payload.year_end ?? null
    );
  }

  const viewRes = await client.query(
    'SELECT * FROM application_view WHERE application_id = $1',
    [applicationId]
  );

  return {
    application_id: applicationId,
    created,
    row: enrichApplicationRow(viewRes.rows[0]),
    resolvedMakeId,
    resolvedModelId,
    resolvedChassisId,
    resolvedEngineId,
  };
}

// GET /api/applications
router.get('/applications', protect, hasPermission('applications:view'), async (req, res) => {
  const { search = '', make = '', model = '', sortBy, sortOrder = 'ASC' } = req.query;
  const { paginated, page, pageSize, offset, limit } = parsePaginationQuery(req.query);
  try {
    const params = [];
    const whereClauses = [];

    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      whereClauses.push(
        `(av.make ILIKE $${params.length} OR av.model ILIKE $${params.length} OR COALESCE(av.engine, '') ILIKE $${params.length} OR COALESCE(av.chassis, '') ILIKE $${params.length})`
      );
    }
    if (make) {
      params.push(make);
      whereClauses.push(`av.make = $${params.length}`);
    }
    if (model) {
      params.push(model);
      whereClauses.push(`av.model = $${params.length}`);
    }

    const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';
    const dir = String(sortOrder).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    let orderBy = `ORDER BY av.make ${dir} NULLS LAST, av.model ${dir} NULLS LAST, av.engine ${dir} NULLS LAST`;
    if (sortBy === 'make') orderBy = `ORDER BY av.make ${dir} NULLS LAST`;
    else if (sortBy === 'model') orderBy = `ORDER BY av.model ${dir} NULLS LAST`;
    else if (sortBy === 'engine') orderBy = `ORDER BY av.engine ${dir} NULLS LAST`;

    const baseQuery = `
      SELECT
        av.application_id,
        av.make,
        av.model,
        av.engine,
        av.make_id,
        av.model_id,
        av.engine_id,
        av.displacement_liters,
        av.fuel_type,
        av.chassis_id,
        av.chassis,
        av.identity_status,
        av.approval_status,
        av.row_version,
        COUNT(pa.part_id)::int AS linked_parts_count
      FROM application_view av
      LEFT JOIN part_application pa ON av.application_id = pa.application_id
      ${whereSql}
      GROUP BY av.application_id, av.make, av.model, av.engine, av.make_id, av.model_id, av.engine_id,
               av.displacement_liters, av.fuel_type, av.chassis_id, av.chassis, av.identity_status, av.approval_status, av.row_version
      ${orderBy}
    `;

    if (!paginated) {
      const { rows } = await db.query(baseQuery, params);
      return res.json(rows.map(enrichApplicationRow));
    }

    const countRes = await db.query(`SELECT COUNT(*)::int AS total FROM application_view av ${whereSql}`, params);
    const total = countRes.rows[0]?.total || 0;
    const pagedParams = [...params, limit, offset];
    const pagedQuery = `${baseQuery} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const { rows } = await db.query(pagedQuery, pagedParams);
    return res.json(paginatedResponse({ data: rows.map(enrichApplicationRow), page, pageSize, total }));
  } catch (err) {
    console.error('Error fetching applications:', err.message);
    res.status(500).send('Server Error');
  }
});

// GET /api/makes and GET /api/applications/makes
const getMakesHandler = async (_req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM vehicle_make ORDER BY make_name ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching makes:', err.message);
    res.status(500).send('Server Error');
  }
};
router.get('/makes', protect, hasPermission('applications:view'), getMakesHandler);
router.get('/applications/makes', protect, hasPermission('applications:view'), getMakesHandler);

// GET /api/makes/:makeId/models
router.get('/makes/:makeId/models', protect, hasPermission('applications:view'), async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM vehicle_model WHERE make_id = $1 ORDER BY model_name ASC',
      [req.params.makeId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching models for make:', err.message);
    res.status(500).send('Server Error');
  }
});

// GET /api/applications/models
router.get('/applications/models', protect, hasPermission('applications:view'), async (req, res) => {
  const { make_id, make } = req.query;
  try {
    let query = `
      SELECT vm.model_id, vm.make_id, vm.model_name, vm.display_shorthand, vm.identity_status, vmk.make_name
      FROM vehicle_model vm
      JOIN vehicle_make vmk ON vmk.make_id = vm.make_id
    `;
    const params = [];
    if (make_id) {
      params.push(Number(make_id));
      query += ` WHERE vm.make_id = $1`;
    } else if (make) {
      params.push(make);
      query += ` WHERE lower(btrim(vmk.make_name)) = lower(btrim($1))`;
    }
    query += ' ORDER BY vm.model_name ASC';
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching models:', err.message);
    res.status(500).send('Server Error');
  }
});

// PUT /api/applications/models/:modelId/shorthand
router.put('/applications/models/:modelId/shorthand', protect, hasPermission('applications:edit'), async (req, res) => {
  const modelId = Number(req.params.modelId);
  const { display_shorthand } = req.body || {};
  if (!Number.isInteger(modelId) || modelId <= 0) {
    return res.status(400).json({ message: 'Invalid modelId' });
  }
  if (typeof display_shorthand !== 'boolean') {
    return res.status(400).json({ message: 'display_shorthand boolean is required' });
  }
  try {
    const { rows } = await db.query(
      `UPDATE vehicle_model
       SET display_shorthand = $1
       WHERE model_id = $2
       RETURNING model_id, make_id, model_name, display_shorthand`,
      [display_shorthand, modelId]
    );
    if (!rows.length) {
      return res.status(404).json({ message: 'Vehicle model not found' });
    }
    taxonomyIndex.invalidate();
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating model shorthand:', err.message);
    res.status(500).send('Server Error');
  }
});

// GET /api/applications/chassis
router.get('/applications/chassis', protect, hasPermission('applications:view'), async (req, res) => {
  const { model_id } = req.query;
  try {
    const params = [];
    let query = `
      SELECT chassis_id, model_id, chassis_code, generation, year_start, year_end, market, identity_status
      FROM vehicle_chassis
    `;
    if (model_id) {
      params.push(Number(model_id));
      query += ' WHERE model_id = $1';
    }
    query += ' ORDER BY chassis_code ASC';
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching chassis:', err.message);
    res.status(500).send('Server Error');
  }
});

// GET /api/engines
router.get('/engines', protect, hasPermission('applications:view'), async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM engine ORDER BY engine_code ASC');
    res.json(rows);
  } catch (err) {
    console.error('Error fetching all engines:', err.message);
    res.status(500).send('Server Error');
  }
});

// PUT /api/engines/:id
router.put('/engines/:id', protect, hasPermission('applications:edit'), async (req, res) => {
  const { id } = req.params;
  const { displacement_liters, fuel_type } = req.body || {};
  const validLegacyFuels = ['diesel', 'gasoline', 'hybrid', 'mild_hybrid', 'electric', 'lpg', 'other'];
  if (fuel_type && !validLegacyFuels.includes(String(fuel_type).toLowerCase())) {
    return res.status(400).json({ message: 'Invalid fuel type' });
  }
  try {
    const { rows } = await db.query(
      'UPDATE engine SET displacement_liters = $1, fuel_type = $2 WHERE engine_id = $3 RETURNING *',
      [displacement_liters || null, fuel_type ? String(fuel_type).toLowerCase() : null, id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Engine not found' });
    taxonomyIndex.invalidate();
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating engine:', err.message);
    res.status(500).send('Server Error');
  }
});

// GET /api/models/:modelId/engines
router.get('/models/:modelId/engines', protect, hasPermission('applications:view'), async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT e.engine_id, e.engine_code, e.displacement_liters, e.fuel_type, vef.year_start, vef.year_end
       FROM vehicle_engine_fitment vef
       JOIN engine e ON e.engine_id = vef.engine_id
       WHERE vef.model_id = $1
       ORDER BY e.engine_code ASC`,
      [req.params.modelId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching model engines:', err.message);
    res.status(500).send('Server Error');
  }
});

// GET /api/applications/engines
router.get('/applications/engines', protect, hasPermission('applications:view'), async (req, res) => {
  const { model_id, make_id, search = '' } = req.query;
  try {
    const params = [];
    const where = [];
    let modelIdParamIdx = null;

    if (model_id) {
      params.push(Number(model_id));
      modelIdParamIdx = params.length;
    }

    let makeFilterClause = '';
    if (!model_id && make_id) {
      params.push(Number(make_id));
      const pIdx = params.length;
      makeFilterClause = `
        EXISTS (
          SELECT 1 FROM vehicle_engine_fitment vef2
          JOIN vehicle_model vm2 ON vm2.model_id = vef2.model_id
          WHERE vef2.engine_id = e.engine_id AND vm2.make_id = $${pIdx}
        )
        OR EXISTS (
          SELECT 1 FROM application a2
          WHERE a2.engine_id = e.engine_id AND a2.make_id = $${pIdx}
        )
      `;
    }

    if (search) {
      params.push(`%${search}%`);
      where.push(`(e.engine_code ILIKE $${params.length} OR COALESCE(e.notes, '') ILIKE $${params.length})`);
    }
    if (makeFilterClause) {
      where.push(`(${makeFilterClause})`);
    }

    const fitmentJoin = modelIdParamIdx
      ? `LEFT JOIN vehicle_engine_fitment vef ON vef.engine_id = e.engine_id AND vef.model_id = $${modelIdParamIdx}`
      : '';
    const isLinkedExpr = modelIdParamIdx ? '(vef.model_id IS NOT NULL) AS is_linked_to_model,' : 'false AS is_linked_to_model,';
    const yearCols = modelIdParamIdx ? 'vef.year_start, vef.year_end' : 'NULL::int AS year_start, NULL::int AS year_end';
    const orderBy = modelIdParamIdx
      ? 'ORDER BY (vef.model_id IS NOT NULL) DESC, e.engine_code ASC'
      : 'ORDER BY e.engine_code ASC';

    const sql = `
      SELECT
        e.engine_id,
        e.engine_code,
        e.displacement_liters,
        e.fuel_type,
        e.notes,
        e.identity_status,
        ${isLinkedExpr}
        ${yearCols}
      FROM engine e
      ${fitmentJoin}
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ${orderBy}
    `;
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching engines:', err.message);
    res.status(500).send('Server Error');
  }
});

// POST /api/applications
router.post('/applications', protect, hasPermission('applications:edit'), async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await resolveAndFindOrCreateApplication(client, req.body || {});
    await client.query('COMMIT');
    taxonomyIndex.invalidate();
    res.status(result.created ? 201 : 200).json(result.row);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) {
      return res.status(err.status).json({
        code: err.code || 'VALIDATION_ERROR',
        message: err.message,
        ...(err.details || {}),
      });
    }
    console.error('Error creating application:', err.message);
    res.status(500).send('Server Error');
  } finally {
    client.release();
  }
});

// PUT /api/applications/:id
router.put('/applications/:id', protect, hasPermission('applications:edit'), async (req, res) => {
  const { id } = req.params;
  const flagCheck = validateNoClientVerificationFlags(req.body);
  if (!flagCheck.valid) {
    return res.status(422).json({
      code: 'CLIENT_VERIFICATION_REJECTED',
      message: `Forbidden client verification fields: ${flagCheck.offendingKeys.join(', ')}`,
      client_verification_rejected: true,
    });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      'SELECT application_id, row_version FROM application WHERE application_id = $1 FOR UPDATE',
      [id]
    );
    if (!current.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Application not found' });
    }
    if (
      req.body?.expected_version != null &&
      Number(req.body.expected_version) !== Number(current.rows[0].row_version)
    ) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        code: 'STALE_APPLICATION',
        message: 'Application was modified by another request',
      });
    }

    let resolvedMakeId = await resolveMake(client, req.body || {});
    const modelRes = await resolveModel(client, {
      model_id: req.body?.model_id,
      model: req.body?.model,
      make_id: resolvedMakeId,
    });
    let resolvedModelId = modelRes.model_id;
    if (resolvedMakeId == null && modelRes.derived_make_id != null) {
      resolvedMakeId = modelRes.derived_make_id;
    }

    const chassisRes = await resolveChassis(client, {
      chassis_id: req.body?.chassis_id,
      chassis: req.body?.chassis,
      model_id: resolvedModelId,
    });
    const resolvedChassisId = chassisRes.chassis_id;
    if (resolvedModelId == null && chassisRes.derived_model_id != null) {
      resolvedModelId = chassisRes.derived_model_id;
    }

    const resolvedEngineId = await resolveEngine(client, req.body || {});

    if (!resolvedMakeId && !resolvedModelId && !resolvedEngineId && !resolvedChassisId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'At least one of make, model, chassis, or engine is required' });
    }

    const duplicate = await client.query(
      `SELECT application_id
       FROM application
       WHERE make_id IS NOT DISTINCT FROM $1
         AND model_id IS NOT DISTINCT FROM $2
         AND engine_id IS NOT DISTINCT FROM $3
         AND chassis_id IS NOT DISTINCT FROM $4
         AND application_id <> $5
       LIMIT 1`,
      [resolvedMakeId, resolvedModelId, resolvedEngineId, resolvedChassisId, id]
    );
    if (duplicate.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'An application with this Make, Model, Chassis, and Engine already exists.',
        existing_application_id: duplicate.rows[0].application_id,
      });
    }

    await client.query(
      'UPDATE application SET make_id = $1, model_id = $2, engine_id = $3, chassis_id = $4 WHERE application_id = $5',
      [resolvedMakeId, resolvedModelId, resolvedEngineId, resolvedChassisId, id]
    );

    if (resolvedModelId && resolvedEngineId) {
      await deriveVehicleEngineFitment(client, resolvedModelId, resolvedEngineId);
    }

    const view = await client.query(
      'SELECT * FROM application_view WHERE application_id = $1',
      [id]
    );
    await client.query('COMMIT');
    taxonomyIndex.invalidate();
    res.json(enrichApplicationRow(view.rows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) {
      return res.status(err.status).json({
        code: err.code || 'VALIDATION_ERROR',
        message: err.message,
        ...(err.details || {}),
      });
    }
    console.error('Error updating application:', err.message);
    res.status(500).send('Server Error');
  } finally {
    client.release();
  }
});

// DELETE /api/applications/:id
router.delete('/applications/:id', protect, hasPermission('applications:edit'), async (req, res) => {
  const { id } = req.params;
  try {
    const deleteOp = await db.query('DELETE FROM application WHERE application_id = $1', [id]);
    if (deleteOp.rowCount === 0) {
      return res.status(404).json({ message: 'Application not found' });
    }
    taxonomyIndex.invalidate();
    res.json({ message: 'Application deleted successfully' });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(400).json({ message: 'Cannot delete this application because it is linked to one or more parts.' });
    }
    console.error('Error deleting application:', err.message);
    res.status(500).send('Server Error');
  }
});

// POST /api/applications/:id/merge
router.post('/applications/:id/merge', protect, hasPermission('applications:edit'), async (req, res) => {
  const sourceId = parseInt(req.params.id, 10);
  const { targetApplicationId } = req.body;
  const targetId = parseInt(targetApplicationId, 10);

  if (!sourceId || !targetId) {
    return res.status(400).json({ message: 'Both source and target application IDs are required.' });
  }
  if (sourceId === targetId) {
    return res.status(400).json({ message: 'Cannot merge an application into itself.' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const checkRes = await client.query(
      'SELECT application_id FROM application WHERE application_id = ANY($1::int[])',
      [[sourceId, targetId]]
    );
    if (checkRes.rows.length < 2) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'One or both applications not found.' });
    }

    await client.query(
      `UPDATE part_application
       SET application_id = $1
       WHERE application_id = $2
         AND part_id NOT IN (
           SELECT part_id FROM part_application WHERE application_id = $1
         )`,
      [targetId, sourceId]
    );

    await client.query('DELETE FROM part_application WHERE application_id = $1', [sourceId]);

    await client.query(
      `UPDATE part_application_rule
       SET application_id = $1
       WHERE application_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM part_application_rule par2
           WHERE par2.part_id = part_application_rule.part_id
             AND par2.application_id = $1
             AND par2.effect = part_application_rule.effect
             AND par2.is_active = TRUE
         )`,
      [targetId, sourceId]
    );
    await client.query('DELETE FROM part_application_rule WHERE application_id = $1', [sourceId]);

    await client.query('DELETE FROM application WHERE application_id = $1', [sourceId]);

    await client.query('COMMIT');
    taxonomyIndex.invalidate();
    res.json({ message: 'Applications merged successfully.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error merging applications:', err.message);
    res.status(500).send('Server Error');
  } finally {
    client.release();
  }
});

router.resolveAndFindOrCreateApplication = resolveAndFindOrCreateApplication;
router.deriveVehicleEngineFitment = deriveVehicleEngineFitment;

module.exports = router;
module.exports.router = router;
