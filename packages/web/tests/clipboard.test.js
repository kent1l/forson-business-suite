import test from 'node:test';
import assert from 'node:assert/strict';
import { copyToClipboard } from '../src/utils/clipboard.js';

test('copyToClipboard - returns false for empty, null, or undefined input', async () => {
    assert.equal(await copyToClipboard(''), false);
    assert.equal(await copyToClipboard(null), false);
    assert.equal(await copyToClipboard(undefined), false);
});

test('copyToClipboard - uses navigator.clipboard.writeText when available', async () => {
    let copiedText = null;
    const originalClipboard = globalThis.navigator?.clipboard;
    Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: {
            writeText: async (text) => {
                copiedText = text;
            },
        },
        configurable: true,
        writable: true,
    });

    try {
        const res = await copyToClipboard('34-1234567-8');
        assert.equal(res, true);
        assert.equal(copiedText, '34-1234567-8');

        const numRes = await copyToClipboard(1234.56);
        assert.equal(numRes, true);
        assert.equal(copiedText, '1234.56');
    } finally {
        if (originalClipboard !== undefined) {
            Object.defineProperty(globalThis.navigator, 'clipboard', {
                value: originalClipboard,
                configurable: true,
                writable: true,
            });
        } else {
            delete globalThis.navigator.clipboard;
        }
    }
});

test('copyToClipboard - falls back to document.execCommand when navigator.clipboard is not available', async () => {
    const originalClipboard = globalThis.navigator?.clipboard;
    Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: undefined,
        configurable: true,
        writable: true,
    });

    let appendedChild = null;
    let removedChild = null;
    let selected = false;
    let focused = false;

    globalThis.document = {
        createElement: (tag) => {
            if (tag === 'textarea') {
                return {
                    value: '',
                    style: {},
                    select: () => { selected = true; },
                    focus: () => { focused = true; },
                };
            }
            return {};
        },
        body: {
            appendChild: (el) => { appendedChild = el; },
            removeChild: (el) => { removedChild = el; },
        },
        execCommand: (cmd) => {
            return cmd === 'copy';
        },
    };

    try {
        const res = await copyToClipboard('860.00');
        assert.equal(res, true);
        assert.equal(selected, true);
        assert.equal(focused, true);
        assert.equal(appendedChild?.value, '860.00');
        assert.equal(removedChild, appendedChild);
    } finally {
        delete globalThis.document;
        if (originalClipboard !== undefined) {
            Object.defineProperty(globalThis.navigator, 'clipboard', {
                value: originalClipboard,
                configurable: true,
                writable: true,
            });
        } else {
            delete globalThis.navigator.clipboard;
        }
    }
});

test('copyToClipboard - falls back to document.execCommand when navigator.clipboard throws', async () => {
    let commandExecuted = null;
    const originalClipboard = globalThis.navigator?.clipboard;
    Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: {
            writeText: async () => {
                throw new Error('Permission denied');
            },
        },
        configurable: true,
        writable: true,
    });

    globalThis.document = {
        createElement: () => ({
            value: '',
            style: {},
            select: () => {},
            focus: () => {},
        }),
        body: {
            appendChild: () => {},
            removeChild: () => {},
        },
        execCommand: (cmd) => {
            commandExecuted = cmd;
            return true;
        },
    };

    try {
        const res = await copyToClipboard('TIN-999-888');
        assert.equal(res, true);
        assert.equal(commandExecuted, 'copy');
    } finally {
        delete globalThis.document;
        if (originalClipboard !== undefined) {
            Object.defineProperty(globalThis.navigator, 'clipboard', {
                value: originalClipboard,
                configurable: true,
                writable: true,
            });
        } else {
            delete globalThis.navigator.clipboard;
        }
    }
});
