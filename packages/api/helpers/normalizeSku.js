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

module.exports = {
    normalizeForSearch,
    normalizeArray,
    EXACT_MATCH_MIN_LENGTH
};
