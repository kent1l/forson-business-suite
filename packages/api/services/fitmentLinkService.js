'use strict';

// All link writers use the same transaction. part_application is a legacy
// discovery projection; part_application_rule stores optional link details and existing exclusions.
// Linking does not create claims, evidence, or an approval task.
const applications = require('../routes/applicationRoutes');
const { COMBINATION_FIELDS } = require('../helpers/vehicleCombination');
const { deriveIdentityAndQualifierModes, validateNoClientVerificationFlags, MODE_FIELDS, RULE_FIELDS } = require('../helpers/fitmentRuleSchema');

function fail(code, message, status = 422) {
  return Object.assign(new Error(message), { code, status, statusCode: status });
}
function normalizeRule(body) {
  const flags = validateNoClientVerificationFlags(body);
  if (!flags.valid) throw fail('CLIENT_VERIFICATION_REJECTED', `Forbidden client verification fields: ${flags.offendingKeys.join(', ')}`);
  if (body.effect != null && !['include', 'exclude'].includes(body.effect)) throw fail('INVALID_EFFECT', 'effect must be include or exclude');
  for (const key of MODE_FIELDS) {
    const mode = body[`${key}_mode`] ?? body.identity_modes?.[key];
    if (mode != null && !['specified','not_supplied','unknown','not_applicable','unrestricted'].includes(mode)) throw fail('INVALID_SCOPE', `Invalid ${key} scope`);
  }
  if (body.condition_json && Object.keys(body.condition_json).length) throw fail('UNSUPPORTED_RESTRICTION', 'Use the vehicle detail fields for link conditions');
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

async function saveFitmentLink(client, partId, body, actorId = null) {
  normalizeRule(body);
  const part = await client.query('SELECT part_id FROM part WHERE part_id = $1 FOR UPDATE', [partId]);
  if (!part.rows.length) throw fail('PART_NOT_FOUND', 'Part not found', 404);
  const input = body;

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
    const resolved = await applications.resolveAndFindOrCreateApplication(client, { ...app, ...identity, derive_model_engine: false });
    if (Number(resolved.application_id) !== id) throw fail('IDENTITY_MISMATCH', 'Application identity changed');
  } else {
    const resolved = await applications.resolveAndFindOrCreateApplication(client, { ...input, derive_model_engine: false });
    app = resolved.row;
  }
  // Classification belongs to the reusable combination. Store only differences on
  // the link (for example a narrower year range or installation position).
  const linkInput = { ...input };
  for (const key of COMBINATION_FIELDS) {
    const alias = { variant_descriptor: 'variant', fuel_type_qualifier: 'fuel_type', displacement_liters_qualifier: 'displacement_liters' }[key];
    const supplied = input[key] ?? (alias ? input[alias] : undefined);
    if (supplied != null && app[key] != null && String(supplied).trim().toLowerCase() === String(app[key]).trim().toLowerCase()) {
      linkInput[key] = null;
      if (alias) linkInput[alias] = null;
    }
  }
  const rule = normalizeRule({ ...linkInput, make_id:app.make_id, model_id:app.model_id, chassis_id:app.chassis_id, engine_id:app.engine_id });
  const values = [partId, app.application_id, ...RULE_FIELDS.map(key => rule[key] ?? null)];
  const where = RULE_FIELDS.map((key, i) => `${key} IS NOT DISTINCT FROM $${i + 3}`).join(' AND ');
  const existing = (await client.query(`SELECT * FROM part_application_rule WHERE part_id=$1 AND application_id=$2 AND is_active=TRUE AND ${where}`, values)).rows[0];
  let savedRule = existing;
  if (!savedRule) {
    savedRule = (await client.query(`INSERT INTO part_application_rule (part_id,application_id,${RULE_FIELDS.join(',')},created_by,updated_by)
      VALUES (${values.map((_, i) => `$${i + 1}`).join(',')},$${values.length + 1},$${values.length + 1}) RETURNING *`, [...values, actorId])).rows[0];
    await client.query(`INSERT INTO fitment_audit(entity_type,entity_id,action,actor_id,after_state) VALUES ('part_application_rule',$1,'linked',$2,$3::jsonb)`, [savedRule.rule_id, actorId, JSON.stringify(savedRule)]);
  }
  // Exclusions never become positive discovery links or vehicle-engine facts.
  if (rule.effect === 'include') {
    await client.query(`INSERT INTO part_application(part_id,application_id,year_start,year_end,legacy_rule_id,legacy_claim_id)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (part_id,application_id) DO NOTHING`, [partId, app.application_id, rule.year_start ?? app.year_start, rule.year_end ?? app.year_end, savedRule.rule_id, savedRule.claim_id]);
  }
  const pa = (await client.query('SELECT * FROM part_application WHERE part_id=$1 AND application_id=$2', [partId, app.application_id])).rows[0];
  return { ...pa, ...savedRule, outcome: existing ? 'existing' : 'saved', existing: Boolean(existing) };
}

module.exports = { saveFitmentLink, normalizeRule, RULE_FIELDS, fail };
