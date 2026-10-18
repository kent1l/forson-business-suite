'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
const db = require('../db');
const { syncReceiptRecordedTag } = require('../services/paperlessService');

describe('GRN recorded tag synchronization', () => {
    const originalFetch = global.fetch;
    const originalEnv = { ...process.env };
    let documents, tags, requests, correspondents, types;
    const response = data => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => data });

    beforeEach(() => {
        process.env.PAPERLESS_API_URL = 'http://paperless.test/api';
        process.env.PAPERLESS_API_TOKEN = 'test-token';
        documents = [{ id: 42, title: 'DR_123', tags: [7], correspondent: 3, document_type: 1 }];
        correspondents = [{ id: 3, name: 'Supplier, Inc.' }];
        types = [{ id: 1, name: 'Goods Receipt' }];
        db.query.mockResolvedValue({ rows: [{ supplier_name: 'SUPPLIER INC.' }] });
        tags = [{ id: 9, name: 'recorded' }];
        requests = [];
        global.fetch = jest.fn(async (url, options) => {
            const parsed = new URL(url);
            requests.push({ path: parsed.pathname, options });
            if (parsed.pathname === '/api/correspondents/') return response({ results: correspondents });
            if (parsed.pathname === '/api/document_types/') return response({ results: types });
            if (parsed.pathname === '/api/documents/') return response({ results: documents });
            if (parsed.pathname === '/api/tags/' && options.method === 'GET') return response({ results: tags });
            if (parsed.pathname === '/api/tags/' && options.method === 'POST') return response({ id: 10, name: 'recorded' });
            if (parsed.pathname === '/api/documents/bulk_edit/') {
                const { parameters } = JSON.parse(options.body);
                // The deployed Paperless API requires both arrays for modify_tags.
                if (!Array.isArray(parameters.add_tags) || !Array.isArray(parameters.remove_tags)) {
                    return { ok: false, status: 400, statusText: 'Bad Request',
                        text: async () => 'add_tags and remove_tags must both be specified' };
                }
            }
            return response({ success: true });
        });
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    const mutations = () => requests.filter(r => r.options.method === 'POST');

    test('reuses the route client for the supplier lookup', async () => {
        const client = { query: jest.fn().mockResolvedValue({ rows: [{ supplier_name: 'Supplier Inc.' }] }) };
        await syncReceiptRecordedTag('DR-123', true, 7, client);
        expect(client.query).toHaveBeenCalledWith(expect.stringContaining('supplier_id = $1'), [7]);
        expect(mutations()).toHaveLength(1);
    });

    test('does not tag when the supplier is missing', async () => {
        db.query.mockResolvedValue({ rows: [] });
        await syncReceiptRecordedTag('DR-123', true, 7);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('a failed supplier lookup does not fail the GRN', async () => {
        const log = jest.spyOn(console, 'error').mockImplementation(() => {});
        db.query.mockRejectedValue(new Error('Lookup unavailable'));
        await expect(syncReceiptRecordedTag('DR-123', true, 7)).resolves.toBeUndefined();
        expect(global.fetch).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalled();
    });

    test.each(['dr / 000123', ' DR_123 ', 'dr123', 'ＤＲ－０００１２３'])('normalizes both title and supplier receipt: %s', async title => {
        documents[0].title = title;
        await syncReceiptRecordedTag('DR-123', true, 7);
        expect(mutations()).toHaveLength(1);
    });

    test.each(['supplier', 'correspondent', 'type', 'missing-correspondent', 'duplicate-correspondent', 'duplicate-type'])('skips mismatching or ambiguous %s', async field => {
        if (field === 'supplier') db.query.mockResolvedValue({ rows: [{ supplier_name: 'Another Supplier Inc.' }] });
        if (field === 'correspondent') documents[0].correspondent = 99;
        if (field === 'type') documents[0].document_type = 99;
        if (field === 'missing-correspondent') correspondents = [];
        if (field === 'duplicate-correspondent') correspondents.push({ id: 4, name: 'Supplier Inc' });
        if (field === 'duplicate-type') types.push({ id: 2, name: 'GOODS-RECEIPT' });
        await syncReceiptRecordedTag('DR-123', true, 7);
        expect(mutations()).toHaveLength(0);
    });

    test('selects the right supplier and document type when receipt numbers overlap', async () => {
        documents.push({ ...documents[0], id: 43, correspondent: 99 }, { ...documents[0], id: 44, document_type: 2 });
        await syncReceiptRecordedTag('DR-123', true, 7);
        expect(JSON.parse(mutations()[0].options.body).documents).toEqual([42]);
        const query = new URL(global.fetch.mock.calls.find(([url]) => new URL(url).pathname === '/api/documents/')[0]).searchParams;
        expect(query.get('correspondent__id')).toBe('3');
        expect(query.get('document_type__id')).toBe('1');
    });

    test.each([true, false])('changes only the recorded tag (recorded=%s)', async recorded => {
        await syncReceiptRecordedTag('DR-123', recorded, 7);
        expect(mutations()).toHaveLength(1);
        expect(mutations()[0].path).toBe('/api/documents/bulk_edit/');
        expect(JSON.parse(mutations()[0].options.body)).toEqual({
            documents: [42], method: 'modify_tags',
            parameters: { add_tags: recorded ? [9] : [], remove_tags: recorded ? [] : [9] },
        });
        expect(mutations()[0].options.headers['Content-Type']).toBe('application/json');
    });

    test('creates recorded when missing on post', async () => {
        tags = [];
        await syncReceiptRecordedTag('DR-123', true, 7);
        expect(mutations()).toHaveLength(2);
        expect(JSON.parse(mutations()[0].options.body)).toEqual({ name: 'recorded' });
        expect(JSON.parse(mutations()[1].options.body).parameters).toEqual({ add_tags: [10], remove_tags: [] });
    });

    test('does not create a missing tag on void', async () => {
        tags = [];
        await syncReceiptRecordedTag('DR-123', false, 7);
        expect(mutations()).toHaveLength(0);
    });

    test.each([
        [],
        [{ id: 42, title: 'DR-1234' }],
        [{ id: 42, title: 'SI-123' }],
        [{ id: 42, title: 'DR-123' }, { id: 43, title: 'DR_123' }],
    ].map(docs => ({ docs })))('skips missing, partial, wrong-prefix, or ambiguous matches: %j', async ({ docs }) => {
        documents = docs.map(doc => ({ correspondent: 3, document_type: 1, ...doc }));
        await syncReceiptRecordedTag('DR-123', true, 7);
        expect(mutations()).toHaveLength(0);
    });

    test.each(['', '-', 'N/A', null])('ignores placeholder receipt %s', async receipt => {
        await syncReceiptRecordedTag(receipt, true, 7);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('skips unconfigured Paperless', async () => {
        delete process.env.PAPERLESS_API_TOKEN;
        await syncReceiptRecordedTag('DR-123', true, 7);
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
        await syncReceiptRecordedTag('DR-123', true, 7);
        expect(mutations()).toHaveLength(1);
    });

    test('logs remote write failures without failing the committed GRN', async () => {
        const firstFetch = global.fetch;
        const log = jest.spyOn(console, 'error').mockImplementation(() => {});
        global.fetch = jest.fn((url, options) => {
            if (options.method === 'POST') throw new Error('Paperless offline');
            return firstFetch(url, options);
        });
        await expect(syncReceiptRecordedTag('DR-123', true, 7)).resolves.toBeUndefined();
        expect(log).toHaveBeenCalledWith(expect.stringContaining('recorded tag'), 'Paperless offline');
    });
});
