const llmClient = require('../core/llmClient');
const { wrapJsonInstruction } = require('../core/promptBuilder');

/**
 * Feature module: AI-assisted Parts Inventory Deduplication.
 */
class PartDeduplicationAI {
    /**
     * Verifies if two individual part records represent the exact same physical inventory item.
     */
    async verifyDuplicate(part1, part2) {
        const formatPns = (pns) => {
            if (!pns || !Array.isArray(pns)) return 'None';
            return pns.map(p => typeof p === 'object' ? p.part_number : p).join(', ') || 'None';
        };

        const basePrompt = `You are an inventory deduplication agent for an auto parts store.
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
Part Numbers: ${formatPns(part2.part_numbers)}`;

        const schema = `{
  "isDuplicate": boolean,
  "reason": "short explanation"
}`;

        const prompt = wrapJsonInstruction(basePrompt, schema);

        try {
            const res = await llmClient.generateJSON(prompt, 30000);
            const result = res.data || {};
            return {
                isDuplicate: result.isDuplicate === true,
                reason: result.reason || '',
                provider: res.provider,
                model: res.model
            };
        } catch (error) {
            console.error('[PartDeduplicationAI] verifyDuplicate error:', error.message);
            return { isDuplicate: true, skipped: true, reason: `AI verification skipped: ${error.message}` };
        }
    }

    /**
     * Analyzes a candidate cluster of parts (3-15 items) and partitions them into duplicate groups.
     */
    async analyzeGroup(parts) {
        if (!parts || parts.length < 2) return { groups: [] };

        const validPartIds = parts.map(p => p.part_id);
        const partsJson = parts.map(p => ({
            id: p.part_id,
            display_name: p.display_name,
            detail: p.detail || '',
            brand: p.brand_name || '',
            part_numbers: Array.isArray(p.part_numbers)
                ? p.part_numbers.map(pn => typeof pn === 'object' ? pn.part_number : pn)
                : []
        }));

        const basePrompt = `You are an expert auto parts inventory deduplication specialist.
Analyze this set of ${parts.length} inventory records and group together items that are EXACT DUPLICATES of the same physical product.

Strict Matching Rules:
1. ONLY group items that are unquestionably the exact same physical part.
2. Distinct sizes, thread pitches, lengths, colors, or positions (e.g. Front vs Rear, Left vs Right) MUST NOT be grouped together.
3. Every group MUST contain at least 2 part IDs.
4. An item should only belong to 1 group.

Input Items:
${JSON.stringify(partsJson, null, 2)}`;

        const schema = `{
  "groups": [
    {
      "partIds": [number, number],
      "reason": "short explanation why these parts are exact duplicates",
      "confidence": "high" | "medium" | "low"
    }
  ]
}`;

        const prompt = wrapJsonInstruction(basePrompt, schema);

        try {
            const res = await llmClient.generateJSON(prompt, 45000);
            return this._validateGroupResult(res.data, validPartIds);
        } catch (error) {
            console.error('[PartDeduplicationAI] analyzeGroup error:', error.message);
            return { groups: [], skipped: true, reason: error.message };
        }
    }

    /**
     * Validates group result structure ensuring valid part IDs and size >= 2.
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

module.exports = new PartDeduplicationAI();
