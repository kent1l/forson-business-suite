/**
 * Legacy compatibility wrapper for LLMRouter.
 * Delegates calls to the modular AI subsystem under services/ai/.
 */
const { llmClient, partDeduplicationAI } = require('./ai');

class LLMRouter {
    constructor() {
        this.provider = llmClient.provider;
        this.geminiKeys = llmClient.geminiKeys;
        this.geminiIndex = llmClient.geminiIndex;
        this.geminiModel = llmClient.geminiModel;
        this.openaiKey = llmClient.openaiKey;
        this.openaiModel = llmClient.openaiModel;
        this.openrouterKey = llmClient.openrouterKey;
        this.openrouterModel = llmClient.openrouterModel;
    }

    async verifyDuplicate(part1, part2) {
        return partDeduplicationAI.verifyDuplicate(part1, part2);
    }

    async analyzeGroup(parts) {
        return partDeduplicationAI.analyzeGroup(parts);
    }

    async generateJSON(prompt, timeoutMs = 25000) {
        return llmClient.generateJSON(prompt, timeoutMs);
    }
}

module.exports = new LLMRouter();
