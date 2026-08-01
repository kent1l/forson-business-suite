/**
 * Centralized AI model configuration registry.
 * Maps models and tiers to environment keys and defines fallback chains.
 */
module.exports = {
    providers: {
        google: {
            apiKeyEnv: 'GEMINI_API_KEY',
            keyPoolEnv: 'GEMINI_API_KEY_POOL',
            defaultModel: 'gemini-3.5-flash-lite',
            tiers: {
                ROUTINE: [
                    'gemini-3.5-flash-lite',
                    'gemini-3.1-flash-lite'
                    // gemini-2.5-flash-lite is excluded due to extremely low RPD limits (20 RPD)
                ],
                REASONING: [
                    'gemini-3.6-flash',
                    'gemini-3.5-flash',
                    'gemini-3-flash',
                    'gemini-2.5-flash'
                    // gemini-2.5-pro and gemini-3.1-pro are excluded because their limits are 0/0/0
                ],
                MICRO: [
                    'gemma-4-31b',
                    'gemma-4-26b',
                    'gemma-4-31b-it',
                    'gemma-4-26b-it'
                ]
            }
        },
        openrouter: {
            apiKeyEnv: 'OPENROUTER_API_KEY',
            defaultModel: 'openrouter/free',
            fallbackChain: [
                'google/gemini-3.5-flash',
                'google/gemini-2.5-flash',
                'openrouter/free',
                'meta-llama/llama-3.3-70b-instruct',
                'deepseek/deepseek-chat',
                'qwen/qwen-2.5-coder-32b-instruct'
            ]
        },
        openai: {
            apiKeyEnv: 'OPENAI_API_KEY',
            defaultModel: 'gpt-4o-mini'
        }
    }
};
