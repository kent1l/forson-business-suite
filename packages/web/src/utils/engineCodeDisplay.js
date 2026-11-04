import { compareFitmentValues } from './fitmentDisplayOrder.js';

// Display-only compression of similar engine codes (Vehicle Fitment Phase 9).
// See docs/plans/2026-09-10_fitment-parsing-linking-display.md §9.
//
// Engines are stored ATOMICALLY and linked to a part individually, because a
// part that fits a 4D55 does not necessarily fit a 4D56. That is the right
// model for correctness, but it makes a fitment list read as a wall of
// near-identical codes. This module recombines them the way staff write them by
// hand -- {4D55, 4D56} -> "4D55/6" -- purely at render time.
//
// The compressed form must NEVER be stored, submitted, exported, or indexed.
// The Meilisearch index in particular keeps the individual codes so that a
// search for "4D56" still finds the part.
//
// This is the exact inverse of the parser's right-aligned overlay
// (packages/api/helpers/engineCodeGrammar.js expandSlashToken), which gives a
// round-trip property the tests rely on.

// Compression is cosmetic, so every one of these guards fails SAFE: when a rule
// is not satisfied the codes are simply rendered separately.
const MIN_PREFIX_LENGTH = 2;
const MAX_GROUP_SIZE = 4;

function longestCommonPrefix(values) {
    if (!values.length) return '';
    let prefix = values[0];
    for (const value of values.slice(1)) {
        let i = 0;
        while (i < prefix.length && i < value.length && prefix[i] === value[i]) i++;
        prefix = prefix.slice(0, i);
        if (!prefix) break;
    }
    return prefix;
}

/**
 * Compresses a set of engine codes into shorthand, or returns null if they
 * cannot be safely combined.
 *
 * Returns null (meaning "render them separately") when:
 *  - fewer than 2 or more than MAX_GROUP_SIZE codes
 *  - any tail would be empty -- rejects {4JA1, 4JA1-T}, which are a naturally
 *    aspirated and a turbo engine and must stay visibly distinct
 *  - any tail contains a variant separator -- rejects {4JJ1-TC, 4JJ1-TCX},
 *    since variant suffixes carry real mechanical meaning
 *  - the shared prefix is too short to be meaningful -- rejects {JT, JX}
 *  - the tails differ in length, which would make the overlay ambiguous in
 *    reverse
 */
export function compressEngineCodes(codes) {
    const unique = [...new Set((codes || []).map(c => String(c || '').trim().toUpperCase()).filter(Boolean))];
    if (unique.length < 2 || unique.length > MAX_GROUP_SIZE) return null;

    const sorted = [...unique].sort();
    const prefix = longestCommonPrefix(sorted);

    // Prefix compression is tried first -- it is the tighter form ("4D55/6")
    // and the one staff already write by hand. Shared-suffix compression is the
    // fallback for code families that differ at the front.
    if (prefix.length < MIN_PREFIX_LENGTH) return compressSharedSuffix(sorted);

    const shortest = Math.min(...sorted.map(c => c.length));
    if (prefix.length * 2 < shortest) return compressSharedSuffix(sorted);

    const tails = sorted.map(c => c.slice(prefix.length));
    if (tails.some(t => t.length === 0)) return null; // e.g. {4JA1, 4JA1-T}
    if (tails.some(t => /[-_/\s]/.test(t))) return compressSharedSuffix(sorted);
    if (new Set(tails.map(t => t.length)).size !== 1) return compressSharedSuffix(sorted);

    return `${sorted[0]}/${tails.slice(1).join('/')}`;
}

/**
 * Compresses a shared trailing segment: the mirror of prefix compression, for
 * the very common Toyota style where codes differ at the FRONT.
 *
 *   {1GD-FTV, 1KD-FTV, 2GD-FTV, 2KD-FTV} -> 1GD/1KD/2GD/2KD-FTV
 *   {4JJ1-TC, 4JK1-TC, 4JH1-TC}          -> 4JJ1/4JK1/4JH1-TC
 *
 * The shared part must be a WHOLE hyphen-delimited segment. Cutting mid-segment
 * would technically save a character or two ("1G/1K/2G/2KD-FTV") but reads as
 * gibberish, and it is the hyphen boundary that makes the form unambiguous to
 * expand back.
 *
 * Returns null when it does not apply, including when any head would still
 * contain a hyphen -- the parser's expansion rule keys off exactly that, so
 * producing such a string would break the round trip.
 */
function compressSharedSuffix(sorted) {
    const suffixes = sorted.map(code => {
        const at = code.indexOf('-');
        return at > 0 ? code.slice(at) : null;
    });
    const suffix = suffixes[0];
    if (!suffix || suffix.length < 2) return null;
    if (!suffixes.every(sfx => sfx === suffix)) return null;

    const heads = sorted.map(code => code.slice(0, code.length - suffix.length));
    if (heads.some(h => !h || h.includes('-'))) return null;
    if (new Set(heads).size !== heads.length) return null;

    return `${heads.slice(0, -1).join('/')}/${sorted[sorted.length - 1]}`;
}

/** Canonical display values only; never use this list to build write payloads. */
export function normalizeEngineCodes(codes) {
    const list = Array.isArray(codes) ? codes : [codes];
    return [...new Set(list.map(code => String(code ?? '').trim().toUpperCase()).filter(Boolean))].sort(compareFitmentValues);
}

/** Shared shorthand, complete label and atomic codes for any display surface. */
export function getEngineCodeDisplay(codes) {
    const normalized = normalizeEngineCodes(codes);
    const shorthand = compressEngineCodes(normalized);
    const full = normalized.join(', ');
    return { codes: normalized, text: shorthand || full, full, compressed: Boolean(shorthand) };
}

export function formatEngineCodes(codes, { compact = true, separator = ', ' } = {}) {
    const display = getEngineCodeDisplay(codes);
    return compact && display.compressed ? display.text : display.codes.join(separator);
}
