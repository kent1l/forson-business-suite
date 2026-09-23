const deepseekAdapter = require('../services/ai/adapters/deepseekAdapter');

describe('DeepSeekAdapter', () => {
    const originalFetch = global.fetch;
    const originalKey = process.env.DEEPSEEK_API_KEY;

    beforeEach(() => {
        process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    afterAll(() => {
        if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
        else process.env.DEEPSEEK_API_KEY = originalKey;
    });

    test('uses non-thinking JSON mode with the configured output cap', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify({
                choices: [{ message: { content: '{"ok":true}' } }],
                usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }
            })
        });

        const result = await deepseekAdapter.generateContent({
            model: 'deepseek-flash',
            prompt: 'Return JSON',
            temperature: 0,
            max_tokens: 256,
            reasoning_effort: 'none'
        });

        const request = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(request).toMatchObject({
            model: 'deepseek-flash',
            response_format: { type: 'json_object' },
            thinking: { type: 'disabled' },
            temperature: 0,
            max_tokens: 256
        });
        expect(result).toMatchObject({ providerUsed: 'deepseek', modelUsed: 'deepseek-flash', data: { ok: true } });
    });
});
