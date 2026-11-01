'use strict';
const { RULE_FIELDS } = require('./fitmentRuleSchema');

// Only fixed internal aliases may be passed here, never request text. Both old
// text consumers and new structured consumers receive the same atomic facts.
function fitmentRulesSql(partAlias = 'pv') {
  if (!['pv', 'p'].includes(partAlias)) throw new Error('Unsupported part alias');
  return `(SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.rule_id),'[]'::jsonb) FROM (
    SELECT r.rule_id,r.application_id,r.approval_status,r.evidence_status,r.row_version,
      ${RULE_FIELDS.map(k => `r.${k}`).join(',')},a.make_id,a.model_id,a.chassis_id,a.engine_id,
      ${currentEvidenceSql()} AS evidence_current
    FROM part_application_rule r JOIN application a USING(application_id)
    WHERE r.part_id=${partAlias}.part_id AND r.is_active=TRUE
  ) f)`;
}
function currentEvidenceSql(alias = 'r') {
  if (!['r','par'].includes(alias)) throw new Error('Unsupported rule alias');
  return `EXISTS (SELECT 1 FROM fitment_rule_source rs
    JOIN fitment_claim_evidence ce USING(claim_id) JOIN fitment_evidence e USING(evidence_id)
    WHERE rs.rule_id=${alias}.rule_id AND ce.relation_type='supports'
      AND e.claim_type='part_compatibility' AND e.part_id=${alias}.part_id
      AND e.approval_status='approved' AND e.evidence_status='sourced_verified'
      AND e.assessment='supported' AND (e.expires_at IS NULL OR e.expires_at>NOW()))`;
}
module.exports={fitmentRulesSql,currentEvidenceSql};
