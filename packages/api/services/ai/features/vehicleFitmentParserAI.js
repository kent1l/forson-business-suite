'use strict';

const db = require('../../../db');
const llmClient = require('../core/llmClient');
const { wrapJsonInstruction, sanitizeInput } = require('../core/promptBuilder');
const JevClient = require('../../jevClient');
const { canonicalizeEngineCode, lookupKey } = require('../../../helpers/engineCodeGrammar');
const { fitmentAiResponseSchema, nameKey } = require('../../../helpers/fitmentRuleSchema');

const VALID_FUEL_TYPES = ['diesel', 'gasoline', 'hybrid', 'mild_hybrid', 'electric', 'lpg'];
const jevClient = new JevClient();
const JEV_FITMENT_CHOICE_CONFIDENCE = Number.isFinite(Number(process.env.JEV_FITMENT_CHOICE_THRESHOLD))
  ? Math.max(0.5, Math.min(0.99, Number(process.env.JEV_FITMENT_CHOICE_THRESHOLD)))
  : 0.85;

const modelKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

class VehicleFitmentParserAI {
  async _loadGroundingData() {
    const [makesRes, modelsRes, enginesRes] = await Promise.all([
      db.query('SELECT make_id, make_name FROM vehicle_make ORDER BY make_name'),
      db.query(`
        SELECT vm.model_id, vm.model_name, vm.make_id, mk.make_name
        FROM vehicle_model vm
        JOIN vehicle_make mk ON mk.make_id = vm.make_id
        ORDER BY mk.make_name, vm.model_name
      `),
      db.query('SELECT engine_id, engine_code, displacement_liters, fuel_type FROM engine ORDER BY engine_code'),
    ]);
    return { makes: makesRes.rows, models: modelsRes.rows, engines: enginesRes.rows };
  }

  _formatGroundingPrompt({ makes = [], models = [], engines = [] }) {
    const modelsByMake = new Map();
    for (const m of models) {
      if (!modelsByMake.has(m.make_name)) modelsByMake.set(m.make_name, []);
      modelsByMake.get(m.make_name).push(m.model_name);
    }
    const modelsBlock = [...modelsByMake.entries()]
      .map(([make, modelNames]) => `${make}: ${modelNames.join(', ')}`)
      .join('\n');

    const enginesBlock = engines
      .map((e) => `${e.engine_code} (${e.displacement_liters != null ? e.displacement_liters + 'L' : 'displacement unknown'}${e.fuel_type ? ', ' + e.fuel_type : ''})`)
      .join(', ');

    return `Existing Makes: ${makes.map((m) => m.make_name).join(', ')}

Existing Models by Make:
${modelsBlock}

Existing Engine Codes (code (displacement, fuel type)):
${enginesBlock}`;
  }

  async parse(text, grounding = {}) {
    return this.parseFitmentText(text, { grounding });
  }

  async parseFitmentText(text, options = {}) {
    const cleanText = sanitizeInput(text);
    if (!cleanText) {
      return { fitments: [], unparsed_tokens: [], notes: '' };
    }

    const grounding = options.grounding || (await this._loadGroundingData());
    const groundingPrompt = this._formatGroundingPrompt(grounding);

    const basePrompt = `You are a vehicle fitment extraction agent for an auto parts store in the Philippines.
Extract every distinct vehicle fitment described in the staff member's text below into structured rows.

Rules:
1. A fitment can specify make+model+engine, make+model only (engine-agnostic), engine only (vehicle-agnostic), or any combination -- extract exactly what is stated, do not invent missing pieces.
2. When a make/model/engine matches one in the existing lists below, use its canonical spelling and include its make_id / model_id / engine_id.
3. Never return a make_id, model_id, or engine_id unless the corresponding make/model/engine name matches that exact taxonomy entry.
4. For exclusions ("except 2010", "excluding Fortuner"), set effect to "exclude"; otherwise set effect to "include".

${groundingPrompt}

Input text: "${cleanText}"`;

    const schemaDescription = `{
  "fitments": [
    {
      "make": "string or null",
      "make_id": "integer or null",
      "model": "string or null",
      "model_id": "integer or null",
      "engine": "string or null",
      "engine_id": "integer or null",
      "displacement_liters": "number or null",
      "fuel_type": "diesel | gasoline | hybrid | electric | lpg | other | null",
      "year_start": "integer or null",
      "year_end": "integer or null",
      "effect": "include | exclude",
      "confidence": "high | medium | low"
    }
  ],
  "unparsed_tokens": ["string"],
  "reasoning": "string"
}`;

    const fullPrompt = wrapJsonInstruction(basePrompt, schemaDescription);

    try {
      const result = await llmClient.executeWithPool('vehicle_fitment_parser_pool', {
        prompt: fullPrompt,
        schema: fitmentAiResponseSchema,
        timeoutMs: 30000,
      });

      const validated = this._validateResult(result, grounding);
      return await this._resolveJevAmbiguities(validated, grounding, cleanText);
    } catch (error) {
      console.error('[VehicleFitmentParserAI] Failed to parse fitment text:', error.message);
      throw new Error('AI fitment parser is temporarily unavailable. Please add applications manually.');
    }
  }

  _validateResult(result, grounding = {}) {
    if (!result || typeof result !== 'object' || !Array.isArray(result.fitments)) {
      return { fitments: [], unparsed_tokens: [], notes: '', reasoning: '' };
    }

    const makeMap = new Map((grounding.makes || []).map((m) => [Number(m.make_id), m]));
    const modelMap = new Map((grounding.models || []).map((m) => [Number(m.model_id), m]));
    const engineMap = new Map((grounding.engines || []).map((e) => [Number(e.engine_id), e]));

    const makeAliasKeysById = new Map();
    for (const a of grounding.makeAliases || []) {
      const id = Number(a.make_id);
      if (!makeAliasKeysById.has(id)) makeAliasKeysById.set(id, new Set());
      makeAliasKeysById.get(id).add(a.alias_key || nameKey(a.alias_text));
    }

    const modelAliasKeysById = new Map();
    for (const a of grounding.modelAliases || []) {
      const id = Number(a.model_id);
      if (!modelAliasKeysById.has(id)) modelAliasKeysById.set(id, new Set());
      modelAliasKeysById.get(id).add(a.alias_key || nameKey(a.alias_text));
    }

    const engineAliasKeysById = new Map();
    for (const a of grounding.engineAliases || []) {
      const id = Number(a.engine_id);
      if (!engineAliasKeysById.has(id)) engineAliasKeysById.set(id, new Set());
      engineAliasKeysById.get(id).add(a.alias_key || lookupKey(a.alias_text));
    }

    const cleaned = [];
    for (const f of result.fitments) {
      if (!f || typeof f !== 'object') continue;

      let makeId = Number.isInteger(f.make_id) ? f.make_id : null;
      let modelId = Number.isInteger(f.model_id) ? f.model_id : null;
      let engineId = Number.isInteger(f.engine_id) ? f.engine_id : null;
      let strippedId = false;

      // 1. Validate make_id existence and agreement with supplied make name
      if (makeId !== null) {
        const makeRow = makeMap.get(makeId);
        if (!makeRow) {
          makeId = null;
          strippedId = true;
        } else if (typeof f.make === 'string' && f.make.trim()) {
          const suppliedKey = nameKey(f.make);
          const canonKey = nameKey(makeRow.make_name);
          const aliases = makeAliasKeysById.get(makeId);
          if (suppliedKey !== canonKey && !(aliases && aliases.has(suppliedKey))) {
            makeId = null;
            strippedId = true;
          }
        }
      }

      // 2. Validate model_id existence, agreement with model name (B08 / F06), and parent make_id
      if (modelId !== null) {
        const modelRow = modelMap.get(modelId);
        if (!modelRow) {
          modelId = null;
          strippedId = true;
        } else {
          if (typeof f.model === 'string' && f.model.trim()) {
            const suppliedModelKey = nameKey(f.model);
            const canonModelKey = nameKey(modelRow.model_name);
            const aliases = modelAliasKeysById.get(modelId);
            if (suppliedModelKey !== canonModelKey && !(aliases && aliases.has(suppliedModelKey))) {
              modelId = null;
              strippedId = true;
            }
          }
          if (modelId !== null) {
            if (makeId !== null && Number(modelRow.make_id) !== makeId) {
              modelId = null;
              strippedId = true;
            } else if (makeId === null && makeMap.has(Number(modelRow.make_id))) {
              const parentMake = makeMap.get(Number(modelRow.make_id));
              if (!f.make || !f.make.trim() || nameKey(f.make) === nameKey(parentMake.make_name)) {
                makeId = Number(modelRow.make_id);
              } else {
                modelId = null;
                strippedId = true;
              }
            }
          }
        }
      }

      // 3. Validate engine_id existence and agreement with engine code
      if (engineId !== null) {
        const engineRow = engineMap.get(engineId);
        if (!engineRow) {
          engineId = null;
          strippedId = true;
        } else if (typeof f.engine === 'string' && f.engine.trim()) {
          const suppliedEngKey = lookupKey(f.engine);
          const canonEngKey = lookupKey(engineRow.engine_code);
          const aliases = engineAliasKeysById.get(engineId);
          if (suppliedEngKey !== canonEngKey && !(aliases && aliases.has(suppliedEngKey))) {
            engineId = null;
            strippedId = true;
          }
        }
      }

      const make = makeId !== null
        ? makeMap.get(makeId).make_name
        : (typeof f.make === 'string' && f.make.trim() ? f.make.trim() : null);
      const model = modelId !== null
        ? modelMap.get(modelId).model_name
        : (typeof f.model === 'string' && f.model.trim() ? f.model.trim() : null);

      let engine = typeof f.engine === 'string' && f.engine.trim() ? f.engine.trim().toUpperCase() : null;
      if (engineId !== null) {
        engine = engineMap.get(engineId).engine_code;
      } else if (engine) {
        const canon = canonicalizeEngineCode(engine);
        if (canon.valid && canon.canonical) {
          engine = canon.canonical;
        }
      }

      if (!make && !model && !engine && !f.chassis) continue;

      const yearStart = Number.isFinite(f.year_start) ? Math.trunc(f.year_start) : null;
      const yearEnd = Number.isFinite(f.year_end) ? Math.trunc(f.year_end) : null;
      const [finalYearStart, finalYearEnd] =
        yearStart != null && yearEnd != null && yearStart > yearEnd
          ? [yearEnd, yearStart]
          : [yearStart, yearEnd];

      const fuelType = typeof f.fuel_type === 'string' && VALID_FUEL_TYPES.includes(f.fuel_type.toLowerCase())
        ? f.fuel_type.toLowerCase()
        : null;
      const displacement = Number.isFinite(f.displacement_liters) && f.displacement_liters > 0 && f.displacement_liters < 20
        ? Number(Number(f.displacement_liters).toFixed(1))
        : null;

      let confidence = ['high', 'medium', 'low'].includes(f.confidence) ? f.confidence : 'low';
      if (strippedId || (makeId === null && modelId === null && engineId === null)) {
        confidence = 'low';
      }

      const row = {
        make,
        make_id: makeId,
        model,
        model_id: modelId,
        engine,
        engine_id: engineId,
        displacement_liters: displacement,
        fuel_type: fuelType,
        year_start: finalYearStart,
        year_end: finalYearEnd,
        effect: f.effect === 'exclude' ? 'exclude' : 'include',
        confidence,
        raw_span: typeof f.raw_span === 'string' ? f.raw_span : '',
      };
      if (f.chassis) row.chassis = String(f.chassis).trim();
      if (Number.isInteger(f.chassis_id)) row.chassis_id = f.chassis_id;
      if (f.market) row.market = String(f.market).trim();
      if (f.variant) row.variant = String(f.variant).trim();
      if (f.position) row.position = String(f.position).trim();
      if (f.drivetrain) row.drivetrain = String(f.drivetrain).trim();
      if (f.transmission) row.transmission = String(f.transmission).trim();
      if (f.generation) row.generation = String(f.generation).trim();

      cleaned.push(row);
    }

    const unparsed = Array.isArray(result.unparsed_tokens)
      ? result.unparsed_tokens.filter((t) => typeof t === 'string' && t.trim())
      : [];

    return {
      fitments: cleaned,
      unparsed_tokens: unparsed,
      notes: typeof result?.notes === 'string' ? result.notes : '',
      reasoning: typeof result?.reasoning === 'string' ? result.reasoning : '',
    };
  }

  async _resolveJevAmbiguities(result, grounding = {}, sourceText = '') {
    if (!jevClient.isConfigured() || !result.fitments || !result.fitments.length) return result;
    const models = grounding.models || [];
    // Do NOT include 'other' as a fallback fuel choice; choose 'unknown' if uncertain (Fixes F17 / D02)
    const explicitFuelChoices = ['diesel', 'gasoline', 'hybrid', 'electric', 'lpg', 'unknown'];

    const resolved = await Promise.all(
      result.fitments.map(async (fitment) => {
        const next = { ...fitment };
        if (!next.model_id && next.model) {
          const key = modelKey(next.model);
          const choices = models
            .filter((model) => !next.make_id || model.make_id === next.make_id)
            .filter((model) => {
              const candidate = modelKey(model.model_name);
              return candidate.includes(key) || key.includes(candidate);
            })
            .slice(0, 5)
            .map((model) => ({
              value: String(model.model_id),
              label: `${model.make_name || ''} ${model.model_name}`.trim(),
            }));
          if (choices.length > 1) {
            choices.push({ value: 'no_match', label: 'No reliable model match' });
            try {
              const decision = await jevClient.evaluateChoice({
                question: 'fitment_model',
                state: { fitment_text: sourceText, proposed_model: next.model },
                choices,
                instructions: 'Choose the existing vehicle model referred to by the text. Choose no_match unless the match is reliable.',
              });
              if (decision?.choice !== 'no_match' && decision?.confidence >= JEV_FITMENT_CHOICE_CONFIDENCE) {
                const model = models.find((row) => String(row.model_id) === decision.choice);
                if (model) {
                  next.model_id = model.model_id;
                  next.model = model.model_name;
                  next.make_id = model.make_id;
                }
              }
            } catch (error) {
              console.warn('[VehicleFitmentParserAI] Jev model choice unavailable:', error.message);
            }
          }
        }
        if (!next.fuel_type && (next.engine || next.displacement_liters != null)) {
          const choices = explicitFuelChoices.map((value) => ({ value, label: value.replace('_', ' ') }));
          try {
            const decision = await jevClient.evaluateChoice({
              question: 'fitment_fuel',
              state: { fitment_text: sourceText, engine: next.engine, displacement_liters: next.displacement_liters },
              choices,
              instructions: 'Choose the fuel type only when it is stated or reliably implied by the engine. Otherwise choose unknown.',
            });
            if (
              decision?.choice &&
              decision.choice !== 'unknown' &&
              decision?.confidence >= JEV_FITMENT_CHOICE_CONFIDENCE
            ) {
              next.fuel_type = decision.choice;
            }
          } catch (error) {
            console.warn('[VehicleFitmentParserAI] Jev fuel choice unavailable:', error.message);
          }
        }
        return next;
      })
    );
    return { ...result, fitments: resolved };
  }
}

module.exports = new VehicleFitmentParserAI();
