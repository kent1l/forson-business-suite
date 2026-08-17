/**
 * Bounds on client-supplied capture times.
 *
 * A phone tells us when a sale or adjustment actually happened, and we cannot
 * verify that claim -- the clock belongs to the device. These tests pin the
 * limits that make the claim safe to accept: nothing from the future, nothing
 * older than the configured window, and a clear line between "clock jitter"
 * and "this really did sit queued for a while".
 */

jest.mock('../db', () => ({ query: jest.fn() }));

const db = require('../db');
const {
    validateCapturedAt,
    getMaxBackdateMinutes,
    offlineNote,
    DEFAULT_MAX_BACKDATE_MINUTES,
} = require('../services/offlineCaptureService');

const opts = {
    tooOldCode: 'TOO_OLD',
    tooOldMessage: (hours, limitHours) => `${Math.round(hours)}h old, limit ${Math.round(limitHours)}h`,
};

const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

beforeEach(() => {
    jest.clearAllMocks();
    // 720 minutes = the seeded default.
    db.query.mockResolvedValue({ rows: [{ setting_value: '720' }] });
});

describe('validateCapturedAt', () => {
    test('an absent capture time is accepted and means "captured on receipt"', async () => {
        for (const value of [undefined, null]) {
            const r = await validateCapturedAt(value, opts);
            expect(r.ok).toBe(true);
            expect(r.capturedAt).toBeNull();
            expect(r.isOffline).toBe(false);
        }
    });

    test('a valid recent timestamp is accepted and normalised to ISO', async () => {
        const r = await validateCapturedAt(minutesAgo(0.2), opts);
        expect(r.ok).toBe(true);
        expect(r.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('garbage is rejected rather than silently becoming Invalid Date', async () => {
        const r = await validateCapturedAt('not-a-date', opts);
        expect(r.ok).toBe(false);
        expect(r.status).toBe(400);
        expect(r.body.message).toMatch(/valid ISO/i);
    });

    test('a genuinely future timestamp is rejected', async () => {
        const r = await validateCapturedAt(new Date(Date.now() + 30 * 60000).toISOString(), opts);
        expect(r.ok).toBe(false);
        expect(r.body.message).toMatch(/future/i);
    });

    test('a slightly fast device clock is tolerated', async () => {
        // Phones drift; a couple of minutes ahead is not an attempt to pre-date.
        const r = await validateCapturedAt(new Date(Date.now() + 3 * 60000).toISOString(), opts);
        expect(r.ok).toBe(true);
    });

    test('beyond the window it is rejected with the caller-supplied code', async () => {
        const r = await validateCapturedAt(minutesAgo(20 * 60), opts);
        expect(r.ok).toBe(false);
        expect(r.body.code).toBe('TOO_OLD');
        expect(r.body.message).toBe('20h old, limit 12h');
    });

    test('just inside the window is accepted', async () => {
        const r = await validateCapturedAt(minutesAgo(719), opts);
        expect(r.ok).toBe(true);
        expect(r.isOffline).toBe(true);
    });

    test('sub-minute drift is jitter, not an offline capture', async () => {
        const r = await validateCapturedAt(minutesAgo(0.5), opts);
        expect(r.ok).toBe(true);
        expect(r.isOffline).toBe(false);
    });

    test('a real gap is flagged as offline', async () => {
        const r = await validateCapturedAt(minutesAgo(90), opts);
        expect(r.ok).toBe(true);
        expect(r.isOffline).toBe(true);
        expect(Math.round(r.driftMinutes)).toBe(90);
    });
});

describe('getMaxBackdateMinutes', () => {
    test('reads the configured window', async () => {
        db.query.mockResolvedValue({ rows: [{ setting_value: '60' }] });
        expect(await getMaxBackdateMinutes()).toBe(60);
    });

    test('falls back when the setting is missing or nonsense, rather than admitting everything', async () => {
        for (const rows of [[], [{ setting_value: 'abc' }], [{ setting_value: '0' }], [{ setting_value: '-5' }]]) {
            db.query.mockResolvedValue({ rows });
            expect(await getMaxBackdateMinutes()).toBe(DEFAULT_MAX_BACKDATE_MINUTES);
        }
    });
});

test('the offline note states the gap in plain terms for the audit trail', () => {
    expect(offlineNote(90.4)).toBe('Captured offline 90 minutes before sync.');
});
