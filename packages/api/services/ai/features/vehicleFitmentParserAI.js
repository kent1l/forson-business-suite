const db = require('../../../db');
const llmClient = require('../core/llmClient');
const { wrapJsonInstruction, sanitizeInput } = require('../core/promptBuilder');

const VALID_FUEL_TYPES = ['diesel', 'gasoline', 'hybrid', 'mild_hybrid', 'electric', 'other'];

/**
 * Feature module: AI-assisted natural-language vehicle fitment entry.
 * Staff describe a fitment in plain text ("Fits Hilux 2005-2015 2.5L Diesel,
 * also Fortuner same years") and get back structured, editable candidate rows
 * to review before anything is saved. This module only proposes -- it never
 * writes to the taxonomy or to part_application itself; the caller is
 * responsible for committing through the normal /applications and
 * /parts/:partId/applications endpoints (which independently re-validate any
 * ID before using it, per the "never trust an LLM-returned ID directly into a
 * write" rule).
 */
class VehicleFitmentParserAI {
    /**
     * Loads the current taxonomy as grounding context so the model prefers
     * matching existing makes/models/engines over inventing near-duplicates
     * (the whole point of Phase 1b's seeded reference data).
     *
     * Phase 8 note: this full-taxonomy load is now the FALLBACK path only.
     * Callers that have already run the deterministic parser
     * (helpers/fitmentTextParser.js) pass a shortlist instead -- see
     * parseFitmentText's `grounding` option. Loading everything made both
     * latency and token cost scale with catalog size rather than with the
     * difficulty of the staff member's input.
     */
    async _loadGroundingData() {
        const [makesRes, modelsRes, enginesRes] = await Promise.all([
            db.query('SELECT make_id, make_name FROM vehicle_make ORDER BY make_name'),
            db.query(`
                SELECT vm.model_id, vm.model_name, vm.make_id, mk.make_name
                FROM vehicle_model vm
                JOIN vehicle_make mk ON mk.make_id = vm.make_id
                ORDER BY mk.make_name, vm.model_name
            `),
            db.query('SELECT engine_id, engine_code, displacement_liters, fuel_type FROM engine ORDER BY engine_code')
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
            .map(e => `${e.engine_code} (${e.displacement_liters != null ? e.displacement_liters + 'L' : 'displacement unknown'}${e.fuel_type ? ', ' + e.fuel_type : ''})`)
            .join(', ');

        return `Existing Makes: ${makes.map(m => m.make_name).join(', ')}

Existing Models by Make:
${modelsBlock}

Existing Engine Codes (code (displacement, fuel type)):
${enginesBlock}`;
    }

    /**
     * Parses a free-text fitment description into structured candidate rows.
     * Never writes anything -- callers must commit each accepted row through
     * the normal application/part_application endpoints.
     */
    async parseFitmentText(text, options = {}) {
        const cleanText = sanitizeInput(text);
        if (!cleanText) {
            return { fitments: [], notes: '' };
        }

        // A caller that has already narrowed the taxonomy (the deterministic
        // parser's shortlist) supplies it here; otherwise fall back to loading
        // the whole thing.
        const grounding = options.grounding || await this._loadGroundingData();
        const groundingPrompt = this._formatGroundingPrompt(grounding);

        const basePrompt = `You are a vehicle fitment extraction agent for an auto parts store in the Philippines.
Extract every distinct vehicle fitment described in the staff member's text below into structured rows.

Rules:
1. A fitment can specify make+model+engine, make+model only (engine-agnostic), engine only (vehicle-agnostic), or any combination -- extract exactly what is stated, do not invent missing pieces.
2. When a make/model/engine matches one in the existing lists below (allow for case differences, abbreviations, and minor spelling variation), return its exact existing name AND its id field. Only omit the id (leave it null) when nothing in the existing lists is a confident match -- in that case still return the name text the user wrote so it can be reviewed as a possible new taxonomy entry.
3. If one description names multiple models (e.g. "Hilux and Fortuner") or multiple engines for the same vehicle, produce one row per make+model+engine combination.
4. Extract a year range if stated (e.g. "2005-2015" -> year_start 2005, year_end 2015; a single year -> both fields set to it). Leave both null if no year is mentioned.
5. Extract displacement_liters (number) and fuel_type (one of: diesel, gasoline, hybrid, mild_hybrid, electric, other) only when stated or unambiguous from the matched engine's known specs; otherwise null.
6. confidence is "high" when make/model/engine names map cleanly to the existing lists or are stated unambiguously, "medium" when there's a plausible but imperfect match or a name not in the existing lists, "low" when the text is genuinely ambiguous.

${groundingPrompt}

Staff description:
"""
${cleanText}
"""`;

        const schema = `{
  "fitments": [
    {
      "make": "string or null",
      "make_id": number or null,
      "model": "string or null",
      "model_id": number or null,
      "engine": "string or null",
      "engine_id": number or null,
      "displacement_liters": number or null,
      "fuel_type": "diesel" | "gasoline" | "hybrid" | "mild_hybrid" | "electric" | "other" | null,
      "year_start": number or null,
      "year_end": number or null,
      "confidence": "high" | "medium" | "low"
    }
  ],
  "notes": "short string, empty if nothing to flag"
}`;

        const prompt = wrapJsonInstruction(basePrompt, schema);

        try {
            const res = await llmClient.executeWithPool('vehicle_fitment_parser_pool', { prompt, timeoutMs: 30000 });
            return this._validateResult(res.data, grounding);
        } catch (error) {
            console.error('[VehicleFitmentParserAI] parseFitmentText error:', error.message);
            const err = new Error(`AI fitment parsing failed: ${error.message}`);
            err.statusCode = 503;
            throw err;
        }
    }

    /**
     * Safety-critical: an LLM-claimed make_id/model_id/engine_id is only kept
     * if it actually exists in the taxonomy snapshot we grounded the prompt
     * with, and (for model_id) actually belongs to the claimed make_id. A
     * bad/hallucinated id is stripped back to null -- never trusted -- while
     * the name text is preserved so the reviewer can still match or create it
     * manually via the normal cascading form.
     */
    _validateResult(result, grounding) {
        const validMakeIds = new Set(grounding.makes.map(m => m.make_id));
        const modelById = new Map(grounding.models.map(m => [m.model_id, m]));
        const validEngineIds = new Set(grounding.engines.map(e => e.engine_id));

        const fitments = Array.isArray(result?.fitments) ? result.fitments : [];

        const cleaned = fitments.map(f => {
            const make = typeof f.make === 'string' ? f.make.trim() || null : null;
            const model = typeof f.model === 'string' ? f.model.trim() || null : null;
            const engine = typeof f.engine === 'string' ? f.engine.trim() || null : null;

            let makeId = Number.isInteger(f.make_id) && validMakeIds.has(f.make_id) ? f.make_id : null;

            let modelId = null;
            if (Number.isInteger(f.model_id) && modelById.has(f.model_id)) {
                const modelRow = modelById.get(f.model_id);
                // A model claimed under a make it doesn't belong to is not a
                // safe match -- keep the model text, drop both ids so the
                // reviewer resolves it explicitly instead of silently
                // attaching the wrong make.
                if (!makeId || modelRow.make_id === makeId) {
                    modelId = f.model_id;
                    if (!makeId) makeId = modelRow.make_id;
                } else {
                    makeId = null;
                }
            }

            const engineId = Number.isInteger(f.engine_id) && validEngineIds.has(f.engine_id) ? f.engine_id : null;

            const yearStart = Number.isFinite(f.year_start) ? Math.trunc(f.year_start) : null;
            const yearEnd = Number.isFinite(f.year_end) ? Math.trunc(f.year_end) : null;
            const [finalYearStart, finalYearEnd] = (yearStart != null && yearEnd != null && yearStart > yearEnd)
                ? [yearEnd, yearStart]
                : [yearStart, yearEnd];

            const fuelType = VALID_FUEL_TYPES.includes(f.fuel_type) ? f.fuel_type : null;
            const displacement = Number.isFinite(f.displacement_liters) ? f.displacement_liters : null;

            const confidence = ['high', 'medium', 'low'].includes(f.confidence) ? f.confidence : 'low';

            return {
                make, make_id: makeId,
                model, model_id: modelId,
                engine, engine_id: engineId,
                displacement_liters: displacement,
                fuel_type: fuelType,
                year_start: finalYearStart,
                year_end: finalYearEnd,
                confidence
            };
        }).filter(f => f.make || f.model || f.engine);

        return {
            fitments: cleaned,
            notes: typeof result?.notes === 'string' ? result.notes : ''
        };
    }
}

module.exports = new VehicleFitmentParserAI();
