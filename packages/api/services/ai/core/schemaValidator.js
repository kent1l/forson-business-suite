const { z } = require('zod');

class SchemaValidator {
    /**
     * Parses raw response string into JSON, handling codeblock fences.
     */
    parseJson(rawText) {
        if (typeof rawText === 'object' && rawText !== null) {
            return rawText;
        }
        if (typeof rawText !== 'string') {
            throw new Error('Invalid response type for JSON parsing');
        }

        let cleaned = rawText.trim();
        const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (jsonMatch && jsonMatch[1]) {
            cleaned = jsonMatch[1].trim();
        } else {
            cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/g, '').trim();
        }

        try {
            return JSON.parse(cleaned);
        } catch (err) {
            // If direct parse fails, try searching for first '{' or '[' and last '}' or ']'
            const firstBrace = cleaned.search(/[\{\[]/);
            const lastBrace = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
            if (firstBrace !== -1 && lastBrace > firstBrace) {
                const extracted = cleaned.substring(firstBrace, lastBrace + 1);
                try {
                    return JSON.parse(extracted);
                } catch {
                    // fall through
                }
            }
            throw new Error(`Failed to parse JSON response: ${err.message}. Content: ${cleaned.substring(0, 100)}`);
        }
    }

    /**
     * Validates data against a Zod schema or optional validation schema/function.
     */
    validate(data, schema) {
        if (!schema) return data;

        if (typeof schema.parse === 'function') {
            // Zod schema
            return schema.parse(data);
        }

        if (typeof schema.safeParse === 'function') {
            const result = schema.safeParse(data);
            if (!result.success) {
                throw new Error(`Schema validation failed: ${result.error.message}`);
            }
            return result.data;
        }

        return data;
    }

    /**
     * Parses and validates raw LLM output against a schema.
     */
    parseAndValidate(rawContent, schema) {
        const parsed = this.parseJson(rawContent);
        return this.validate(parsed, schema);
    }
}

const schemaValidatorInstance = new SchemaValidator();
module.exports = schemaValidatorInstance;
