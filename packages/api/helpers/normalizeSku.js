/**
 * Normalizes SKUs and part numbers for consistent search matching.
 * Strips non-alphanumeric chars, collapses spaces, converts to lowercase.
 * @param {string} input - The SKU or part number to normalize
 * @returns {string} Normalized string (alphanumeric lowercase)
 */
const normalizeForSearch = (input) => {
    if (!input || typeof input !== 'string') return '';
    return input.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
};

/**
 * Minimum length required for normalized exact matching.
 * Prevents over-broad matches on very short strings.
 */
const EXACT_MATCH_MIN_LENGTH = 3;
const TOKEN_MIN_LENGTH = 2;

/**
 * Normalize an array of strings using the same rules.
 * Filters out empty/invalid entries.
 * @param {string[]} inputs - Array of strings to normalize
 * @returns {string[]} Array of normalized strings
 */
const normalizeArray = (inputs) => {
    if (!Array.isArray(inputs)) return [];
    return inputs
        .map(s => normalizeForSearch(s))
        .filter(s => s && s.length >= EXACT_MATCH_MIN_LENGTH);
};

/**
 * Expands a SKU, part number, or identifier into normalized search tokens
 * covering spaced, hyphenated, collapsed, prefix/suffix, and numeric forms.
 * Example: "VK-9001" / "VK9001" -> ["vk9001", "vk", "9001"].
 * @param {string} input
 * @returns {string[]}
 */
const expandIdentifierTokens = (input) => {
    if (!input || typeof input !== 'string') return [];
    const tokens = new Set();
    const addToken = (tok) => {
        if (tok && tok.length >= TOKEN_MIN_LENGTH) {
            tokens.add(tok);
        }
    };

    const full = normalizeForSearch(input);
    addToken(full);

    const segments = input
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);

    for (const seg of segments) {
        addToken(seg);
    }

    if (segments.length > 1) {
        const pairLimit = Math.min(segments.length - 1, 10);
        for (let i = 0; i < pairLimit; i++) {
            addToken(segments[i] + segments[i + 1]);
            if (i + 2 < segments.length) {
                addToken(segments[i] + segments[i + 1] + segments[i + 2]);
            }
        }
        if (segments.length <= 10) {
            for (let i = 1; i < segments.length; i++) {
                addToken(segments.slice(i).join(''));
            }
        }
    }

    const decomposeRuns = (str) => {
        if (!str) return;
        const runs = str.match(/[a-z]+|\d+/g) || [];
        for (const run of runs) {
            addToken(run);
            if (/^0+\d{3,}$/.test(run)) {
                addToken(run.replace(/^0+/, ''));
            }
        }
        if (runs.length > 1 && runs.length <= 10) {
            for (let i = 1; i < runs.length; i++) {
                addToken(runs.slice(i).join(''));
            }
            for (let j = 2; j < runs.length; j++) {
                addToken(runs.slice(0, j).join(''));
            }
        }
    };

    decomposeRuns(full);
    for (const seg of segments) {
        decomposeRuns(seg);
    }

    return Array.from(tokens);
};

/**
 * Expands a string or array of identifiers/part numbers into deduplicated search tokens.
 * @param {string|Array<string|{part_number?: string}>} inputs
 * @returns {string[]}
 */
const expandIdentifierArray = (inputs) => {
    const items = typeof inputs === 'string'
        ? inputs.split(/[;,]/)
        : Array.isArray(inputs)
            ? inputs.flatMap((entry) => {
                if (typeof entry === 'string') return entry.split(/[;,]/);
                if (entry && typeof entry === 'object' && typeof entry.part_number === 'string') {
                    return entry.part_number.split(/[;,]/);
                }
                return [];
            })
            : [];

    const out = new Set();
    for (const item of items) {
        for (const token of expandIdentifierTokens(item)) {
            out.add(token);
        }
    }
    return Array.from(out);
};

/**
 * Builds deduplicated search query variants (max 3) to handle spaced, hyphenated,
 * and concatenated identifier queries (e.g. "vk 9001" <-> "vk9001" <-> "vk-9001").
 * @param {string} rawQuery
 * @returns {string[]}
 */
const buildSearchQueryVariants = (rawQuery) => {
    if (!rawQuery || typeof rawQuery !== 'string' || !rawQuery.trim()) return [''];
    const trimmed = rawQuery.trim().replace(/\s+/g, ' ');
    const variants = [];
    const seen = new Set();

    const addVariant = (candidate) => {
        if (!candidate || variants.length >= 3) return;
        const cleaned = candidate.trim().replace(/\s+/g, ' ');
        if (!cleaned) return;
        const key = cleaned.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        variants.push(cleaned);
    };

    addVariant(trimmed);

    const collapsed = trimmed
        .replace(/([a-z0-9])\s*[-./_]+\s*(?=[a-z0-9])/gi, '$1')
        .replace(/\b([a-z]{1,6})\s+(\d[a-z0-9]*)\b/gi, '$1$2')
        .replace(/\b(\d{2,})\s+([a-z]{1,4})\b/gi, '$1$2');
    addVariant(collapsed);

    const wordTokens = trimmed.split(/\s+/);
    const alnumOnly = normalizeForSearch(trimmed);
    if (wordTokens.length >= 2 && wordTokens.length <= 3 && alnumOnly.length > 0 && alnumOnly.length <= 24) {
        addVariant(alnumOnly);
    }

    const split = trimmed
        .replace(/[-./_*]+/g, ' ')
        .replace(/([a-zA-Z])(\d)/g, '$1 $2')
        .replace(/(\d)([a-zA-Z]{2,})/g, '$1 $2');
    addVariant(split);

    return variants;
};

/**
 * Executes a Meilisearch parts query using query variants and merges/deduplicates
 * hits while preserving ranking order and falling back gracefully on multi-word misses.
 * @param {object} index - Meilisearch index instance
 * @param {string} rawQuery
 * @param {object} searchOptions
 * @returns {Promise<object>}
 */
const searchPartsWithVariants = async (index, rawQuery, searchOptions = {}) => {
    const variants = buildSearchQueryVariants(rawQuery);
    const primaryQuery = variants[0] ?? '';

    if (variants.length <= 1 || Number(searchOptions.offset) > 0) {
        let result = await index.search(primaryQuery, searchOptions);
        if (
            (!result?.hits || result.hits.length === 0)
            && searchOptions.matchingStrategy === 'all'
            && primaryQuery.trim().split(/\s+/).length >= 2
        ) {
            result = await index.search(primaryQuery, { ...searchOptions, matchingStrategy: 'last' });
        }
        return result;
    }

    if (Number(searchOptions.limit) === 0) {
        const results = await Promise.all(variants.map((v) => index.search(v, searchOptions)));
        return results.reduce((best, curr) => {
            const bestTotal = best?.estimatedTotalHits || best?.totalHits || 0;
            const currTotal = curr?.estimatedTotalHits || curr?.totalHits || 0;
            return currTotal > bestTotal ? curr : best;
        }, results[0] || { hits: [], estimatedTotalHits: 0 });
    }

    const variantOptions = { ...searchOptions, showRankingScore: true };
    const results = await Promise.all(variants.map((v) => index.search(v, variantOptions)));

    const hitMap = new Map();
    let hasScores = false;
    let orderCounter = 0;

    for (let variantIndex = 0; variantIndex < results.length; variantIndex++) {
        const hits = results[variantIndex]?.hits || [];
        for (const hit of hits) {
            const key = hit?.part_id ?? hit?.id;
            if (key == null) continue;
            const rawScore = typeof hit._rankingScore === 'number' ? hit._rankingScore : null;
            if (rawScore !== null) hasScores = true;
            const effectiveScore = rawScore !== null
                ? rawScore + (variantIndex === 0 ? 0.0001 : 0)
                : null;

            const existing = hitMap.get(key);
            if (!existing) {
                hitMap.set(key, {
                    hit,
                    score: effectiveScore,
                    order: orderCounter++,
                });
            } else if (effectiveScore !== null && (existing.score === null || effectiveScore > existing.score)) {
                existing.hit = hit;
                existing.score = effectiveScore;
            }
        }
    }

    const entries = Array.from(hitMap.values());
    if (hasScores) {
        entries.sort((a, b) => {
            const scoreDiff = (b.score ?? -1) - (a.score ?? -1);
            if (scoreDiff !== 0) return scoreDiff;
            return a.order - b.order;
        });
    }

    let mergedHits = entries.map((e) => e.hit);
    if (
        mergedHits.length === 0
        && searchOptions.matchingStrategy === 'all'
        && primaryQuery.trim().split(/\s+/).length >= 2
    ) {
        const fallbackResult = await index.search(primaryQuery, { ...searchOptions, matchingStrategy: 'last' });
        if (fallbackResult?.hits?.length > 0) {
            return fallbackResult;
        }
    }

    const limit = Number(searchOptions.limit);
    if (Number.isFinite(limit) && limit > 0 && mergedHits.length > limit) {
        mergedHits = mergedHits.slice(0, limit);
    }

    const estimatedTotalHits = Math.max(
        ...results.map((r) => r?.estimatedTotalHits || r?.totalHits || r?.hits?.length || 0),
        mergedHits.length
    );

    return {
        ...(results[0] || {}),
        hits: mergedHits,
        estimatedTotalHits,
    };
};

module.exports = {
    normalizeForSearch,
    normalizeArray,
    expandIdentifierTokens,
    expandIdentifierArray,
    buildSearchQueryVariants,
    searchPartsWithVariants,
    EXACT_MATCH_MIN_LENGTH
};
