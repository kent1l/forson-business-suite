/**
 * Tracks when the signed-in user last confirmed their password for My Pay.
 *
 * A plain module-level value rather than localStorage: it should not survive
 * a page refresh (a shared office PC left on the My Pay tab and refreshed by
 * the next person should ask again) and does not need to be shared across
 * tabs. Reset on logout (see AuthContext) so the next person to sign in on
 * the same browser can't inherit an already-unlocked state.
 */
export const PAY_REAUTH_WINDOW_MS = 15 * 60 * 1000;

let unlockedAt = null;

export const unlockPayReauth = () => { unlockedAt = Date.now(); };
export const lockPayReauth = () => { unlockedAt = null; };
export const isPayReauthUnlocked = () => !!unlockedAt && (Date.now() - unlockedAt < PAY_REAUTH_WINDOW_MS);
