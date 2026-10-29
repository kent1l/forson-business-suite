'use strict';

/**
 * Tri-state vehicle fitment matcher.
 * States:
 *  - 'confirmed': Rule(s) positively match all queried dimensions and require no unprovided vehicle details.
 *  - 'needs_details': Rule(s) match the known dimensions, but either the rule is narrower than the query
 *                     (requires engine/year/qualifier not supplied in query) or the rule is broader with
 *                     mode 'not_supplied' / 'unknown' (not verified as 'unrestricted') or unapproved.
 *  - 'conflict': An explicit exclusion rule matches, or a rule for the same make/model explicitly specifies
 *                a conflicting engine, year range, chassis, or fuel/qualifier.
 *  - 'no_match': No rule applies to the queried make/model/chassis/engine.
 */

function normalizeStr(val) {
  return typeof val === 'string' ? val.trim().toLowerCase() : '';
}

function yearMatchesRule(queryYear, queryYearStart, queryYearEnd, ruleYearStart, ruleYearEnd) {
  const qStart = queryYear != null ? Number(queryYear) : (queryYearStart != null ? Number(queryYearStart) : null);
  const qEnd = queryYear != null ? Number(queryYear) : (queryYearEnd != null ? Number(queryYearEnd) : qStart);
  if (qStart == null && qEnd == null) return null; // query did not supply year
  const rStart = ruleYearStart != null ? Number(ruleYearStart) : 1900;
  const rEnd = ruleYearEnd != null ? Number(ruleYearEnd) : 2100;
  const effQStart = qStart ?? qEnd;
  const effQEnd = qEnd ?? qStart;
  return effQStart <= rEnd && effQEnd >= rStart;
}

/**
 * Evaluate a single rule against a vehicle query.
 * @param {object} rule - Rule / application row
 * @param {object} query - { make_id, model_id, chassis_id, engine_id, year, year_start, year_end, fuel_type, market, variant, position, drivetrain, transmission }
 * @returns {{ state: 'confirmed'|'needs_details'|'conflict'|'no_match', reasons: string[] }}
 */
function evaluateSingleRule(rule, query = {}) {
  const reasons = [];
  const effect = rule.effect === 'exclude' ? 'exclude' : 'include';

  const makeMode = rule.make_mode || (rule.make_id != null ? 'specified' : 'not_supplied');
  const modelMode = rule.model_mode || (rule.model_id != null ? 'specified' : 'not_supplied');
  const chassisMode = rule.chassis_mode || (rule.chassis_id != null ? 'specified' : 'not_supplied');
  const engineMode = rule.engine_mode || (rule.engine_id != null ? 'specified' : 'not_supplied');
  const yearMode = rule.year_mode || (rule.year_start != null || rule.year_end != null ? 'specified' : 'not_supplied');

  // 1. Check Make
  if (rule.make_id != null && query.make_id != null && Number(rule.make_id) !== Number(query.make_id)) {
    return { state: 'no_match', reasons: ['make_mismatch'] };
  }
  if (rule.make_id == null && query.make_id != null) {
    if (makeMode !== 'unrestricted') {
      reasons.push('make_not_supplied_on_rule');
    }
  } else if (rule.make_id != null && query.make_id == null && query.model_id == null && query.chassis_id == null && query.engine_id == null) {
    reasons.push('make_not_supplied_in_query');
  }

  // 2. Check Model
  if (rule.model_id != null && query.model_id != null && Number(rule.model_id) !== Number(query.model_id)) {
    return { state: 'no_match', reasons: ['model_mismatch'] };
  }
  if (rule.model_id == null && query.model_id != null) {
    if (modelMode !== 'unrestricted') {
      reasons.push('model_not_supplied_on_rule');
    }
  } else if (rule.model_id != null && query.model_id == null) {
    reasons.push('model_required_by_rule');
  }

  // 3. Check Chassis
  if (rule.chassis_id != null && query.chassis_id != null && Number(rule.chassis_id) !== Number(query.chassis_id)) {
    return { state: 'conflict', reasons: ['chassis_conflict'] };
  }
  if (rule.chassis_id == null && query.chassis_id != null) {
    if (chassisMode !== 'unrestricted') {
      reasons.push('chassis_not_supplied_on_rule');
    }
  } else if (rule.chassis_id != null && query.chassis_id == null) {
    reasons.push('chassis_required_by_rule');
  }

  // 4. Check Engine (Fixes F11: explicit different engine on same make/model is a conflict, NEVER a match)
  if (rule.engine_id != null && query.engine_id != null && Number(rule.engine_id) !== Number(query.engine_id)) {
    return { state: 'conflict', reasons: ['engine_conflict'] };
  }
  if (rule.engine_id == null && query.engine_id != null) {
    if (engineMode !== 'unrestricted') {
      reasons.push('engine_not_supplied_on_rule');
    }
  } else if (rule.engine_id != null && query.engine_id == null) {
    reasons.push('engine_required_by_rule');
  }

  // 5. Check Year Range
  const hasRuleYear = rule.year_start != null || rule.year_end != null;
  const hasQueryYear = query.year != null || query.year_start != null || query.year_end != null;
  if (hasRuleYear && hasQueryYear) {
    const ym = yearMatchesRule(query.year, query.year_start, query.year_end, rule.year_start, rule.year_end);
    if (ym === false) {
      return { state: 'conflict', reasons: ['year_out_of_range'] };
    }
  } else if (!hasRuleYear && hasQueryYear) {
    if (yearMode !== 'unrestricted') {
      reasons.push('year_not_supplied_on_rule');
    }
  } else if (hasRuleYear && !hasQueryYear) {
    reasons.push('year_required_by_rule');
  }

  // 6. Check Fuel qualifier
  const ruleFuel = rule.fuel_type_qualifier || rule.fuel_type || null;
  if (ruleFuel && query.fuel_type) {
    if (normalizeStr(ruleFuel) !== normalizeStr(query.fuel_type)) {
      return { state: 'conflict', reasons: ['fuel_type_conflict'] };
    }
  } else if (ruleFuel && !query.fuel_type) {
    reasons.push('fuel_type_required_by_rule');
  }

  // 7. Check other qualifiers (market, variant, position, drivetrain, transmission)
  const qualifierPairs = [
    ['market', rule.market, query.market],
    ['variant', rule.variant_descriptor ?? rule.variant, query.variant],
    ['position', rule.position, query.position],
    ['drivetrain', rule.drivetrain, query.drivetrain],
    ['transmission', rule.transmission, query.transmission],
  ];
  for (const [name, rVal, qVal] of qualifierPairs) {
    if (rVal && qVal) {
      if (normalizeStr(rVal) !== normalizeStr(qVal)) {
        return { state: 'conflict', reasons: [`${name}_conflict`] };
      }
    } else if (rVal && !qVal) {
      reasons.push(`${name}_required_by_rule`);
    }
  }

  // If this is an exclusion rule:
  if (effect === 'exclude') {
    if (reasons.length === 0) {
      return { state: 'conflict', reasons: ['explicitly_excluded'] };
    }
    return { state: 'needs_details', reasons: ['potential_exclusion_needs_details', ...reasons] };
  }

  // Approval status check: if requireApproved is set on query and rule is not approved
  if (query.require_approved && rule.approval_status && rule.approval_status !== 'approved') {
    reasons.push(`rule_status_${rule.approval_status}`);
  }

  if (reasons.length > 0) {
    return { state: 'needs_details', reasons };
  }

  return { state: 'confirmed', reasons: [] };
}

/**
 * Evaluate a collection of rules for a single part against a vehicle query.
 * Exclusion rules take precedence over inclusion rules.
 */
function evaluateFitmentRules(rules = [], query = {}) {
  if (!Array.isArray(rules) || rules.length === 0) {
    return { state: 'no_match', status: 'no_match', reasons: ['no_rules'], matchedRules: [] };
  }

  const activeRules = rules.filter((r) => r && r.is_active !== false);
  const excludeRules = activeRules.filter((r) => r.effect === 'exclude');
  const includeRules = activeRules.filter((r) => r.effect !== 'exclude');

  // 1. Check explicit exclusions first
  let potentialExclusionReasons = null;
  for (const exRule of excludeRules) {
    const res = evaluateSingleRule(exRule, query);
    if (res.state === 'conflict' && res.reasons.includes('explicitly_excluded')) {
      return { state: 'conflict', status: 'excluded', reasons: res.reasons, matchedRules: [exRule] };
    }
    if (res.state === 'needs_details' && res.reasons.includes('potential_exclusion_needs_details')) {
      potentialExclusionReasons = res.reasons;
    }
  }

  // 2. Evaluate inclusion rules
  const confirmed = [];
  const needsDetails = [];
  const conflicts = [];

  for (const incRule of includeRules) {
    const res = evaluateSingleRule(incRule, query);
    if (res.state === 'confirmed') {
      confirmed.push({ rule: incRule, reasons: res.reasons });
    } else if (res.state === 'needs_details') {
      needsDetails.push({ rule: incRule, reasons: res.reasons });
    } else if (res.state === 'conflict') {
      conflicts.push({ rule: incRule, reasons: res.reasons });
    }
  }

  if (confirmed.length > 0) {
    if (potentialExclusionReasons) {
      return {
        state: 'needs_details',
        status: 'needs_details',
        reasons: potentialExclusionReasons,
        matchedRules: confirmed.map((c) => c.rule),
      };
    }
    // Unverified legacy rules cannot produce a confirmed_compatible status when verification is checked
    const hasVerifiedOrApproved = confirmed.some(
      (c) =>
        (!c.rule.approval_status && !c.rule.evidence_status) ||
        (c.rule.approval_status === 'approved' && c.rule.evidence_status !== 'legacy_unverified')
    );
    if (!hasVerifiedOrApproved) {
      return {
        state: 'needs_details',
        status: 'needs_details',
        reasons: ['legacy_unverified_rule'],
        matchedRules: confirmed.map((c) => c.rule),
      };
    }
    return {
      state: 'confirmed',
      status: 'confirmed_compatible',
      reasons: [],
      matchedRules: confirmed.map((c) => c.rule),
    };
  }

  if (needsDetails.length > 0) {
    return {
      state: 'needs_details',
      status: 'needs_details',
      reasons: Array.from(new Set(needsDetails.flatMap((n) => n.reasons))),
      matchedRules: needsDetails.map((n) => n.rule),
    };
  }

  if (conflicts.length > 0) {
    return {
      state: 'conflict',
      status: 'conflict',
      reasons: Array.from(new Set(conflicts.flatMap((c) => c.reasons))),
      matchedRules: conflicts.map((c) => c.rule),
    };
  }

  return { state: 'no_match', status: 'no_match', reasons: ['no_matching_rule'], matchedRules: [] };
}

/**
 * Build SQL WHERE predicate for Power Search vehicle filter (fixes F11 / H19).
 * Prevents a part linked to an application with a specific engine (e.g. 2KD-FTV)
 * from matching a search for a different engine (e.g. 1KD-FTV) via vehicle_engine_fitment,
 * and respects part_application_rule exclusions.
 */
function buildPowerSearchVehiclePredicate(params, filters = {}) {
  const { makeId, modelId, chassisId, engineId, year, includeNeedsDetails = true } = filters;
  const clauses = [];

  if (makeId !== undefined && makeId !== null) {
    params.push(makeId);
    clauses.push(`a.make_id = $${params.length}`);
  }
  if (modelId !== undefined && modelId !== null) {
    params.push(modelId);
    clauses.push(`a.model_id = $${params.length}`);
  }
  if (chassisId !== undefined && chassisId !== null) {
    params.push(chassisId);
    clauses.push(`a.chassis_id = $${params.length}`);
  }
  if (engineId !== undefined && engineId !== null) {
    params.push(engineId);
    const engParam = `$${params.length}`;
    if (includeNeedsDetails) {
      // Matches either exact engine_id OR an application without a conflicting engine_id where the model is known to use this engine or rule is unrestricted
      clauses.push(`(
        a.engine_id = ${engParam}
        OR (
          a.engine_id IS NULL
          AND (
            EXISTS (
              SELECT 1 FROM part_application_rule par_inc
              WHERE par_inc.part_id = p.part_id
                AND par_inc.application_id = a.application_id
                AND par_inc.effect = 'include'
                AND par_inc.is_active = TRUE
                AND par_inc.engine_mode = 'unrestricted'
            )
            OR EXISTS (
              SELECT 1 FROM vehicle_engine_fitment vef
              WHERE vef.model_id = a.model_id
                AND vef.engine_id = ${engParam}
            )
          )
        )
      )`);
    } else {
      clauses.push(`(
        a.engine_id = ${engParam}
        OR (
          a.engine_id IS NULL
          AND EXISTS (
            SELECT 1 FROM part_application_rule par_inc
            WHERE par_inc.part_id = p.part_id
              AND par_inc.application_id = a.application_id
              AND par_inc.effect = 'include'
              AND par_inc.is_active = TRUE
              AND par_inc.engine_mode = 'unrestricted'
          )
        )
      )`);
    }
  }
  if (year !== undefined && year !== null) {
    params.push(year);
    const yrParam = `$${params.length}`;
    clauses.push(`(pa.year_start IS NULL OR pa.year_start <= ${yrParam}) AND (pa.year_end IS NULL OR pa.year_end >= ${yrParam})`);
  }

  // Exclude parts that have an explicit active exclusion rule matching the queried vehicle
  const exChecks = [
    `par_ex.part_id = p.part_id`,
    `par_ex.effect = 'exclude'`,
    `par_ex.is_active = TRUE`,
  ];
  if (makeId !== undefined && makeId !== null) {
    params.push(makeId);
    exChecks.push(`(a_ex.make_id IS NULL OR a_ex.make_id = $${params.length})`);
  }
  if (modelId !== undefined && modelId !== null) {
    params.push(modelId);
    exChecks.push(`(a_ex.model_id IS NULL OR a_ex.model_id = $${params.length})`);
  }
  if (engineId !== undefined && engineId !== null) {
    params.push(engineId);
    exChecks.push(`(a_ex.engine_id IS NULL OR a_ex.engine_id = $${params.length})`);
  }
  if (year !== undefined && year !== null) {
    params.push(year);
    const exYrParam = `$${params.length}`;
    exChecks.push(`(par_ex.year_start IS NULL OR par_ex.year_start <= ${exYrParam}) AND (par_ex.year_end IS NULL OR par_ex.year_end >= ${exYrParam})`);
  }

  const exclusionGuard = `NOT EXISTS (
    SELECT 1
    FROM part_application_rule par_ex
    JOIN application a_ex ON a_ex.application_id = par_ex.application_id
    WHERE ${exChecks.join(' AND ')}
  )`;

  return `(
    p.is_universal = TRUE
    OR (
      EXISTS (
        SELECT 1
        FROM part_application pa
        JOIN application a ON pa.application_id = a.application_id
        WHERE pa.part_id = p.part_id
        ${clauses.length ? 'AND ' + clauses.join(' AND ') : ''}
      )
      AND ${exclusionGuard}
    )
  )`;
}

module.exports = {
  evaluateSingleRule,
  evaluateFitmentRules,
  buildPowerSearchVehiclePredicate,
};
