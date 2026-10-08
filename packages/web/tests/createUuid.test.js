import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUuid } from '../src/utils/createUuid.js';

test('creates a valid version 4 UUID when randomUUID is unavailable', () => {
    const cryptoApi = {
        getRandomValues(bytes) {
            bytes.set([0, 17, 34, 51, 68, 85, 255, 119, 255, 153, 170, 187, 204, 221, 238, 255]);
            return bytes;
        },
    };

    assert.equal(createUuid(cryptoApi), '00112233-4455-4f77-bf99-aabbccddeeff');
});

test('uses the browser UUID implementation when available', () => {
    assert.equal(createUuid({ randomUUID: () => 'native-uuid' }), 'native-uuid');
});
