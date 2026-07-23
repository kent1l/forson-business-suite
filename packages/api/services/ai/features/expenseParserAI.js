const db = require('../../../db');
const llmClient = require('../core/llmClient');
const embeddingClient = require('../core/embeddingClient');
const { wrapJsonInstruction } = require('../core/promptBuilder');

/**
 * Feature module: AI-assisted Natural Language Expense Parser with RAG pgvector dynamic few-shot retrieval.
 */
class ExpenseParserAI {
    /**
     * Parses natural language expense text into structured fields.
     */
    async parseExpenseText(text) {
        if (!text || typeof text !== 'string' || text.trim().length < 3) {
            const error = new Error('Text too short for AI parsing');
            error.statusCode = 400;
            throw error;
        }

        // 1. Fetch active categories
        let categories = [];
        try {
            const categoriesRes = await db.query(
                `SELECT category_id, category_name, description 
                 FROM expense_category 
                 WHERE is_active = true 
                 ORDER BY sort_order ASC, category_name ASC`
            );
            categories = categoriesRes.rows;
        } catch {
            // Non-blocking fallback if DB is unavailable
        }

        // 2. Fetch active payment methods
        let paymentMethods = [];
        try {
            const pmRes = await db.query(
                `SELECT method_id, name 
                 FROM payment_methods 
                 WHERE enabled = true 
                 ORDER BY sort_order ASC`
            );
            paymentMethods = pmRes.rows;
        } catch {
            // Non-blocking fallback if DB is unavailable
        }

        // 3. Dynamic RAG Few-Shot Retrieval via pgvector Cosine Similarity Search
        let fewShotExamples = [];
        try {
            let queryVector = null;
            try {
                const embResult = await embeddingClient.generateEmbeddingWithPool(text.trim());
                if (embResult?.vector) {
                    queryVector = JSON.stringify(embResult.vector);
                }
            } catch (embErr) {
                console.warn('[ExpenseParserAI] Failed to generate embedding vector for few-shot query:', embErr.message);
            }

            if (queryVector) {
                const vectorRes = await db.query(
                    `SELECT raw_input, corrected_category, corrected_data, field_name, ai_suggestion, user_correction
                     FROM expense_ai_correction
                     WHERE embedding IS NOT NULL
                     ORDER BY embedding <=> $1
                     LIMIT 3`,
                    [queryVector]
                );

                if (vectorRes.rows.length > 0) {
                    fewShotExamples = vectorRes.rows.map(r => {
                        if (r.raw_input || r.corrected_category) {
                            return `Input: "${r.raw_input || text.trim()}" -> Corrected Category: "${r.corrected_category || 'N/A'}" | Details: ${JSON.stringify(r.corrected_data || {})}`;
                        }
                        return `Field: ${r.field_name} | Suggestion: "${r.ai_suggestion}" -> Corrected: "${r.user_correction}"`;
                    });
                }
            }

            // Fallback to recent corrections if pgvector search returned no examples
            if (fewShotExamples.length === 0) {
                const correctionsRes = await db.query(
                    `SELECT c.field_name, c.ai_suggestion, c.user_correction, e.notes 
                     FROM expense_ai_correction c
                     JOIN expense e ON c.expense_id = e.expense_id
                     ORDER BY c.created_at DESC 
                     LIMIT 5`
                );
                fewShotExamples = correctionsRes.rows.map(r => 
                    `Input note: "${r.notes || ''}" | Corrected ${r.field_name}: from "${r.ai_suggestion}" to "${r.user_correction}"`
                );
            }
        } catch (err) {
            console.warn('[ExpenseParserAI] Few-shot retrieval error:', err.message);
        }

        // Today in Philippine Time
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
        const categoryListJson = JSON.stringify(categories.map(c => ({ id: c.category_id, name: c.category_name, description: c.description })));
        const pmListJson = JSON.stringify(paymentMethods.map(p => ({ id: p.method_id, name: p.name })));
        const examplesText = fewShotExamples.length > 0 ? fewShotExamples.join('\n') : 'None available yet.';

        const basePrompt = `You are an expense classification assistant for a retail auto parts store in the Philippines.
Parse the user's natural language expense description into structured fields.

Context:
- Today's date: ${today}
- Currency: PHP (₱)
- Active expense categories: ${categoryListJson}
- Available payment methods: ${pmListJson}

Prior correction examples for reference:
${examplesText}

User expense description: "${text.trim()}"`;

        const schema = `{
  "amount": number or null,
  "category_name": string or null (MUST match one of the active category names listed above exactly),
  "payee": string or null,
  "payment_method_name": string or null (MUST match one of the available payment methods listed above, or null),
  "expense_date": "YYYY-MM-DD" (resolve relative dates like "yesterday", "last friday" relative to today: ${today}),
  "reference_no": string or null,
  "notes": string or null (summary description of expense),
  "confidence": {
    "overall": number between 0 and 1,
    "category": number between 0 and 1,
    "amount": number between 0 and 1,
    "date": number between 0 and 1,
    "payment_method": number between 0 and 1
  }
}`;

        const prompt = wrapJsonInstruction(basePrompt, schema);

        let llmResult;
        try {
            llmResult = await llmClient.executeWithPool('expense_parser_pool', { prompt, timeoutMs: 25000 });
        } catch (err) {
            console.error('[ExpenseParserAI] LLM parse call failed:', err.message);
            const error = new Error('AI parsing service unavailable');
            error.statusCode = 503;
            error.fallback = 'manual';
            throw error;
        }

        let raw = llmResult.data || {};

        // Escalate to expense_reasoning_pool if overall confidence is low (<0.60) or missing essential fields
        if ((!raw.confidence || raw.confidence.overall < 0.60) && raw.amount) {
            try {
                console.warn('[ExpenseParserAI] Low confidence score. Escalating to expense_reasoning_pool...');
                const escalatedRes = await llmClient.executeWithPool('expense_reasoning_pool', { prompt, timeoutMs: 30000 });
                if (escalatedRes?.data?.confidence?.overall > (raw.confidence?.overall || 0)) {
                    llmResult = escalatedRes;
                    raw = escalatedRes.data;
                }
            } catch (err) {
                console.warn('[ExpenseParserAI] Escalation attempt failed, retaining primary result:', err.message);
            }
        }

        // Match category_name to active category ID
        let matchedCategory = null;
        if (raw.category_name) {
            const found = categories.find(
                c => c.category_name.toLowerCase() === String(raw.category_name).trim().toLowerCase()
            );
            if (found) matchedCategory = found;
        }

        // Match payment method
        let matchedPm = null;
        if (raw.payment_method_name) {
            const foundPm = paymentMethods.find(
                p => p.name.toLowerCase() === String(raw.payment_method_name).trim().toLowerCase()
            );
            if (foundPm) matchedPm = foundPm;
        }

        // Validate and clamp date
        let parsedDate = today;
        if (raw.expense_date && /^\d{4}-\d{2}-\d{2}$/.test(raw.expense_date)) {
            const dateObj = new Date(raw.expense_date);
            const maxFutureDate = new Date();
            maxFutureDate.setDate(maxFutureDate.getDate() + 365);
            if (!isNaN(dateObj.getTime()) && dateObj <= maxFutureDate) {
                parsedDate = raw.expense_date;
            }
        }

        // Parse amount
        let parsedAmount = null;
        if (typeof raw.amount === 'number' && raw.amount > 0) {
            parsedAmount = Math.round(raw.amount * 100) / 100;
        } else if (typeof raw.amount === 'string') {
            const cleanAmount = parseFloat(raw.amount.replace(/[^0-9.]/g, ''));
            if (!isNaN(cleanAmount) && cleanAmount > 0) {
                parsedAmount = Math.round(cleanAmount * 100) / 100;
            }
        }

        // Confidence normalization
        const conf = raw.confidence || {};
        const normalizedConf = {
            overall: typeof conf.overall === 'number' ? Math.min(1, Math.max(0, conf.overall)) : 0.7,
            category: matchedCategory ? (typeof conf.category === 'number' ? Math.min(1, Math.max(0, conf.category)) : 0.8) : 0,
            amount: parsedAmount ? (typeof conf.amount === 'number' ? Math.min(1, Math.max(0, conf.amount)) : 0.9) : 0,
            date: typeof conf.date === 'number' ? Math.min(1, Math.max(0, conf.date)) : 0.8,
            payment_method: matchedPm ? (typeof conf.payment_method === 'number' ? Math.min(1, Math.max(0, conf.payment_method)) : 0.8) : 0.5
        };

        return {
            parsed: {
                amount: parsedAmount,
                category_id: matchedCategory ? matchedCategory.category_id : null,
                category_name: matchedCategory ? matchedCategory.category_name : (raw.category_name || null),
                payee: raw.payee ? String(raw.payee).trim().substring(0, 200) : null,
                payment_method_id: matchedPm ? matchedPm.method_id : null,
                payment_method_text: matchedPm ? matchedPm.name : (raw.payment_method_name || 'Cash'),
                expense_date: parsedDate,
                reference_no: raw.reference_no ? String(raw.reference_no).trim().substring(0, 100) : null,
                notes: raw.notes ? String(raw.notes).trim() : text.trim(),
                confidence: normalizedConf
            },
            raw_llm_response: raw,
            provider: llmResult.provider || llmResult.providerUsed
        };
    }

    /**
     * Stores a user correction record alongside its vector embedding for future RAG few-shot retrieval.
     */
    async recordCorrection({ expense_id, field_name, ai_suggestion, user_correction, raw_input, corrected_category, corrected_data }) {
        let vectorJson = null;
        const textToEmbed = raw_input || user_correction || ai_suggestion || '';
        if (textToEmbed && textToEmbed.trim().length >= 3) {
            try {
                const embRes = await embeddingClient.generateEmbeddingWithPool(textToEmbed.trim());
                if (embRes?.vector) {
                    vectorJson = JSON.stringify(embRes.vector);
                }
            } catch (err) {
                console.warn('[ExpenseParserAI] Failed to generate embedding for correction record:', err.message);
            }
        }

        const query = `
            INSERT INTO expense_ai_correction (
                expense_id, field_name, ai_suggestion, user_correction, 
                raw_input, corrected_category, corrected_data, embedding
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING correction_id
        `;

        const res = await db.query(query, [
            expense_id || null,
            field_name ? String(field_name).substring(0, 50) : 'category',
            ai_suggestion ? String(ai_suggestion) : null,
            user_correction ? String(user_correction) : null,
            raw_input ? String(raw_input) : (textToEmbed || null),
            corrected_category ? String(corrected_category).substring(0, 100) : null,
            corrected_data ? JSON.stringify(corrected_data) : null,
            vectorJson
        ]);

        return res.rows[0];
    }
}

module.exports = new ExpenseParserAI();
