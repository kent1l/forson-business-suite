import { formatEngineCodes, getEngineCodeDisplay } from './engineCodeDisplay.js';
import { formatFitmentPosition } from './fitmentPosition.js';
export { compressEngineCodes } from './engineCodeDisplay.js';

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
  if (row.generation) parts.push(`Generation: ${row.generation}`);
  if (row.variant || row.variant_descriptor) parts.push(row.variant || row.variant_descriptor);
  if (row.drivetrain) parts.push(row.drivetrain);
  if (row.transmission) parts.push(row.transmission);
  if (row.fuel_type_qualifier || row.fuel_type) parts.push(row.fuel_type_qualifier || row.fuel_type);
  if (row.displacement_liters_qualifier || row.displacement_liters) parts.push(`${row.displacement_liters_qualifier || row.displacement_liters}L`);
  if (row.market) parts.push(row.market);
  if (row.position) parts.push(formatFitmentPosition(row.position));
  return parts.join(' · ');
}

export function formatApplicationScopeBadge(row = {}) {
  if (row.effect === 'exclude') return { label: 'Excluded', tone: 'red' };
  if (row.already_linked) return { label: 'Already linked', tone: 'slate' };
  if (row.confidence_label === 'unresolved') return { label: 'Choose vehicle', tone: 'amber' };
  return { label: row.rule_id || row.part_app_id ? 'Linked' : 'Vehicle combination', tone: 'slate' };
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
      qualifierSummary,
      app.year_start ?? '',app.year_end ?? '',
      ...['make','model','chassis','engine','year','market','variant','position','drivetrain','transmission','fuel','displacement','generation'].map(k=>app[`${k}_mode`] || ''),
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
        const code = formatEngineCodes(r.engine);
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
            fitment.make_id ?? '', fitment.model_id ?? '', fitment.chassis_id ?? '',
            Boolean(fitment.engine),
            fitment.effect === 'exclude' ? 'exclude' : 'include',
            formatQualifierSummary(fitment),
            ...['make','model','chassis','engine','year','market','variant','position','drivetrain','transmission','fuel','displacement','generation'].map(k=>fitment[`${k}_mode`] || ''),
            fitment.year_start ?? '',
            fitment.year_end ?? '',
        ].join('|');

        if (!groups.has(key)) {
            groups.set(key, {
                make: fitment.make || null,
                model: fitment.model || null,
                chassis: fitment.chassis || null,
                position: formatFitmentPosition(fitment.position) || null,
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
        const display = getEngineCodeDisplay(group.engineCodes);
        return {
            ...group,
            engineCodes: display.codes,
            engineDisplay: display.text,
            compressed: display.compressed,
        };
    });
}

/** Renders one group as a single display string, e.g. "Toyota Hilux 4D55/6 (2005-2015)". */
export function formatFitmentGroup(group) {
    const years = group.year_start && group.year_end
        ? (group.year_start === group.year_end ? `(${group.year_start})` : `(${group.year_start}-${group.year_end})`)
        : group.year_start ? `(${group.year_start}+)`
            : group.year_end ? `(up to ${group.year_end})` : '';

    const vehicle = [group.make, group.model, group.engineDisplay, group.chassis ? `[${group.chassis}]` : null, years]
        .filter(Boolean)
        .join(' ')
        .trim();
    return [group.position, vehicle].filter(Boolean).join(' · ');
}

// Save vehicle identity and optional link details; parsing is transient.
export function fitmentSavePayload(candidate) {
  const fields = ['application_id','make_id','make','model_id','model','chassis_id','chassis','engine_id','engine','year_start','year_end','effect','variant_descriptor','fuel_type_qualifier','displacement_liters_qualifier','fuel_type','displacement_liters','market','variant','position','drivetrain','transmission','generation'];
  const payload = Object.fromEntries(fields.filter(k => candidate[k] !== undefined).map(k => [k, candidate[k] === '' ? null : candidate[k]]));
  return payload;
}
