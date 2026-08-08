'use strict';

const paperlessService = require('../services/paperlessService');
const paperlessConfig = require('../config/paperlessConfig');

describe('PaperlessService Unit Tests', () => {
    const originalEnv = { ...process.env };
    const originalFetch = global.fetch;

    beforeEach(() => {
        process.env = { ...originalEnv };
        process.env.PAPERLESS_API_URL = 'http://localhost:8000/api';
        process.env.PAPERLESS_API_TOKEN = 'test-token';
    });

    afterAll(() => {
        process.env = originalEnv;
        global.fetch = originalFetch;
    });

    describe('Config Loader', () => {
        it('should correctly parse environment configuration', () => {
            process.env.PAPERLESS_API_URL = 'https://paperless.test.com/api/';
            process.env.PAPERLESS_API_TOKEN = 'secret-token-123';
            process.env.PAPERLESS_TIMEOUT_SECONDS = '15';
            process.env.PAPERLESS_VERIFY_SSL = 'false';

            const config = paperlessConfig.getPaperlessConfig();
            expect(config.apiUrl).toBe('https://paperless.test.com/api');
            expect(config.apiToken).toBe('secret-token-123');
            expect(config.timeoutMs).toBe(15000);
            expect(config.verifySsl).toBe(false);
            expect(config.isConfigured).toBe(true);
        });

        it('should report unconfigured status if env vars missing', async () => {
            delete process.env.PAPERLESS_API_URL;
            delete process.env.PAPERLESS_API_TOKEN;

            const health = await paperlessService.testConnection();
            expect(health.status).toBe('unconfigured');
            expect(health.healthy).toBe(false);
        });
    });

    describe('Full-Prefix Title Matching', () => {
        it('should match physical receipt numbers keeping prefixes (CI-, DR-, SI-, VAT-) intact and supporting CI_xxxx format', async () => {
            const mockDocs = [
                { id: 101, title: 'CI_1011', created: '2026-08-01' },
                { id: 102, title: 'DR_1011', created: '2026-08-02' },
                { id: 103, title: 'SI_2002', created: '2026-08-03' },
                { id: 104, title: 'VAT_421', created: '2026-08-04' },
            ];

            global.fetch = jest.fn().mockImplementation(async (url) => {
                const urlStr = String(url);
                let matched = mockDocs;
                if (urlStr.includes('title__icontains=')) {
                    const paramVal = decodeURIComponent(urlStr.split('title__icontains=')[1].split('&')[0]).toLowerCase();
                    const cleanParam = paramVal.replace(/[-_ ]/g, '');
                    matched = mockDocs.filter(d => d.title.toLowerCase().replace(/[-_ ]/g, '').includes(cleanParam));
                }
                return {
                    ok: true,
                    headers: { get: () => 'application/json' },
                    json: async () => ({ count: matched.length, results: matched }),
                };
            });

            // 1. Searching for CI-1011 matches Paperless title CI_1011
            const docCIHyphen = await paperlessService.findDocumentByReceiptNo('CI-1011');
            expect(docCIHyphen).toBeDefined();
            expect(docCIHyphen.id).toBe(101);
            expect(docCIHyphen.title).toBe('CI_1011');

            // 2. Searching for CI_1011 matches Paperless title CI_1011
            const docCIUnderscore = await paperlessService.findDocumentByReceiptNo('CI_1011');
            expect(docCIUnderscore).toBeDefined();
            expect(docCIUnderscore.id).toBe(101);

            // 3. DR-1011 match (should NOT clash with CI-1011)
            const docDR = await paperlessService.findDocumentByReceiptNo('DR-1011');
            expect(docDR).toBeDefined();
            expect(docDR.id).toBe(102);
            expect(docDR.title).toBe('DR_1011');

            // 4. VAT-421 match
            const docVAT = await paperlessService.findDocumentByReceiptNo('VAT-421');
            expect(docVAT).toBeDefined();
            expect(docVAT.id).toBe(104);
            expect(docVAT.title).toBe('VAT_421');
        });
    });
});
