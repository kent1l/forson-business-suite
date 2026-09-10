// Deterministic natural-language fitment parser (Vehicle Fitment Phase 7).
// See docs/plans/2026-09-10_fitment-parsing-linking-display.md §7.
//
// Handles the regular majority of staff fitment input without an LLM. Only
// genuine residue -- text this module could not account for -- is escalated to
// vehicleFitmentParserAI, and then with a shortlist prompt rather than the whole
// taxonomy.
//
// This module is PURE: taxonomy in, candidate rows out. No DB, no network, no
// clock. That is what makes the engine-code rules (where the correctness risk
// concentrates) cheap to test exhaustively.
//
// Like the AI parser, it only ever PROPOSES. Every row goes to the review panel
// and is committed through the normal /applications endpoints, which
// independently re-validate ids. When matching is uncertain this module emits
// the raw text with a null id rather than a guess -- a confidently wrong match
// is worse than no match.

const {
    ENGINE_TOKEN_RE,
    lookupKey,
    expandSlashToken,
} = require('./engineCodeGrammar');
const { nameKey } = require('./vehicleTaxonomyIndex');

const VALID_FUEL_TYPES = ['diesel', 'gasoline', 'hybrid', 'mild_hybrid', 'electric', 'other'];

// Market shorthand for fuel, mapped onto the engine_fuel_type_chk values
// established in 20260909_05.
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

// Words that carry no fitment information; leftover text made only of these is
// not treated as residue and so does not trigger an AI escalation.
const STOPWORDS = new Set([
    'FITS', 'FIT', 'FITMENT', 'FOR', 'ALSO', 'SAME', 'YEAR', 'YEARS', 'YR', 'YRS',
    'THE', 'ALL', 'AND', 'OR', 'WITH', 'MODEL', 'MODELS', 'ENGINE', 'ENGINES',
    'UP', 'TO', 'FROM', 'ONWARDS', 'ONWARD', 'SERIES', 'TYPE', 'VARIANT',
    'APPLICABLE', 'USE', 'USED', 'ON', 'IN', 'OF', 'A', 'AN', 'ANY', 'BOTH',
]);

// `+` joins clauses ("Hilux + Fortuner") but also marks an open-ended year
// range ("2015+"), so it only separates when it does not directly follow a
// digit -- otherwise the year marker would be split off and read as a bare
// single year.
const CLAUSE_SPLIT_RE = /\s*(?:[;\n,]|\band\b|\balso\b|(?<!\d)\+)\s*/i;

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
        // 2005-2015 / 2005 to 2015 / 2005–2015
        [/\b(19|20)(\d{2})\s*(?:-|–|—|to|thru|through)\s*(19|20)(\d{2})\b/i,
            m => [Number(m[1] + m[2]), Number(m[3] + m[4])]],
        // '05-'15 / 05-15
        [/(?:^|\s)'?(\d{2})\s*(?:-|–|to)\s*'?(\d{2})(?=\s|$)/,
            m => [expandTwoDigitYear(m[1]), expandTwoDigitYear(m[2])]],
        // 2015+ / 2015 onwards / 2015 up. The `+` alternative carries no
        // trailing \b: `+` is a non-word character, so at end-of-input there is
        // no boundary for \b to match and the whole pattern would fail.
        [/\b(19|20)(\d{2})\s*(?:\+|\b(?:onwards?|up)\b)/i,
            m => [Number(m[1] + m[2]), null]],
        // up to 2018 / until 2018
        [/\b(?:up\s+to|until|till|thru)\s*(19|20)(\d{2})\b/i,
            m => [null, Number(m[1] + m[2])]],
        // bare single year
        [/\b(19|20)(\d{2})\b/,
            m => { const y = Number(m[1] + m[2]); return [y, y]; }],
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
    // Two-digit years in this catalog are vehicle model years: 70-99 read as
    // 19xx, 00-69 as 20xx.
    return n >= 70 ? 1900 + n : 2000 + n;
}

function extractDisplacement(text) {
    const patterns = [
        [/\b(\d(?:\.\d{1,2})?)\s*(?:L\b|LITERS?\b|LITRES?\b)/i, m => Number(m[1])],
        [/\b(\d{3,4})\s*cc\b/i, m => Number(m[1]) / 1000],
        [/\b(\d\.\d{1,2})\b/, m => Number(m[1])],
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

/**
 * Greedy longest-first literal span match against a name list, so multi-word
 * models ("Grand Vitara", "Mitsubishi Fuso") win over their first token.
 */
function matchNameSpans(text, nameTokens, resolve) {
    let working = text;
    const hits = [];
    for (const name of nameTokens) {
        const key = nameKey(name);
        if (!key) continue;
        // Match the name allowing arbitrary internal separator variance
        // (`Hi-Lux`, `Hi Lux`, `HiLux` are the same model).
        const pattern = name
            .split('')
            .filter(ch => /[A-Za-z0-9]/.test(ch))
            .map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('[\\s\\-_.]*');
        if (!pattern) continue;
        const re = new RegExp(`(?<![A-Za-z0-9])${pattern}(?![A-Za-z0-9])`, 'i');
        const m = working.match(re);
        if (m) {
            const resolved = resolve(key);
            if (resolved && resolved.length) {
                hits.push({ text: m[0], key, matches: resolved });
                working = mask(working, m.index, m.index + m[0].length);
            }
        }
    }
    return { hits, masked: working };
}

/**
 * Resolves an engine span to real engine rows.
 *
 * Order is deliberate and is the safety mechanism for the whole module:
 *   1. exact code as typed
 *   2. normalized key (case/spacing/hyphen variance only -- `4JA1-T` never
 *      collapses into `4JA1`)
 *   3. alias
 *   4. slash expansion, with EVERY expansion confirmed against the taxonomy
 *
 * Engine codes are never fuzzy-matched: `4D55` and `4D56` are edit distance 1
 * and are different engines. An unresolved span keeps its raw text and a null
 * id for a human to resolve.
 */
function resolveEngineSpan(span, index) {
    const raw = String(span).trim();
    if (!raw) return null;

    const exact = index.enginesByExactCode.get(raw.toUpperCase());
    if (exact && exact.length) return { text: raw, matches: exact, method: 'exact' };

    // Covers both the normalized code and any alias, since both were indexed
    // into enginesByKey under the same key function.
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
                    if (!confirmed.some(e => e.engine_id === engine.engine_id)) confirmed.push(engine);
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
    // Too short to fuzzy-match safely -- `JT` vs `JX` is one edit apart.
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

/**
 * Whether an unresolved span is shaped like an engine code rather than an
 * ordinary word. Real codes carry a digit ("4JA1", "1TR-FE"), a separator
 * ("4D55/6"), or are short all-caps designations ("JT"). Sentence words are
 * none of those.
 */
function looksLikeEngineCode(token) {
    const raw = String(token).trim();
    if (!raw) return false;
    if (/[0-9]/.test(raw)) return true;
    if (/[/]/.test(raw)) return true;
    // All-caps and short: a plausible bare designation the catalog has not seen
    // yet. Longer all-caps words are far more likely to be shouted prose.
    if (raw.length <= 4 && raw === raw.toUpperCase() && /^[A-Z]+$/.test(raw)) return true;
    return false;
}

function parseClause(clause, index) {
    let working = clause;

    // Names first: a model like "L300" would otherwise be eaten by the
    // displacement or engine-token patterns.
    const makeHit = matchNameSpans(working, index.makeNameTokens, k => index.makesByKey.get(k));
    working = makeHit.masked;

    const modelHit = matchNameSpans(working, index.modelNameTokens, k => index.modelsByKey.get(k));
    working = modelHit.masked;

    const years = extractYears(working);
    working = years.masked;

    const displacement = extractDisplacement(working);
    working = displacement.masked;

    const fuel = extractFuel(working);
    working = fuel.masked;

    // Engine codes last, over whatever text no earlier pass claimed.
    const engineSpans = [];
    const engineMatches = working.match(ENGINE_TOKEN_RE) || [];
    for (const span of engineMatches) {
        const trimmed = span.trim();
        if (!trimmed || STOPWORDS.has(trimmed.toUpperCase())) continue;

        const resolved = resolveEngineSpan(trimmed, index);
        if (!resolved) continue;

        // The token pattern is deliberately loose, so it also nominates
        // ordinary words ("Grand", "van"). A span that resolves to a real
        // engine is kept regardless of shape; one that does not is only kept
        // if it actually looks like a code. Otherwise a stray adjective would
        // become a junk "(new engine)" row for staff to clean up, which is
        // worse than leaving the word as residue for the AI to interpret.
        if (!resolved.matches.length && !looksLikeEngineCode(trimmed)) continue;

        engineSpans.push(resolved);
        const idx = working.indexOf(span);
        if (idx >= 0) working = mask(working, idx, idx + span.length);
    }

    // Anything still standing that isn't a stopword is residue -- the signal
    // that this clause needs a human or the AI fallback.
    const residue = working
        .split(/[^A-Za-z0-9.\-/]+/)
        .map(t => t.trim())
        .filter(Boolean)
        .filter(t => !STOPWORDS.has(t.toUpperCase()));

    // A residue token that looks like a model name gets one fuzzy attempt.
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
        residue: stillResidue,
    };
}

// ---------------------------------------------------------------------------
// Row assembly
// ---------------------------------------------------------------------------

/**
 * When a clause names several models and several engines, the honest reading is
 * one fitment per make+model+engine combination -- the same rule the AI prompt
 * already states.
 */
function buildRows(parsed, index) {
    const makeOptions = parsed.makes.length ? parsed.makes : [null];
    const modelOptions = parsed.models.length ? parsed.models : [null];
    const engineOptions = parsed.engines.length ? parsed.engines : [null];

    const rows = [];

    for (const makeHit of makeOptions) {
        for (const modelHit of modelOptions) {
            for (const engineHit of engineOptions) {
                const makeRow = pickSingle(makeHit);
                let modelRow = pickSingle(modelHit, makeRow ? m => m.make_id === makeRow.make_id : null);

                // A model resolved under a different make than the one stated
                // is not a safe match -- keep the text, drop the ids, let the
                // reviewer resolve it rather than silently attaching the wrong
                // make.
                const modelConflicts = modelHit && modelHit.matches.length > 0 && !modelRow;

                let engineRows = engineHit ? engineHit.matches : [];
                let engineInferred = false;

                // No engine named, but a bare displacement was: if this model
                // has exactly one engine of that displacement already recorded
                // against it in the catalog, that is almost certainly the one
                // meant. Proposed at medium confidence -- it is an inference,
                // and the reviewer still confirms it.
                if (!engineHit && parsed.displacement != null && modelRow) {
                    const inferred = inferEngineFromDisplacement(modelRow, parsed.displacement, index);
                    if (inferred) {
                        engineRows = [inferred];
                        engineInferred = true;
                    }
                }

                // One engine span can legitimately resolve to several engines
                // (`4D55/6`); each becomes its own row, individually linked.
                const engineList = engineRows.length ? engineRows : [null];

                for (const engineRow of engineList) {
                    const resolvedMake = makeRow || (modelRow ? index.makesById.get(modelRow.make_id) : null);
                    rows.push(assembleRow({
                        parsed,
                        makeHit,
                        modelHit,
                        engineHit,
                        makeRow: resolvedMake || null,
                        modelRow: modelConflicts ? null : modelRow,
                        engineRow,
                        engineInferred,
                    }));
                }
            }
        }
    }

    return rows.filter(r => r.make || r.model || r.engine);
}

/**
 * Picks the engine already fitted to this model at the stated displacement --
 * but only when exactly one qualifies. Two candidates means the text really is
 * ambiguous, and guessing would be worse than leaving it for the reviewer.
 */
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
    // Ambiguous (several taxonomy rows share this name) -- do not guess.
    if (candidates.length !== 1) return null;
    return candidates[0];
}

function assembleRow({ parsed, makeHit, modelHit, engineHit, makeRow, modelRow, engineRow, engineInferred }) {
    const displacement = parsed.displacement != null
        ? parsed.displacement
        : (engineRow && engineRow.displacement_liters != null ? Number(engineRow.displacement_liters) : null);

    const fuel = parsed.fuel || (engineRow && VALID_FUEL_TYPES.includes(engineRow.fuel_type) ? engineRow.fuel_type : null);

    let [yearStart, yearEnd] = [parsed.yearStart, parsed.yearEnd];
    if (yearStart != null && yearEnd != null && yearStart > yearEnd) [yearStart, yearEnd] = [yearEnd, yearStart];

    const namedButUnresolved =
        (makeHit && !makeRow) ||
        (modelHit && !modelRow) ||
        (engineHit && !engineRow);
    const usedFuzzy = Boolean(modelHit && modelHit.fuzzy);

    let confidence = 'high';
    if (namedButUnresolved || parsed.residue.length) confidence = 'low';
    else if (usedFuzzy || engineInferred) confidence = 'medium';

    return {
        make: makeRow ? makeRow.make_name : (makeHit ? makeHit.text : null),
        make_id: makeRow ? makeRow.make_id : null,
        model: modelRow ? modelRow.model_name : (modelHit ? modelHit.text : null),
        model_id: modelRow ? modelRow.model_id : null,
        engine: engineRow ? engineRow.engine_code : (engineHit ? engineHit.text : null),
        engine_id: engineRow ? engineRow.engine_id : null,
        displacement_liters: displacement,
        fuel_type: fuel,
        year_start: yearStart,
        year_end: yearEnd,
        confidence,
        source: 'local',
    };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Parses free-text fitment input against the taxonomy index.
 *
 * Returns candidate rows in exactly the shape vehicleFitmentParserAI already
 * returns, so the existing review panel renders local and AI results
 * interchangeably, plus the residue the caller uses to decide whether to
 * escalate.
 */
function parseFitmentText(text, index) {
    const clean = String(text || '').trim();
    if (!clean) {
        return { fitments: [], residue: [], unresolvedClauses: [], fullyResolved: true };
    }

    const clauses = clean.split(CLAUSE_SPLIT_RE).map(c => c.trim()).filter(Boolean);

    const rows = [];
    const residue = [];
    const unresolvedClauses = [];

    // Context carried forward across clauses: "Hilux 2005-2015 2.5L diesel,
    // also Fortuner same years" means the second clause inherits everything it
    // does not restate.
    let carried = { makes: [], yearStart: null, yearEnd: null, displacement: null, fuel: null };

    for (const clause of clauses) {
        const parsed = parseClause(clause, index);

        if (!parsed.makes.length && carried.makes.length && parsed.models.length) {
            parsed.makes = carried.makes;
        }
        if (parsed.yearStart == null && parsed.yearEnd == null) {
            parsed.yearStart = carried.yearStart;
            parsed.yearEnd = carried.yearEnd;
        }
        if (parsed.displacement == null) parsed.displacement = carried.displacement;
        if (!parsed.fuel) parsed.fuel = carried.fuel;

        // A clause naming nothing at all is filler ("same years"), not residue.
        const namesSomething = parsed.makes.length || parsed.models.length || parsed.engines.length;
        if (!namesSomething) {
            if (parsed.residue.length) {
                residue.push(...parsed.residue);
                unresolvedClauses.push(clause);
            }
            continue;
        }

        rows.push(...buildRows(parsed, index));

        if (parsed.residue.length) {
            residue.push(...parsed.residue);
            unresolvedClauses.push(clause);
        }

        carried = {
            makes: parsed.makes.length ? parsed.makes : carried.makes,
            yearStart: parsed.yearStart,
            yearEnd: parsed.yearEnd,
            displacement: parsed.displacement,
            fuel: parsed.fuel,
        };
    }

    const deduped = dedupeRows(rows);
    const fullyResolved = residue.length === 0
        && deduped.length > 0
        && deduped.every(r => r.confidence === 'high');

    return { fitments: deduped, residue, unresolvedClauses, fullyResolved };
}

function dedupeRows(rows) {
    const seen = new Set();
    const out = [];
    for (const row of rows) {
        const key = [
            row.make_id, row.model_id, row.engine_id,
            row.make, row.model, row.engine,
            row.year_start, row.year_end,
        ].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(row);
    }
    return out;
}

/**
 * Narrows the taxonomy to the rows plausibly relevant to text the local pass
 * could not account for.
 *
 * This is what lets the AI fallback stop carrying the entire taxonomy in its
 * prompt. Previously every call serialised all makes, models and engines --
 * a prompt that grew with the catalog rather than with the difficulty of the
 * input. The shortlist is scored by edit distance against the residue, so the
 * model sees a handful of genuinely near candidates instead of hundreds of
 * irrelevant ones.
 */
function buildShortlist(residueTokens, index, perDimension = 8) {
    const tokens = (residueTokens || []).map(nameKey).filter(t => t.length >= 2);
    if (!tokens.length) return { makes: [], models: [], engines: [] };

    const score = (candidateKey) => {
        let best = Infinity;
        for (const token of tokens) {
            if (candidateKey.includes(token) || token.includes(candidateKey)) return 0;
            best = Math.min(best, levenshtein(token, candidateKey));
        }
        return best;
    };

    const pick = (rows, keyOf) => rows
        .map(row => ({ row, distance: score(nameKey(keyOf(row))) }))
        .filter(entry => entry.distance <= 3)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, perDimension)
        .map(entry => entry.row);

    return {
        makes: pick(index.makes, r => r.make_name),
        models: pick(index.models, r => r.model_name),
        engines: pick(index.engines, r => r.engine_code),
    };
}

module.exports = { parseFitmentText, buildShortlist, VALID_FUEL_TYPES };
