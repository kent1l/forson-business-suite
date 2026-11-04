'use strict';

// In-memory vehicle taxonomy index (Vehicle Fitment Phase 7 + Phase 1/2 taxonomy_version).

const { lookupKey } = require('./engineCodeGrammar');

const TTL_MS = 10 * 60 * 1000;

let cache = null;
let loadedAt = 0;
let inflight = null;

/**
 * Key for make and model names: case, spacing and punctuation are cosmetic
 * here, so `Hi-Lux`, `hi lux` and `HILUX` all collapse together, as do
 * `L 300` and `L300`.
 */
function nameKey(name) {
  if (name == null) return '';
  return String(name).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function pushTo(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

async function fetchTaxonomy() {
  const db = require('../db');
  const safeQuery = async (sql, fallbackSql = null) => {
    try {
      const res = await db.query(sql);
      return res.rows;
    } catch (err) {
      if (fallbackSql && err && (err.code === '42703' || err.code === '42P01')) {
        const res2 = await db.query(fallbackSql);
        return res2.rows;
      }
      if (err && (err.code === '42703' || err.code === '42P01')) return [];
      throw err;
    }
  };

  const [
    makes,
    models,
    engines,
    chassis,
    makeAliases,
    modelAliases,
    engineAliases,
    modelEnginePairs,
    metaRows,
  ] = await Promise.all([
    safeQuery(
      'SELECT make_id, make_name, display_short, identity_status FROM vehicle_make ORDER BY make_name',
      'SELECT make_id, make_name, display_short FROM vehicle_make ORDER BY make_name'
    ),
    safeQuery(
      `SELECT vm.model_id, vm.model_name, vm.display_short, vm.make_id, mk.make_name, vm.identity_status
       FROM vehicle_model vm
       JOIN vehicle_make mk ON mk.make_id = vm.make_id
       ORDER BY mk.make_name, vm.model_name`,
      `SELECT vm.model_id, vm.model_name, vm.display_short, vm.make_id, mk.make_name
       FROM vehicle_model vm
       JOIN vehicle_make mk ON mk.make_id = vm.make_id
       ORDER BY mk.make_name, vm.model_name`
    ),
    safeQuery(
      'SELECT engine_id, engine_code, display_short, displacement_liters, fuel_type, identity_status FROM engine ORDER BY engine_code',
      'SELECT engine_id, engine_code, display_short, displacement_liters, fuel_type FROM engine ORDER BY engine_code'
    ),
    safeQuery(
      'SELECT chassis_id, model_id, chassis_code, generation, year_start, year_end, market, identity_status FROM vehicle_chassis ORDER BY chassis_code'
    ),
    safeQuery(
      "SELECT make_id, alias_text, alias_key, status FROM vehicle_make_alias WHERE COALESCE(status, 'approved') = 'approved'",
      'SELECT make_id, alias_text FROM vehicle_make_alias'
    ),
    safeQuery(
      "SELECT model_id, make_id, alias_text, alias_key, status FROM vehicle_model_alias WHERE COALESCE(status, 'approved') = 'approved'",
      'SELECT model_id, alias_text FROM vehicle_model_alias'
    ),
    safeQuery(
      "SELECT engine_id, alias_text, alias_key, status FROM engine_alias WHERE COALESCE(status, 'approved') = 'approved'",
      'SELECT engine_id, alias_text FROM engine_alias'
    ),
    safeQuery(
      `SELECT DISTINCT model_id, engine_id
       FROM application
       WHERE model_id IS NOT NULL AND engine_id IS NOT NULL
       UNION
       SELECT DISTINCT model_id, engine_id
       FROM vehicle_engine_fitment
       WHERE model_id IS NOT NULL AND engine_id IS NOT NULL`,
      `SELECT DISTINCT model_id, engine_id
       FROM application
       WHERE model_id IS NOT NULL AND engine_id IS NOT NULL`
    ),
    safeQuery('SELECT taxonomy_version FROM fitment_taxonomy_meta LIMIT 1'),
  ]);

  const taxonomyVersion = metaRows && metaRows[0] && metaRows[0].taxonomy_version != null
    ? Number(metaRows[0].taxonomy_version)
    : 1;

  return {
    makes,
    models,
    engines,
    chassis,
    makeAliases,
    modelAliases,
    engineAliases,
    modelEnginePairs,
    taxonomyVersion,
  };
}

/**
 * Builds the lookup structures. Exported separately from the loader so tests
 * (and the parser's own fixtures) can construct an index from literal rows
 * without touching a database.
 */
function buildIndex(raw = {}) {
  const makes = raw.makes || [];
  const models = raw.models || [];
  const engines = raw.engines || [];
  const chassis = raw.chassis || [];
  const makeAliases = (raw.makeAliases || []).filter((a) => !a.status || a.status === 'approved');
  const modelAliases = (raw.modelAliases || []).filter((a) => !a.status || a.status === 'approved');
  const engineAliases = (raw.engineAliases || []).filter((a) => !a.status || a.status === 'approved');
  const modelEnginePairs = raw.modelEnginePairs || raw.modelEngines || [];

  const makesById = new Map(makes.map((m) => [m.make_id, m]));
  const modelsById = new Map(models.map((m) => [m.model_id, m]));
  const enginesById = new Map(engines.map((e) => [e.engine_id, e]));
  const chassisById = new Map(chassis.map((c) => [c.chassis_id, c]));

  const makesByKey = new Map();
  for (const m of makes) pushTo(makesByKey, nameKey(m.make_name), m);
  for (const a of makeAliases) {
    const target = makesById.get(a.make_id);
    if (target) pushTo(makesByKey, nameKey(a.alias_text), target);
  }

  const modelsByKey = new Map();
  for (const m of models) pushTo(modelsByKey, nameKey(m.model_name), m);
  for (const a of modelAliases) {
    const target = modelsById.get(a.model_id);
    if (target) pushTo(modelsByKey, nameKey(a.alias_text), target);
  }

  const enginesByKey = new Map();
  for (const e of engines) pushTo(enginesByKey, lookupKey(e.engine_code), e);
  for (const a of engineAliases) {
    const target = enginesById.get(a.engine_id);
    if (target) pushTo(enginesByKey, lookupKey(a.alias_text), target);
  }

  const enginesByExactCode = new Map();
  for (const e of engines) pushTo(enginesByExactCode, String(e.engine_code).toUpperCase().trim(), e);

  const isBareDisplacementCode = (code) => /^\d+(\.\d+)?\s*L?$/i.test(String(code).trim());

  const engineCodeTokens = [
    ...new Set([
      ...engines.map((e) => String(e.engine_code).trim()),
      ...engineAliases.map((a) => String(a.alias_text).trim()),
    ]),
  ]
    .filter(Boolean)
    .filter((code) => !isBareDisplacementCode(code))
    .sort((a, b) => b.length - a.length);

  const enginesByNameKey = new Map();
  for (const e of engines) pushTo(enginesByNameKey, nameKey(e.engine_code), e);
  for (const a of engineAliases) {
    const target = enginesById.get(a.engine_id);
    if (target) pushTo(enginesByNameKey, nameKey(a.alias_text), target);
  }

  const modelNameTokens = [...new Set(models.map((m) => String(m.model_name).trim()))]
    .concat(modelAliases.map((a) => String(a.alias_text).trim()))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  const makeNameTokens = [...new Set(makes.map((m) => String(m.make_name).trim()))]
    .concat(makeAliases.map((a) => String(a.alias_text).trim()))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  const modelEngines = new Map();
  for (const pair of modelEnginePairs) {
    if (!modelEngines.has(pair.model_id)) modelEngines.set(pair.model_id, new Set());
    modelEngines.get(pair.model_id).add(pair.engine_id);
  }

  // Compatibility lower-case map views for fitmentRuleSchema.validateAtomicAliasText
  const makeByNameKey = new Map();
  for (const [k, v] of makesByKey.entries()) {
    makeByNameKey.set(k.toLowerCase(), v[0]);
  }
  const modelsByNameKey = new Map();
  for (const [k, v] of modelsByKey.entries()) {
    modelsByNameKey.set(k.toLowerCase(), v);
  }

  return {
    makes,
    models,
    engines,
    chassis,
    makeAliases,
    modelAliases,
    engineAliases,
    taxonomyVersion: Number(raw.taxonomyVersion) || 1,
    modelEngines,
    makesById,
    modelsById,
    enginesById,
    chassisById,
    makesByKey,
    modelsByKey,
    enginesByKey,
    enginesByExactCode,
    enginesByNameKey,
    engineCodeTokens,
    makeNameTokens,
    modelNameTokens,
    makeByNameKey,
    modelsByNameKey,
  };
}

async function fetchDbTaxonomyVersion() {
  try {
    const db = require('../db');
    const res = await db.query('SELECT taxonomy_version FROM fitment_taxonomy_meta LIMIT 1');
    if (res.rows && res.rows[0] && res.rows[0].taxonomy_version != null) {
      return Number(res.rows[0].taxonomy_version);
    }
  } catch (_err) {
    // Ignore when table is absent or in unit tests
  }
  return null;
}

async function getIndex({ force = false } = {}) {
  if (!force && cache && Date.now() - loadedAt < TTL_MS) {
    const dbVer = await fetchDbTaxonomyVersion();
    if (dbVer == null || dbVer === cache.taxonomyVersion) {
      return cache;
    }
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const raw = await fetchTaxonomy();
      cache = buildIndex(raw);
      loadedAt = Date.now();
      return cache;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Call after any write to a make/model/engine/alias row. */
function invalidate() {
  cache = null;
  loadedAt = 0;
}

module.exports = {
  getIndex,
  invalidate,
  buildIndex,
  buildIndexFromData: buildIndex,
  nameKey,
  TTL_MS,
};
