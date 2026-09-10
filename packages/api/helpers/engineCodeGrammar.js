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
