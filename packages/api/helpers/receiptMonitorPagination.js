'use strict';

// Count substring matches in a numbered reference using digit states, rather than
// expanding a booklet into its numbers. The memo is shared by all bounds on a page.
function referenceCounter(prefix, search) {
    const pattern = search.toUpperCase();
    const advance = (state, char) => {
        if (state === pattern.length) return state;
        const text = pattern.slice(0, state) + char;
        for (let n = Math.min(pattern.length, text.length); n > 0; n--) {
            if (text.endsWith(pattern.slice(0, n))) return n;
        }
        return 0;
    };
    let initial = 0;
    for (const char of `${prefix.toUpperCase()}-`) initial = advance(initial, char);
    const transitions = Array.from({ length: pattern.length + 1 }, (_, state) =>
        Array.from({ length: 10 }, (_, digit) => advance(state, String(digit))));
    const memo = new Map();
    const upTo = bound => {
        if (bound < 1n) return 0n;
        if (!pattern.length) return bound;
        const digits = String(bound);
        const count = (position, tight, started, state) => {
            if (position === digits.length) return started && state === pattern.length ? 1n : 0n;
            const key = `${digits.length - position}:${started}:${state}`;
            if (!tight && memo.has(key)) return memo.get(key);
            const limit = tight ? Number(digits[position]) : 9;
            let total = 0n;
            for (let digit = 0; digit <= limit; digit++) {
                const nextStarted = started || digit !== 0;
                total += count(position + 1, tight && digit === limit, nextStarted,
                    nextStarted ? transitions[state][digit] : state);
            }
            if (!tight) memo.set(key, total);
            return total;
        };
        return count(0, true, false, initial);
    };
    const between = (low, high) => upTo(high) - upTo(low - 1n);
    const at = (low, high, index) => {
        if (!pattern.length) return low + index;
        const baseline = upTo(low - 1n);
        while (low < high) {
            const middle = (low + high) / 2n;
            if (upTo(middle) - baseline > index) high = middle;
            else low = middle + 1n;
        }
        return low;
    };
    return { between, at };
}

function paginateReferences(records, min, max, { prefix, search, status, sortBy, sortOrder, page }) {
    const occupied = [...records.entries()].filter(([, row]) => row.status !== 'NO_RECORD')
        .sort(([a], [b]) => BigInt(a) < BigInt(b) ? -1 : 1);
    const segments = [];
    let cursor = min;
    for (const [serial, row] of occupied) {
        const n = BigInt(serial);
        if (cursor < n) segments.push({ low: cursor, high: n - 1n, status: 'NO_RECORD' });
        segments.push({ low: n, high: n, status: row.status });
        cursor = n + 1n;
    }
    if (cursor <= max) segments.push({ low: cursor, high: max, status: 'NO_RECORD' });
    if (sortBy === 'status') segments.sort((a, b) => a.status.localeCompare(b.status) || (a.low < b.low ? -1 : 1));
    const descending = sortOrder === 'desc';
    if (descending) segments.reverse();
    const counter = referenceCounter(prefix, search);
    const matches = segments.filter(segment => status === 'ALL' || segment.status === status)
        .map(segment => ({ ...segment, count: counter.between(segment.low, segment.high) }));
    const total = matches.reduce((sum, segment) => sum + segment.count, 0n);
    let skip = (BigInt(page) - 1n) * 25n;
    const serials = [];
    for (const segment of matches) {
        if (skip >= segment.count) { skip -= segment.count; continue; }
        for (let index = skip; index < segment.count && serials.length < 25; index++) {
            serials.push(String(counter.at(segment.low, segment.high, descending ? segment.count - index - 1n : index)));
        }
        skip = 0n;
        if (serials.length === 25) break;
    }
    return { total, serials };
}

module.exports = { paginateReferences };
