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

// BIR Taxpayer Identification Number. Entry is wildly inconsistent -- staff copy
// it off a 2307 as "123 456 789 0000", "123-456-789", or a bare digit run -- but
// it has to match exactly when a certificate is reconciled against the customer
// on file, so it is stored in one canonical dashed layout.
//
// A TIN is a 9-digit base plus a branch code (000 for head office, 3 digits in
// current issuances, 5 in older ones). Anything that doesn't fit one of those
// shapes is left as typed rather than reformatted: an unrecognized length means
// the number is probably wrong, and silently regrouping the digits would hide
// that from whoever has to reconcile it later.
const normalizeTin = (value) => {
    const cleaned = normalizeText(value);
    if (!cleaned) return cleaned;
    const digits = cleaned.replace(/\D/g, '');
    const base = digits.slice(0, 9);
    const branch = digits.slice(9);
    if (digits.length === 9) return base.replace(/(\d{3})(\d{3})(\d{3})/, '$1-$2-$3');
    if (digits.length === 12 || digits.length === 14) {
        return `${base.replace(/(\d{3})(\d{3})(\d{3})/, '$1-$2-$3')}-${branch}`;
    }
    return cleaned;
};

// Stored part number display value (separate from normalizeSku.js's
// search-index normalization): uppercased on entry to match the auto-parts
// catalog convention this business already follows for the vast majority of
// its data.
const normalizePartNumber = (value) => {
    const cleaned = normalizeText(value);
    if (!cleaned) return cleaned;
    return cleaned.toUpperCase();
};

module.exports = {
    normalizeText,
    normalizeName,
    normalizeEmail,
    normalizePhone,
    normalizePartNumber,
    normalizeTin,
};
