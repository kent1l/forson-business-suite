/**
 * Prompt building & sanitization utilities for AI features.
 */

/**
 * Sanitizes user text inputs to prevent prompt injection and control character issues.
 */
function sanitizeInput(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '') // Strip control chars
        .trim();
}

/**
 * Formats prior correction pairs or few-shot examples into readable prompt text.
 */
function formatFewShotContext(examples = []) {
    if (!Array.isArray(examples) || examples.length === 0) {
        return 'None available.';
    }
    return examples
        .map((ex, idx) => `Example ${idx + 1}: ${typeof ex === 'string' ? ex : JSON.stringify(ex)}`)
        .join('\n');
}

/**
 * Appends a JSON output format instruction wrapper.
 */
function wrapJsonInstruction(basePrompt, jsonSchemaDescription) {
    return `${basePrompt}

CRITICAL: Return ONLY valid JSON matching this exact structure without markdown code fences or conversational text:
${jsonSchemaDescription}`;
}

module.exports = {
    sanitizeInput,
    formatFewShotContext,
    wrapJsonInstruction
};
