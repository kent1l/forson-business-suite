// Engine-code grammar for natural-language fitment parsing (Vehicle Fitment Phase 7).
// See docs/plans/2026-09-10_fitment-parsing-linking-display.md §7.3.
//
// Staff write engine codes in a compressed shorthand that looks messy but is in
// fact the most rule-governed part of a fitment description:
//
//   4D55/6    -> 4D55, 4D56          (two distinct engines)
//   4JA1/B1   -> 4JA1, 4JB1
//   4JA1-T    -> one engine, distinct from 4JA1 (turbo)
//   JT        -> a bare short code, resolvable only by exact match or alias
//
// This is deliberately the place where an LLM is NOT used. Asked to expand
// "4JA1/B1" a language model will readily produce plausible-but-nonexistent
// codes; a grammar plus a gazetteer check cannot. Everything here is pure --
// no DB, no network -- so the rules can be tested exhaustively, which is where
// the correctness risk actually concentrates.

// Candidate engine-code spans inside free text. Deliberately loose: this only
// nominates spans, and the taxonomy lookup is what decides whether a span is a
// real engine.
const ENGINE_TOKEN_RE = /\b\d?[A-Z]{1,4}\d{0,3}[A-Z]?(?:\s*[-/]\s*[A-Z0-9]{1,5})*\b/gi;

/**
 * Canonical lookup key for an engine code.
 *
 * Collapses the variance that is genuinely cosmetic (case, surrounding
 * whitespace, whether the separator was typed at all) while preserving the
 * variance that is not. `4JA1 - T`, `4JA1-T` and `4JA1T` all key to `4JA1T`,
 * but `4JA1` keys to `4JA1` and stays a different engine -- a naturally
 * aspirated one. Never shave a variant suffix to reach a base code; 53 of the
 * 271 seeded engine codes carry one and they denote real mechanical
 * differences.
 */
function lookupKey(code) {
    if (code == null) return '';
    return String(code).toUpperCase().replace(/[\s\-_.]/g, '');
}

/** Normalized form used for alias_text storage (see 20260910_02 migration). */
function normalizeAlias(text) {
    if (text == null) return '';
    return String(text).toUpperCase().trim().replace(/\s+/g, ' ');
}

/**
 * Expands a slash-compressed engine token by RIGHT-ALIGNED OVERLAY.
 *
 * One rule covers every observed form: each `/`-segment is overlaid onto the
 * tail of the ORIGINAL base (never onto the previous expansion), so
 *
 *   expand("4D55", "6")  -> "4D5" + "6"  -> "4D56"
 *   expand("4JA1", "B1") -> "4J"  + "B1" -> "4JB1"
 *   expand("4D55", "65") -> "4D"  + "65" -> "4D65"
 *
 * A segment at least as long as the base is taken to be a complete code in its
 * own right ("4D55/4D56"), since there would be nothing left of the base to
 * overlay onto.
 *
 * This only PROPOSES candidates. Callers must confirm every returned code
 * against the real engine taxonomy before offering it -- an expansion that
 * matches nothing is a review candidate, never an invention.
 */
function expandSlashToken(token) {
    const cleaned = String(token || '').toUpperCase().replace(/\s*\/\s*/g, '/').trim();
    if (!cleaned) return [];

    const segments = cleaned.split('/').map(s => s.trim()).filter(Boolean);
    if (segments.length === 0) return [];

    // Shared-SUFFIX form: "1GD/1KD/2GD/2KD-FTV" means all four Toyota codes end
    // in -FTV. This is the mirror of the overlay rule and is how staff compress
    // the very common Toyota style, where codes differ at the FRONT rather than
    // the tail. It applies only when the final segment carries a hyphen segment
    // and none of the earlier ones do -- otherwise "4D55/6" or "1KR-DE/VE" would
    // be misread.
    const suffixExpansion = expandSharedSuffix(segments);
    if (suffixExpansion) return suffixExpansion;

    const base = segments[0];
    const out = [base];

    for (const segment of segments.slice(1)) {
        const expanded = segment.length >= base.length
            ? segment
            : base.slice(0, base.length - segment.length) + segment;
        if (!out.includes(expanded)) out.push(expanded);
    }

    return out;
}

/**
 * Expands the shared-suffix form, or returns null when it does not apply.
 *
 *   1GD/1KD/2GD/2KD-FTV -> 1GD-FTV, 1KD-FTV, 2GD-FTV, 2KD-FTV
 *   4JJ1/4JK1/4JH1-TC   -> 4JJ1-TC, 4JK1-TC, 4JH1-TC
 *
 * Guarded so it cannot swallow a legitimately distinct base code: if an earlier
 * segment already equals the final segment's base ("4JA1/4JA1-L"), the shared
 * suffix reading would silently drop the naturally aspirated 4JA1, so we fall
 * through to the overlay rule instead.
 */
function expandSharedSuffix(segments) {
    if (segments.length < 2) return null;

    const last = segments[segments.length - 1];
    const hyphenAt = last.indexOf('-');
    if (hyphenAt <= 0) return null;

    const heads = segments.slice(0, -1);
    if (heads.some(h => h.includes('-'))) return null;

    const lastBase = last.slice(0, hyphenAt);
    const suffix = last.slice(hyphenAt);
    if (!lastBase || suffix.length < 2) return null;
    if (heads.some(h => h === lastBase)) return null;

    const out = [];
    for (const head of heads) {
        const expanded = head + suffix;
        if (!out.includes(expanded)) out.push(expanded);
    }
    if (!out.includes(last)) out.push(last);
    return out;
}

/** True when a token carries a variant suffix (`-T`, `-TC`, `-FE`, `-HP`, ...). */
function hasVariantSuffix(token) {
    return /-[A-Z0-9]{1,5}$/i.test(String(token || '').trim());
}

module.exports = {
    ENGINE_TOKEN_RE,
    lookupKey,
    normalizeAlias,
    expandSlashToken,
    hasVariantSuffix,
};
