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
        collapseDuplicateEngines = false,
        cache = true,
        fallbackUnknown = '',
    } = merged;

    const appsArray = Array.isArray(applications) ? applications : [applications];

    const cacheKeyBase = cache ? JSON.stringify({ a: appsArray.map(a => (typeof a === 'object' ? a.application_id || a : a)), o: { separator, multiline, maxApplications, truncateMode, truncateChars, truncateWords, logicalStrategy, includeYears, includeEngine, collapseDuplicateEngines } }) : null;
    if (cache && cacheKeyBase) {
        const hit = getCache(cacheKeyBase);
        if (hit) return hit;
    }

    // 1. Map to individual display strings
    let formattedList = appsArray.map(a => formatSingleApplication(a, { includeYears, includeEngine })).filter(Boolean);

    // 2. Collapse duplicate engines (same make+model) if requested
    if (collapseDuplicateEngines) {
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
