'use strict';
const { RULE_FIELDS } = require('./fitmentRuleSchema');

// Only fixed internal aliases may be passed here, never request text. Both old
// text consumers and new structured consumers receive the same atomic facts.
const { COMBINATION_FIELDS } = require('./vehicleCombination');
const QUALIFIER_MODES = { year_start:'year',year_end:'year',market:'market',variant_descriptor:'variant',drivetrain:'drivetrain',transmission:'transmission',generation:'generation',fuel_type_qualifier:'fuel',displacement_liters_qualifier:'displacement' };
function effectiveRuleColumns(rule = 'r', application = 'a') {
  if (!['r','par'].includes(rule) || !['a','av'].includes(application)) throw new Error('Unsupported fitment alias');
  const columns = COMBINATION_FIELDS.map(k => `COALESCE(${rule}.${k},${application}.${k}) AS ${k}`);
  for (const mode of [...new Set(Object.values(QUALIFIER_MODES))]) {
    const fields = COMBINATION_FIELDS.filter(k => QUALIFIER_MODES[k]===mode);
    columns.push(`CASE WHEN ${fields.map(k=>`COALESCE(${rule}.${k},${application}.${k}) IS NOT NULL`).join(' OR ')} THEN 'specified' ELSE ${rule}.${mode}_mode END AS ${mode}_mode`);
  }
  return columns.join(',');
}
function fitmentRulesSql(partAlias = 'pv') {
  if (!['pv', 'p'].includes(partAlias)) throw new Error('Unsupported part alias');
  const inherited = new Set([...COMBINATION_FIELDS, ...Object.values(QUALIFIER_MODES).map(k=>`${k}_mode`)]);
  return `(SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.rule_id),'[]'::jsonb) FROM (
    SELECT r.rule_id,r.application_id,r.row_version,
      ${RULE_FIELDS.filter(k=>!inherited.has(k)).map(k => `r.${k}`).join(',')},${effectiveRuleColumns()},
      a.make_id,a.model_id,a.chassis_id,a.engine_id,a.make,a.model,a.chassis,a.engine,a.fuel_type,a.displacement_liters
    FROM part_application_rule r JOIN application_view a USING(application_id)
    WHERE r.part_id=${partAlias}.part_id AND r.is_active=TRUE
  ) f)`;
}
function fitmentLabelsSql(partAlias = 'pv', asArray = false) {
  if (!['pv','p'].includes(partAlias)) throw new Error('Unsupported part alias');
  const label = `concat_ws(' ',a.make,a.model,a.chassis,a.engine,
    COALESCE(r.year_start,a.year_start),COALESCE(r.year_end,a.year_end),
    COALESCE(r.market,a.market),COALESCE(r.variant_descriptor,a.variant_descriptor),
    COALESCE(r.drivetrain,a.drivetrain),COALESCE(r.transmission,a.transmission),
    COALESCE(r.generation,a.generation),r.position,
    COALESCE(r.fuel_type_qualifier,a.fuel_type),COALESCE(r.displacement_liters_qualifier,a.displacement_liters))`;
  return `(SELECT ${asArray ? `array_agg(${label} ORDER BY r.rule_id)` : `string_agg(${label}, '; ' ORDER BY r.rule_id)`}
    FROM part_application_rule r JOIN application_view a USING(application_id)
    WHERE r.part_id=${partAlias}.part_id AND r.is_active AND r.effect='include')`;
}
function fitmentYearRangesSql(partAlias = 'pv') {
  if (!['pv','p'].includes(partAlias)) throw new Error('Unsupported part alias');
  return `(SELECT jsonb_agg(jsonb_build_array(COALESCE(r.year_start,a.year_start),COALESCE(r.year_end,a.year_end)))
    FROM part_application_rule r JOIN application a USING(application_id)
    WHERE r.part_id=${partAlias}.part_id AND r.is_active AND r.effect='include')`;
}
module.exports={fitmentRulesSql,fitmentLabelsSql,fitmentYearRangesSql,effectiveRuleColumns};
