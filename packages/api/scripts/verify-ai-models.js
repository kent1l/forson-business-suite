const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const GEMINI_MODELS = [
    // Standard Gemini Models
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-3.1-pro',
    'gemini-3.0-flash',
    'gemini-3-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    
    // Gemma Open Models
    'gemma-4-31b-it',
    'gemma-4-31b',
    'gemma-4-26b-it',
    'gemma-4-26b'
];

const OPENROUTER_MODELS = [
    'openrouter/free',
    'google/gemini-2.5-flash',
    'google/gemini-3.5-flash',
    'meta-llama/llama-3.3-70b-instruct',
    'deepseek/deepseek-chat',
    'qwen/qwen-2.5-coder-32b-instruct'
];

async function testGeminiModel(key, model) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(10000),
            body: JSON.stringify({
                contents: [{ parts: [{ text: 'Respond with short JSON: {"status":"ok"}' }] }],
                generationConfig: { responseMimeType: 'application/json' }
            })
        });

        const status = res.status;
        const text = await res.text();

        if (res.ok) {
            return { model, status: 'SUCCESS', httpStatus: status, detail: 'OK' };
        }

        if (status === 429 || text.includes('RESOURCE_EXHAUSTED') || text.includes('Quota exceeded')) {
            return { model, status: 'RATE_LIMITED', httpStatus: status, detail: 'Rate limit or quota exhausted (KEEP IN LIST)' };
        }

        if (status === 404 || text.includes('NOT_FOUND') || text.includes('is not found') || text.includes('deprecated') || text.includes('unsupported')) {
            return { model, status: 'DEPRECATED_OR_INVALID', httpStatus: status, detail: text.substring(0, 120) };
        }

        return { model, status: 'ERROR', httpStatus: status, detail: text.substring(0, 120) };
    } catch (err) {
        return { model, status: 'NETWORK_ERROR', httpStatus: 0, detail: err.message };
    }
}

async function testOpenRouterModel(key, model) {
    try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'http://localhost:5173',
                'X-Title': 'Forson Business Suite'
            },
            signal: AbortSignal.timeout(15000),
            body: JSON.stringify({
                model: model,
                messages: [{ role: 'user', content: 'Respond with short JSON: {"status":"ok"}' }],
                response_format: { type: 'json_object' }
            })
        });

        const status = res.status;
        const text = await res.text();

        if (res.ok) {
            return { model, status: 'SUCCESS', httpStatus: status, detail: 'OK' };
        }

        if (status === 429) {
            return { model, status: 'RATE_LIMITED', httpStatus: status, detail: 'Rate limit / quota exhausted' };
        }

        if (status === 404 || text.includes('not found') || text.includes('does not exist')) {
            return { model, status: 'DEPRECATED_OR_INVALID', httpStatus: status, detail: text.substring(0, 120) };
        }

        return { model, status: 'ERROR', httpStatus: status, detail: text.substring(0, 120) };
    } catch (err) {
        return { model, status: 'NETWORK_ERROR', httpStatus: 0, detail: err.message };
    }
}

async function runVerification() {
    console.log('====================================================');
    console.log('   FORSON BUSINESS SUITE - AI MODEL VERIFICATION');
    console.log('====================================================\n');

    const geminiKeys = (process.env.GEMINI_API_KEY_POOL || process.env.GEMINI_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean);
    const openrouterKey = process.env.OPENROUTER_API_KEY || '';
    const openaiKey = process.env.OPENAI_API_KEY || '';

    console.log(`[Config] Gemini Keys: ${geminiKeys.length} | OpenRouter Key: ${openrouterKey ? 'YES' : 'NO'} | OpenAI Key: ${openaiKey ? 'YES' : 'NO'}\n`);

    if (geminiKeys.length > 0) {
        console.log('--- Testing Direct Google Gemini API Models ---');
        for (const model of GEMINI_MODELS) {
            const result = await testGeminiModel(geminiKeys[0], model);
            console.log(`Model: ${result.model.padEnd(25)} | Status: ${result.status.padEnd(22)} | HTTP: ${result.httpStatus} | Detail: ${result.detail}`);
        }
        console.log('\n');
    } else {
        console.log('[Notice] No direct GEMINI_API_KEY found in .env. Skipping direct Gemini API checks.\n');
    }

    if (openrouterKey) {
        console.log('--- Testing OpenRouter Fallback Models ---');
        for (const model of OPENROUTER_MODELS) {
            const result = await testOpenRouterModel(openrouterKey, model);
            console.log(`Model: ${result.model.padEnd(35)} | Status: ${result.status.padEnd(22)} | HTTP: ${result.httpStatus} | Detail: ${result.detail}`);
        }
        console.log('\n');
    } else {
        console.log('[Notice] No OPENROUTER_API_KEY found in .env.\n');
    }

    console.log('====================================================');
    console.log('   VERIFICATION COMPLETE');
    console.log('====================================================');
}

if (require.main === module) {
    runVerification();
}

module.exports = { testGeminiModel, testOpenRouterModel, runVerification };
