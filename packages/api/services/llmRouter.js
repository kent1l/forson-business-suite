/**
 * Service for routing LLM verification requests to different providers
 * Supported: Google Gemini, OpenAI, OpenRouter
 */
class LLMRouter {
    constructor() {
        this.provider = (process.env.LLM_PROVIDER || 'google').toLowerCase();
        
        // Parse Google Gemini Keys
        const geminiPool = process.env.GEMINI_API_KEY_POOL || process.env.GEMINI_API_KEY || '';
        this.geminiKeys = geminiPool.split(',').map(k => k.trim()).filter(Boolean);
        this.geminiIndex = 0;
        this.geminiModel = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

        // OpenAI settings
        this.openaiKey = process.env.OPENAI_API_KEY || '';
        this.openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';

        // OpenRouter settings
        this.openrouterKey = process.env.OPENROUTER_API_KEY || '';
        this.openrouterModel = process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-exp:free';
    }

    async verifyDuplicate(part1, part2) {
        const formatPns = (pns) => {
            if (!pns || !Array.isArray(pns)) return 'None';
            return pns.map(p => typeof p === 'object' ? p.part_number : p).join(', ') || 'None';
        };

        const prompt = `You are an inventory deduplication agent.
Verify if these two descriptions refer to the EXACT same physical inventory item (e.g. same brand, size, specifications). 
Different colors, sizes, materials, or part numbers mean they are DISTINCT items.

Item 1:
Name: ${part1.display_name}
Detail: ${part1.detail || 'None'}
Brand: ${part1.brand_name || 'None'}
Part Numbers: ${formatPns(part1.part_numbers)}

Item 2:
Name: ${part2.display_name}
Detail: ${part2.detail || 'None'}
Brand: ${part2.brand_name || 'None'}
Part Numbers: ${formatPns(part2.part_numbers)}

Respond ONLY with a JSON object:
{
  "isDuplicate": boolean,
  "reason": "short explanation"
}`;

        switch (this.provider) {
            case 'openai':
                return this.callOpenAI(prompt);
            case 'openrouter':
                return this.callOpenRouter(prompt);
            case 'google':
            default:
                return this.callGemini(prompt);
        }
    }

    async callGemini(prompt, retries = 3) {
        if (this.geminiKeys.length === 0) {
            console.warn('No Gemini API keys found. Skipping AI verification.');
            return { isDuplicate: true, skipped: true, reason: 'Skipped - No Gemini API Key' };
        }

        const key = this.geminiKeys[this.geminiIndex];
        this.geminiIndex = (this.geminiIndex + 1) % this.geminiKeys.length;

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${key}`;

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: AbortSignal.timeout(30000),
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { responseMimeType: 'application/json' }
                    })
                });

                if (!response.ok) {
                    if (response.status === 429 && attempt < retries) {
                        console.warn(`[LLM] Gemini 429 Rate Limit. Retrying in ${attempt * 2}s...`);
                        await new Promise(r => setTimeout(r, attempt * 2000));
                        continue;
                    }
                    throw new Error(`Gemini API returned status ${response.status}: ${await response.text()}`);
                }

                const data = await response.json();
                const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                const result = JSON.parse(text);
                return { isDuplicate: result.isDuplicate === true, reason: result.reason || '', provider: 'google', model: this.geminiModel };
            } catch (error) {
                console.error(`[LLM] Gemini attempt ${attempt} failed:`, error.message);
                if (attempt === retries) {
                    return { isDuplicate: true, skipped: true, reason: `Gemini failed: ${error.message}` };
                }
                await new Promise(r => setTimeout(r, attempt * 2000));
            }
        }
    }

    async callOpenAI(prompt, retries = 3) {
        if (!this.openaiKey) {
            console.warn('No OpenAI API key found. Skipping AI verification.');
            return { isDuplicate: true, skipped: true, reason: 'Skipped - No OpenAI API Key' };
        }

        const url = 'https://api.openai.com/v1/chat/completions';
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.openaiKey}`
                    },
                    signal: AbortSignal.timeout(30000),
                    body: JSON.stringify({
                        model: this.openaiModel,
                        messages: [{ role: 'user', content: prompt }],
                        response_format: { type: 'json_object' }
                    })
                });

                if (!response.ok) {
                    if (response.status === 429 && attempt < retries) {
                        console.warn(`[LLM] OpenAI 429 Rate Limit. Retrying in ${attempt * 2}s...`);
                        await new Promise(r => setTimeout(r, attempt * 2000));
                        continue;
                    }
                    throw new Error(`OpenAI API returned status ${response.status}: ${await response.text()}`);
                }

                const data = await response.json();
                const text = data.choices?.[0]?.message?.content;
                const result = JSON.parse(text);
                return { isDuplicate: result.isDuplicate === true, reason: result.reason || '', provider: 'openai', model: this.openaiModel };
            } catch (error) {
                console.error(`[LLM] OpenAI attempt ${attempt} failed:`, error.message);
                if (attempt === retries) {
                    return { isDuplicate: true, skipped: true, reason: `OpenAI failed: ${error.message}` };
                }
                await new Promise(r => setTimeout(r, attempt * 2000));
            }
        }
    }

    async callOpenRouter(prompt, retries = 3, overrideModel = null, useFallback = true) {
        const modelToUse = overrideModel || this.openrouterModel;
        
        if (!modelToUse) {
            return { isDuplicate: true, skipped: true, reason: 'No OpenRouter model configured' };
        }

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                        'HTTP-Referer': 'http://localhost:5173',
                        'X-Title': 'Forson Business Suite',
                        'Content-Type': 'application/json'
                    },
                    signal: AbortSignal.timeout(30000),
                    body: JSON.stringify({
                        model: modelToUse,
                        messages: [{ role: 'user', content: prompt }],
                        response_format: { type: 'json_object' }
                    })
                });

                if (!response.ok) {
                    if (response.status === 429 && attempt < retries) {
                        console.warn(`OpenRouter 429 Rate Limit. Retrying in ${attempt * 2}s...`);
                        await new Promise(resolve => setTimeout(resolve, attempt * 2000));
                        continue;
                    }
                    throw new Error(`OpenRouter API returned status ${response.status}: ${await response.text()}`);
                }

                const responseText = await response.text();
                if (!responseText.trim()) {
                    throw new Error('OpenRouter returned empty response body');
                }

                let data;
                try {
                    data = JSON.parse(responseText);
                } catch {
                    throw new Error('OpenRouter response body was not valid JSON');
                }

                let text = data.choices?.[0]?.message?.content || '{}';
                
                // Clean markdown backticks if the model decided to format it as code
                text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
                
                let result;
                try {
                    result = JSON.parse(text);
                } catch {
                    console.error('OpenRouter inner JSON parse error. Raw text:', text);
                    return { isDuplicate: true, skipped: true, reason: 'AI JSON parsing failed' };
                }
                
                return { isDuplicate: result.isDuplicate === true, reason: result.reason || '', provider: 'openrouter', model: modelToUse };
            } catch (error) {
                console.error(`OpenRouter Attempt ${attempt} failed with model ${modelToUse}:`, error.message);
                if (attempt === retries) {
                    if (useFallback && process.env.OPENROUTER_FALLBACK_MODEL) {
                        console.warn(`Primary model failed after ${retries} attempts. Falling back to secondary model: ${process.env.OPENROUTER_FALLBACK_MODEL}`);
                        return this.callOpenRouter(prompt, retries, process.env.OPENROUTER_FALLBACK_MODEL, false);
                    }
                    return { isDuplicate: true, skipped: true, reason: `AI failed: ${error.message}` };
                }
                await new Promise(resolve => setTimeout(resolve, attempt * 2000));
            }
        }
    }
    /**
     * Analyzes a cluster of candidate parts and groups them into duplicate sets.
     * This is the primary detection method — replaces pair-by-pair verification.
     *
     * @param {Array} parts - Array of part objects (up to 20)
     * @returns {Object} { groups: [{ partIds: [], reason: '', confidence: 'high'|'medium'|'low' }] }
     */
    async analyzeGroup(parts) {
        // Format each part into a clean text block for the AI
        const formatPart = (p, index) => {
            const pns = (p.part_numbers || [])
                .map(pn => typeof pn === 'object' ? pn.part_number : pn)
                .join(', ') || 'None';
            return [
                `[Part ${index + 1}] ID: ${p.part_id}`,
                `  Name: ${p.display_name || 'N/A'}`,
                `  Detail: ${p.detail || 'N/A'}`,
                `  Brand: ${p.brand_name || 'N/A'}`,
                `  Group/Category: ${p.group_name || 'N/A'}`,
                `  SKU: ${p.internal_sku || 'N/A'}`,
                `  Part Numbers: ${pns}`,
            ].join('\n');
        };

        const partsList = parts.map(formatPart).join('\n\n');
        const partIds = parts.map(p => p.part_id);
        const prompt = `You are an automotive parts inventory deduplication expert for a parts store.

You will be given a list of parts from an inventory system. Your job is to identify which parts are the SAME physical item that was entered more than once (duplicates), and group them together.

IMPORTANT RULES:
1. Different sizes, specs, voltages, or dimensions (e.g., 12V vs 24V, 15/16" vs 1") = DIFFERENT items. Do NOT group them.
   - PISTON RINGS / BEARINGS / ENGINE PARTS: STD (Standard) vs oversizes (0.25, 0.50, 0.75, 1.00, 1.50, 020, 030, 040) are DIFFERENT items. NEVER group standard with an oversize, or different oversizes together.
   - GASKETS (especially Cylinder Head Gaskets): Different materials (e.g., CARBON, STEEL, METAL, COPPER, PAPER, GRAPHITE) represent distinct products. NEVER group different materials together.

2. Different BRANDS = DIFFERENT inventory items, EVEN IF they share the same part number.
   In automotive parts, OEM part numbers are printed on aftermarket products as cross-references.
   For example: SEIKEN 47575R and DENSO 47575R are SEPARATE stock items sold at different prices
   from different suppliers. DO NOT group them.
   EXCEPTION: You MAY group cross-brand parts ONLY IF:
   a) One brand is clearly unset or generic (brand is exactly "NO BRAND", "GENERIC", "N/A", "UNKNOWN", or blank),
      AND the part names and categories are otherwise identical — strongly suggesting a data-entry duplicate.
   b) The internal_sku fields share nearly the same prefix pattern, strongly suggesting the same catalog
      entry was entered twice with a minor variation.

3. Vendor prefixes in part numbers are common WITHIN THE SAME BRAND (e.g., SC-47575R and 47575R from
   the same brand are the same number — the "SC-" is a supplier prefix). Strip vendor prefixes when
   comparing part numbers, but ONLY when the brand is the same.

4. Different part categories = NEVER duplicates, even if they share a part number.
   A coincidental part number match between an ALTERNATOR and a VALVE SEAL is not a duplication signal.

5. Parts with no overlapping part numbers and different brand names are almost certainly NOT duplicates.
   Be very conservative — if unsure, do NOT include the pair in any group.

6. A part can only belong to ONE group.

Parts to analyze:
${partsList}

Respond ONLY with a valid JSON object in this exact format:
{
  "groups": [
    {
      "partIds": [101, 102],
      "reason": "Both are RUBBER CUP (SEIKEN) with part number 47575R — SC-47575R and 47575R are the same number with a vendor prefix, same brand",
      "confidence": "high"
    }
  ]
}

Only include groups that contain 2 or more parts. Parts that are NOT duplicates of anything else should NOT appear in any group. If no duplicates are found, return { "groups": [] }.`;

        switch (this.provider) {
            case 'openai':
                return this._callOpenAIForGroup(prompt, partIds);
            case 'openrouter':
                return this._callOpenRouterForGroup(prompt, partIds);
            case 'google':
            default:
                return this._callGeminiForGroup(prompt, partIds);
        }
    }

    async _callGeminiForGroup(prompt, partIds) {
        if (this.geminiKeys.length === 0) {
            console.warn('[LLM] No Gemini API key. Returning empty groups.');
            return { groups: [], skipped: true };
        }
        const key = this.geminiKeys[this.geminiIndex];
        this.geminiIndex = (this.geminiIndex + 1) % this.geminiKeys.length;

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${key}`;
        const retries = 3;
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: AbortSignal.timeout(45000),
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { responseMimeType: 'application/json' }
                    })
                });

                if (!response.ok) {
                    if (response.status === 429 && attempt < retries) {
                        console.warn(`[LLM] Gemini (group) 429 Rate Limit. Retrying in ${attempt * 2}s...`);
                        await new Promise(r => setTimeout(r, attempt * 2000));
                        continue;
                    }
                    throw new Error(`Gemini API error ${response.status}: ${await response.text()}`);
                }
                const data = await response.json();
                const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                const result = JSON.parse(text);
                return this._validateGroupResult(result, partIds);
            } catch (error) {
                console.error(`[LLM] Gemini (group) attempt ${attempt} failed:`, error.message);
                if (attempt === retries) return { groups: [], skipped: true };
                await new Promise(r => setTimeout(r, attempt * 2000));
            }
        }
    }

    // Internal helper — calls OpenAI and parses group response
    async _callOpenAIForGroup(prompt, partIds) {
        if (!this.openaiKey) return { groups: [], skipped: true };
        const retries = 3;
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const response = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.openaiKey}` },
                    signal: AbortSignal.timeout(45000),
                    body: JSON.stringify({
                        model: this.openaiModel,
                        messages: [{ role: 'user', content: prompt }],
                        response_format: { type: 'json_object' }
                    })
                });
                if (!response.ok) {
                    if (response.status === 429 && attempt < retries) {
                        console.warn(`[LLM] OpenAI (group) 429 Rate Limit. Retrying in ${attempt * 2}s...`);
                        await new Promise(r => setTimeout(r, attempt * 2000));
                        continue;
                    }
                    throw new Error(`OpenAI error ${response.status}`);
                }
                const data = await response.json();
                const result = JSON.parse(data.choices?.[0]?.message?.content);
                return this._validateGroupResult(result, partIds);
            } catch (error) {
                console.error(`[LLM] OpenAI (group) attempt ${attempt} failed:`, error.message);
                if (attempt === retries) return { groups: [], skipped: true };
                await new Promise(r => setTimeout(r, attempt * 2000));
            }
        }
    }

    // Internal helper — calls OpenRouter and parses group response
    async _callOpenRouterForGroup(prompt, partIds) {
        if (!this.openrouterKey && !this.openrouterModel) return { groups: [], skipped: true };
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'HTTP-Referer': 'http://localhost:5173',
                'X-Title': 'Forson Business Suite',
                'Content-Type': 'application/json'
            },
            signal: AbortSignal.timeout(45000),
            body: JSON.stringify({
                model: this.openrouterModel,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: 'json_object' }
            })
        });
        if (!response.ok) throw new Error(`OpenRouter error ${response.status}`);
        const data = await response.json();
        let text = data.choices?.[0]?.message?.content || '{}';
        text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        const result = JSON.parse(text);
        return this._validateGroupResult(result, partIds);
    }

    /**
     * Validates the AI's group result — ensures part IDs are real and groups have ≥ 2 members.
     */
    _validateGroupResult(result, validPartIds) {
        const validIdSet = new Set(validPartIds);
        const groups = (result?.groups || [])
            .map(g => ({
                partIds: (g.partIds || []).filter(id => validIdSet.has(id)),
                reason: g.reason || '',
                confidence: ['high', 'medium', 'low'].includes(g.confidence) ? g.confidence : 'low'
            }))
            .filter(g => g.partIds.length >= 2);
        return { groups };
    }
}

module.exports = new LLMRouter();
