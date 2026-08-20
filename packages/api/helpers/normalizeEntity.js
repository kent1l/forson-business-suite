/**
 * Shared text normalization for employee/customer/supplier/item data entry.
 *
 * Used by both the live create/update routes and scripts/normalizeExistingData.js,
 * so a one-time backfill of existing records and everyday data entry can never
 * drift apart. Only trims/re-cases fields where the "correct" casing is inferable
 * (person names); company names, addresses, and item descriptions are left at
 * whitespace cleanup only, since their casing (acronyms, brand styling, barangay
 * abbreviations) can't be safely guessed.
 */

const collapseWhitespace = (str) => str.replace(/\s+/g, ' ').trim();

// Generic short freetext: trim + collapse whitespace, empty string -> null.
const normalizeText = (value) => {
    if (typeof value !== 'string') return value;
    const cleaned = collapseWhitespace(value);
    return cleaned === '' ? null : cleaned;
};

// Lowercase words that stay lowercase mid-name (Filipino/Spanish/Dutch particles).
const NAME_PARTICLES = new Set([
    'de', 'la', 'las', 'los', 'del', 'dela', 'delos', 'delas',
    'van', 'von', 'der', 'da', 'di', 'y', 'bin', 'binti',
]);
const ROMAN_NUMERAL_SUFFIXES = new Set(['ii', 'iii', 'iv', 'v', 'vi']);

const titleCaseWord = (word) => {
    if (!word) return word;
    const lower = word.toLowerCase();
    if (NAME_PARTICLES.has(lower)) return lower;
    if (ROMAN_NUMERAL_SUFFIXES.has(lower)) return lower.toUpperCase();
    return word
        .split('-')
        .map((part) => part
            .split("'")
            .map((seg) => (seg ? seg[0].toUpperCase() + seg.slice(1).toLowerCase() : seg))
            .join("'"))
        .join('-');
};

// Re-capitalizes the letter after a Mc/Mac surname prefix (titleCaseWord alone
// would produce "Mcdonald" / "Macarthur").
const fixScottishPrefix = (word) => word.replace(/^(Mc|Mac)([a-z])/, (_, prefix, next) => prefix + next.toUpperCase());

// Person names: title-case each word, e.g. "juan DELA cruz jr" -> "Juan dela Cruz Jr".
const normalizeName = (value) => {
    const cleaned = normalizeText(value);
    if (!cleaned) return cleaned;
    return cleaned
        .split(' ')
        .map((word) => fixScottishPrefix(titleCaseWord(word)))
        .join(' ');
};

const normalizeEmail = (value) => {
    if (typeof value !== 'string') return value;
    const cleaned = value.trim().toLowerCase();
    return cleaned === '' ? null : cleaned;
};

// Keeps digits and the separators people actually use (+, spaces, dashes,
// parentheses) and strips everything else, without forcing one canonical
// layout — valid PH numbers legitimately vary (landline+area code vs mobile).
const normalizePhone = (value) => {
    const cleaned = normalizeText(value);
    if (!cleaned) return cleaned;
    const stripped = cleaned.replace(/[^\d+\-() ]/g, '').trim();
    return stripped === '' ? null : stripped;
};

module.exports = {
    normalizeText,
    normalizeName,
    normalizeEmail,
    normalizePhone,
};
