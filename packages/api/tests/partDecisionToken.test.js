'use strict';

const {
    generatePartDecisionToken,
    verifyPartDecisionToken,
} = require('../helpers/partDecisionToken');

describe('partDecisionToken helper', () => {
    const payload = {
        detail: 'Oil Filter',
        brand_id: 5,
        group_id: 10,
        part_numbers_string: 'OF-100, OF-101',
        barcodes: ['12345678', '87654321'],
    };

    test('generates and verifies a valid token', () => {
        const token = generatePartDecisionToken(42, payload);
        const result = verifyPartDecisionToken(token, 42, payload);
        expect(result).toEqual({ valid: true });
    });

    test('rejects candidate mismatch', () => {
        const token = generatePartDecisionToken(42, payload);
        const result = verifyPartDecisionToken(token, 99, payload);
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('candidate_mismatch');
    });

    test('rejects modified payload', () => {
        const token = generatePartDecisionToken(42, payload);
        const modifiedPayload = { ...payload, detail: 'Air Filter' };
        const result = verifyPartDecisionToken(token, 42, modifiedPayload);
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('payload_changed');
    });

    test('rejects expired token', () => {
        const token = generatePartDecisionToken(42, payload, { ttlMs: -1000 });
        const result = verifyPartDecisionToken(token, 42, payload);
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('expired');
    });

    test('rejects tampered token', () => {
        const token = generatePartDecisionToken(42, payload);
        const tampered = token.slice(0, -4) + 'abcd';
        const result = verifyPartDecisionToken(tampered, 42, payload);
        expect(result.valid).toBe(false);
    });
});
