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
    if (prefix.length < MIN_PREFIX_LENGTH) return null;

    const shortest = Math.min(...sorted.map(c => c.length));
    if (prefix.length * 2 < shortest) return null;

    const tails = sorted.map(c => c.slice(prefix.length));
    if (tails.some(t => t.length === 0)) return null;
    if (tails.some(t => /[-_/\s]/.test(t))) return null;
    if (new Set(tails.map(t => t.length)).size !== 1) return null;

    return `${sorted[0]}/${tails.slice(1).join('/')}`;
}

/**
 * Formats a part's fitment rows for display, compressing engine codes only
 * within an identical vehicle context.
 *
 * Grouping by make/model/year range is not a nicety: without it, "Hilux 4D56
 * 2005-2010" and "L300 4D55 1995-2000" would merge into a single line asserting
 * a fitment nobody entered.
 *
 * Each returned group carries `engineCodes` (the full, uncompressed list) so
 * the caller can put it in a title/tooltip -- compression must never lose
 * information.
 */
export function groupFitmentsForDisplay(fitments) {
    const groups = new Map();

    for (const fitment of (fitments || [])) {
        const key = [
            fitment.make || '',
            fitment.model || '',
            fitment.year_start ?? '',
            fitment.year_end ?? '',
        ].join('|');

        if (!groups.has(key)) {
            groups.set(key, {
                make: fitment.make || null,
                model: fitment.model || null,
                year_start: fitment.year_start ?? null,
                year_end: fitment.year_end ?? null,
                engineCodes: [],
                fitments: [],
            });
        }
        const group = groups.get(key);
        if (fitment.engine) group.engineCodes.push(fitment.engine);
        group.fitments.push(fitment);
    }

    return [...groups.values()].map(group => {
        const compressed = compressEngineCodes(group.engineCodes);
        return {
            ...group,
            engineDisplay: compressed || group.engineCodes.join(', '),
            compressed: Boolean(compressed),
        };
    });
}

/** Renders one group as a single display string, e.g. "Toyota Hilux 4D55/6 (2005-2015)". */
export function formatFitmentGroup(group) {
    const years = group.year_start && group.year_end
        ? (group.year_start === group.year_end ? `(${group.year_start})` : `(${group.year_start}-${group.year_end})`)
        : group.year_start ? `(${group.year_start}+)`
            : group.year_end ? `(up to ${group.year_end})` : '';

    return [group.make, group.model, group.engineDisplay, years]
        .filter(Boolean)
        .join(' ')
        .trim();
}
