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
        if (options.binaryWithContentType) {
            return { buffer: Buffer.from(await response.arrayBuffer()), contentType };
        }
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
            return exactMatch;
        }

        // Partial match of normalized hyphenated form
        const partialMatch = uniqueDocs.find(doc => doc.title && (
            doc.title.trim().includes(cleanReceiptNo) ||
            (normalizedReceiptNo && normalizeToHyphen(doc.title).includes(normalizedReceiptNo))
        ));
        if (partialMatch) {
            return partialMatch;
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

async function findGoodsReceiptDocuments(receiptNos, supplierName) {
    const references = [...new Set(receiptNos.filter(isValidReceiptQuery))];
    const supplierKey = normalizePartyName(supplierName);
    if (!references.length || !supplierKey || !isValidReceiptQuery(supplierName)) return [];
    const [correspondents, types] = await Promise.all([
        listAllPaperlessObjects('correspondents'),
        listAllPaperlessObjects('document_types'),
    ]);
    const matchingParties = correspondents.filter(c => normalizePartyName(c.name) === supplierKey);
    const matchingTypes = types.filter(t => normalizePartyName(t.name) === normalizePartyName('Goods Receipt'));
    if (matchingParties.length !== 1 || matchingTypes.length !== 1) return [];
    const correspondentId = matchingParties[0].id;
    const documentTypeId = matchingTypes[0].id;
    const wantedKeys = new Set(references.map(normalizeReceiptIdentifier));
    const matchesByKey = new Map();
    let page = 1;
    let data;
    // Scope once per bill, then resolve every reference against exact normalized
    // titles. Ambiguous titles never choose an arbitrary scan.
    do {
        data = await listDocuments({ correspondentId, documentTypeId, pageSize: 100, page: page++ });
        for (const doc of data.results || []) {
            const key = normalizeReceiptIdentifier(doc.title);
            if (doc.correspondent !== correspondentId || doc.document_type !== documentTypeId || !wantedKeys.has(key)) continue;
            const matches = matchesByKey.get(key) || new Map();
            matches.set(doc.id, doc);
            matchesByKey.set(key, matches);
        }
    } while (data.next);
    return references.flatMap(referenceNo => {
        const matches = matchesByKey.get(normalizeReceiptIdentifier(referenceNo));
        return matches?.size === 1 ? [{ referenceNo, document: matches.values().next().value }] : [];
    });
}

async function findGoodsReceiptDocument(receiptNo, supplierName) {
    const matches = await findGoodsReceiptDocuments([receiptNo], supplierName);
    return matches[0]?.document || null;
}

/** Best-effort post-commit synchronization: Paperless must not undo a posted GRN. */
async function syncReceiptRecordedTag(receiptNo, recorded, supplierId, queryClient) {
    if (!getPaperlessConfig().isConfigured || !isValidReceiptQuery(receiptNo) || !supplierId) return;
    try {
        if (!recorded) {
            const dbExecutor = queryClient || require('../db');
            const { rows: remaining } = await dbExecutor.query(
                `SELECT 1 FROM goods_receipt
                 WHERE supplier_id = $1
                   AND status = 'Active' AND workflow_status = 'Posted'
                   AND (
                     public.goods_receipt_match_key(physical_receipt_no) = public.goods_receipt_match_key($2)
                     OR lower(trim(both from supplier_invoice_no)) = lower(trim(both from $2))
                     OR supplier_bill_match_key(supplier_document_no) = supplier_bill_match_key($2)
                   )
                 LIMIT 1`,
                [supplierId, receiptNo],
            );
            if (remaining.length > 0) {
                return;
            }
        }

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
                parameters: {
                    add_tags: recorded ? [tag.id] : [],
                    remove_tags: recorded ? [] : [tag.id],
                },
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

// Paperless's preview endpoint can return an archived PDF as well as an image.
// Determine the actual format rather than relabelling arbitrary upstream bytes.
async function getDocumentPreview(documentId) {
    const { buffer } = await paperlessFetch(`/documents/${documentId}/preview/`, {
        binaryWithContentType: true,
        headers: { Accept: '*/*' },
    });
    let contentType;
    if (buffer.subarray(0, 5).toString() === '%PDF-') contentType = 'application/pdf';
    else if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) contentType = 'image/png';
    else if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) contentType = 'image/jpeg';
    else if (['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString())) contentType = 'image/gif';
    else if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') contentType = 'image/webp';
    if (!contentType) {
        const err = new Error('Paperless returned an unsupported receipt preview format.');
        err.status = 502;
        throw err;
    }
    return { buffer, contentType };
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
    getDocumentPreview,
    updateDocumentTags,
    paperlessFetch,
    normalizeToHyphen,
    isValidReceiptQuery,
    syncReceiptRecordedTag,
    findGoodsReceiptDocument,
    findGoodsReceiptDocuments,
    listAllPaperlessObjects,
};
