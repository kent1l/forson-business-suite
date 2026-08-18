const db = require('../db');

/**
 * Validation for writes that were captured on a phone before they reached us.
 *
 * A mobile client may tell us when something actually happened, so a sale rung
 * up during a blackout records the time the customer paid rather than the time
 * the LAN came back. That claim is unverifiable -- it comes from a device clock
 * the server does not control -- so it is bounded rather than trusted: never in
 * the future, and never further back than the configured window.
 *
 * The rules here are lifted from the offline clock-in path in routes/dtrRoutes.js,
 * which solved this first. That copy is deliberately left in place: consolidating
 * it would mean editing a payroll-material control while shipping an unrelated
 * feature, which is a worse trade than ~30 duplicated lines. Worth folding
 * together later, in a change that is only about that.
 */

const DEFAULT_MAX_BACKDATE_MINUTES = 720;
const SETTING_KEY = 'MOBILE_OFFLINE_MAX_BACKDATE_MINUTES';

/** A phone clock running slightly fast is normal; genuine future-dating is not. */
const FUTURE_TOLERANCE_MINUTES = 5;

/** Below this, the difference is clock jitter rather than a real offline gap. */
const OFFLINE_THRESHOLD_MINUTES = 1;

const getMaxBackdateMinutes = async () => {
    const { rows } = await db.query(
        'SELECT setting_value FROM settings WHERE setting_key = $1',
        [SETTING_KEY]
    );
    const parsed = Number(rows[0]?.setting_value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BACKDATE_MINUTES;
};

/**
 * Checks a client-supplied capture time.
 *
 * Resolves to `{ ok: true, capturedAt, driftMinutes, isOffline }` when the value
 * is absent (nothing to validate) or acceptable, and to
 * `{ ok: false, status, body }` when the caller should reject the request --
 * returned rather than thrown so routes can bail before opening a transaction.
 *
 * `tooOldMessage` receives the drift and the limit, both in hours, so each
 * caller can tell the user what to do instead of just what went wrong.
 */
const validateCapturedAt = async (raw, { tooOldCode, tooOldMessage }) => {
    if (raw === undefined || raw === null) {
        return { ok: true, capturedAt: null, driftMinutes: 0, isOffline: false };
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
        return {
            ok: false,
            status: 400,
            body: { message: 'captured_at must be a valid ISO timestamp' },
        };
    }

    const driftMinutes = (Date.now() - parsed.getTime()) / 60000;

    if (driftMinutes < -FUTURE_TOLERANCE_MINUTES) {
        return {
            ok: false,
            status: 400,
            body: { message: 'captured_at cannot be in the future' },
        };
    }

    const maxBackdate = await getMaxBackdateMinutes();
    if (driftMinutes > maxBackdate) {
        return {
            ok: false,
            status: 400,
            body: {
                message: tooOldMessage(driftMinutes / 60, maxBackdate / 60),
                code: tooOldCode,
            },
        };
    }

    return {
        ok: true,
        capturedAt: parsed.toISOString(),
        driftMinutes,
        isOffline: driftMinutes > OFFLINE_THRESHOLD_MINUTES,
    };
};

/** The note appended to offline-captured records, so the gap is visible in the audit trail. */
const offlineNote = (driftMinutes) =>
    `Captured offline ${Math.round(driftMinutes)} minutes before sync.`;

module.exports = {
    getMaxBackdateMinutes,
    validateCapturedAt,
    offlineNote,
    DEFAULT_MAX_BACKDATE_MINUTES,
    SETTING_KEY,
};
