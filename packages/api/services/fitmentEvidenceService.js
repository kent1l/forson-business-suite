'use strict';
const { computeInterpretationKey } = require('../helpers/fitmentRuleSchema');
const { fail } = require('./fitmentLinkService');
const { enqueuePartUpsert } = require('./meiliOutboxService');

function assertCurrentEvidence(evidence) {
  if (!evidence.source_title || !evidence.quoted_span || evidence.rights_policy !== 'permitted_excerpt' || evidence.assessment !== 'supported' || evidence.claim_type === 'unclassified' || (evidence.expires_at && new Date(evidence.expires_at) <= new Date())) {
    throw fail('EVIDENCE_REQUIRED', 'Evidence needs a permitted supporting excerpt, exact claim scope, source title and current validity');
  }
}

async function reviewEvidence(client, id, body, actor) {
  const evidence = (await client.query('SELECT * FROM fitment_evidence WHERE evidence_id=$1 FOR UPDATE', [id])).rows[0];
  if (!evidence) throw fail('NOT_FOUND', 'Evidence not found', 404);
  if (Number(body.expected_version) !== Number(evidence.row_version)) throw fail('STALE_EVIDENCE', 'Evidence changed; refresh before reviewing', 409);
  const approve = ['approve','approved'].includes(body.decision);
  if (!approve && !['reject','rejected','invalidate'].includes(body.decision)) throw fail('INVALID_DECISION', 'Choose approve, reject or invalidate');
  if (!String(body.reason || '').trim()) throw fail('REASON_REQUIRED', 'Review reason is required');
  if (approve) assertCurrentEvidence(evidence);
  const updated = (await client.query(`UPDATE fitment_evidence SET approval_status=$1,evidence_status=$2,reviewer_id=$3,reviewed_at=NOW(),review_reason=$4,row_version=row_version+1,updated_at=NOW() WHERE evidence_id=$5 RETURNING *`, [approve?'approved':'rejected',approve?'sourced_verified':'rejected',actor,body.reason,id])).rows[0];
  if (!approve) {
    // Every dependent rule is re-reviewed even when another source remains;
    // contradictory evidence cannot be masked by an older inclusion approval.
    const affected = (await client.query(`UPDATE part_application_rule r SET approval_status='needs_review',evidence_status='conflicted',updated_by=$2
      WHERE EXISTS (SELECT 1 FROM fitment_claim_evidence ce JOIN fitment_rule_source s USING(claim_id) WHERE ce.evidence_id=$1 AND s.rule_id=r.rule_id)
      RETURNING r.part_id`, [id,actor])).rows;
    for (const {part_id} of affected) await enqueuePartUpsert(part_id,{source:'fitment_evidence_invalidated'},client);
  }
  await client.query(`INSERT INTO fitment_audit(entity_type,entity_id,action,actor_id,reason,before_state,after_state) VALUES ('fitment_evidence',$1,$2,$3,$4,$5::jsonb,$6::jsonb)`, [id,approve?'approved':'invalidated',actor,body.reason,JSON.stringify(evidence),JSON.stringify(updated)]);
  return updated;
}

async function reviewRule(client, partId, ruleId, body, actor) {
  await client.query('SELECT part_id FROM part WHERE part_id=$1 FOR UPDATE',[partId]);
  const rule = (await client.query('SELECT r.*,a.make_id,a.model_id,a.chassis_id,a.engine_id FROM part_application_rule r JOIN application a USING(application_id) WHERE r.rule_id=$1 AND r.part_id=$2 AND r.is_active=TRUE FOR UPDATE OF r',[ruleId,partId])).rows[0];
  if (!rule) throw fail('NOT_FOUND','Rule not found',404);
  if (Number(body.expected_version) !== Number(rule.row_version)) throw fail('STALE_RULE','Rule changed; refresh before reviewing',409);
  if (!String(body.reason || '').trim()) throw fail('REASON_REQUIRED','Review reason is required');
  if (!['approve','reject','invalidate'].includes(body.decision)) throw fail('INVALID_DECISION','Choose approve, reject or invalidate');
  const approve = body.decision === 'approve';
  if (approve) {
    if (!Array.isArray(body.evidence_ids) || !body.evidence_ids.length) throw fail('EVIDENCE_REQUIRED','Exact part compatibility evidence is required');
    const ids = [...new Set(body.evidence_ids.map(Number))].sort((a,b)=>a-b);
    const evidence = (await client.query('SELECT * FROM fitment_evidence WHERE evidence_id=ANY($1::int[]) ORDER BY evidence_id FOR SHARE',[ids])).rows;
    if (evidence.length !== ids.length) throw fail('EVIDENCE_REQUIRED','Evidence not found');
    for (const ev of evidence) {
      assertCurrentEvidence(ev);
      if (ev.approval_status !== 'approved' || ev.evidence_status !== 'sourced_verified' || ev.claim_type !== 'part_compatibility' || Number(ev.part_id) !== Number(partId) || Number(ev.extracted_claim.application_id) !== Number(rule.application_id) || computeInterpretationKey(ev.extracted_claim.rule) !== computeInterpretationKey(rule)) throw fail('EVIDENCE_SCOPE_MISMATCH','Evidence must support this exact part, identity, effect and every restriction');
      await client.query("INSERT INTO fitment_claim_evidence(claim_id,evidence_id,relation_type) VALUES ($1,$2,'supports') ON CONFLICT DO NOTHING",[rule.claim_id,ev.evidence_id]);
    }
    const contradictions = (await client.query("SELECT 1 FROM fitment_claim_evidence ce JOIN fitment_rule_source s USING(claim_id) JOIN fitment_evidence e USING(evidence_id) WHERE s.rule_id=$1 AND (ce.relation_type='contradicts' OR e.assessment='contradicted')",[ruleId])).rows;
    if (contradictions.length) throw fail('CONFLICTING_EVIDENCE','Contradictory evidence requires review');
  }
  const updated=(await client.query("UPDATE part_application_rule SET approval_status=$1,evidence_status=$2,updated_by=$3 WHERE rule_id=$4 RETURNING *",[approve?'approved':'needs_review',approve?'sourced_verified':'conflicted',actor,ruleId])).rows[0];
  await client.query("INSERT INTO fitment_audit(entity_type,entity_id,action,actor_id,reason,before_state,after_state) VALUES ('part_application_rule',$1,$2,$3,$4,$5::jsonb,$6::jsonb)",[ruleId,body.decision,actor,body.reason,JSON.stringify(rule),JSON.stringify(updated)]);
  await enqueuePartUpsert(partId,{source:'fitment_rule_review'},client);
  return updated;
}
module.exports={reviewEvidence,reviewRule};
