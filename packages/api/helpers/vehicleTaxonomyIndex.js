// In-memory vehicle taxonomy index (Vehicle Fitment Phase 7).
// See docs/plans/2026-09-10_fitment-parsing-linking-display.md §7.1.
//
// The taxonomy is small and changes rarely (20 makes / 155 models / 271 engines
// at the time of writing), but before this module every fitment parse issued
// three queries for it and then serialised the whole thing into an LLM prompt,
// so both latency and token cost scaled with catalog size rather than with the
// complexity of what the staff member actually typed. Loading it once and
// keeping it in process removes that from both the local and the AI path.
//
// The index is invalidated explicitly whenever the taxonomy is written to, with
// a TTL as a backstop in case a write path is ever missed (a stale index would
// otherwise degrade parsing silently and be very hard to notice).

const { lookupKey } = require('./engineCodeGrammar');

// `db` is required lazily rather than at module load so that buildIndex() and
// nameKey() stay importable by the pure parser tests without opening a pool.

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
    const [makes, models, engines, makeAliases, modelAliases, engineAliases, modelEnginePairs] = await Promise.all([
        db.query('SELECT make_id, make_name FROM vehicle_make ORDER BY make_name'),
        db.query(`
            SELECT vm.model_id, vm.model_name, vm.make_id, mk.make_name
            FROM vehicle_model vm
            JOIN vehicle_make mk ON mk.make_id = vm.make_id
            ORDER BY mk.make_name, vm.model_name
        `),
        db.query('SELECT engine_id, engine_code, displacement_liters, fuel_type FROM engine ORDER BY engine_code'),
        db.query('SELECT make_id, alias_text FROM vehicle_make_alias'),
        db.query('SELECT model_id, alias_text FROM vehicle_model_alias'),
        db.query('SELECT engine_id, alias_text FROM engine_alias'),
        // Which engines this catalog has actually seen fitted to which models.
        // Used only to disambiguate, never to invent a fitment.
        db.query(`
            SELECT DISTINCT model_id, engine_id
            FROM application
            WHERE model_id IS NOT NULL AND engine_id IS NOT NULL
        `),
    ]);
    return {
        makes: makes.rows,
        models: models.rows,
        engines: engines.rows,
        makeAliases: makeAliases.rows,
        modelAliases: modelAliases.rows,
        engineAliases: engineAliases.rows,
        modelEnginePairs: modelEnginePairs.rows,
    };
}

/**
 * Builds the lookup structures. Exported separately from the loader so tests
 * (and the parser's own fixtures) can construct an index from literal rows
 * without touching a database.
 */
function buildIndex(raw) {
    const makesById = new Map(raw.makes.map(m => [m.make_id, m]));
    const modelsById = new Map(raw.models.map(m => [m.model_id, m]));
    const enginesById = new Map(raw.engines.map(e => [e.engine_id, e]));

    const makesByKey = new Map();
    for (const m of raw.makes) pushTo(makesByKey, nameKey(m.make_name), m);
    for (const a of raw.makeAliases) {
        const target = makesById.get(a.make_id);
        if (target) pushTo(makesByKey, nameKey(a.alias_text), target);
    }

    const modelsByKey = new Map();
    for (const m of raw.models) pushTo(modelsByKey, nameKey(m.model_name), m);
    for (const a of raw.modelAliases) {
        const target = modelsById.get(a.model_id);
        if (target) pushTo(modelsByKey, nameKey(a.alias_text), target);
    }

    // Engine keys can legitimately be multi-valued: an alias such as the
    // retired family code `4D55/56/65` deliberately fans out to all three of
    // its member engines. A key that resolves to more than one engine is not an
    // error -- it is a set the reviewer chooses from.
    const enginesByKey = new Map();
    for (const e of raw.engines) pushTo(enginesByKey, lookupKey(e.engine_code), e);
    for (const a of raw.engineAliases) {
        const target = enginesById.get(a.engine_id);
        if (target) pushTo(enginesByKey, lookupKey(a.alias_text), target);
    }

    // Exact (unnormalized) engine codes, so a code typed verbatim always wins
    // before any normalization is attempted.
    const enginesByExactCode = new Map();
    for (const e of raw.engines) pushTo(enginesByExactCode, String(e.engine_code).toUpperCase().trim(), e);

    // Model names, longest first, for greedy multi-word span matching
    // ("Grand Vitara" must beat "Grand").
    const modelNameTokens = [...new Set(raw.models.map(m => String(m.model_name).trim()))]
        .concat(raw.modelAliases.map(a => String(a.alias_text).trim()))
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);

    const makeNameTokens = [...new Set(raw.makes.map(m => String(m.make_name).trim()))]
        .concat(raw.makeAliases.map(a => String(a.alias_text).trim()))
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);

    // Disambiguation prior: which engines this catalog has actually recorded
    // against which models. When a staff member writes a bare displacement
    // ("Hilux 2.5") there may be several 2.5L engines in the taxonomy; the one
    // already fitted to that model is overwhelmingly the intended one. This is
    // knowledge the system has and a language model does not.
    const modelEngines = new Map();
    for (const pair of (raw.modelEnginePairs || [])) {
        if (!modelEngines.has(pair.model_id)) modelEngines.set(pair.model_id, new Set());
        modelEngines.get(pair.model_id).add(pair.engine_id);
    }

    return {
        makes: raw.makes,
        models: raw.models,
        engines: raw.engines,
        modelEngines,
        makesById,
        modelsById,
        enginesById,
        makesByKey,
        modelsByKey,
        enginesByKey,
        enginesByExactCode,
        makeNameTokens,
        modelNameTokens,
    };
}

async function getIndex() {
    const fresh = cache && (Date.now() - loadedAt) < TTL_MS;
    if (fresh) return cache;
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

module.exports = { getIndex, invalidate, buildIndex, nameKey, TTL_MS };
