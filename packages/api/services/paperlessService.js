'use strict';

const https = require('https');
const http = require('http');
const { getPaperlessConfig } = require('../config/paperlessConfig');

/**
 * Helper to make HTTP/HTTPS requests to Paperless-ngx REST API with timeout, SSL verification toggle, and Bearer/Token auth.
 */
async function paperlessFetch(endpointPath, options = {}) {
    const config = getPaperlessConfig();
    if (!config.apiUrl) {
        throw new Error('PAPERLESS_API_URL is not configured in environment variables');
    }
    if (!config.apiToken) {
        throw new Error('PAPERLESS_API_TOKEN is not configured in environment variables');
    }

    const fullUrl = `${config.apiUrl}${endpointPath.startsWith('/') ? '' : '/'}${endpointPath}`;
    const urlObj = new URL(fullUrl);
    const isHttps = urlObj.protocol === 'https:';

    const headers = {
        'Authorization': `Token ${config.apiToken}`,
        'Accept': 'application/json',
        ...(options.headers || {}),
    };

    const agent = isHttps
        ? new https.Agent({ rejectUnauthorized: config.verifySsl })
        : new http.Agent();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
        const response = await fetch(fullUrl, {
            method: options.method || 'GET',
            headers,
            body: options.body ? JSON.stringify(options.body) : undefined,
            signal: controller.signal,
            agent,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            const error = new Error(`Paperless API HTTP ${response.status}: ${response.statusText} (${errText})`);
            error.status = response.status;
            throw error;
        }

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            return await response.json();
        } else {
            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);
        }
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            const timeoutErr = new Error(`Paperless API request timed out after ${config.timeoutMs / 1000}s`);
            timeoutErr.status = 408;
            throw timeoutErr;
        }
        throw err;
    }
}

/**
 * Connection Health Check
 */
async function testConnection() {
    const startTime = Date.now();
    const config = getPaperlessConfig();

    if (!config.isConfigured) {
        return {
            status: 'unconfigured',
            healthy: false,
            message: 'PAPERLESS_API_URL or PAPERLESS_API_TOKEN missing in environment',
            latencyMs: 0,
        };
    }

    try {
        const data = await paperlessFetch('/tags/?page_size=1');
        const latencyMs = Date.now() - startTime;
        return {
            status: 'ok',
            healthy: true,
            message: 'Successfully connected to Paperless-ngx API',
            latencyMs,
            totalTags: data?.count || 0,
        };
    } catch (err) {
        return {
            status: 'error',
            healthy: false,
            message: err.message,
            latencyMs: Date.now() - startTime,
        };
    }
}

/**
 * Query documents from Paperless-ngx
 */
async function listDocuments(params = {}) {
    const searchParams = new URLSearchParams();

    if (params.tag) searchParams.set('tags__name__all', params.tag);
    if (params.query) searchParams.set('query', params.query);
    if (params.title) searchParams.set('title__icontains', params.title);
    if (params.page) searchParams.set('page', String(params.page));
    if (params.pageSize || params.page_size) searchParams.set('page_size', String(params.pageSize || params.page_size || 25));
    if (params.ordering) searchParams.set('ordering', params.ordering);

    const queryString = searchParams.toString();
    const path = `/documents/${queryString ? `?${queryString}` : ''}`;
    return await paperlessFetch(path);
}

/**
 * Fetch available tags from Paperless-ngx
 */
async function listTags() {
    return await paperlessFetch('/tags/?page_size=100');
}

/**
 * Match a physical receipt number against Paperless document titles.
 * Supports format variations like CI_xxxx, CI-xxxx, CI xxxx while preserving full prefixes.
 */
async function findDocumentByReceiptNo(receiptNo) {
    if (!receiptNo || typeof receiptNo !== 'string') return null;
    const cleanReceiptNo = receiptNo.trim();
    if (!cleanReceiptNo) return null;

    // Generate prefix/delimiter variants (e.g. CI_1011, CI-1011, CI 1011)
    const underscoreVariant = cleanReceiptNo.replace(/[- ]/g, '_');
    const hyphenVariant = cleanReceiptNo.replace(/[_ ]/g, '-');
    const searchVariants = Array.from(new Set([cleanReceiptNo, underscoreVariant, hyphenVariant]));

    const normalize = (str) => (str || '').toLowerCase().replace(/[-_ ]/g, '');
    const cleanNormalized = normalize(cleanReceiptNo);

    try {
        // Query Paperless REST API trying the primary variants
        let results = [];
        for (const variant of searchVariants) {
            const result = await listDocuments({ title: variant, pageSize: 10 });
            if (result?.results?.length) {
                results = results.concat(result.results);
            }
        }

        // Deduplicate results by ID
        const uniqueDocs = Array.from(new Map(results.map(d => [d.id, d])).values());

        // 1. Exact normalized match preserving full prefix (e.g. CI_1011 matches CI-1011)
        const exactMatch = uniqueDocs.find(doc => doc.title && normalize(doc.title) === cleanNormalized);
        if (exactMatch) return exactMatch;

        // 2. Partial normalized match
        const partialMatch = uniqueDocs.find(doc => doc.title && normalize(doc.title).includes(cleanNormalized));
        return partialMatch || null;
    } catch (err) {
        console.error(`[PaperlessService] Error searching document for receiptNo "${cleanReceiptNo}":`, err.message);
        return null;
    }
}


/**
 * Batch lookup matching Paperless documents for a list of physical receipt numbers
 */
async function findDocumentsByReceiptNumbers(receiptNoList = []) {
    const matchMap = {};
    const uniqueReceipts = Array.from(new Set(receiptNoList.filter(r => r && typeof r === 'string' && r.trim())));

    for (const receiptNo of uniqueReceipts) {
        const matchedDoc = await findDocumentByReceiptNo(receiptNo);
        if (matchedDoc) {
            const cleanKey = receiptNo.trim();
            const underscoreKey = cleanKey.replace(/[- ]/g, '_');
            const hyphenKey = cleanKey.replace(/[_ ]/g, '-');
            matchMap[cleanKey] = matchedDoc;
            matchMap[underscoreKey] = matchedDoc;
            matchMap[hyphenKey] = matchedDoc;
        }
    }

    return matchMap;
}

/**
 * Fetch thumbnail or preview image binary for a document
 */
async function downloadDocumentArtifact(documentId, artifactType = 'thumb') {
    const path = `/documents/${documentId}/${artifactType}/`;
    return await paperlessFetch(path);
}


/**
 * Update document tags (add/remove tags by tag IDs)
 */
async function updateDocumentTags(documentId, { addTags = [], removeTags = [] }) {
    // 1. Fetch current document to get existing tag IDs
    const currentDoc = await paperlessFetch(`/documents/${documentId}/`);
    const currentTags = new Set(currentDoc.tags || []);

    addTags.forEach(t => currentTags.add(t));
    removeTags.forEach(t => currentTags.delete(t));

    const updatedTags = Array.from(currentTags);
    return await paperlessFetch(`/documents/${documentId}/`, {
        method: 'PATCH',
        body: { tags: updatedTags },
    });
}

module.exports = {
    testConnection,
    listDocuments,
    listTags,
    findDocumentByReceiptNo,
    findDocumentsByReceiptNumbers,
    downloadDocumentArtifact,
    updateDocumentTags,
    paperlessFetch,
};
