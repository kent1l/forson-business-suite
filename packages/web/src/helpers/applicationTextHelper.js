/**
 * Format a single application object into a display string
 * @param {Object} application - The application object
 * @returns {string} Formatted application text
 */
import { getApplication } from './applicationCache';
import { getPreset } from './applicationDisplayPresets';

// Simple LRU cache for formatted results to avoid recomputation on identical inputs
const FORMAT_CACHE_LIMIT = 100;
const formatCache = new Map(); // key -> string

const setCache = (key, value) => {
    if (formatCache.has(key)) {
        formatCache.delete(key); // refresh order
    }
    formatCache.set(key, value);
    if (formatCache.size > FORMAT_CACHE_LIMIT) {
        // delete oldest
        const firstKey = formatCache.keys().next().value;
        formatCache.delete(firstKey);
    }
};

const getCache = (key) => formatCache.get(key);

const formatSingleApplication = (application, granularOptions = {}) => {
    if (!application) return '';

    // If it's a numeric id (number) try to resolve via cache
    if (typeof application === 'number') {
        const resolved = getApplication(application);
        if (resolved) return formatSingleApplication(resolved);
        return String(application);
    }

    // If it's a numeric string e.g. "7" try to resolve via cache
    if (typeof application === 'string') {
        const trimmed = application.trim();
        if (/^\d+$/.test(trimmed)) {
            const resolved = getApplication(parseInt(trimmed, 10));
            if (resolved) return formatSingleApplication(resolved);
            return trimmed;
        }
        return application;
    }

    if (typeof application === 'object') {
        const { includeYears = true, includeEngine = true } = granularOptions;
        // If there's a pre-formatted display property, use it
        if (application.display) return application.display;

        // If it only has application_id (from backend normalization), return id string (will be enriched later if cache loaded)
        if (application.application_id && !(application.make || application.model || application.engine)) {
            const resolved = getApplication(application.application_id);
            if (resolved) return formatSingleApplication(resolved, granularOptions);
            return String(application.application_id);
        }

        const parts = [application.make, application.model];
        if (includeEngine) parts.push(application.engine);
        let base = parts.filter(Boolean).join(' ').trim();

        if (includeYears && (application.year_start || application.year_end)) {
            const years = [application.year_start, application.year_end].filter(Boolean).join('-');
            if (years) base = `${base} (${years})`;
        }
        return base.trim();
    }
    return String(application);
};

/**
 * Formats application data into a display string
 * @param {Array|Object|string} applications - The applications data to format
 * @param {Object} options - Formatting options
 * @param {string} options.separator - Separator between multiple applications (default: ', ')
 * @param {boolean} options.truncate - Whether to truncate the output (default: false)
 * @param {number} options.maxLength - Maximum length before truncation (default: 100)
 * @returns {string} Formatted applications text
 */
export const formatApplicationText = (applications, options = {}) => {
    if (!applications) return '';

    // Apply preset if style provided
    let merged = { ...options };
    if (options.style) {
        merged = { ...getPreset(options.style), ...options };
    }

    const {
        separator = ', ',
        multiline = false,
        maxApplications = null,
        showMoreTemplate = (hidden) => `(+${hidden} more)`,
        truncateMode = 'none', // 'none' | 'chars' | 'words' | 'logical'
        truncateChars = 100,
        truncateWords = 15,
        logicalStrategy = 'apps-then-more', // or 'first-full-then-initials'
        includeYears = true,
    includeEngine = true,
    collapseDuplicateEngines = false, // deprecated in favor of mergeModelsByMake
    mergeModelsByMake = false,
        cache = true,
        fallbackUnknown = '',
    } = merged;

    const appsArray = Array.isArray(applications) ? applications : [applications];

    const cacheKeyBase = cache ? JSON.stringify({ a: appsArray.map(a => (typeof a === 'object' ? a.application_id || a : a)), o: { separator, multiline, maxApplications, truncateMode, truncateChars, truncateWords, logicalStrategy, includeYears, includeEngine, collapseDuplicateEngines } }) : null;
    if (cache && cacheKeyBase) {
        const hit = getCache(cacheKeyBase);
        if (hit) return hit;
    }

    // 1. Optional hierarchical merging by make
    let formattedList;
    if (mergeModelsByMake) {
        const byMake = new Map();
        appsArray.forEach(a => {
            if (!a || typeof a !== 'object') return; // non-object fallback handled later
            const make = (a.make || '').trim();
            const model = (a.model || '').trim();
            const engine = (a.engine || '').trim();
            const yearStart = a.year_start || null;
            const yearEnd = a.year_end || null;
            if (!make && !model) return; // insufficient data
            if (!byMake.has(make)) byMake.set(make, []);
            byMake.get(make).push({ make, model, engine, yearStart, yearEnd, raw: a });
        });

        const makeSegments = [];
        byMake.forEach((entries, make) => {
            // Group by model first
            const byModel = new Map();
            entries.forEach(e => {
                if (!byModel.has(e.model)) byModel.set(e.model, []);
                byModel.get(e.model).push(e);
            });
            // Alphabetical models (approved tweak #1)
            const modelKeys = Array.from(byModel.keys()).sort((a,b) => a.localeCompare(b));
            const modelParts = modelKeys.map(modelName => {
                const modelEntries = byModel.get(modelName);
                // Collect engines (always show engines when includeEngine=true approval #2 option 1)
                let enginePart = '';
                if (includeEngine) {
                    const engines = Array.from(new Set(modelEntries.map(me => me.engine).filter(Boolean))).sort();
                    if (engines.length === 1) enginePart = ` (${engines[0]})`;
                    else if (engines.length > 1) enginePart = ` (${engines.join('/')})`;
                }
                // Years handling (#3a): if differing ranges per model, we append per model; shared range appended later at make-level
                const ranges = Array.from(new Set(modelEntries.map(me => (me.yearStart || me.yearEnd) ? `${me.yearStart || ''}-${me.yearEnd || ''}` : '').filter(Boolean)));
                let yearPart = '';
                // We'll decide shared vs per-model after computing all models
                return { modelName, enginePart, ranges, rawEntries: modelEntries, placeholder: null, yearPart };
            });

            // Determine if all models share identical single year range
            const allRanges = modelParts.map(mp => mp.ranges.length === 1 ? mp.ranges[0] : null);
            const uniqueShared = Array.from(new Set(allRanges.filter(Boolean)));
            let sharedYearRange = null;
            if (uniqueShared.length === 1 && allRanges.every(r => r === uniqueShared[0])) {
                sharedYearRange = uniqueShared[0];
            }

            // Inject per-model year parts if no shared range
            modelParts.forEach(mp => {
                if (!sharedYearRange) {
                    if (mp.ranges.length === 1) {
                        mp.yearPart = mp.ranges[0] ? `(${mp.ranges[0].replace(/^-|-$|--/g,'').replace(/(^-|-$)/g,'')})` : '';
                    } else if (mp.ranges.length > 1) {
                        // Multiple distinct ranges; join compactly
                        mp.yearPart = `(${mp.ranges.join('|')})`;
                    }
                }
            });

            // Compression threshold (#5): if more than 4 models, show first 3 then +X more
            const MODEL_THRESHOLD = 4; // approved
            let visibleModels = modelParts;
            let tailNote = '';
            if (modelParts.length > MODEL_THRESHOLD) {
                const hidden = modelParts.length - 3;
                visibleModels = modelParts.slice(0,3);
                tailNote = ` (+${hidden} more)`;
            }

            const modelsMerged = visibleModels.map(mp => {
                const base = mp.modelName || '';
                return `${base}${mp.enginePart || ''}${mp.yearPart ? mp.yearPart : ''}`.trim();
            }).filter(Boolean).join('/');

            let segment = modelsMerged;
            if (make) segment = `${make} ${modelsMerged}`.trim();
            if (sharedYearRange && includeYears) {
                const yr = sharedYearRange.replace(/^-|-$|--/g,'').replace(/(^-|-$)/g,'');
                if (yr) segment = `${segment} (${yr})`;
            }
            if (tailNote) segment += tailNote;
            makeSegments.push(segment.trim());
        });

        // Fallback: if merging yields nothing (e.g., all primitives) just map normally
        if (makeSegments.length) {
            formattedList = makeSegments;
        } else {
            formattedList = appsArray.map(a => formatSingleApplication(a, { includeYears, includeEngine })).filter(Boolean);
        }
    } else {
        // Non-merge path
        formattedList = appsArray.map(a => formatSingleApplication(a, { includeYears, includeEngine })).filter(Boolean);
    }

    // 2. Collapse duplicate engines (same make+model) if requested
    if (!mergeModelsByMake && collapseDuplicateEngines) {
        const map = new Map();
        appsArray.forEach((a, idx) => {
            if (!a || typeof a !== 'object') return;
            const key = `${a.make || ''}::${a.model || ''}`;
            if (!key.trim()) return;
            if (!map.has(key)) map.set(key, { engines: new Set(), base: { make: a.make, model: a.model }, idxs: [] });
            if (a.engine) map.get(key).engines.add(a.engine);
            map.get(key).idxs.push(idx);
        });
        if (map.size > 0) {
            // Rebuild list with collapsed forms
            const used = new Set();
            const rebuilt = [];
            appsArray.forEach((a, idx) => {
                if (used.has(idx)) return;
                if (a && typeof a === 'object') {
                    const key = `${a.make || ''}::${a.model || ''}`;
                    const group = map.get(key);
                    if (group && group.idxs.length > 1) {
                        group.idxs.forEach(i => used.add(i));
                        const engines = Array.from(group.engines.values());
                        const enginePart = engines.length ? ` (${engines.join(' / ')})` : '';
                        rebuilt.push(`${[a.make, a.model].filter(Boolean).join(' ')}${enginePart}`.trim());
                        return;
                    }
                }
                rebuilt.push(formattedList[idx]);
            });
            formattedList = rebuilt.filter(Boolean);
        }
    }

    // 3. Logical truncation strategies
    const applyLogical = (list) => {
        if (!maxApplications || list.length <= maxApplications) return list.join(multiline ? '\n' : separator);
        if (logicalStrategy === 'apps-then-more') {
            const visible = list.slice(0, maxApplications);
            const hidden = list.length - maxApplications;
            return `${visible.join(multiline ? '\n' : separator)} ${showMoreTemplate(hidden)}`;
        }
        if (logicalStrategy === 'first-full-then-initials') {
            if (list.length === 0) return '';
            const [first, ...rest] = list;
            const initials = rest.map(s => s.split(/\s+/).map(p => p[0]).join('')).join(separator.trim());
            return initials ? `${first}${multiline ? '\n' : separator}${initials}` : first;
        }
        // custom: if function provided
        if (typeof logicalStrategy === 'function') {
            return logicalStrategy(list, { separator: multiline ? '\n' : separator, showMoreTemplate });
        }
        return list.join(multiline ? '\n' : separator);
    };

    let output;
    if (truncateMode === 'logical' && maxApplications) {
        output = applyLogical(formattedList);
    } else {
        output = formattedList.join(multiline ? '\n' : separator);
    }

    // 4. Truncate by chars or words if specified (applied after logical)
    if (truncateMode === 'chars') {
        if (output.length > truncateChars) {
            // avoid cutting mid-word
            let truncated = output.slice(0, truncateChars);
            const lastSpace = truncated.lastIndexOf(' ');
            if (lastSpace > truncateChars * 0.6) truncated = truncated.slice(0, lastSpace);
            output = `${truncated.trim()}...`;
        }
    } else if (truncateMode === 'words') {
        const words = output.split(/\s+/);
        if (words.length > truncateWords) {
            output = `${words.slice(0, truncateWords).join(' ')}...`;
        }
    }

    if (!output && fallbackUnknown) output = fallbackUnknown;

    if (cache && cacheKeyBase) setCache(cacheKeyBase, output);
    return output;
};

export default formatApplicationText;
