const http = require('node:http');
const { getDocumentPreview } = require('../services/paperlessService');

describe('Paperless receipt preview formats', () => {
    let server, preview, upstreamType, accept, originalUrl, originalToken;
    beforeAll(async () => {
        originalUrl = process.env.PAPERLESS_API_URL;
        originalToken = process.env.PAPERLESS_API_TOKEN;
        server = http.createServer((req, res) => {
            accept = req.headers.accept;
            res.setHeader('Content-Type', upstreamType);
            res.end(preview);
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        process.env.PAPERLESS_API_URL = `http://127.0.0.1:${server.address().port}/api`;
        process.env.PAPERLESS_API_TOKEN = 'local-preview-fixture';
    });
    afterAll(async () => {
        if (originalUrl === undefined) delete process.env.PAPERLESS_API_URL; else process.env.PAPERLESS_API_URL = originalUrl;
        if (originalToken === undefined) delete process.env.PAPERLESS_API_TOKEN; else process.env.PAPERLESS_API_TOKEN = originalToken;
        await new Promise(resolve => server.close(resolve));
    });
    test('returns PDFs as PDFs even when the upstream MIME label is incorrect', async () => {
        preview = Buffer.from('%PDF-1.7\nfixture');
        upstreamType = 'image/png';
        const result = await getDocumentPreview(1236);
        expect(result.contentType).toBe('application/pdf');
        expect(result.buffer).toEqual(preview);
        expect(accept).toBe('*/*');
    });
    test.each([
        ['image/png', [137,80,78,71,13,10,26,10]],
        ['image/jpeg', [255,216,255,224]],
        ['image/gif', Buffer.from('GIF89a')],
        ['image/webp', Buffer.from('RIFF1234WEBP')],
    ])('preserves %s preview format', async (expectedType, bytes) => {
        preview = Buffer.from(bytes);
        upstreamType = 'application/octet-stream';
        const result = await getDocumentPreview(1236);
        expect(result.contentType).toBe(expectedType);
        expect(result.buffer).toEqual(preview);
    });
    test('rejects HTML or invalid data instead of serving a broken image', async () => {
        preview = Buffer.from('<html>Sign in</html>');
        upstreamType = 'text/html';
        await expect(getDocumentPreview(1236)).rejects.toMatchObject({status:502});
    });
});
