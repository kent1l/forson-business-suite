'use strict';

// All link writers use the same transaction. part_application is a legacy
// discovery projection; part_application_rule owns restrictions and alternatives.
const applications = require('../routes/applicationRoutes');
const { deriveIdentityAndQualifierModes, computeInterpretationKey, validateNoClientVerificationFlags, MODE_FIELDS, RULE_FIELDS } = require('../helpers/fitmentRuleSchema');

function fail(code, message, status = 422) {
  return Object.assign(new Error(message), { code, status, statusCode: status });
}
function normalizeRule(body) {
  const flags = validateNoClientVerificationFlags(body);
  if (!flags.valid) throw fail('CLIENT_VERIFICATION_REJECTED', `Forbidden client verification fields: ${flags.offendingKeys.join(', ')}`);
  if (body.effect != null && !['include', 'exclude'].includes(body.effect)) throw fail('INVALID_EFFECT', 'effect must be include or exclude');
  for (const key of MODE_FIELDS) {
    const mode = body[`${key}_mode`] ?? body.identity_modes?.[key];
    if (mode != null && !['specified', 'not_supplied'].includes(mode)) {
      throw fail('EVIDENCE_REQUIRED', 'Unrestricted scope requires a separate evidence approval; missing values stay not supplied');
    }
  }
  if (body.condition_json && Object.keys(body.condition_json).length) throw fail('UNSUPPORTED_RESTRICTION', 'Unsupported restrictions require review');
  const year = value => {
    if (value == null || value === '') return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1900 || n > 2100) throw fail('INVALID_YEAR_RANGE', 'Years must be integers between 1900 and 2100');
    return n;
  };
  const year_start = year(body.year_start), year_end = year(body.year_end);
  if (year_start != null && year_end != null && year_start > year_end) throw fail('INVALID_YEAR_RANGE', 'year_start cannot be greater than year_end');
  const fuel = body.fuel_type_qualifier ?? body.fuel_type;
  if (fuel != null && fuel !== '' && !['diesel', 'gasoline', 'hybrid', 'electric', 'lpg', 'other'].includes(fuel)) throw fail('INVALID_FUEL', 'Invalid fuel type');
  const disp = body.displacement_liters_qualifier ?? body.displacement_liters;
  if (disp != null && disp !== '' && (!Number.isFinite(Number(disp)) || Number(disp) <= 0 || Number(disp) >= 20 || Math.abs(Number(disp) * 10 - Math.round(Number(disp) * 10)) > 1e-8)) throw fail('INVALID_DISPLACEMENT', 'Displacement must be positive, less than 20, and have at most one decimal place');
  for (const key of ['market', 'variant', 'variant_descriptor', 'position', 'drivetrain', 'transmission', 'generation']) {
    if (body[key] != null && (typeof body[key] !== 'string' || body[key].length > 200)) throw fail('INVALID_QUALIFIER', `Invalid ${key}`);
  }
  const modes = deriveIdentityAndQualifierModes({ ...body, year_start, year_end });
  return { ...modes, year_start, year_end, effect: body.effect || 'include' };
}

async function saveFitmentLink(client, partId, body, actorId = null, sourceType = 'manual_ui') {
  normalizeRule(body);
  const part = await client.query('SELECT part_id FROM part WHERE part_id = $1 FOR UPDATE', [partId]);
  if (!part.rows.length) throw fail('PART_NOT_FOUND', 'Part not found', 404);
  let input = body;
  let reviewCandidate = null;
  if (body.review_id != null || body.candidate_id != null) {
    if (!body.review_id || !body.candidate_id || body.expected_version == null) throw fail('REVIEW_VERSION_REQUIRED', 'review_id, candidate_id and expected_version are required');
    const review = (await client.query('SELECT * FROM fitment_review WHERE review_id = $1 FOR UPDATE', [body.review_id])).rows[0];
    if (!review || (review.part_id != null && Number(review.part_id) !== Number(partId)) || (review.created_by != null && Number(review.created_by) !== Number(actorId))) throw fail('REVIEW_NOT_FOUND', 'Review not found', 404);
    if (Number(review.row_version) !== Number(body.expected_version)) throw fail('STALE_REVIEW', 'The review changed; parse again before saving', 409);
    const meta = (await client.query('SELECT taxonomy_version FROM fitment_taxonomy_meta LIMIT 1')).rows[0];
    if (meta && Number(meta.taxonomy_version) !== Number(review.taxonomy_version)) throw fail('STALE_REVIEW', 'Taxonomy changed; parse again before saving', 409);
    reviewCandidate = (await client.query('SELECT * FROM fitment_review_candidate WHERE review_id = $1 AND candidate_id = $2 FOR UPDATE', [body.review_id, body.candidate_id])).rows[0];
    if (!reviewCandidate || ['dismissed', 'applied'].includes(reviewCandidate.disposition)) throw fail('CANDIDATE_UNAVAILABLE', 'Candidate is no longer available', 409);
    if (reviewCandidate.unresolved_dimensions?.length) throw fail('UNRESOLVED_IDENTITY', 'Resolve the candidate identity before linking it');
    const candidate = reviewCandidate.edited_payload || reviewCandidate.candidate_payload;
    // Client edits must first be saved in the versioned review.
    if (computeInterpretationKey(body) !== computeInterpretationKey(candidate)) throw fail('STALE_CANDIDATE', 'Candidate differs from the reviewed interpretation', 409);
    if (reviewCandidate.alternative_group_id) {
      const applied = await client.query("SELECT 1 FROM fitment_review_candidate WHERE review_id=$1 AND alternative_group_id=$2 AND disposition='applied' AND candidate_id<>$3", [body.review_id, reviewCandidate.alternative_group_id, body.candidate_id]);
      if (applied.rows.length) throw fail('ALTERNATIVE_CONFLICT', 'Another interpretation of this clause was already linked', 409);
    }
    input = { ...candidate, application_id: body.application_id };
    // Parsed proposals cannot create taxonomy. Manual entry remains separate.
    for (const dim of ['make', 'model', 'chassis', 'engine']) {
      if (input[dim] && !input[`${dim}_id`]) throw fail('UNRESOLVED_IDENTITY', `Resolve ${dim} before linking`);
    }
  }

  let app;
  if (input.application_id != null) {
    const id = Number(input.application_id);
    if (!Number.isSafeInteger(id) || id <= 0) throw fail('INVALID_APPLICATION_ID', 'Invalid application_id');
    app = (await client.query('SELECT * FROM application WHERE application_id=$1', [id])).rows[0];
    if (!app) throw fail('APPLICATION_NOT_FOUND', 'Application not found');
    const identity = {};
    for (const dim of ['make', 'model', 'chassis', 'engine']) {
      if (input[`${dim}_id`] != null && Number(input[`${dim}_id`]) !== Number(app[`${dim}_id`])) throw fail('IDENTITY_MISMATCH', `${dim}_id conflicts with application_id`);
      identity[`${dim}_id`] = app[`${dim}_id`];
      if (input[dim]) identity[dim] = input[dim];
    }
    const resolved = await applications.resolveAndFindOrCreateApplication(client, { ...identity, derive_model_engine: false });
    if (Number(resolved.application_id) !== id) throw fail('IDENTITY_MISMATCH', 'Application identity changed');
  } else {
    const resolved = await applications.resolveAndFindOrCreateApplication(client, { ...input, derive_model_engine: false });
    app = { application_id: resolved.application_id, make_id: resolved.resolvedMakeId, model_id: resolved.resolvedModelId, chassis_id: resolved.resolvedChassisId, engine_id: resolved.resolvedEngineId };
  }
  const identityState = (await client.query(`SELECT a.identity_status AS application_status,
    mk.identity_status AS make_status,mo.identity_status AS model_status,
    en.identity_status AS engine_status,ch.identity_status AS chassis_status
    FROM application a LEFT JOIN vehicle_make mk USING(make_id) LEFT JOIN vehicle_model mo USING(model_id)
    LEFT JOIN engine en USING(engine_id) LEFT JOIN vehicle_chassis ch USING(chassis_id)
    WHERE a.application_id=$1`,[app.application_id])).rows[0];
  if (Object.values(identityState || {}).some(status => ['rejected','superseded'].includes(status))) throw fail('UNRESOLVED_IDENTITY','A selected identity was retired; refresh the selection');
  const rule = normalizeRule({ ...input, make_id:app.make_id, model_id:app.model_id, chassis_id:app.chassis_id, engine_id:app.engine_id });
  const values = [partId, app.application_id, ...RULE_FIELDS.map(key => rule[key] ?? null)];
  const where = RULE_FIELDS.map((key, i) => `${key} IS NOT DISTINCT FROM $${i + 3}`).join(' AND ');
  const existing = (await client.query(`SELECT * FROM part_application_rule WHERE part_id=$1 AND application_id=$2 AND is_active=TRUE AND ${where}`, values)).rows[0];
  let savedRule = existing;
  if (!savedRule) {
    const claim = (await client.query(`INSERT INTO fitment_claim
      (part_id,application_id,source_type,raw_text,clause_text,clause_span,parser_mode,claim_effect,approval_status,evidence_status,field_provenance,created_by)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'needs_review','user_declared',$9::jsonb,$10) RETURNING claim_id`,
    [partId, app.application_id, reviewCandidate ? 'text_import' : sourceType, input.raw_text || input.raw_span || input.clause_text || null, input.clause_text || null, JSON.stringify(input.clause_span || null), reviewCandidate ? 'deterministic' : 'manual', rule.effect, JSON.stringify({ ...input.field_provenance, source_clauses: input.source_clauses || [] }), actorId])).rows[0];
    savedRule = (await client.query(`INSERT INTO part_application_rule (part_id,application_id,${RULE_FIELDS.join(',')},claim_id,approval_status,evidence_status,created_by,updated_by)
      VALUES (${values.map((_, i) => `$${i + 1}`).join(',')},$${values.length + 1},'needs_review','user_declared',$${values.length + 2},$${values.length + 2}) RETURNING *`, [...values, claim.claim_id, actorId])).rows[0];
    await client.query('INSERT INTO fitment_rule_source(rule_id,claim_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [savedRule.rule_id,claim.claim_id]);
    await client.query(`INSERT INTO fitment_audit(entity_type,entity_id,action,actor_id,after_state) VALUES ('part_application_rule',$1,'linked',$2,$3::jsonb)`, [savedRule.rule_id, actorId, JSON.stringify(savedRule)]);
  }
  if (existing && (input.raw_text || input.raw_span || input.clause_text)) {
    const raw = input.raw_text || input.raw_span || input.clause_text;
    const known = await client.query('SELECT 1 FROM fitment_rule_source s JOIN fitment_claim c USING(claim_id) WHERE s.rule_id=$1 AND c.raw_text=$2', [existing.rule_id,raw]);
    if (!known.rows.length) {
      const claim = (await client.query(`INSERT INTO fitment_claim(part_id,application_id,source_type,raw_text,clause_text,parser_mode,claim_effect,approval_status,evidence_status,field_provenance,created_by) VALUES ($1,$2,'text_import',$3,$4,'deterministic',$5,'needs_review','user_declared',$6::jsonb,$7) RETURNING claim_id`, [partId,app.application_id,raw,input.clause_text || null,rule.effect,JSON.stringify({ ...input.field_provenance, source_clauses: input.source_clauses || [] }),actorId])).rows[0];
      await client.query('INSERT INTO fitment_rule_source(rule_id,claim_id) VALUES ($1,$2)', [existing.rule_id,claim.claim_id]);
    }
  }
  // Exclusions never become positive discovery links or vehicle-engine facts.
  if (rule.effect === 'include') {
    await client.query(`INSERT INTO part_application(part_id,application_id,year_start,year_end,legacy_rule_id,legacy_claim_id)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (part_id,application_id) DO NOTHING`, [partId, app.application_id, rule.year_start, rule.year_end, savedRule.rule_id, savedRule.claim_id]);
  }
  if (reviewCandidate) await client.query("UPDATE fitment_review_candidate SET disposition='applied',preselected=FALSE,existing_rule_id=$1,row_version=row_version+1 WHERE candidate_id=$2", [savedRule.rule_id, reviewCandidate.candidate_id]);
  const pa = (await client.query('SELECT * FROM part_application WHERE part_id=$1 AND application_id=$2', [partId, app.application_id])).rows[0];
  return { ...pa, ...savedRule, outcome: existing ? 'existing' : 'saved', existing: Boolean(existing) };
}

module.exports = { saveFitmentLink, normalizeRule, RULE_FIELDS, fail };
