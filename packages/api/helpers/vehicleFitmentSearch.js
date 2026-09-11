// Shared helpers for building the `searchable_applications` text indexed into
// Meilisearch's `parts` index. Multiple call sites (partRoutes, partApplicationRoutes,
// the meili outbox worker, and the meili listener) each flatten a part's vehicle
// fitments into one string; this keeps the year-token expansion identical everywhere
// instead of drifting across four copies.

// Reasonable bound on how many individual year tokens to expand an open-ended or
// very wide year range into -- avoids an unbounded string for a fitment like "1990-2030".
const MAX_YEAR_TOKENS = 40;

function yearTokensFor(yearStart, yearEnd) {
    if (!yearStart && !yearEnd) return '';
    const start = yearStart || yearEnd;
    const end = yearEnd || yearStart;
    if (end - start + 1 > MAX_YEAR_TOKENS) {
        // Range too wide to expand usefully; fall back to the boundary years so
        // "1990" / "2030" still text-match without producing a huge token list.
        return `${start} ${end}`;
    }
    const years = [];
    for (let y = start; y <= end; y++) years.push(y);
    return years.join(' ');
}

// Appends flattened year tokens (for every part_application row) to an already-built
// make/model/engine string, so a literal year typed into keyword search
// (e.g. "oil filter hilux 2015") text-matches directly.
function withYearTokens(baseString, yearRanges) {
    const tokens = (yearRanges || [])
        .map(([yearStart, yearEnd]) => yearTokensFor(yearStart, yearEnd))
        .filter(Boolean)
        .join(' ');
    return [baseString, tokens].filter(Boolean).join(' ');
}

module.exports = { yearTokensFor, withYearTokens, MAX_YEAR_TOKENS };
