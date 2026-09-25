const JevClient = require('../services/jevClient');

describe('JevClient', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    test('stays disabled without both an endpoint and API key', async () => {
        const fetchImpl = jest.fn();
        const client = new JevClient({ env: {}, fetchImpl });

        expect(client.isConfigured()).toBe(false);
        await expect(client.evaluateDuplicate({ entityType: 'brand', left: { name: 'ACME' }, right: { name: 'Acme Parts' } })).resolves.toBeNull();
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    test('uses the documented OpenRouter Decisions endpoint and pinned Jev model by default', () => {
        const client = new JevClient({ env: { OPENROUTER_API_KEY: 'test-key' }, fetchImpl: jest.fn() });

        expect(client.config.apiUrl).toBe('https://openrouter.ai/api/alpha/decisions');
        expect(client.config.model).toBe('typesafe/jev-1.13');
        expect(client.isConfigured()).toBe(true);
    });

    test('sends a typed Noul decision and validates its probability', async () => {
        const fetchImpl = jest.fn().mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify({ model: 'jev-1.13.0', answers: { duplicate: { type: 'noul', noul: 0.91 } } }),
        });
        const client = new JevClient({ env: { OPENROUTER_DECISIONS_URL: 'https://openrouter.example.test/api/alpha/decisions', OPENROUTER_API_KEY: 'test-key' }, fetchImpl });

        await expect(client.evaluateDuplicate({ entityType: 'brand', left: { name: 'ACME', code: 'AC' }, right: { name: 'Acme Parts', code: 'ACP' } }))
            .resolves.toEqual({ probability: 0.91, model: 'jev-1.13.0' });

        const [url, request] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://openrouter.example.test/api/alpha/decisions');
        expect(request.headers.Authorization).toBe('Bearer test-key');
        const body = JSON.parse(request.body);
        expect(body.questions.duplicate.type).toBe('noul');
        expect(body.state.left).toEqual({ name: 'ACME', code: 'AC' });
    });

    test('rejects malformed provider answers instead of guessing a merge decision', async () => {
        const client = new JevClient({
            env: { OPENROUTER_API_KEY: 'test-key' },
            fetchImpl: jest.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ answers: { duplicate: { noul: 1.5 } } }) }),
        });

        await expect(client.evaluateDuplicate({ entityType: 'brand', left: { name: 'A' }, right: { name: 'B' } }))
            .rejects.toThrow('invalid Noul probability');
    });
});
