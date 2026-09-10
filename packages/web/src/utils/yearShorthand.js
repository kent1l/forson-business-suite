// Compact year-range notation for dense fitment lists (Vehicle Fitment Phase 10).
// See docs/plans/2026-09-10_fitment-parsing-linking-display.md §10b.
//
// Year ranges are the second-bulkiest part of a fitment string after engine
// codes -- "(2005-2015)" is 11 characters repeated on every row. Two-digit
// notation is what staff already write on shelf labels and supplier sheets, so
// "05-15" is not just shorter, it is the familiar form.
//
// Display-only, like every other compression here: the stored year_start and
// year_end are always full four-digit integers.
//
// The century pivot deliberately matches the parser's expandTwoDigitYear in
// packages/api/helpers/fitmentTextParser.js -- 70-99 reads as 19xx, 00-69 as
// 20xx -- so a shortened range typed back in resolves to the same years.
const CENTURY_PIVOT = 70;

function twoDigit(year) {
    const n = Number(year);
    if (!Number.isFinite(n)) return null;
    return String(n % 100).padStart(2, '0');
}

/**
 * True when a four-digit year survives the round trip through two-digit
 * notation. Years before 1970 collide with 20xx under the pivot, so they keep
 * their full form rather than silently rendering as the wrong century.
 */
function isPivotSafe(year) {
    const n = Number(year);
    if (!Number.isFinite(n)) return false;
    const short = n % 100;
    const restored = short >= CENTURY_PIVOT ? 1900 + short : 2000 + short;
    return restored === n;
}

/**
 * Formats a year range.
 *
 * @param {number|null} start
 * @param {number|null} end
 * @param {{ short?: boolean }} options - `short` selects two-digit notation.
 * @returns {string} e.g. "2005-2015", or "05-15" when short
 */
export function formatYears(start, end, { short = false } = {}) {
    const hasStart = start != null && start !== '';
    const hasEnd = end != null && end !== '';
    if (!hasStart && !hasEnd) return '';

    // Fall back to full years whenever shortening would be lossy, so a range
    // spanning an unsafe year is never half-shortened.
    const canShorten = short
        && (!hasStart || isPivotSafe(start))
        && (!hasEnd || isPivotSafe(end));

    const fmt = (y) => (canShorten ? twoDigit(y) : String(y));

    if (hasStart && hasEnd) {
        return Number(start) === Number(end) ? fmt(start) : `${fmt(start)}-${fmt(end)}`;
    }
    if (hasStart) return `${fmt(start)}+`;
    // An end with no start reads as "everything up to and including this year".
    return canShorten ? `≤${fmt(end)}` : `up to ${end}`;
}

export { CENTURY_PIVOT };
