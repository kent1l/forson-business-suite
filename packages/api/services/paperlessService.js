'use strict';

const https = require('https');
const http = require('http');
const { getPaperlessConfig } = require('../config/paperlessConfig');
const { normalizePartyName, normalizeReceiptIdentifier } = require('../helpers/paperlessMatching');

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
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
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
    if (params.correspondentId) searchParams.set('correspondent__id', String(params.correspondentId));
    if (params.documentTypeId) searchParams.set('document_type__id', String(params.documentTypeId));

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
 * Validates that a receipt search string is a legitimate alphanumeric identifier
 * and not a placeholder character like '-', '—', 'N/A', or 'NONE'.
 */
function isValidReceiptQuery(str) {
    if (!str || typeof str !== 'string') return false;
    const clean = str.trim();
    if (!clean || clean === '-' || clean === '—' || /^n\/?a$/i.test(clean) || /^none$/i.test(clean)) {
        return false;
    }
    return /[a-zA-Z0-9]/.test(clean);
}

// Known receipt prefixes that use separator normalization (underscore/space → hyphen)
const KNOWN_RECEIPT_PREFIXES = new Set(['CI', 'DR', 'SI', 'VAT', 'OR', 'DM', 'INV', 'PMT']);

/**
 * Normalizes prefix format (e.g. CI_xxxx, DR xxxx) to hyphenated form (e.g. CI-xxxx).
 * Only converts known prefixes; unknown prefixes are returned unchanged.
 */
function normalizeToHyphen(str) {
    if (!isValidReceiptQuery(str)) return '';
    const trimmed = str.trim();
    return trimmed.replace(/^([A-Za-z]+)[-_ ]+(.+)$/, (match, prefix, num) => {
        if (KNOWN_RECEIPT_PREFIXES.has(prefix.toUpperCase())) {
            return `${prefix.toUpperCase()}-${num.trim()}`;
        }
        return match; // Unknown prefix: return unchanged
    });
}

/**
 * Match a physical receipt number against Paperless document titles.
 * Supports format variations like CI_xxxx, CI-xxxx, CI xxxx while preserving full prefixes.
 */
async function findDocumentByReceiptNo(receiptNo, { exactOnly = false } = {}) {
    if (!isValidReceiptQuery(receiptNo)) return null;
    const cleanReceiptNo = receiptNo.trim();

    const normalizedReceiptNo = normalizeToHyphen(cleanReceiptNo);
    const underscoreVariant = normalizedReceiptNo ? normalizedReceiptNo.replace(/-/g, '_') : '';
    const spaceVariant = normalizedReceiptNo ? normalizedReceiptNo.replace(/-/g, ' ') : '';
    const searchVariants = Array.from(new Set([cleanReceiptNo, normalizedReceiptNo, underscoreVariant, spaceVariant].filter(Boolean)));

    try {
        // Query Paperless REST API trying the primary variants
        let results = [];
        for (const variant of searchVariants) {
            let page = 1;
            let result;
            do {
                result = await listDocuments({ title: variant, pageSize: exactOnly ? 100 : 10, page });
                results = results.concat(result?.results || []);
                page += 1;
            } while (exactOnly && result?.next);
        }

        // Deduplicate results by ID
        const uniqueDocs = Array.from(new Map(results.map(d => [d.id, d])).values());

        // Exact match of clean or normalized hyphenated form
        const exactMatches = uniqueDocs.filter(doc => doc.title && (
            doc.title.trim() === cleanReceiptNo ||
            (normalizedReceiptNo && normalizeToHyphen(doc.title) === normalizedReceiptNo)
        ));
        // Tag mutations must never choose an arbitrary document or a partial match.
        if (exactOnly && exactMatches.length !== 1) return null;
        const exactMatch = exactMatches[0];
        if (exactMatch) {
            return {
                ...exactMatch,
                title: normalizeToHyphen(exactMatch.title) || exactMatch.title,
            };
        }

        // Partial match of normalized hyphenated form
        const partialMatch = uniqueDocs.find(doc => doc.title && (
            doc.title.trim().includes(cleanReceiptNo) ||
            (normalizedReceiptNo && normalizeToHyphen(doc.title).includes(normalizedReceiptNo))
        ));
        if (partialMatch) {
            return {
                ...partialMatch,
                title: normalizeToHyphen(partialMatch.title) || partialMatch.title,
            };
        }

        return null;
    } catch (err) {
        console.error(`[PaperlessService] Error searching document for receiptNo "${cleanReceiptNo}":`, err.message);
        return null;
    }
}

async function listAllPaperlessObjects(resource) {
    const results = [];
    let page = 1;
    let data;
    do {
        data = await paperlessFetch(`/${resource}/?page_size=100&page=${page++}`);
        results.push(...(data.results || []));
    } while (data.next);
    return results;
}

async function findGoodsReceiptDocument(receiptNo, supplierName) {
    const receiptKey = normalizeReceiptIdentifier(receiptNo);
    const supplierKey = normalizePartyName(supplierName);
    if (!receiptKey || !supplierKey || !isValidReceiptQuery(supplierName)) return null;
    const [correspondents, types] = await Promise.all([
        listAllPaperlessObjects('correspondents'),
        listAllPaperlessObjects('document_types'),
    ]);
    const matchingParties = correspondents.filter(c => normalizePartyName(c.name) === supplierKey);
    const matchingTypes = types.filter(t => normalizePartyName(t.name) === normalizePartyName('Goods Receipt'));
    if (matchingParties.length !== 1 || matchingTypes.length !== 1) return null;
    const correspondentId = matchingParties[0].id;
    const documentTypeId = matchingTypes[0].id;
    const matches = new Map();
    let page = 1;
    let data;
    // Fetch scoped metadata rather than filtering raw title text: leading zeros and
    // punctuation can differ before normalization. Check IDs again defensively.
    do {
        data = await listDocuments({ correspondentId, documentTypeId, pageSize: 100, page: page++ });
        for (const doc of data.results || []) {
            if (doc.correspondent === correspondentId && doc.document_type === documentTypeId &&
                normalizeReceiptIdentifier(doc.title) === receiptKey) matches.set(doc.id, doc);
        }
    } while (data.next);
    return matches.size === 1 ? matches.values().next().value : null;
}

/** Best-effort post-commit synchronization: Paperless must not undo a posted GRN. */
async function syncReceiptRecordedTag(receiptNo, recorded, supplierId, queryClient) {
    if (!getPaperlessConfig().isConfigured || !isValidReceiptQuery(receiptNo) || !supplierId) return;
    try {
        const { rows: [supplier] } = await (queryClient || require('../db')).query(
            'SELECT supplier_name FROM supplier WHERE supplier_id = $1', [supplierId],
        );
        if (!supplier) return;
        const document = await findGoodsReceiptDocument(receiptNo, supplier.supplier_name);
        if (!document) return;

        const findRecordedTag = async () => {
            let page = 1;
            let data;
            do {
                data = await paperlessFetch(`/tags/?page_size=100&page=${page}`);
                const tag = data.results?.find(t => t.name?.trim().toLowerCase() === 'recorded');
                if (tag) return tag;
                page += 1;
            } while (data.next);
            return null;
        };
        let tag = await findRecordedTag();
        if (!tag && recorded) {
            try {
                tag = await paperlessFetch('/tags/', { method: 'POST', body: { name: 'recorded' } });
            } catch (err) {
                // Another receipt may have created the tag concurrently.
                tag = await findRecordedTag();
                if (!tag) throw err;
            }
        }
        if (!tag) return;

        // Modify only this tag, preserving concurrent changes to other document tags.
        await paperlessFetch('/documents/bulk_edit/', {
            method: 'POST',
            body: {
                documents: [document.id],
                method: 'modify_tags',
                parameters: recorded ? { add_tags: [tag.id] } : { remove_tags: [tag.id] },
            },
        });
    } catch (err) {
        console.error(`[PaperlessService] Failed to ${recorded ? 'add' : 'remove'} recorded tag for receipt "${receiptNo}":`, err.message);
    }
}


/**
 * Batch lookup matching Paperless documents for a list of physical receipt numbers
 */
async function findDocumentsByReceiptNumbers(receiptNoList = []) {
    const matchMap = {};
    const uniqueReceipts = Array.from(new Set(receiptNoList.filter(isValidReceiptQuery)));

    for (const receiptNo of uniqueReceipts) {
        const matchedDoc = await findDocumentByReceiptNo(receiptNo);
        if (matchedDoc) {
            const rawKey = receiptNo.trim();
            const normalizedKey = normalizeToHyphen(receiptNo);
            matchMap[rawKey] = matchedDoc;
            if (normalizedKey) {
                matchMap[normalizedKey] = matchedDoc;
            }
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
    normalizeToHyphen,
    isValidReceiptQuery,
    syncReceiptRecordedTag,
    findGoodsReceiptDocument,
    listAllPaperlessObjects,
};
