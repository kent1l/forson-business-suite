// Curated shorthand for rendering dense fitment text (Vehicle Fitment Phase 10).
// See docs/plans/2026-09-10_fitment-parsing-linking-display.md §10a.
//
// Loaded once from /applications/display-dictionary and held in memory. Two
// distinct jobs:
//
//   1. Preferred abbreviations for long canonical names ("UD Trucks / Nissan
//      Diesel" -> "UD"). These are curated per taxonomy row, NOT the alias
//      tables -- aliases map many input spellings onto one row and include
//      variants nobody would ever want on screen.
//
//   2. Which model names are ambiguous across makes. Dropping the make from
//      "Toyota Hilux 4D56" is safe because no other make has a Hilux, but this
//      catalog really does have a Ranger under both Ford and Hino, and a Rosa
//      under both Mitsubishi Fuso and Hino. Dropping the make on those would put
//      a wrong answer in front of someone at the counter, so the server tells us
//      which names to leave alone.
//
// Everything here is presentation-only and never sent back to the server.
//
// The dictionary is optional by design: until it loads, every lookup returns the
// full name and every model is treated as ambiguous, so the UI degrades to the
// long-but-correct form rather than to a wrong one.

// Imported lazily inside loadDisplayDictionary for the same reason as
// applicationCache: it keeps this module loadable outside Vite so the lookup
// rules can be unit-tested.

const state = {
    loaded: false,
    loading: null,
    makes: {},
    models: {},
    engines: {},
    ambiguousModels: new Set(),
};

const norm = (value) => String(value ?? '').trim().toLowerCase();

export const loadDisplayDictionary = async () => {
    if (state.loaded) return state;
    if (state.loading) return state.loading;

    state.loading = (async () => {
        try {
            const { default: api } = await import('../api');
            const { data } = await api.get('/applications/display-dictionary');
            state.makes = {};
            state.models = {};
            state.engines = {};
            for (const [full, short] of Object.entries(data?.makes || {})) state.makes[norm(full)] = short;
            for (const [full, short] of Object.entries(data?.models || {})) state.models[norm(full)] = short;
            for (const [full, short] of Object.entries(data?.engines || {})) state.engines[norm(full)] = short;
            state.ambiguousModels = new Set((data?.ambiguousModels || []).map(norm));
        } catch {
            // A missing dictionary must not break rendering -- fall back to full
            // names, and keep every model ambiguous so no make is dropped.
            state.makes = {};
            state.models = {};
            state.engines = {};
            state.ambiguousModels = null;
        } finally {
            state.loaded = true;
            state.loading = null;
        }
        return state;
    })();

    return state.loading;
};

export const shortMake = (name) => (name ? state.makes[norm(name)] || name : name);
export const shortModel = (name) => (name ? state.models[norm(name)] || name : name);
export const shortEngine = (code) => (code ? state.engines[norm(code)] || code : code);

/**
 * Whether this model name needs its make kept alongside it. Returns true when
 * the dictionary has not loaded (or failed), so the cautious, longer form is
 * always the fallback.
 */
export const modelNeedsMake = (modelName) => {
    if (!modelName) return true;
    if (!state.loaded || state.ambiguousModels === null) return true;
    return state.ambiguousModels.has(norm(modelName));
};

export const isDictionaryLoaded = () => state.loaded && state.ambiguousModels !== null;

// Test seam: lets the unit tests exercise the lookup rules without a network.
export const __setDictionaryForTests = ({ makes = {}, models = {}, engines = {}, ambiguousModels = [] }) => {
    state.makes = Object.fromEntries(Object.entries(makes).map(([k, v]) => [norm(k), v]));
    state.models = Object.fromEntries(Object.entries(models).map(([k, v]) => [norm(k), v]));
    state.engines = Object.fromEntries(Object.entries(engines).map(([k, v]) => [norm(k), v]));
    state.ambiguousModels = new Set(ambiguousModels.map(norm));
    state.loaded = true;
};

export const __resetDictionaryForTests = () => {
    state.loaded = false;
    state.loading = null;
    state.makes = {};
    state.models = {};
    state.engines = {};
    state.ambiguousModels = new Set();
};
