'use strict';

const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const db = require('../db');
const {
  deriveIdentityAndQualifierModes,
  computeInterpretationKey,
} = require('../helpers/fitmentRuleSchema');

function sha256(str) {
  return crypto.createHash('sha256').update(String(str || '')).digest('hex');
}

function normalizeFitmentInputText(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

/**
 * Self-contained candidate merger for deterministic + AI fitments.
 * Fixes F05 (`B06`, `B07`):
 * - Infers missing `make_id` when `model_id` or `make` name matches a sibling row.
 * - Includes `fuel_type`, `displacement_liters`, `effect`, `chassis_id`, and qualifiers in the
 *   dedupe key so contradictory fuel/qualifiers on the same vehicle/year stay separate (`B07`).
 */
function mergeFitmentCandidates(localRows, aiRows) {
  const rank = { high: 3, medium: 2, low: 1 };
  const nKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const cKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '');

  const allInput = [...(localRows || []), ...(aiRows || [])].filter(Boolean);
  const makeIdByModelId = new Map();
  const makeNameByModelId = new Map();
  const makeIdByName = new Map();
  const modelIdByName = new Map();
  const engineIdByCode = new Map();
  const rememberUnique = (map, key, value) => {
    if (!map.has(key)) map.set(key,value);
    else if (map.get(key) !== value) map.set(key,null);
  };

  for (const r of allInput) {
    if (r.model_id != null && r.make_id != null) {
      rememberUnique(makeIdByModelId,Number(r.model_id),Number(r.make_id));
      if (r.make) makeNameByModelId.set(Number(r.model_id), r.make);
    }
    if (r.make_id != null && r.make) {
      rememberUnique(makeIdByName,nKey(r.make),Number(r.make_id));
    }
    if (r.model_id != null && r.model) {
      rememberUnique(modelIdByName,`${r.make_id ?? ''}:${nKey(r.model)}`,Number(r.model_id));
      rememberUnique(modelIdByName,`:${nKey(r.model)}`,Number(r.model_id));
    }
    if (r.engine_id != null && r.engine) {
      rememberUnique(engineIdByCode,cKey(r.engine),Number(r.engine_id));
    }
  }

  const normalizeRow = (r, origin) => {
    const copy = { ...r, _origin: r._origin || origin };
    if (copy.make_id == null && copy.model_id != null && makeIdByModelId.has(Number(copy.model_id))) {
      copy.make_id = makeIdByModelId.get(Number(copy.model_id));
      if (!copy.make && makeNameByModelId.has(Number(copy.model_id))) {
        copy.make = makeNameByModelId.get(Number(copy.model_id));
      }
    }
    if (copy.make_id == null && copy.make && makeIdByName.has(nKey(copy.make))) {
      copy.make_id = makeIdByName.get(nKey(copy.make));
    }
    if (copy.model_id == null && copy.model) {
      const scoped = modelIdByName.get(`${copy.make_id ?? ''}:${nKey(copy.model)}`);
      const unscoped = modelIdByName.get(`:${nKey(copy.model)}`);
      if (scoped != null) copy.model_id = scoped;
      else if (copy.make_id == null && unscoped != null) copy.model_id = unscoped;
    }
    if (copy.engine_id == null && copy.engine && engineIdByCode.has(cKey(copy.engine))) {
      copy.engine_id = engineIdByCode.get(cKey(copy.engine));
    }
    return copy;
  };

  const keyOf = (r) => computeInterpretationKey(r);
  const vehicleAnchorKey = (r) => [
    r.make_id ?? nKey(r.make),
    r.model_id ?? nKey(r.model),
    r.year_start ?? '',
    r.year_end ?? '',
    r.clause_index ?? r.clause_text ?? '',
    r.effect || 'include',
  ].join('|');

  const map = new Map();
  for (const raw of localRows || []) {
    const r = normalizeRow(raw, 'local');
    map.set(keyOf(r), r);
  }
  for (const raw of aiRows || []) {
    const r = normalizeRow(raw, 'ai');
    const k = keyOf(r);
    const existing = map.get(k);
    if (!existing) {
      map.set(k, r);
    } else {
      const merged = (rank[r.confidence] || 0) > (rank[existing.confidence] || 0)
        ? { ...existing, ...r }
        : { ...r, ...existing };
      merged.make_id = existing.make_id ?? r.make_id ?? null;
      merged.make = existing.make ?? r.make ?? null;
      merged.model_id = existing.model_id ?? r.model_id ?? null;
      merged.model = existing.model ?? r.model ?? null;
      merged.engine_id = existing.engine_id ?? r.engine_id ?? null;
      merged.engine = existing.engine ?? r.engine ?? null;
      merged._origin = 'merged';
      merged.source_clauses = [...(existing.source_clauses || [existing.raw_span || existing.clause_text].filter(Boolean)), ...(r.source_clauses || [r.raw_span || r.clause_text].filter(Boolean))];
      merged.field_provenance = { ...r.field_provenance, ...existing.field_provenance };
      map.set(k, merged);
    }
  }

  const out = Array.from(map.values());

  // Tag competing interpretations sharing the same vehicle/year anchor with an alternative_group_id
  const anchorBuckets = new Map();
  for (const row of out) {
    const ak = vehicleAnchorKey(row);
    if (!anchorBuckets.has(ak)) anchorBuckets.set(ak, []);
    anchorBuckets.get(ak).push(row);
  }
  let groupSeq = 1;
  for (const [, bucket] of anchorBuckets.entries()) {
    if (bucket.length > 1) {
      const gid = `alt_grp_${groupSeq++}`;
      for (const row of bucket) {
        if (!row.alternative_group_id) row.alternative_group_id = gid;
      }
    }
  }

  // A corrected AI reading can change the model itself. Reconcile by the
  // original clause as well as by vehicle identity; uncertain local readings
  // cannot be bulk-added alongside a conflicting reading of that same text.
  for (const local of out.filter(r => r._origin === 'local' && ['low','medium'].includes(r.confidence))) {
    const clause = String(local.clause_text || local.raw_span || '').trim();
    if (!clause) continue;
    for (const alternative of out.filter(r => r._origin === 'ai')) {
      const span = String(alternative.clause_text || alternative.raw_span || '').trim();
      if (!span || span !== clause || keyOf(local) === keyOf(alternative)) continue;
      const group = local.alternative_group_id || `alt_clause_${sha256(clause).slice(0,12)}`;
      local.alternative_group_id = group;
      alternative.alternative_group_id = group;
    }
  }

  return out;
}

/**
 * Validate external evidence URL to prevent SSRF (Mandatory Secure Web Skills).
 * Only allows public HTTPS URLs; blocks loopback, private RFC1918, link-local, and internal hostnames.
 */
async function validateEvidenceUrl(rawUrl, allowedDomains = []) {
  if (!rawUrl) return { ok: true, url: null, domain: null };
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch (_e) {
    return { ok: false, code: 'INVALID_EVIDENCE_URL', message: 'Invalid URL format' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, code: 'UNSUPPORTED_URL_PROTOCOL', message: 'Only HTTPS evidence URLs are permitted' };
  }
  if (parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) return {ok:false,code:'INVALID_EVIDENCE_URL',message:'Credentials and non-HTTPS ports are forbidden'};
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g,'').replace(/\.$/,'');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.localhost')
  ) {
    return { ok: false, code: 'SSRF_BLOCKED_HOST', message: 'Internal or localhost evidence URLs are forbidden' };
  }

  const isPrivateIp = (ip) => {
    if (net.isIPv4(ip)) {
      const parts = ip.split('.').map(Number);
      if (parts[0] === 10) return true;
      if (parts[0] === 127) return true;
      if (parts[0] === 0) return true;
      if (parts[0] === 169 && parts[1] === 254) return true;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      if (parts[0] === 192 && (parts[1] === 168 || parts[1] === 0)) return true;
      if (parts[0] >= 224 || parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127 || parts[0] === 198 && [18,19,51].includes(parts[1]) || parts[0] === 203 && parts[1] === 0) return true;
      return false;
    }
    if (net.isIPv6(ip)) {
      const norm = ip.toLowerCase();
      // Public IPv6 evidence addresses must be global unicast. This also rejects
      // IPv4-mapped, translation, multicast and unspecified address forms.
      if (!/^[23][0-9a-f]{3}:/.test(norm) || norm.startsWith('2001:db8:')) return true;
      if (norm === '::1' || norm === '::' || norm.startsWith('fe80:') || norm.startsWith('fc') || norm.startsWith('fd')) {
        return true;
      }
    }
    return false;
  };

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      return { ok: false, code: 'SSRF_BLOCKED_IP', message: 'Private or loopback IP addresses are forbidden' };
    }
  } else {
    try {
      const records = await dns.lookup(hostname, { all: true });
      for (const rec of records) {
        if (isPrivateIp(rec.address)) {
          return { ok: false, code: 'SSRF_BLOCKED_DNS_IP', message: 'Hostname resolves to a private or loopback IP' };
        }
      }
    } catch {
      return { ok:false,code:'EVIDENCE_DNS_UNAVAILABLE',message:'Could not validate public evidence hostname' };
    }
  }

  if (Array.isArray(allowedDomains) && allowedDomains.length > 0) {
    const allowed = allowedDomains.map((d) => String(d).toLowerCase().trim()).filter(Boolean);
    if (allowed.length > 0 && !allowed.some((d) => hostname === d || hostname.endsWith(`.${d}`))) {
      return { ok: false, code: 'DOMAIN_NOT_ALLOWLISTED', message: `Domain ${hostname} is not in allowed_domains` };
    }
  }

  return { ok: true, url: parsed.toString(), domain: hostname };
}

/**
 * Create or update a persisted v2 fitment review session.
 * Preserves previously dismissed/edited candidate dispositions across unchanged re-parses (A18 / H15)
 * and marks candidates that are already linked to `partId` (A19).
 */
async function createOrUpdateReviewSession({
  partId = null,
  rawText,
  fitments = [],
  residue = [],
  source = 'local',
  taxonomyVersion = 1,
  userId = null,
}) {
  const normalizedText = normalizeFitmentInputText(rawText);
  const textHash = sha256(normalizedText);
  const numericPartId = partId != null && Number.isInteger(Number(partId)) && Number(partId) > 0
    ? Number(partId)
    : null;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`review:${userId}:${numericPartId}:${textHash}`]);
    // 1. Check for existing open review session for (part_id, text_hash)
    const existingRevRes = await client.query(
      `SELECT review_id, row_version
       FROM fitment_review
       WHERE part_id IS NOT DISTINCT FROM $1
         AND text_hash = $2
         AND status = 'open' AND created_by IS NOT DISTINCT FROM $3
       ORDER BY review_id DESC
       LIMIT 1
       FOR UPDATE`,
      [numericPartId, textHash, userId]
    );

    let reviewId;
    let reviewVersion = 1;
    const existingCandidatesByKey = new Map();

    if (existingRevRes.rows.length > 0) {
      reviewId = existingRevRes.rows[0].review_id;
      reviewVersion = Number(existingRevRes.rows[0].row_version) + 1;
      await client.query(
        `UPDATE fitment_review
         SET taxonomy_version = $1,
             parser_metadata = $2::jsonb,
             updated_by = COALESCE($3, updated_by),
             updated_at = NOW(),
             row_version = row_version + 1
         WHERE review_id = $4`,
        [taxonomyVersion, JSON.stringify({ source, residue }), userId, reviewId]
      );
      const prevCands = await client.query(
        `SELECT * FROM fitment_review_candidate WHERE review_id = $1`,
        [reviewId]
      );
      for (const c of prevCands.rows) {
        existingCandidatesByKey.set(c.interpretation_key, c);
      }
    } else {
      const insRev = await client.query(
        `INSERT INTO fitment_review
           (part_id, raw_text, normalized_text, text_hash, source_type, status, taxonomy_version, parser_metadata, created_by, updated_by)
         VALUES ($1, $2, $3, $4, 'text_import', 'open', $5, $6::jsonb, $7, $7)
         RETURNING review_id`,
        [numericPartId, rawText, normalizedText, textHash, taxonomyVersion, JSON.stringify({ source, residue }), userId]
      );
      reviewId = insRev.rows[0].review_id;
    }

    // 2. If partId is provided, load existing part_application and part_application_rule rows to detect already-linked items
    const existingLinks = [];
    if (numericPartId !== null) {
      const linksRes = await client.query(
        `SELECT r.*, r.variant_descriptor AS variant,
                a.make_id,a.model_id,a.chassis_id,a.engine_id,pa.part_app_id
         FROM part_application_rule r JOIN application a USING(application_id)
         LEFT JOIN part_application pa ON pa.part_id=r.part_id AND pa.application_id=r.application_id
         WHERE r.part_id=$1 AND r.is_active=TRUE`,
        [numericPartId]
      );
      existingLinks.push(...linksRes.rows);
    }

    const candidatesOut = [];

    for (let idx = 0; idx < fitments.length; idx++) {
      const f = { ...fitments[idx], raw_text: rawText };
      const interpKey = computeInterpretationKey(f);
      const modes = deriveIdentityAndQualifierModes(f);

      const unresolvedDims = [];
      if (f.make && f.make_id == null) unresolvedDims.push('make');
      if (f.model && f.model_id == null) unresolvedDims.push('model');
      if (f.engine && f.engine_id == null) unresolvedDims.push('engine');
      if (f.chassis && f.chassis_id == null) unresolvedDims.push('chassis');
      if (f.ambiguous_model_collision) unresolvedDims.push('model_collision');
      if (f.ambiguous_engine_collision) unresolvedDims.push('engine_collision');
      if (f.uncertain_pairing) unresolvedDims.push('pairing');

      const matchedExisting = existingLinks.find(lnk => computeInterpretationKey(lnk) === interpKey);
      const alreadyLinked = Boolean(matchedExisting);

      let confidenceLabel = ['exact', 'high', 'medium', 'low'].includes(f.confidence) ? f.confidence : 'low';
      if (unresolvedDims.length > 0 || (f.make_id == null && f.model_id == null && f.engine_id == null && f.chassis_id == null)) {
        confidenceLabel = 'unresolved';
      }

      let uiBadge = 'Needs review';
      if (alreadyLinked) {
        uiBadge = 'Already linked';
      } else if (confidenceLabel === 'unresolved') {
        uiBadge = 'Unresolved';
      } else if (f.evidence_status === 'sourced_suggestion' || f.evidence_status === 'sourced_verified') {
        uiBadge = 'Sourced suggestion';
      }

      const prev = existingCandidatesByKey.get(interpKey);
      let disposition = 'pending';
      let preselected = false;

      if (prev && prev.disposition === 'dismissed') {
        disposition = 'dismissed';
        preselected = false;
      } else if (alreadyLinked) {
        disposition = 'already_linked';
        preselected = false;
      } else if (prev && prev.disposition === 'edited') {
        disposition = 'edited';
        preselected = Boolean(prev.preselected);
      } else {
        // Only unambiguous high/exact local candidates without collisions are preselected (A19)
        const isHighCertainty =
          (confidenceLabel === 'high' || confidenceLabel === 'exact') &&
          unresolvedDims.length === 0 &&
          !f.ambiguous_model_collision &&
          !f.alternative_group_id &&
          f._origin !== 'ai';
        preselected = isHighCertainty;
        disposition = preselected ? 'selected' : 'pending';
      }

      const qualifiers = {
        year_start: f.year_start ?? null,
        year_end: f.year_end ?? null,
        fuel_type: f.fuel_type ?? null,
        displacement_liters: f.displacement_liters ?? null,
        market: f.market ?? null,
        variant: f.variant ?? null,
        position: f.position ?? null,
        drivetrain: f.drivetrain ?? null,
        transmission: f.transmission ?? null,
        generation: f.generation ?? null,
      };

      const upRes = await client.query(
        `INSERT INTO fitment_review_candidate (
           review_id, interpretation_key, alternative_group_id, clause_index, clause_text, clause_span,
           source_origin, effect, candidate_payload, identity_modes, qualifiers, field_provenance,
           unresolved_dimensions, collision_candidates, confidence_label, ui_badge,
           disposition, preselected, already_linked, existing_rule_id, existing_part_app_id, updated_by
         ) VALUES (
           $1, $2, $3, $4, $5, $6::jsonb,
           $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb,
           $13::jsonb, $14::jsonb, $15, $16,
           $17, $18, $19, $20, $21, $22
         )
         ON CONFLICT (review_id, interpretation_key) DO UPDATE SET
           alternative_group_id = EXCLUDED.alternative_group_id,
           clause_index = EXCLUDED.clause_index,
           candidate_payload = EXCLUDED.candidate_payload,
           identity_modes = EXCLUDED.identity_modes,
           qualifiers = EXCLUDED.qualifiers,
           confidence_label = EXCLUDED.confidence_label,
           ui_badge = EXCLUDED.ui_badge,
           disposition = CASE
             WHEN fitment_review_candidate.disposition = 'dismissed' THEN 'dismissed'
             WHEN fitment_review_candidate.disposition = 'edited' THEN 'edited'
             ELSE EXCLUDED.disposition
           END,
           preselected = CASE
             WHEN fitment_review_candidate.disposition = 'dismissed' THEN FALSE
             ELSE EXCLUDED.preselected
           END,
           already_linked = EXCLUDED.already_linked,
           existing_rule_id = EXCLUDED.existing_rule_id,
           existing_part_app_id = EXCLUDED.existing_part_app_id,
           updated_at = NOW()
         RETURNING *`,
        [
          reviewId,
          interpKey,
          f.alternative_group_id || null,
          idx,
          f.clause_text || null,
          f.clause_span ? JSON.stringify(f.clause_span) : null,
          ['local', 'ai', 'merged', 'evidence', 'manual_edit'].includes(f._origin) ? f._origin : 'local',
          f.effect === 'exclude' ? 'exclude' : 'include',
          JSON.stringify(f),
          JSON.stringify(modes.identity_modes),
          JSON.stringify(qualifiers),
          JSON.stringify(f.field_provenance || {}),
          JSON.stringify(unresolvedDims),
          JSON.stringify(f.collision_candidates || []),
          confidenceLabel,
          uiBadge,
          disposition,
          preselected,
          alreadyLinked,
          matchedExisting ? matchedExisting.rule_id : null,
          matchedExisting ? matchedExisting.part_app_id : null,
          userId,
        ]
      );

      const candRow = upRes.rows[0];
      candidatesOut.push({
        candidate_id: candRow.candidate_id,
        review_id: candRow.review_id,
        interpretation_key: candRow.interpretation_key,
        alternative_group_id: candRow.alternative_group_id,
        effect: candRow.effect,
        disposition: candRow.disposition,
        preselected: candRow.preselected,
        already_linked: candRow.already_linked,
        ui_badge: candRow.ui_badge,
        confidence_label: candRow.confidence_label,
        identity_modes: candRow.identity_modes,
        qualifiers: candRow.qualifiers,
        unresolved_dimensions: candRow.unresolved_dimensions,
        collision_candidates: candRow.collision_candidates,
        ...(candRow.edited_payload || f),
        dismissed_reason: candRow.dismissed_reason,
      });
    }

    await client.query('COMMIT');
    return {
      review_id: reviewId,
      review_version: reviewVersion,
      taxonomy_version: taxonomyVersion,
      candidates: candidatesOut,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function parseReviewIdParam(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw;
  const str = String(raw).trim();
  if (/^\d+$/.test(str)) {
    const n = Number(str);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  const uuidMatch = str.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-([0-9a-f]{12})$/i);
  if (uuidMatch) {
    const parsed = parseInt(uuidMatch[1], 16);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Patch a review session or candidate (e.g. dismiss/restore/edit candidate).
 */
async function patchReviewSession(reviewId, body = {}, userId = null) {
  const numReviewId = parseReviewIdParam(reviewId);
  if (!numReviewId) {
    const err = new Error('Invalid reviewId');
    err.status = 400;
    throw err;
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const revRes = await client.query(
      'SELECT * FROM fitment_review WHERE review_id = $1 FOR UPDATE',
      [numReviewId]
    );
    if (revRes.rows.length === 0) {
      const err = new Error('Fitment review session not found');
      err.status = 404;
      throw err;
    }

    const revRow = revRes.rows[0];
    if (revRow.created_by != null && Number(revRow.created_by) !== Number(userId)) {
      throw Object.assign(new Error('Fitment review session not found'), {status:404});
    }
    const expectedVersion = body.review_version ?? body.expected_version ?? null;
    if (expectedVersion == null || Number(expectedVersion) !== Number(revRow.row_version)) {
      const err = new Error(`Expected review_version ${expectedVersion} does not match current ${revRow.row_version}`);
      err.status = 409;
      err.code = 'STALE_REVIEW';
      throw err;
    }

    if (Array.isArray(body.dismiss)) {
      for (const item of body.dismiss) {
        const cId = typeof item === 'object' ? item.candidate_id : item;
        const iKey = typeof item === 'object' ? item.interpretation_key : String(item);
        const reason = (typeof item === 'object' ? item.reason : null) || body.reason || null;
        if (cId != null && Number.isInteger(Number(cId))) {
          await client.query(
            `UPDATE fitment_review_candidate
             SET disposition = 'dismissed', preselected = FALSE, dismissed_reason = COALESCE($1, dismissed_reason),
                 row_version = row_version + 1, updated_by = COALESCE($2, updated_by), updated_at = NOW()
             WHERE review_id = $3 AND candidate_id = $4`,
            [reason, userId, numReviewId, Number(cId)]
          );
        } else if (iKey) {
          await client.query(
            `UPDATE fitment_review_candidate
             SET disposition = 'dismissed', preselected = FALSE, dismissed_reason = COALESCE($1, dismissed_reason),
                 row_version = row_version + 1, updated_by = COALESCE($2, updated_by), updated_at = NOW()
             WHERE review_id = $3 AND interpretation_key = $4`,
            [reason, userId, numReviewId, iKey]
          );
        }
      }
      await client.query(
        'UPDATE fitment_review SET row_version = row_version + 1, updated_at = NOW() WHERE review_id = $1',
        [numReviewId]
      );
      const allCandsRes = await client.query(
        'SELECT * FROM fitment_review_candidate WHERE review_id = $1 ORDER BY candidate_id ASC',
        [numReviewId]
      );
      await client.query('COMMIT');
      return {
        review_id: numReviewId,
        review_version: Number(revRow.row_version) + 1,
        candidates: allCandsRes.rows.map((c) => ({
          ...(c.edited_payload || c.candidate_payload || {}),
          candidate_id: c.candidate_id,
          review_id: c.review_id,
          interpretation_key: c.interpretation_key,
          disposition: c.disposition,
          preselected: c.preselected,
          already_linked: c.already_linked,
          ui_badge: c.ui_badge,
          confidence_label: c.confidence_label,
        })),
      };
    }

    const action = body.action || (body.disposition === 'dismissed' ? 'dismiss_candidate' : 'update_candidate');
    const candidateId = body.candidate_id != null && Number.isInteger(Number(body.candidate_id))
      ? Number(body.candidate_id)
      : null;
    const interpKey = body.interpretation_key || null;

    let targetCandRes;
    if (candidateId != null) {
      targetCandRes = await client.query(
        'SELECT * FROM fitment_review_candidate WHERE review_id = $1 AND candidate_id = $2 FOR UPDATE',
        [numReviewId, candidateId]
      );
    } else if (interpKey) {
      targetCandRes = await client.query(
        'SELECT * FROM fitment_review_candidate WHERE review_id = $1 AND interpretation_key = $2 FOR UPDATE',
        [numReviewId, interpKey]
      );
    } else {
      targetCandRes = await client.query(
        'SELECT * FROM fitment_review_candidate WHERE review_id = $1 ORDER BY candidate_id ASC LIMIT 1 FOR UPDATE',
        [numReviewId]
      );
    }

    if (!candidateId && !interpKey) throw Object.assign(new Error('candidate_id or interpretation_key is required'), {status:400});
    if (!targetCandRes.rows.length) throw Object.assign(new Error('Candidate not found'), {status:404});
    let updatedCandidate = null;
    if (targetCandRes.rows.length > 0) {
      const target = targetCandRes.rows[0];
      const nextDisposition =
        action === 'dismiss_candidate' || body.disposition === 'dismissed'
          ? 'dismissed'
          : (body.disposition || 'edited');

      // Resurfacing a previously dismissed candidate requires an explicit reason (A18)
      if (target.disposition === 'dismissed' && nextDisposition !== 'dismissed') {
        const cleanReason = typeof body.reason === 'string' ? body.reason.trim() : '';
        if (!cleanReason) {
          const err = new Error('A reason is required to resurface a dismissed candidate');
          err.status = 422;
          err.code = 'RESURFACE_REASON_REQUIRED';
          throw err;
        }
      }

      if (body.edited_payload) {
        const { normalizeRule } = require('./fitmentLinkService');
        const applications = require('../routes/applicationRoutes');
        normalizeRule(body.edited_payload);
        const resolved = await applications.resolveAndFindOrCreateApplication(client, { ...body.edited_payload, derive_model_engine: false });
        const canonical = (await client.query('SELECT make,model,engine,chassis,make_id,model_id,engine_id,chassis_id FROM application_view WHERE application_id=$1', [resolved.application_id])).rows[0];
        body.edited_payload = { ...body.edited_payload, ...canonical, raw_text: revRow.raw_text, raw_span:target.clause_text || revRow.raw_text, field_provenance: { ...target.field_provenance, manual_correction: 'reviewed_identity' } };
      }
      const nextPreselected = nextDisposition === 'dismissed' ? false : Boolean(body.preselected);

      const upd = await client.query(
        `UPDATE fitment_review_candidate
         SET disposition = $1,
             preselected = $2,
             dismissed_reason = COALESCE($3, dismissed_reason),
             edited_payload = COALESCE($4::jsonb, edited_payload),
             unresolved_dimensions = CASE WHEN $4::jsonb IS NOT NULL THEN '[]'::jsonb ELSE unresolved_dimensions END,
             row_version = row_version + 1,
             updated_by = COALESCE($5, updated_by),
             updated_at = NOW()
         WHERE candidate_id = $6
         RETURNING *`,
        [
          nextDisposition,
          nextPreselected,
          body.reason || null,
          body.edited_payload ? JSON.stringify(body.edited_payload) : null,
          userId,
          target.candidate_id,
        ]
      );
      updatedCandidate = upd.rows[0];

      await client.query(
        'UPDATE fitment_review SET row_version = row_version + 1, updated_at = NOW() WHERE review_id = $1',
        [numReviewId]
      );

      await client.query(
        `INSERT INTO fitment_audit (entity_type, entity_id, action, actor_id, reason, before_state, after_state)
         VALUES ('fitment_review', $1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
        [
          numReviewId,
          action,
          userId,
          body.reason || null,
          JSON.stringify({ candidate_id: target.candidate_id, disposition: target.disposition }),
          JSON.stringify({ candidate_id: updatedCandidate.candidate_id, disposition: updatedCandidate.disposition }),
        ]
      );
    }

    const allCandsRes = await client.query(
      'SELECT * FROM fitment_review_candidate WHERE review_id = $1 ORDER BY candidate_id ASC',
      [numReviewId]
    );

    await client.query('COMMIT');
    return {
      review_id: numReviewId,
      review_version: Number(revRow.row_version) + (updatedCandidate ? 1 : 0),
      updated_candidate: updatedCandidate,
      candidates: allCandsRes.rows.map((c) => ({
        ...(c.edited_payload || c.candidate_payload || {}),
        candidate_id: c.candidate_id,
        review_id: c.review_id,
        interpretation_key: c.interpretation_key,
        disposition: c.disposition,
        preselected: c.preselected,
        already_linked: c.already_linked,
        ui_badge: c.ui_badge,
        confidence_label: c.confidence_label,
      })),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Create a bounded fitment research job and store sourced evidence items as 'needs_review' (H16 / A19).
 */
async function createResearchJob(body = {}, userId = null) {
  const allowedDomains = Array.isArray(body.allowed_domains) ? body.allowed_domains : [];
  if (body.source_url) {
    const urlCheck = await validateEvidenceUrl(body.source_url, allowedDomains);
    if (!urlCheck.ok) {
      const err = new Error(urlCheck.message);
      err.status = 422;
      err.code = urlCheck.code;
      throw err;
    }
  }

  let queryText = String(body.query || body.query_text || '').trim();
  const parsedReviewId = parseReviewIdParam(body.review_id);
  if (!queryText && parsedReviewId) {
    const revLookup = await db.query('SELECT raw_text FROM fitment_review WHERE review_id = $1', [parsedReviewId]);
    if (revLookup.rows.length > 0) {
      queryText = String(revLookup.rows[0].raw_text || '').trim();
    }
  }
  if (!queryText && body.candidate_id) {
    queryText = String(body.candidate_id).trim();
  }

  const providersDisabled = true; // Paid/live research is gated; manual evidence capture is independent.
  if (providersDisabled && !body.evidence && !body.allow_offline_capture) {
    const err = new Error('External research providers are disabled; manual fitment entry remains available');
    err.status = 503;
    err.code = 'RESEARCH_PROVIDER_UNAVAILABLE';
    err.details = {
      fallback: 'manual',
      outage_manual_usable: true,
      auto_approved: false,
      live_rules_mutated: 0,
    };
    throw err;
  }

  if (!queryText) {
    const err = new Error('query is required for fitment research');
    err.status = 400;
    throw err;
  }

  const parsed = { fitments: [] };
  const hasFitments = false;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const partId = body.part_id != null && Number.isInteger(Number(body.part_id)) ? Number(body.part_id) : null;
    const jobRes = await client.query(
      `INSERT INTO fitment_research_job
         (part_id, query_text, search_scope, status, provider, allowed_domains, result_summary, requested_by, started_at, completed_at)
       VALUES ($1, $2, $3::jsonb, 'completed', 'evidence_capture', $4::jsonb, $5::jsonb, $6, NOW(), NOW())
       RETURNING *`,
      [
        partId,
        queryText,
        JSON.stringify(body.search_scope || {}),
        JSON.stringify(allowedDomains),
        JSON.stringify({ candidate_count: parsed.fitments.length, outcome: hasFitments ? 'candidates_found' : 'insufficient' }),
        userId,
      ]
    );
    const job = jobRes.rows[0];

    const evidenceItems = [];
    const rawEvidenceList = Array.isArray(body.evidence) ? body.evidence.slice(0,10) : [];

    let unlicensedPassagePersisted = false;
    for (const item of rawEvidenceList) {
      if (item.source_url) {
        const check = await validateEvidenceUrl(item.source_url, allowedDomains);
        if (!check.ok) {
          const err = new Error(check.message);
          err.status = 422;
          err.code = check.code;
          throw err;
        }
      }
      if (item.unlicensed === true || String(item.quoted_span || '').length > 500) {
        // Never persist full unlicensed passages; keep only bounded <= 280-char citation excerpt or skip
        if (item.unlicensed === true) {
          continue;
        }
      }
      const boundedSpan = item.rights_policy === 'permitted_excerpt' ? String(item.quoted_span || '').slice(0,280) : '';
      if (item.expires_at && !Number.isFinite(Date.parse(item.expires_at))) throw Object.assign(new Error('Invalid evidence expiry'),{status:422});
      const evRes = await client.query(
        `INSERT INTO fitment_evidence (
           research_job_id, part_id, source_type, source_url, source_domain, source_title,
           quoted_span, trust_tier, approval_status, evidence_status, extracted_claim, created_by,claim_type,rights_policy,assessment,expires_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, 'needs_review', 'sourced_suggestion', $9::jsonb, $10,$11,$12,$13,$14
         )
         RETURNING *`,
        [
          job.job_id,
          partId,
          item.source_type || 'web_catalog',
          item.source_url || null,
          item.source_url ? new URL(item.source_url).hostname.toLowerCase() : null,
          item.source_title || null,
          boundedSpan,
          item.trust_tier || 'tier_3_unverified_web',
          JSON.stringify(item.extracted_claim || {}),
          userId,
          item.claim_type || 'unclassified',
          item.rights_policy || 'metadata_only',
          ['supported','contradicted','insufficient'].includes(item.assessment) ? item.assessment : 'insufficient',
          item.expires_at || null,
        ]
      );
      evidenceItems.push({
        ...evRes.rows[0],
        status: evRes.rows[0].approval_status,
      });
    }

    await client.query('COMMIT');
    return {
      job_id: job.job_id,
      status: 'completed',
      outcome: hasFitments ? 'candidates_found' : 'insufficient',
      no_result: hasFitments ? null : 'insufficient',
      query_text: job.query_text,
      auto_approved: false,
      live_rules_mutated: 0,
      unlicensed_passage_persisted: unlicensedPassagePersisted,
      evidence: evidenceItems,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getResearchJob(jobId) {
  const numId = Number(jobId);
  if (!Number.isInteger(numId) || numId <= 0) {
    const err = new Error('Invalid jobId');
    err.status = 400;
    throw err;
  }
  const jobRes = await db.query('SELECT * FROM fitment_research_job WHERE job_id = $1', [numId]);
  if (jobRes.rows.length === 0) {
    const err = new Error('Research job not found');
    err.status = 404;
    throw err;
  }
  const evRes = await db.query(
    'SELECT * FROM fitment_evidence WHERE research_job_id = $1 ORDER BY evidence_id ASC',
    [numId]
  );
  const job = jobRes.rows[0];
  return {
    job_id: job.job_id,
    status: job.status,
    query_text: job.query_text,
    auto_approved: false,
    live_rules_mutated: 0,
    evidence: evRes.rows.map((r) => ({
      ...r,
      status: r.approval_status,
    })),
  };
}

/**
 * Record an extraction correction without silently creating a global taxonomy alias (H17 / A18).
 */
async function createCorrection(body = {}, userId = null) {
  const corrected = body.corrected || body.corrected_extraction || body.corrected_fields || {};
  const original = body.original || body.original_extraction || (body.candidate_id ? { candidate_id: body.candidate_id } : {});
  const parsedReviewId = parseReviewIdParam(body.review_id);
  const numericCandidateId = body.candidate_id != null && /^\d+$/.test(String(body.candidate_id))
    ? Number(body.candidate_id)
    : null;

  let rawClauseText = String(body.raw_text || body.raw_clause_text || '').trim();
  if (!rawClauseText && parsedReviewId) {
    const revLookup = await db.query('SELECT raw_text FROM fitment_review WHERE review_id = $1', [parsedReviewId]);
    if (revLookup.rows.length > 0) {
      rawClauseText = String(revLookup.rows[0].raw_text || '').trim();
    }
  }
  if (!rawClauseText && Object.keys(corrected).length > 0) {
    rawClauseText = `correction:${JSON.stringify(corrected)}`;
  }
  if (!rawClauseText) {
    const err = new Error('raw_text, review_id, or corrected_fields is required');
    err.status = 400;
    throw err;
  }

  const promoteToAlias = Boolean(body.promote_to_alias);

  const res = await db.query(
    `INSERT INTO fitment_correction (
       part_id, review_id, candidate_id, raw_clause_text,
       original_extraction, corrected_extraction, correction_type,
       promote_to_alias, status, reason, created_by
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      body.part_id != null && Number.isInteger(Number(body.part_id)) ? Number(body.part_id) : null,
      parsedReviewId,
      numericCandidateId,
      rawClauseText,
      JSON.stringify(original),
      JSON.stringify(corrected),
      body.correction_type || 'parser_extraction_fix',
      promoteToAlias,
      promoteToAlias ? 'pending_alias_review' : 'recorded',
      body.reason || null,
      userId,
    ]
  );

  return {
    ...res.rows[0],
    auto_alias_created: false,
  };
}

module.exports = {
  mergeFitmentCandidates,
  validateEvidenceUrl,
  createOrUpdateReviewSession,
  patchReviewSession,
  createResearchJob,
  getResearchJob,
  createCorrection,
  sha256,
};
