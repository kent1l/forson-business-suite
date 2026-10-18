'use strict';

const { syncReceiptRecordedTag } = require('../services/paperlessService');

describe('GRN recorded tag synchronization', () => {
    const originalFetch = global.fetch;
    const originalEnv = { ...process.env };
    let documents, tags, requests;
    const response = data => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => data });

    beforeEach(() => {
        process.env.PAPERLESS_API_URL = 'http://paperless.test/api';
        process.env.PAPERLESS_API_TOKEN = 'test-token';
        documents = [{ id: 42, title: 'DR_123', tags: [7] }];
        tags = [{ id: 9, name: 'recorded' }];
        requests = [];
        global.fetch = jest.fn(async (url, options) => {
            const parsed = new URL(url);
            requests.push({ path: parsed.pathname, options });
            if (parsed.pathname === '/api/documents/') return response({ results: documents });
            if (parsed.pathname === '/api/tags/' && options.method === 'GET') return response({ results: tags });
            if (parsed.pathname === '/api/tags/' && options.method === 'POST') return response({ id: 10, name: 'recorded' });
            return response({ success: true });
        });
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    const mutations = () => requests.filter(r => r.options.method === 'POST');

    test.each([true, false])('changes only the recorded tag (recorded=%s)', async recorded => {
        await syncReceiptRecordedTag('DR-123', recorded);
        expect(mutations()).toHaveLength(1);
        expect(mutations()[0].path).toBe('/api/documents/bulk_edit/');
        expect(JSON.parse(mutations()[0].options.body)).toEqual({
            documents: [42], method: 'modify_tags',
            parameters: recorded ? { add_tags: [9] } : { remove_tags: [9] },
        });
        expect(mutations()[0].options.headers['Content-Type']).toBe('application/json');
    });

    test('creates recorded when missing on post', async () => {
        tags = [];
        await syncReceiptRecordedTag('DR-123', true);
        expect(mutations()).toHaveLength(2);
        expect(JSON.parse(mutations()[0].options.body)).toEqual({ name: 'recorded' });
        expect(JSON.parse(mutations()[1].options.body).parameters).toEqual({ add_tags: [10] });
    });

    test('does not create a missing tag on void', async () => {
        tags = [];
        await syncReceiptRecordedTag('DR-123', false);
        expect(mutations()).toHaveLength(0);
    });

    test.each([
        [],
        [{ id: 42, title: 'DR-1234' }],
        [{ id: 42, title: 'SI-123' }],
        [{ id: 42, title: 'DR-123' }, { id: 43, title: 'DR_123' }],
    ].map(docs => ({ docs })))('skips missing, partial, wrong-prefix, or ambiguous matches: %j', async ({ docs }) => {
        documents = docs;
        await syncReceiptRecordedTag('DR-123', true);
        expect(mutations()).toHaveLength(0);
    });

    test.each(['', '-', 'N/A', null])('ignores placeholder receipt %s', async receipt => {
        await syncReceiptRecordedTag(receipt, true);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('skips unconfigured Paperless', async () => {
        delete process.env.PAPERLESS_API_TOKEN;
        await syncReceiptRecordedTag('DR-123', true);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('finds tags and documents beyond the first page', async () => {
        const firstFetch = global.fetch;
        global.fetch = jest.fn(async (url, options) => {
            const parsed = new URL(url);
            if (options.method === 'GET' && parsed.searchParams.get('page') === '1') {
                return response({ results: [], next: 'page2' });
            }
            return firstFetch(url, options);
        });
        await syncReceiptRecordedTag('DR-123', true);
        expect(mutations()).toHaveLength(1);
    });

    test('logs remote write failures without failing the committed GRN', async () => {
        const firstFetch = global.fetch;
        const log = jest.spyOn(console, 'error').mockImplementation(() => {});
        global.fetch = jest.fn((url, options) => {
            if (options.method === 'POST') throw new Error('Paperless offline');
            return firstFetch(url, options);
        });
        await expect(syncReceiptRecordedTag('DR-123', true)).resolves.toBeUndefined();
        expect(log).toHaveBeenCalledWith(expect.stringContaining('recorded tag'), 'Paperless offline');
    });
});
