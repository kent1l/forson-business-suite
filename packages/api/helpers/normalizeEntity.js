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

const UOM_ALIASES = {
    pc: 'pcs', pcs: 'pcs', pce: 'pcs', pces: 'pcs', piece: 'pcs', pieces: 'pcs', ea: 'pcs', each: 'pcs', unit: 'pcs', units: 'pcs',
    set: 'set', sets: 'set',
    bx: 'box', bxs: 'box', box: 'box', boxes: 'box',
    btl: 'btl', btls: 'btl', bottle: 'btl', bottles: 'btl',
    pr: 'pair', prs: 'pair', pair: 'pair', pairs: 'pair',
    rl: 'roll', rls: 'roll', roll: 'roll', rolls: 'roll',
    can: 'can', cans: 'can',
    bg: 'bag', bgs: 'bag', bag: 'bag', bags: 'bag',
    drm: 'drum', drum: 'drum', drums: 'drum',
    pail: 'pail', pails: 'pail',
    pk: 'pack', pks: 'pack', pkg: 'pack', pkgs: 'pack', pack: 'pack', packs: 'pack',
    kit: 'kit', kits: 'kit',
    assy: 'assy', assembly: 'assy', assemblies: 'assy',
    ft: 'ft', feet: 'ft', foot: 'ft',
    m: 'm', mtr: 'm', mtrs: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm',
    cm: 'cm', centimeter: 'cm', centimeters: 'cm',
    mm: 'mm', millimeter: 'mm', millimeters: 'mm',
    in: 'in', inch: 'in', inches: 'in',
    yd: 'yd', yds: 'yd', yard: 'yd', yards: 'yd',
    l: 'l', ltr: 'l', ltrs: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
    ml: 'ml', milliliter: 'ml', milliliters: 'ml',
    gal: 'gal', gals: 'gal', gallon: 'gal', gallons: 'gal',
    qt: 'qt', qts: 'qt', quart: 'qt', quarts: 'qt',
    pt: 'pt', pts: 'pt', pint: 'pt', pints: 'pt',
    kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
    g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g',
    lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
    oz: 'oz', ounce: 'oz', ounces: 'oz',
    dz: 'doz', doz: 'doz', dozen: 'doz', dozens: 'doz',
    cs: 'case', case: 'case', cases: 'case',
    ctn: 'ctn', ctns: 'ctn', crt: 'ctn', carton: 'ctn', cartons: 'ctn',
    tb: 'tube', tube: 'tube', tubes: 'tube',
    sht: 'sheet', sheet: 'sheet', sheets: 'sheet',
};

const normalizeUom = (value, fallback = 'pcs') => {
    if (typeof value !== 'string') return fallback;
    const cleaned = collapseWhitespace(value)
        .toLowerCase()
        .replace(/\.+$/g, '')
        .replace(/(?:\/|\()e?s\)?$/g, '')
        .trim();
    if (!cleaned || !/[a-z]/.test(cleaned)) return fallback;
    return UOM_ALIASES[cleaned] || cleaned;
};

module.exports = {
    normalizeText,
    normalizeName,
    normalizeEmail,
    normalizePhone,
    normalizePartNumber,
    normalizeTin,
    normalizeUom,
};
