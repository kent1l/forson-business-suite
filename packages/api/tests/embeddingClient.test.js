jest.mock('../services/ai/core/embeddingLoader', () => ({
    getPoolConfig: jest.fn()
}));
jest.mock('../services/ai/core/circuitBreaker', () => ({
    isCoolingDown: jest.fn().mockReturnValue(false),
    isDeprecated: jest.fn().mockReturnValue(false),
    triggerCooldown: jest.fn(),
    markDeprecated: jest.fn()
}));

const embeddingLoader = require('../services/ai/core/embeddingLoader');
const embeddingClient = require('../services/ai/core/embeddingClient');

const originalFetch = global.fetch;

describe('EmbeddingClient provider calls', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch = jest.fn();
        process.env.GEMINI_API_KEY = 'test-gemini-key';
        process.env.OPENROUTER_API_KEY = 'test-or-key';
    });

    afterAll(() => {
        global.fetch = originalFetch;
    });

    test('Gemini call requests outputDimensionality explicitly rather than relying on client-side slicing', async () => {
        embeddingLoader.getPoolConfig.mockReturnValue({
            dimensions: 768,
            fallback_chain: [{ provider: 'gemini', model: 'gemini-embedding-2', api_key_env: 'GEMINI_API_KEY', dimensions_override: 768 }]
        });
        global.fetch.mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify({ embedding: { values: new Array(768).fill(0.01) } })
        });

        const result = await embeddingClient.generateEmbeddingWithPool('test text');

        expect(result.dimensions).toBe(768);
        const [, options] = global.fetch.mock.calls[0];
        const sentBody = JSON.parse(options.body);
        expect(sentBody.outputDimensionality).toBe(768);
    });

    test('OpenRouter call omits `dimensions` for a candidate with no dimensions_override, instead of forcing the pool default', async () => {
        embeddingLoader.getPoolConfig.mockReturnValue({
            dimensions: 768,
            fallback_chain: [{ provider: 'openrouter', model: 'nvidia/nemotron-3-embed-1b:free', api_key_env: 'OPENROUTER_API_KEY' }]
        });
        global.fetch.mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify({ data: [{ embedding: new Array(2048).fill(0.01) }] })
        });

        await embeddingClient.generateEmbeddingWithPool('test text');

        const [, options] = global.fetch.mock.calls[0];
        const sentBody = JSON.parse(options.body);
        // Forcing `dimensions: 768` on a model whose native size is fixed at 2048
        // is exactly what made this candidate fail on every real call.
        expect(sentBody).not.toHaveProperty('dimensions');
    });

    test('OpenRouter call sends `dimensions` when a candidate explicitly declares dimensions_override', async () => {
        embeddingLoader.getPoolConfig.mockReturnValue({
            dimensions: 768,
            fallback_chain: [{ provider: 'openrouter', model: 'some/flexible-embed', api_key_env: 'OPENROUTER_API_KEY', dimensions_override: 768 }]
        });
        global.fetch.mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify({ data: [{ embedding: new Array(768).fill(0.01) }] })
        });

        await embeddingClient.generateEmbeddingWithPool('test text');

        const sentBody = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(sentBody.dimensions).toBe(768);
    });

    test('a vector longer than the target is truncated', async () => {
        embeddingLoader.getPoolConfig.mockReturnValue({
            dimensions: 768,
            fallback_chain: [{ provider: 'gemini', model: 'gemini-embedding-001', api_key_env: 'GEMINI_API_KEY' }]
        });
        global.fetch.mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify({ embedding: { values: new Array(3072).fill(0.01) } })
        });

        const result = await embeddingClient.generateEmbeddingWithPool('test text');
        expect(result.vector).toHaveLength(768);
    });

    test('a vector SHORTER than the target fails over to the next candidate instead of being zero-padded', async () => {
        embeddingLoader.getPoolConfig.mockReturnValue({
            dimensions: 768,
            fallback_chain: [
                { provider: 'gemini', model: 'broken-short-model', api_key_env: 'GEMINI_API_KEY' },
                { provider: 'gemini', model: 'gemini-embedding-001', api_key_env: 'GEMINI_API_KEY' }
            ]
        });
        global.fetch
            .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ embedding: { values: new Array(300).fill(0.01) } }) })
            .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ embedding: { values: new Array(768).fill(0.02) } }) });

        const result = await embeddingClient.generateEmbeddingWithPool('test text');

        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(result.model).toBe('gemini-embedding-001');
        expect(result.vector).toHaveLength(768);
        // No zero-filled tail from the short candidate should have leaked through.
        expect(result.vector.every(v => v === 0.02)).toBe(true);
    });

    test('all candidates failing surfaces every provider error, not just the last one', async () => {
        embeddingLoader.getPoolConfig.mockReturnValue({
            dimensions: 768,
            fallback_chain: [
                { provider: 'gemini', model: 'dead-model', api_key_env: 'GEMINI_API_KEY' },
                { provider: 'openrouter', model: 'also-dead', api_key_env: 'OPENROUTER_API_KEY' }
            ]
        });
        global.fetch
            .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'not found' })
            .mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'dimensions must be one of 2048' });

        await expect(embeddingClient.generateEmbeddingWithPool('test text')).rejects.toThrow(/dead-model.*also-dead|also-dead.*dead-model/s);
    });
});
