'use strict';

const { z } = require('zod');
const { lookupKey } = require('./engineCodeGrammar');

const SCOPE_MODES = ['specified', 'unrestricted', 'not_supplied', 'unknown', 'not_applicable'];
const EFFECTS = ['include', 'exclude'];
const FUEL_TYPES = ['diesel', 'gasoline', 'hybrid', 'electric', 'lpg', 'other'];
const APPROVAL_STATUSES = ['draft', 'needs_review', 'approved', 'rejected', 'superseded', 'legacy_unverified'];
const EVIDENCE_STATUSES = [
  'sourced_verified',
  'sourced_suggestion',
  'user_declared',
  'unverified_ai',
  'legacy_unverified',
  'conflicted',
  'rejected',
];

const CLIENT_VERIFICATION_FORBIDDEN_KEYS = new Set([
  'verified',
  'is_verified',
  'confirmed',
  'is_confirmed',
  'client_verified',
  'evidence_verified',
  'auto_approve',
  'force_verified',
]);

function nameKey(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function codeKey(str) {
  return lookupKey(String(str || '')) || String(str || '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

const fitmentAiCandidateSchema = z.object({
  make: z.string().trim().min(1).nullable().optional(),
  make_id: z.number().int().positive().nullable().optional(),
  model: z.string().trim().min(1).nullable().optional(),
  model_id: z.number().int().positive().nullable().optional(),
  chassis: z.string().trim().min(1).nullable().optional(),
  chassis_id: z.number().int().positive().nullable().optional(),
  engine: z.string().trim().min(1).nullable().optional(),
  engine_id: z.number().int().positive().nullable().optional(),
  year_start: z.number().int().min(1950).max(2035).nullable().optional(),
  year_end: z.number().int().min(1950).max(2035).nullable().optional(),
  displacement_liters: z.number().gt(0).lt(20).nullable().optional(),
  fuel_type: z.enum(FUEL_TYPES).nullable().optional(),
  effect: z.enum(EFFECTS).optional().default('include'),
  market: z.string().trim().min(1).nullable().optional(),
  variant: z.string().trim().min(1).nullable().optional(),
  position: z.string().trim().min(1).nullable().optional(),
  drivetrain: z.string().trim().min(1).nullable().optional(),
  transmission: z.string().trim().min(1).nullable().optional(),
  generation: z.string().trim().min(1).nullable().optional(),
  confidence: z.enum(['high', 'medium', 'low']).optional().default('low'),
  raw_span: z.string().optional().default(''),
});

const fitmentAiResponseSchema = z.object({
  fitments: z.array(fitmentAiCandidateSchema).default([]),
  unparsed_tokens: z.array(z.string()).optional().default([]),
  reasoning: z.string().optional().default(''),
});

/**
 * Detect forbidden client-supplied verification or self-approval flags on general CRUD routes.
 */
function validateNoClientVerificationFlags(body) {
  if (!body || typeof body !== 'object') {
    return { valid: true, offendingKeys: [] };
  }
  const offendingKeys = [];
  for (const key of Object.keys(body)) {
    if (CLIENT_VERIFICATION_FORBIDDEN_KEYS.has(key)) {
      offendingKeys.push(key);
    }
  }
  if (
    body.approval_status === 'approved' ||
    body.evidence_status === 'sourced_verified' ||
    body.identity_status === 'verified'
  ) {
    offendingKeys.push(
      body.approval_status === 'approved'
        ? 'approval_status'
        : body.evidence_status === 'sourced_verified'
          ? 'evidence_status'
          : 'identity_status'
    );
  }
  return {
    valid: offendingKeys.length === 0,
    offendingKeys,
  };
}

/**
 * Validate atomic alias text (F12 / H08 / A18).
 * Rejects phrases with years, displacement, fuel keywords, fitment stopwords,
 * clause punctuation, excessive token count, or cross-dimension collisions.
 */
function validateAtomicAliasText(aliasText, type, index = null) {
  if (typeof aliasText !== 'string' || !aliasText.trim()) {
    return { ok: false, code: 'ALIAS_EMPTY', message: 'alias_text is required' };
  }
  const trimmed = aliasText.trim();
  if (trimmed.length > 60) {
    return { ok: false, code: 'ALIAS_TOO_LONG', message: 'alias_text must be 60 characters or fewer' };
  }
  if (/[,;|\n\r]/.test(trimmed)) {
    return { ok: false, code: 'ALIAS_CONTAINS_CLAUSE_PUNCTUATION', message: 'alias_text cannot contain clause punctuation' };
  }
  if (/\b(?:19[5-9]\d|20[0-3]\d)\b/.test(trimmed) || /\b\d{2}\s*-\s*\d{2}\b/.test(trimmed)) {
    return { ok: false, code: 'ALIAS_CONTAINS_YEAR', message: 'alias_text cannot contain year tokens or ranges' };
  }
  if (/\b\d\.\d\s*[lL]?\b/.test(trimmed) || /\b[1-9]\d{2,3}\s*cc\b/i.test(trimmed)) {
    return { ok: false, code: 'ALIAS_CONTAINS_DISPLACEMENT', message: 'alias_text cannot contain engine displacement' };
  }
  if (/\b(?:diesel|gasoline|petrol|gas|hybrid|electric|ev|lpg|tdi|crdi|di-d|d-4d|d4d)\b/i.test(trimmed)) {
    return { ok: false, code: 'ALIAS_CONTAINS_FUEL', message: 'alias_text cannot contain fuel type keywords' };
  }
  if (/\b(?:fits|fit|for|also|same|years|year|yr|yrs|model|models|all|both|except|excluding|exclude|not|with|and|or)\b/i.test(trimmed)) {
    return { ok: false, code: 'ALIAS_CONTAINS_PHRASE_STOPWORDS', message: 'alias_text must be an atomic name/code, not a fitment phrase' };
  }
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length > 4) {
    return { ok: false, code: 'ALIAS_NOT_ATOMIC', message: 'alias_text contains too many tokens to be an atomic alias' };
  }

  // If taxonomy index is available, reject aliases that embed another dimension's canonical name
  if (index && type === 'model') {
    for (const tok of tokens) {
      const nk = nameKey(tok);
      if (nk && index.makeByNameKey && index.makeByNameKey.has(nk)) {
        return {
          ok: false,
          code: 'ALIAS_CONTAINS_MAKE_NAME',
          message: `Model alias cannot contain make name "${tok}"`,
        };
      }
    }
  }
  if (index && type === 'engine') {
    if (tokens.length > 2) {
      return { ok: false, code: 'ENGINE_ALIAS_NOT_ATOMIC', message: 'Engine alias must be an atomic engine code' };
    }
    for (const tok of tokens) {
      const nk = nameKey(tok);
      if (nk && ((index.makeByNameKey && index.makeByNameKey.has(nk)) || (index.modelsByNameKey && index.modelsByNameKey.has(nk)))) {
        return {
          ok: false,
          code: 'ALIAS_CONTAINS_VEHICLE_NAME',
          message: `Engine alias cannot contain make or model name "${tok}"`,
        };
      }
    }
  }

  return { ok: true, normalized: trimmed };
}

/**
 * Derive explicit scope modes for identity dimensions and qualifiers.
 */
function deriveIdentityAndQualifierModes(row = {}) {
  const hasMake = row.make_id != null || (typeof row.make === 'string' && row.make.trim() !== '');
  const hasModel = row.model_id != null || (typeof row.model === 'string' && row.model.trim() !== '');
  const hasChassis = row.chassis_id != null || (typeof row.chassis === 'string' && row.chassis.trim() !== '');
  const hasEngine = row.engine_id != null || (typeof row.engine === 'string' && row.engine.trim() !== '');

  const make_mode = row.make_mode && SCOPE_MODES.includes(row.make_mode)
    ? row.make_mode
    : (hasMake ? 'specified' : 'not_supplied');
  const model_mode = row.model_mode && SCOPE_MODES.includes(row.model_mode)
    ? row.model_mode
    : (hasModel ? 'specified' : 'not_supplied');
  const chassis_mode = row.chassis_mode && SCOPE_MODES.includes(row.chassis_mode)
    ? row.chassis_mode
    : (hasChassis ? 'specified' : 'not_supplied');
  const engine_mode = row.engine_mode && SCOPE_MODES.includes(row.engine_mode)
    ? row.engine_mode
    : (hasEngine ? 'specified' : 'not_supplied');

  const hasYear = row.year_start != null || row.year_end != null;
  const year_mode = hasYear ? 'specified' : (row.year_mode && SCOPE_MODES.includes(row.year_mode) && row.year_mode !== 'specified' ? row.year_mode : 'not_supplied');

  const normStr = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
  const market = normStr(row.market);
  const variant_descriptor = normStr(row.variant_descriptor ?? row.variant);
  const position = normStr(row.position);
  const drivetrain = normStr(row.drivetrain);
  const transmission = normStr(row.transmission);
  const generation = normStr(row.generation);
  const fuel_type_qualifier = row.fuel_type_qualifier ?? row.fuel_type ?? null;
  const displacement_liters_qualifier = row.displacement_liters_qualifier ?? row.displacement_liters ?? null;

  return {
    make_mode,
    model_mode,
    chassis_mode,
    engine_mode,
    year_mode,
    market,
    market_mode: market ? 'specified' : 'not_supplied',
    variant_descriptor,
    variant_mode: variant_descriptor ? 'specified' : 'not_supplied',
    position,
    position_mode: position ? 'specified' : 'not_supplied',
    drivetrain,
    drivetrain_mode: drivetrain ? 'specified' : 'not_supplied',
    transmission,
    transmission_mode: transmission ? 'specified' : 'not_supplied',
    fuel_type_qualifier: FUEL_TYPES.includes(fuel_type_qualifier) ? fuel_type_qualifier : null,
    fuel_mode: FUEL_TYPES.includes(fuel_type_qualifier) ? 'specified' : 'not_supplied',
    displacement_liters_qualifier: displacement_liters_qualifier != null && Number.isFinite(Number(displacement_liters_qualifier))
      ? Number(displacement_liters_qualifier)
      : null,
    displacement_mode: displacement_liters_qualifier != null && Number.isFinite(Number(displacement_liters_qualifier))
      ? 'specified'
      : 'not_supplied',
    generation,
    generation_mode: generation ? 'specified' : 'not_supplied',
    identity_modes: {
      make: make_mode,
      model: model_mode,
      engine: engine_mode,
      chassis: chassis_mode,
    },
  };
}

/**
 * Compute deterministic interpretation key for a parsed/reviewed candidate.
 */
function computeInterpretationKey(row = {}) {
  const effect = row.effect === 'exclude' ? 'exclude' : 'include';
  const makePart = row.make_id != null ? `id:${row.make_id}` : `k:${nameKey(row.make)}`;
  const modelPart = row.model_id != null ? `id:${row.model_id}` : `k:${nameKey(row.model)}`;
  const chassisPart = row.chassis_id != null ? `id:${row.chassis_id}` : `k:${codeKey(row.chassis)}`;
  const enginePart = row.engine_id != null ? `id:${row.engine_id}` : `k:${codeKey(row.engine)}`;
  const ys = row.year_start ?? '';
  const ye = row.year_end ?? '';
  const fuel = row.fuel_type_qualifier ?? row.fuel_type ?? '';
  const disp = row.displacement_liters_qualifier ?? row.displacement_liters ?? '';
  const market = nameKey(row.market);
  const variant = nameKey(row.variant_descriptor ?? row.variant);
  const position = nameKey(row.position);
  const drivetrain = nameKey(row.drivetrain);
  const transmission = nameKey(row.transmission);
  const generation = nameKey(row.generation);

  return [
    effect,
    makePart,
    modelPart,
    chassisPart,
    enginePart,
    ys,
    ye,
    fuel,
    disp,
    market,
    variant,
    position,
    drivetrain,
    transmission,
    generation,
  ].join('|');
}

module.exports = {
  SCOPE_MODES,
  EFFECTS,
  FUEL_TYPES,
  APPROVAL_STATUSES,
  EVIDENCE_STATUSES,
  nameKey,
  codeKey,
  fitmentAiCandidateSchema,
  fitmentAiResponseSchema,
  validateNoClientVerificationFlags,
  validateAtomicAliasText,
  deriveIdentityAndQualifierModes,
  computeInterpretationKey,
};
