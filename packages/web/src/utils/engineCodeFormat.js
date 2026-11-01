/**
 * Frontend mirror of `packages/api/helpers/engineCodeGrammar.js` plus
 * fitment-chip display helpers (`groupApplicationsForDisplay`, `formatYearRange`, `formatApplicationScopeBadge`).
 */

const STRIP_PREFIX_RE = /^(?:engine|eng\.?|motor|code)\s*[:-]?\s*/i;
const VALID_CHAR_RE = /^[A-Z0-9-]+$/;

const TWO_PART_PATTERNS = [
  /^([0-9]{1,2}[A-Z]{1,3})[- ]?([A-Z0-9]{1,5})$/,
  /^([A-Z]{1,3}[0-9]{1,2}[A-Z]?)[- ]?([A-Z0-9]{1,5})$/,
];
const SINGLE_BLOCK_PATTERNS = [
  /^[0-9][A-Z][0-9]{1,2}[A-Z]?$/,
  /^[A-Z]{1,3}[0-9]{2,3}[A-Z]{0,4}$/,
  /^[0-9]{1,2}[A-Z]{1,3}$/,
  /^[A-Z]{1,4}[0-9]{1,2}$/,
];

export function canonicalizeEngineCode(raw) {
  if (raw === null || raw === undefined) return { canonical: null, valid: true };
  let s = String(raw).trim();
  if (!s) return { canonical: null, valid: true };

  s = s.replace(STRIP_PREFIX_RE, '').trim().toUpperCase();
  s = s.replace(/[–—_./]+/g, '-').replace(/\s+/g, ' ');

  if (s.length < 2 || s.length > 20) {
    return { canonical: s, valid: false, reason: 'Engine code must be 2–20 characters.' };
  }

  for (const re of TWO_PART_PATTERNS) {
    const m = s.match(re);
    if (m) {
      const candidate = `${m[1]}-${m[2]}`;
      const compact = candidate.replace(/-/g, '');
      if (SINGLE_BLOCK_PATTERNS.some((sb) => sb.test(compact)) && !s.includes('-') && !s.includes(' ')) {
        return { canonical: compact, valid: true };
      }
      return { canonical: candidate, valid: true };
    }
  }

  const compact = s.replace(/[-\s]+/g, '');
  if (SINGLE_BLOCK_PATTERNS.some((re) => re.test(compact))) {
    return { canonical: compact, valid: true };
  }

  const normalized = s.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (VALID_CHAR_RE.test(normalized) && /[A-Z]/.test(normalized) && /[0-9]/.test(normalized)) {
    return { canonical: normalized, valid: true };
  }

  return {
    canonical: normalized,
    valid: false,
    reason: 'Expected an engine code like "1KD-FTV", "4D56", "4JJ1-TCX", or "L15A".',
  };
}

export function formatYearRange(yearStart, yearEnd) {
  const ys = yearStart != null && yearStart !== '' ? Number(yearStart) : null;
  const ye = yearEnd != null && yearEnd !== '' ? Number(yearEnd) : null;
  if (!ys && !ye) return '';
  if (ys && ye) {
    if (ys === ye) return String(ys);
    const sameCentury = Math.floor(ys / 100) === Math.floor(ye / 100);
    const endShort = sameCentury ? `'${String(ye).slice(-2)}` : String(ye);
    return `${ys}–${endShort}`;
  }
  if (ys && !ye) return `${ys}+`;
  return `–${ye}`;
}

export function formatQualifierSummary(row = {}) {
  const parts = [];
  if (row.chassis) parts.push(`Chassis: ${row.chassis}`);
  if (row.position) parts.push(row.position);
  if (row.drivetrain) parts.push(row.drivetrain);
  if (row.transmission) parts.push(row.transmission);
  if (row.market) parts.push(row.market);
  if (row.variant) parts.push(row.variant);
  return parts.join(' · ');
}

export function formatApplicationScopeBadge(row = {}) {
  if (row.effect === 'exclude') {
    return { label: 'Excluded', tone: 'red' };
  }
  if (row.ui_badge) {
    if (row.ui_badge === 'Already linked') return { label: 'Already linked', tone: 'slate' };
    if (row.ui_badge === 'Unresolved') return { label: 'Unresolved', tone: 'red' };
    if (row.ui_badge === 'Sourced suggestion') return { label: 'Sourced suggestion', tone: 'blue' };
    return { label: row.ui_badge, tone: 'amber' };
  }
  if (row.approval_status === 'approved' || row.evidence_status === 'sourced_verified') {
    return { label: 'Verified', tone: 'emerald' };
  }
  if (row.evidence_status === 'sourced_suggestion') {
    return { label: 'Sourced suggestion', tone: 'blue' };
  }
  if (row.approval_status === 'needs_review') {
    return { label: 'Needs review', tone: 'amber' };
  }
  return { label: 'Unverified', tone: 'slate' };
}

/**
 * Collapse a flat list of part-application rows into grouped display entries
 * without collapsing exclusions, chassis codes, or distinct qualifiers into
 * general positive rows (Fixes F14 / F15).
 */
export function groupApplicationsForDisplay(applications = []) {
  if (!Array.isArray(applications) || applications.length === 0) return [];

  const groups = new Map();
  for (const app of applications) {
    const make = (app.make || '').trim();
    const model = (app.model || '').trim();
    const chassis = (app.chassis || '').trim();
    const effect = app.effect === 'exclude' ? 'exclude' : 'include';
    const qualifierSummary = formatQualifierSummary(app);

    const key = [
      effect,
      make.toLowerCase(),
      model.toLowerCase(),
      chassis.toLowerCase(),
      qualifierSummary.toLowerCase(),
    ].join('|');

    if (!groups.has(key)) {
      groups.set(key, {
        make,
        model,
        chassis,
        effect,
        qualifierSummary,
        shorthand: Boolean(app.display_shorthand),
        rows: [],
      });
    }
    const g = groups.get(key);
    if (app.display_shorthand) g.shorthand = true;
    g.rows.push(app);
  }

  const out = [];
  for (const g of groups.values()) {
    const labelBase = g.shorthand && g.model
      ? g.model
      : [g.make, g.model].filter(Boolean).join(' ') || (g.chassis ? `Chassis ${g.chassis}` : 'Engine-only');

    const allModelAgnostic = g.rows.every((r) => !r.engine);
    const allExplicitlyUnrestricted = allModelAgnostic && g.rows.some((r) => r.engine_mode === 'unrestricted');
    let yearRange = '';
    const starts = g.rows.map((r) => r.year_start).filter((v) => v != null);
    const ends = g.rows.map((r) => r.year_end).filter((v) => v != null);
    if (starts.length || ends.length) {
      const minStart = starts.length ? Math.min(...starts) : null;
      const maxEnd = ends.length ? Math.max(...ends) : null;
      yearRange = formatYearRange(minStart, maxEnd);
    }

    const seenEngines = new Set();
    const engines = [];
    if (!allModelAgnostic) {
      for (const r of g.rows) {
        const code = (r.engine || '').trim();
        if (!code) continue;
        const k = code.toUpperCase();
        if (seenEngines.has(k)) continue;
        seenEngines.add(k);
        engines.push({
          code,
          yearRange: formatYearRange(r.year_start, r.year_end),
          part_app_id: r.part_app_id,
          application_id: r.application_id,
        });
      }
    }

    out.push({
      key: `${g.effect}|${g.make}|${g.model}|${g.chassis}|${g.qualifierSummary}`,
      label: labelBase,
      make: g.make,
      model: g.model,
      chassis: g.chassis,
      effect: g.effect,
      qualifierSummary: g.qualifierSummary,
      shorthand: g.shorthand,
      yearRange,
      engines,
      engineScopeLabel: allModelAgnostic
        ? (allExplicitlyUnrestricted ? 'All engines (verified)' : 'Engine not specified')
        : null,
      rows: g.rows,
    });
  }

  return out;
}

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
            fitment.effect === 'exclude' ? 'exclude' : 'include',
            formatQualifierSummary(fitment),
            fitment.engine_mode || '',
            fitment.approval_status || '',
            fitment.evidence_status || '',
            fitment.year_start ?? '',
            fitment.year_end ?? '',
        ].join('|');

        if (!groups.has(key)) {
            groups.set(key, {
                make: fitment.make || null,
                model: fitment.model || null,
                chassis: fitment.chassis || null,
                effect: fitment.effect === 'exclude' ? 'exclude' : 'include',
                qualifierSummary: formatQualifierSummary(fitment),
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

    return [group.make, group.model, group.chassis ? `[${group.chassis}]` : null, group.engineDisplay, years]
        .filter(Boolean)
        .join(' ')
        .trim();
}
