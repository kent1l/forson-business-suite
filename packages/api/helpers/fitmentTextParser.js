'use strict';

// Deterministic natural-language fitment parser (Vehicle Fitment Phase 7 + Phase 2 clause scope & exclusions).

const {
  ENGINE_TOKEN_RE,
  lookupKey,
  expandSlashToken,
} = require('./engineCodeGrammar');
const { nameKey } = require('./vehicleTaxonomyIndex');

const VALID_FUEL_TYPES = ['diesel', 'gasoline', 'hybrid', 'mild_hybrid', 'electric', 'lpg', 'other'];

const FUEL_KEYWORDS = [
  [/\bdiesels?\b/i, 'diesel'],
  [/\bcrdi\b/i, 'diesel'],
  [/\btdci?\b/i, 'diesel'],
  [/\bdci\b/i, 'diesel'],
  [/\bd-?4-?d\b/i, 'diesel'],
  [/\bgasoline\b/i, 'gasoline'],
  [/\bgas\b/i, 'gasoline'],
  [/\bpetrol\b/i, 'gasoline'],
  [/\befi\b/i, 'gasoline'],
  [/\bvvt-?i\b/i, 'gasoline'],
  [/\bmild[\s-]?hybrid\b/i, 'mild_hybrid'],
  [/\bhybrid\b/i, 'hybrid'],
  [/\bphev\b/i, 'hybrid'],
  [/\belectric\b/i, 'electric'],
  [/\bev\b/i, 'electric'],
];

const STOPWORDS = new Set([
  'FITS', 'FIT', 'FITMENT', 'FOR', 'ALSO', 'SAME', 'YEAR', 'YEARS', 'YR', 'YRS',
  'THE', 'ALL', 'AND', 'OR', 'WITH', 'MODEL', 'MODELS', 'ENGINE', 'ENGINES',
  'UP', 'TO', 'FROM', 'ONWARDS', 'ONWARD', 'SERIES', 'TYPE', 'VARIANT',
  'APPLICABLE', 'USE', 'USED', 'ON', 'IN', 'OF', 'A', 'AN', 'ANY', 'BOTH',
  'EXCEPT', 'EXCLUDING', 'EXCLUDE', 'EXCL', 'SPECS', 'SPEC',
]);

const CLAUSE_SPLIT_RE = /\s*(?:[;\n,]|\band\b|\balso\b|(?<!\d)\+)\s*/i;
const EXPLICIT_YEAR_CARRY_RE = /\b(?:same\s+(?:years?|yrs?|model\s+years?)|(?:all|both)\s+models)\b/i;
const EXPLICIT_SPEC_CARRY_RE = /\b(?:same\s+(?:engines?|specs?|fuel))\b/i;
const EXCLUSION_SPLIT_RE = /\b(?:except(?:\s+for)?|exclud(?:e|es|ing)|excl\.?|not\s+for)\b/i;

/** Replaces [start,end) with spaces so later passes skip it but offsets hold. */
function mask(text, start, end) {
  return text.slice(0, start) + ' '.repeat(end - start) + text.slice(end);
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

// ---------------------------------------------------------------------------
// Dimension extraction -- pure regex, no taxonomy needed
// ---------------------------------------------------------------------------

function extractYears(text) {
  const patterns = [
    [
      /\b(19|20)(\d{2})\s*(?:-|–|—|to|thru|through)\s*(19|20)(\d{2})\b/i,
      (m) => [Number(m[1] + m[2]), Number(m[3] + m[4])],
    ],
    [
      /(?:^|\s)'?(\d{2})\s*(?:-|–|to)\s*'?(\d{2})(?=\s|$)/,
      (m) => [expandTwoDigitYear(m[1]), expandTwoDigitYear(m[2])],
    ],
    [
      /\b(19|20)(\d{2})\s*(?:\+|\b(?:onwards?|up)\b)/i,
      (m) => [Number(m[1] + m[2]), null],
    ],
    [
      /\b(?:up\s+to|until|till|thru)\s*(19|20)(\d{2})\b/i,
      (m) => [null, Number(m[1] + m[2])],
    ],
    [
      /\b(19|20)(\d{2})\b/,
      (m) => {
        const y = Number(m[1] + m[2]);
        return [y, y];
      },
    ],
  ];

  for (const [re, pick] of patterns) {
    const m = text.match(re);
    if (m) {
      const [start, end] = pick(m);
      return { yearStart: start, yearEnd: end, masked: mask(text, m.index, m.index + m[0].length) };
    }
  }
  return { yearStart: null, yearEnd: null, masked: text };
}

function expandTwoDigitYear(two) {
  const n = Number(two);
  return n >= 70 ? 1900 + n : 2000 + n;
}

function extractDisplacement(text) {
  const patterns = [
    [/\b(\d(?:\.\d{1,2})?)\s*(?:L\b|LITERS?\b|LITRES?\b)/i, (m) => Number(m[1])],
    [/\b(\d{3,4})\s*cc\b/i, (m) => Number(m[1]) / 1000],
    [/\b(\d\.\d{1,2})\b/, (m) => Number(m[1])],
  ];
  for (const [re, pick] of patterns) {
    const m = text.match(re);
    if (m) {
      const value = pick(m);
      if (Number.isFinite(value) && value > 0 && value < 30) {
        return { displacement: value, masked: mask(text, m.index, m.index + m[0].length) };
      }
    }
  }
  return { displacement: null, masked: text };
}

function extractFuel(text) {
  for (const [re, fuel] of FUEL_KEYWORDS) {
    const m = text.match(re);
    if (m) {
      return { fuel, masked: mask(text, m.index, m.index + m[0].length) };
    }
  }
  return { fuel: null, masked: text };
}

// ---------------------------------------------------------------------------
// Taxonomy matching
// ---------------------------------------------------------------------------

function matchNameSpans(text, nameTokens, resolve, boundary = 'A-Za-z0-9') {
  let working = text;
  const hits = [];
  for (const name of nameTokens) {
    const key = nameKey(name);
    if (!key) continue;
    const pattern = name
      .split('')
      .filter((ch) => /[A-Za-z0-9]/.test(ch))
      .map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[\\s\\-_./&()]*');
    if (!pattern) continue;
    const re = new RegExp(`(?<![${boundary}])${pattern}(?![${boundary}])`, 'i');
    const m = working.match(re);
    if (m) {
      const resolved = resolve(key);
      if (resolved && resolved.length) {
        hits.push({ text: m[0], key, matches: resolved, offset: m.index });
        working = mask(working, m.index, m.index + m[0].length);
      }
    }
  }
  return { hits, masked: working };
}

function resolveEngineSpan(span, index) {
  const raw = String(span).trim();
  if (!raw) return null;

  const exact = index.enginesByExactCode.get(raw.toUpperCase());
  if (exact && exact.length) return { text: raw, matches: exact, method: 'exact' };

  const byKey = index.enginesByKey.get(lookupKey(raw));
  if (byKey && byKey.length) return { text: raw, matches: byKey, method: 'normalized' };

  if (raw.includes('/')) {
    const candidates = expandSlashToken(raw);
    const confirmed = [];
    const unconfirmed = [];
    for (const candidate of candidates) {
      const hit = index.enginesByKey.get(lookupKey(candidate));
      if (hit && hit.length) {
        for (const engine of hit) {
          if (!confirmed.some((e) => e.engine_id === engine.engine_id)) confirmed.push(engine);
        }
      } else {
        unconfirmed.push(candidate);
      }
    }
    if (confirmed.length) {
      return { text: raw, matches: confirmed, method: 'expanded', unconfirmed };
    }
    return { text: raw, matches: [], method: 'unresolved', unconfirmed: candidates };
  }

  return { text: raw, matches: [], method: 'unresolved' };
}

function fuzzyResolveModel(spanText, index) {
  const key = nameKey(spanText);
  if (key.length < 5) return null;
  let best = null;
  for (const [candidateKey, rows] of index.modelsByKey.entries()) {
    if (Math.abs(candidateKey.length - key.length) > 2) continue;
    const distance = levenshtein(key, candidateKey);
    if (distance <= 2 && (!best || distance < best.distance)) {
      best = { distance, rows };
    }
  }
  return best ? best.rows : null;
}

// ---------------------------------------------------------------------------
// Clause parsing
// ---------------------------------------------------------------------------

function looksLikeEngineCode(token) {
  const raw = String(token).trim();
  if (!raw) return false;
  if (/[0-9]/.test(raw)) return true;
  if (/[/]/.test(raw)) return true;
  if (raw.length <= 4 && raw === raw.toUpperCase() && /^[A-Z]+$/.test(raw)) return true;
  return false;
}

function parseClause(clause, index, effect = 'include') {
  let working = clause;

  const makeHit = matchNameSpans(working, index.makeNameTokens, (k) => index.makesByKey.get(k));
  working = makeHit.masked;

  const modelHit = matchNameSpans(working, index.modelNameTokens, (k) => index.modelsByKey.get(k));
  working = modelHit.masked;

  const knownEngineHit = matchNameSpans(
    working,
    index.engineCodeTokens || [],
    (k) => (index.enginesByNameKey ? index.enginesByNameKey.get(k) : null),
    'A-Za-z0-9/_.\\-'
  );
  working = knownEngineHit.masked;

  const years = extractYears(working);
  working = years.masked;

  const displacement = extractDisplacement(working);
  working = displacement.masked;

  const fuel = extractFuel(working);
  working = fuel.masked;

  const engineSpans = knownEngineHit.hits.map((hit) => ({
    text: hit.text,
    matches: hit.matches,
    method: 'known',
    offset: hit.offset,
  }));
  const engineMatches = working.match(ENGINE_TOKEN_RE) || [];
  for (const span of engineMatches) {
    const trimmed = span.trim();
    if (!trimmed || STOPWORDS.has(trimmed.toUpperCase())) continue;

    const resolved = resolveEngineSpan(trimmed, index);
    if (!resolved) continue;

    if (!resolved.matches.length && !looksLikeEngineCode(trimmed)) continue;

    const idx = working.indexOf(span);
    engineSpans.push({ ...resolved, offset: idx >= 0 ? idx : undefined });
    if (idx >= 0) working = mask(working, idx, idx + span.length);
  }

  const residue = working
    .split(/[^A-Za-z0-9.\-/]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !STOPWORDS.has(t.toUpperCase()));

  const fuzzyModels = [];
  const stillResidue = [];
  for (const token of residue) {
    const fuzzy = modelHit.hits.length ? null : fuzzyResolveModel(token, index);
    if (fuzzy && fuzzy.length) {
      fuzzyModels.push({ text: token, matches: fuzzy, fuzzy: true });
    } else {
      stillResidue.push(token);
    }
  }

  return {
    makes: makeHit.hits,
    models: [...modelHit.hits, ...fuzzyModels],
    engines: engineSpans,
    yearStart: years.yearStart,
    yearEnd: years.yearEnd,
    displacement: displacement.displacement,
    fuel: fuel.fuel,
    effect,
    residue: stillResidue,
  };
}

// ---------------------------------------------------------------------------
// Row assembly
// ---------------------------------------------------------------------------

function buildRows(parsed, index) {
  const makeOptions = parsed.makes.length ? parsed.makes : [null];
  const modelOptions = parsed.models.length ? parsed.models : [null];
  const engineOptions = parsed.engines.length ? parsed.engines : [null];

  const rows = [];

  for (const makeHit of makeOptions) {
    for (const modelHit of modelOptions) {
      for (const engineHit of engineOptions) {
        const makeRow = pickSingle(makeHit);
        const modelRow = pickSingle(modelHit, makeRow ? (m) => m.make_id === makeRow.make_id : null);

        const modelConflicts = modelHit && modelHit.matches.length > 0 && !modelRow;

        let engineRows = engineHit ? engineHit.matches : [];
        let engineInferred = false;

        if (!engineHit && parsed.displacement != null && modelRow) {
          const inferred = inferEngineFromDisplacement(modelRow, parsed.displacement, index);
          if (inferred) {
            engineRows = [inferred];
            engineInferred = true;
          }
        }

        const engineList = engineRows.length ? engineRows : [null];

        for (const engineRow of engineList) {
          const resolvedMake = makeRow || (modelRow ? index.makesById.get(modelRow.make_id) : null);
          rows.push(
            assembleRow({
              parsed,
              makeHit,
              modelHit,
              engineHit,
              makeRow: resolvedMake || null,
              modelRow: modelConflicts ? null : modelRow,
              engineRow,
              engineInferred,
            })
          );
        }
      }
    }
  }

  return rows.filter((r) => r.make || r.model || r.engine);
}

function inferEngineFromDisplacement(modelRow, displacement, index) {
  const known = index.modelEngines && index.modelEngines.get(modelRow.model_id);
  if (!known || known.size === 0) return null;

  const matches = [];
  for (const engineId of known) {
    const engine = index.enginesById.get(engineId);
    if (!engine || engine.displacement_liters == null) continue;
    if (Math.abs(Number(engine.displacement_liters) - displacement) < 0.005) matches.push(engine);
  }
  return matches.length === 1 ? matches[0] : null;
}

function pickSingle(hit, predicate) {
  if (!hit || !hit.matches || hit.matches.length === 0) return null;
  const candidates = predicate ? hit.matches.filter(predicate) : hit.matches;
  if (candidates.length !== 1) return null;
  return candidates[0];
}

function assembleRow({ parsed, makeHit, modelHit, engineHit, makeRow, modelRow, engineRow, engineInferred }) {
  const displacement =
    parsed.displacement != null
      ? parsed.displacement
      : engineRow && engineRow.displacement_liters != null
        ? Number(engineRow.displacement_liters)
        : null;

  const fuel =
    parsed.fuel ||
    (engineRow && VALID_FUEL_TYPES.includes(engineRow.fuel_type) ? engineRow.fuel_type : null);

  let [yearStart, yearEnd] = [parsed.yearStart, parsed.yearEnd];
  if (yearStart != null && yearEnd != null && yearStart > yearEnd) {
    [yearStart, yearEnd] = [yearEnd, yearStart];
  }

  const namedButUnresolved =
    (makeHit && !makeRow) || (modelHit && !modelRow) || (engineHit && !engineRow);
  const usedFuzzy = Boolean(modelHit && modelHit.fuzzy);

  let confidence = 'high';
  if (namedButUnresolved || parsed.residue.length) confidence = 'low';
  else if (usedFuzzy || engineInferred) confidence = 'medium';

  return {
    make: makeRow ? makeRow.make_name : makeHit ? makeHit.text : null,
    make_id: makeRow ? makeRow.make_id : null,
    model: modelRow ? modelRow.model_name : modelHit ? modelHit.text : null,
    model_id: modelRow ? modelRow.model_id : null,
    engine: engineRow ? engineRow.engine_code : engineHit ? engineHit.text : null,
    engine_id: engineRow ? engineRow.engine_id : null,
    displacement_liters: displacement,
    fuel_type: fuel,
    year_start: yearStart,
    year_end: yearEnd,
    effect: parsed.effect || 'include',
    confidence,
    source: 'local',
  };
}

function splitPairedSlashClauses(clauses, index) {
  if (!index) return clauses;
  const out = [];
  for (const clause of clauses) {
    if (!/\s+\/\s+/.test(clause)) {
      out.push(clause);
      continue;
    }
    const wholeKey = nameKey(clause);
    if (
      (index.makesByKey && index.makesByKey.has(wholeKey)) ||
      (index.modelsByKey && index.modelsByKey.has(wholeKey))
    ) {
      out.push(clause);
      continue;
    }
    const parts = clause.split(/\s+\/\s+/).map((p) => p.trim()).filter(Boolean);
    const allHaveVehicle = parts.length > 1 && parts.every((seg) => {
      const mkHit = matchNameSpans(seg, index.makeNameTokens || [], (k) => index.makesByKey.get(k));
      const mdHit = matchNameSpans(seg, index.modelNameTokens || [], (k) => index.modelsByKey.get(k));
      return mkHit.hits.length > 0 || mdHit.hits.length > 0;
    });
    if (allHaveVehicle) {
      out.push(...parts);
    } else {
      out.push(clause);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function parseFitmentText(text, index) {
  const clean = String(text || '').trim();
  if (!clean) {
    return { fitments: [], residue: [], unresolvedClauses: [], fullyResolved: true };
  }

  const baseClauses = clean.split(CLAUSE_SPLIT_RE).map((c) => c.trim()).filter(Boolean);
  const clauses = splitPairedSlashClauses(baseClauses, index);

  const rows = [];
  const residue = [];
  const unresolvedClauses = [];

  let carried = { makes: [], models: [], yearStart: null, yearEnd: null, displacement: null, fuel: null };

  for (const rawClause of clauses) {
    // Check if clause has an inline exclusion ("Toyota Hilux except 2010")
    const exMatch = EXCLUSION_SPLIT_RE.exec(rawClause);
    if (exMatch) {
      const beforeEx = rawClause.slice(0, exMatch.index).trim();
      const afterEx = rawClause.slice(exMatch.index + exMatch[0].length).trim();

      if (beforeEx) {
        const posParsed = parseClause(beforeEx, index, 'include');
        if (!posParsed.makes.length && carried.makes.length && posParsed.models.length) {
          posParsed.makes = carried.makes;
        }
        rows.push(...buildRows(posParsed, index));
        if (posParsed.residue.length) {
          residue.push(...posParsed.residue);
          unresolvedClauses.push(beforeEx);
        }
        carried = {
          makes: posParsed.makes.length ? posParsed.makes : carried.makes,
          models: posParsed.models.length ? posParsed.models : carried.models,
          yearStart: posParsed.yearStart ?? carried.yearStart,
          yearEnd: posParsed.yearEnd ?? carried.yearEnd,
          displacement: posParsed.displacement ?? carried.displacement,
          fuel: posParsed.fuel || carried.fuel,
        };
      }

      if (afterEx) {
        const negParsed = parseClause(afterEx, index, 'exclude');
        if (!negParsed.makes.length && carried.makes.length) {
          negParsed.makes = carried.makes;
        }
        if (!negParsed.models.length && carried.models.length) {
          negParsed.models = carried.models;
        }
        rows.push(...buildRows(negParsed, index));
        if (negParsed.residue.length) {
          residue.push(...negParsed.residue);
          unresolvedClauses.push(afterEx);
        }
      }
      continue;
    }

    const explicitYearCarry = EXPLICIT_YEAR_CARRY_RE.test(rawClause);
    const explicitSpecCarry = EXPLICIT_SPEC_CARRY_RE.test(rawClause);
    const parsed = parseClause(rawClause, index, 'include');

    const rawYearStart = parsed.yearStart;
    const rawYearEnd = parsed.yearEnd;
    const rawDisplacement = parsed.displacement;
    const rawFuel = parsed.fuel;

    if (!parsed.makes.length && carried.makes.length && parsed.models.length) {
      parsed.makes = carried.makes;
    }
    if (parsed.yearStart == null && parsed.yearEnd == null && explicitYearCarry) {
      parsed.yearStart = carried.yearStart;
      parsed.yearEnd = carried.yearEnd;
    }
    if (parsed.displacement == null && explicitSpecCarry) {
      parsed.displacement = carried.displacement;
    }
    if (!parsed.fuel && explicitSpecCarry) {
      parsed.fuel = carried.fuel;
    }

    const namesSomething = parsed.makes.length || parsed.models.length || parsed.engines.length;
    if (!namesSomething) {
      if (parsed.residue.length) {
        residue.push(...parsed.residue);
        unresolvedClauses.push(rawClause);
      }
      continue;
    }

    rows.push(...buildRows(parsed, index));

    if (parsed.residue.length) {
      residue.push(...parsed.residue);
      unresolvedClauses.push(rawClause);
    }

    carried = {
      makes: parsed.makes.length ? parsed.makes : carried.makes,
      models: parsed.models.length ? parsed.models : carried.models,
      yearStart: rawYearStart !== null || rawYearEnd !== null ? rawYearStart : carried.yearStart,
      yearEnd: rawYearStart !== null || rawYearEnd !== null ? rawYearEnd : carried.yearEnd,
      displacement: rawDisplacement !== null ? rawDisplacement : carried.displacement,
      fuel: rawFuel || carried.fuel,
    };
  }

  const deduped = dedupeRows(rows);
  const fullyResolved =
    residue.length === 0 &&
    deduped.length > 0 &&
    deduped.every((r) => r.confidence === 'high');

  const safeForLocalOnly =
    fullyResolved &&
    deduped.every(
      (row) =>
        row.engine_id != null ||
        (row.make_id != null &&
          row.model_id != null &&
          row.year_start != null &&
          row.year_end != null)
    );

  if (index && typeof index === 'object') {
    const makeIds = new Set();
    const modelIds = new Set();
    const engineIds = new Set();
    for (const r of deduped) {
      if (r.make_id != null) makeIds.add(r.make_id);
      if (r.model_id != null) modelIds.add(r.model_id);
      if (r.engine_id != null) engineIds.add(r.engine_id);
    }
    try {
      Object.defineProperty(index, '_lastRecognized', {
        value: { makeIds, modelIds, engineIds },
        configurable: true,
        writable: true,
      });
    } catch (_e) {
      // Ignore if frozen
    }
  }

  return { fitments: deduped, residue, unresolvedClauses, fullyResolved, safeForLocalOnly };
}

function dedupeRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = [
      row.effect || 'include',
      row.make_id,
      row.model_id,
      row.engine_id,
      row.make,
      row.model,
      row.engine,
      row.year_start,
      row.year_end,
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/**
 * Narrows the taxonomy to the rows plausibly relevant to text the local pass
 * could not account for, while preserving already-recognized makes, models,
 * and linked engines from the current parse (`B09` / `F07`).
 */
function buildShortlist(residueTokens, index, perDimension = 8, localResult = null) {
  const tokens = (residueTokens || []).map(nameKey).filter((t) => t.length >= 2);
  if (!tokens.length) return { makes: [], models: [], engines: [] };

  const score = (candidateKey) => {
    let best = Infinity;
    for (const token of tokens) {
      if (candidateKey.includes(token) || token.includes(candidateKey)) return 0;
      best = Math.min(best, levenshtein(token, candidateKey));
    }
    return best;
  };

  const pick = (rows, keyOf) =>
    rows
      .map((row) => ({ row, distance: score(nameKey(keyOf(row))) }))
      .filter((entry) => entry.distance <= 3)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, perDimension)
      .map((entry) => entry.row);

  const makes = pick(index.makes, (r) => r.make_name);
  const models = pick(index.models, (r) => r.model_name);
  const engines = pick(index.engines, (r) => r.engine_code);

  const hasResidueHit = makes.length > 0 || models.length > 0 || engines.length > 0;
  if (!hasResidueHit && !localResult) {
    return { makes, models, engines };
  }

  const recMakeIds = new Set();
  const recModelIds = new Set();
  const recEngineIds = new Set();

  if (localResult && Array.isArray(localResult.fitments)) {
    for (const f of localResult.fitments) {
      if (f.make_id != null) recMakeIds.add(f.make_id);
      if (f.model_id != null) recModelIds.add(f.model_id);
      if (f.engine_id != null) recEngineIds.add(f.engine_id);
    }
  } else if (index && index._lastRecognized) {
    for (const id of index._lastRecognized.makeIds) recMakeIds.add(id);
    for (const id of index._lastRecognized.modelIds) recModelIds.add(id);
    for (const id of index._lastRecognized.engineIds) recEngineIds.add(id);
  }

  for (const mkId of recMakeIds) {
    const mk = index.makesById && index.makesById.get(mkId);
    if (mk && !makes.some((m) => m.make_id === mk.make_id)) {
      makes.push(mk);
    }
  }

  for (const mdId of recModelIds) {
    const md = index.modelsById && index.modelsById.get(mdId);
    if (md && !models.some((m) => m.model_id === md.model_id)) {
      models.push(md);
    }
  }

  for (const md of models) {
    const mk = index.makesById && index.makesById.get(md.make_id);
    if (mk && !makes.some((m) => m.make_id === mk.make_id)) {
      makes.push(mk);
    }
    const knownEngs = index.modelEngines && index.modelEngines.get(md.model_id);
    if (knownEngs) {
      for (const engId of knownEngs) {
        recEngineIds.add(engId);
      }
    }
  }

  for (const engId of recEngineIds) {
    const eng = index.enginesById && index.enginesById.get(engId);
    if (eng && !engines.some((e) => e.engine_id === eng.engine_id)) {
      engines.push(eng);
    }
  }

  return { makes, models, engines };
}

module.exports = { parseFitmentText, buildShortlist, VALID_FUEL_TYPES };
