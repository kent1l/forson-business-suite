'use strict';

const crypto = require('crypto');

const getSecret = () => process.env.JWT_SECRET || process.env.SESSION_SECRET || 'forson-part-decision-secret-salt';

const normalizeText = (v) => String(v || '').trim().replace(/\s+/g, ' ');

const normalizePayloadForFingerprint = (payload) => {
    const detail = normalizeText(payload?.detail).toUpperCase();
    const brandId = payload?.brand_id ? String(payload.brand_id) : '';
    const groupId = payload?.group_id ? String(payload.group_id) : '';
    const partNumbers = normalizeText(payload?.part_numbers_string || payload?.part_numbers).toUpperCase();
    let barcodes = [];
    if (Array.isArray(payload?.barcodes)) {
        barcodes = payload.barcodes.map(b => normalizeText(b)).filter(Boolean).sort();
    } else if (typeof payload?.barcodes === 'string') {
        barcodes = payload.barcodes.split(',').map(b => normalizeText(b)).filter(Boolean).sort();
    }
    return JSON.stringify({ detail, brandId, groupId, partNumbers, barcodes });
};

const hashPayload = (payload) => {
    return crypto.createHash('sha256').update(normalizePayloadForFingerprint(payload)).digest('hex');
};

const generatePartDecisionToken = (candidateId, payload, { ttlMs = 15 * 60 * 1000, secret = getSecret() } = {}) => {
    const candidateStr = String(candidateId);
    const payloadHash = hashPayload(payload);
    const expiresAt = Date.now() + ttlMs;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(`${candidateStr}:${payloadHash}:${expiresAt}`);
    const sig = hmac.digest('hex');

    const tokenObj = {
        candidate_id: candidateStr,
        payload_hash: payloadHash,
        expires_at: expiresAt,
        sig,
    };
    return Buffer.from(JSON.stringify(tokenObj), 'utf8').toString('base64url');
};

const verifyPartDecisionToken = (token, candidateId, payload, { secret = getSecret() } = {}) => {
    if (!token || typeof token !== 'string') {
        return { valid: false, reason: 'missing_token' };
    }
    let data;
    try {
        data = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    } catch {
        return { valid: false, reason: 'malformed_token' };
    }

    if (!data.candidate_id || !data.payload_hash || !data.expires_at || !data.sig) {
        return { valid: false, reason: 'incomplete_token' };
    }

    if (Date.now() > Number(data.expires_at)) {
        return { valid: false, reason: 'expired' };
    }

    if (String(data.candidate_id) !== String(candidateId)) {
        return { valid: false, reason: 'candidate_mismatch' };
    }

    const expectedHash = hashPayload(payload);
    if (data.payload_hash !== expectedHash) {
        return { valid: false, reason: 'payload_changed' };
    }

    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(`${String(data.candidate_id)}:${data.payload_hash}:${data.expires_at}`);
    const expectedSig = hmac.digest('hex');

    if (data.sig !== expectedSig) {
        return { valid: false, reason: 'invalid_signature' };
    }

    return { valid: true };
};

module.exports = {
    normalizePayloadForFingerprint,
    generatePartDecisionToken,
    verifyPartDecisionToken,
};
