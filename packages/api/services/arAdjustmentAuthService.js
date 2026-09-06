'use strict';

/**
 * Inline manager authorization for A/R concessions.
 *
 * A cashier without `ar:discount_grant` can still key a concession, but the
 * submission has to be authorized by someone who holds it, entering their own
 * credentials at the counter. Both employees end up named on the document.
 *
 * This is the repo's first cross-user authorization, so the rules it has to
 * obey are stricter than the existing self re-auth (POST /verify-password):
 *
 *   * It issues NO session token. The thing returned is a single-purpose JWT
 *     with aud 'ar_adjustment'. It never touches req.user, and `protect` will
 *     not accept it -- it carries no login_date, so it fails there too.
 *   * Its claims bind it to {purpose, requested_by, customer_id, total_amount}.
 *     A token obtained for a 200-peso concession on customer 42 cannot be
 *     replayed on a different customer, a larger amount, or a different kind of
 *     concession. The purpose matters as much as the amount: a manager shown
 *     "a 800-peso settlement discount on the collection you are standing over"
 *     has not agreed to an 800-peso bad-debt write-off against an older invoice
 *     with no money collected at all, and without a purpose claim those two are
 *     the same token.
 *   * It is single-use. The jti is claimed in ar_adjustment_authorization_log
 *     at issue and spent at consumption by an UPDATE that only matches an
 *     unspent row, so a replayed request loses the race in the database rather
 *     than in JavaScript.
 *   * The authorizer's permission and active status are re-checked AT
 *     CONSUMPTION, not only at issue. A manager whose access is revoked in the
 *     three minutes the token lives cannot still authorize with it.
 *   * Unknown username and wrong password return the same message, and the
 *     password never reaches a log line.
 */

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const TOKEN_AUDIENCE = 'ar_adjustment';

/** What a token may be spent on. Checked at issue and again at consumption. */
const PURPOSES = new Set(['SETTLEMENT_DISCOUNT', 'BALANCE_WRITE_DOWN']);
const DEFAULT_TTL_SECONDS = 180;
const GRANT_PERMISSION = 'ar:discount_grant';

/** Level 10 is the admin bypass `hasPermission` applies; mirrored so the two agree. */
const ADMIN_LEVEL = 10;

/** Attempts per requesting employee inside the window before the endpoint stops answering. */
const RATE_LIMIT_MAX_ATTEMPTS = 10;
const RATE_LIMIT_WINDOW_MINUTES = 5;

/**
 * The same sentence for an unknown username, a wrong password, an inactive
 * account and a manager who lacks the permission. Distinguishing them turns the
 * endpoint into an oracle for which usernames exist and who can approve
 * discounts -- exactly the reconnaissance a cashier building a fraud would want.
 */
const GENERIC_DENIAL = 'Those credentials cannot authorize this concession.';

/**
 * A real bcrypt hash of a passphrase nobody has, compared against when the
 * username is unknown so a missing account costs the same time as a wrong
 * password. Without it the endpoint answers instantly for names that do not
 * exist and slowly for names that do, which enumerates the staff list.
 */
const DUMMY_HASH = '$2b$10$/jH/C66fMrgGIEd/aEuTBupCnwnGfNM06CET2kabCMpMM2IuFlnHK';

class AuthorizationError extends Error {
    constructor(message, statusCode = 403) {
        super(message);
        this.statusCode = statusCode;
    }
}

const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

async function getTtlSeconds(executor) {
    try {
        const { rows } = await executor.query(
            `SELECT setting_value FROM settings WHERE setting_key = 'AR_ADJUSTMENT_AUTH_TTL_SECONDS'`
        );
        const parsed = parseInt(rows[0]?.setting_value, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_SECONDS;
    } catch {
        return DEFAULT_TTL_SECONDS;
    }
}

/**
 * Does this employee row hold the grant permission, right now?
 *
 * Read from the database rather than from any token: an employee whose system
 * access was revoked has permission_level_id NULLed, and a demotion has to take
 * effect on the next request, not the next login.
 */
async function loadAuthorizerByUsername(executor, username) {
    const { rows } = await executor.query(
        `SELECT e.employee_id, e.username, e.password_hash, e.is_active, e.permission_level_id,
                COALESCE(BOOL_OR(p.permission_key = $2), false) AS has_grant
           FROM employee e
           LEFT JOIN role_permission rp ON rp.permission_level_id = e.permission_level_id
           LEFT JOIN permission p       ON p.permission_id = rp.permission_id
          WHERE e.username = $1
          GROUP BY e.employee_id`,
        [username, GRANT_PERMISSION]
    );
    return rows[0] || null;
}

function canGrant(employee) {
    if (!employee || !employee.is_active || employee.permission_level_id === null) return false;
    return Number(employee.permission_level_id) === ADMIN_LEVEL || employee.has_grant === true;
}

async function writeLog(executor, {
    action, requestedBy, authorizedBy = null, customerId = null,
    amount = null, tokenJti = null, notes = null, adjustmentId = null, reasonCode = null,
}) {
    await executor.query(
        `INSERT INTO ar_adjustment_authorization_log
            (adjustment_id, customer_id, action, requested_by, authorized_by, amount, reason_code, token_jti, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [adjustmentId, customerId, action, requestedBy, authorizedBy, amount, reasonCode, tokenJti, notes]
    );
}

/**
 * Too many attempts from one cashier in a short window is either a brute-force
 * or a cashier hunting for someone who will approve. Both are worth stopping,
 * and both are worth the DENIED rows that record them.
 *
 * Counted in the table rather than in process memory so it survives a restart
 * and holds across API instances.
 */
async function assertNotRateLimited(executor, requestedBy) {
    const { rows: [{ count }] } = await executor.query(
        `SELECT COUNT(*)::int AS count
           FROM ar_adjustment_authorization_log
          WHERE requested_by = $1
            AND action IN ('AUTHORIZED', 'DENIED')
            AND created_at > CURRENT_TIMESTAMP - ($2 || ' minutes')::interval`,
        [requestedBy, String(RATE_LIMIT_WINDOW_MINUTES)]
    );
    if (count >= RATE_LIMIT_MAX_ATTEMPTS) {
        throw new AuthorizationError(
            `Too many authorization attempts. Wait ${RATE_LIMIT_WINDOW_MINUTES} minutes before trying again.`,
            429
        );
    }
}

/**
 * Verify a permission-holder's credentials and mint a token the cashier can
 * submit with. Writes a log row either way -- a run of DENIED rows is the fraud
 * signal this table exists for.
 *
 * @param {object} executor        db or an open PoolClient
 * @param {object} opts
 * @param {string} opts.username   the AUTHORIZER's username (not the cashier's)
 * @param {string} opts.password   the authorizer's password
 * @param {number} opts.requestedBy  employee_id of the cashier asking
 * @param {number} opts.customerId
 * @param {number} opts.totalAmount  the concession the token may authorize
 */
async function issueAuthorization(executor, { username, password, requestedBy, customerId, totalAmount, purpose }) {
    if (!requestedBy) throw new AuthorizationError('The requesting employee could not be identified.', 401);
    if (!username || !password) throw new AuthorizationError('A username and password are required.', 400);

    const customer = Number(customerId);
    const amount = round2(totalAmount);
    if (!customer) throw new AuthorizationError('A customer is required.', 400);
    if (!(amount > 0)) throw new AuthorizationError('The concession amount must be greater than zero.', 400);
    if (!PURPOSES.has(purpose)) {
        throw new AuthorizationError('An authorization must say what kind of concession it approves.', 400);
    }

    await assertNotRateLimited(executor, requestedBy);

    const authorizer = await loadAuthorizerByUsername(executor, username);

    // bcrypt.compare is run even when the username is unknown, against a hash
    // that cannot match, so a missing account and a wrong password take the same
    // time. Without it the endpoint leaks which usernames exist by how fast it
    // answers.
    const hash = authorizer?.password_hash || DUMMY_HASH;
    const passwordMatches = await bcrypt.compare(String(password), hash);

    if (!authorizer || !passwordMatches || !canGrant(authorizer)) {
        await writeLog(executor, {
            action: 'DENIED',
            requestedBy,
            customerId: customer,
            amount,
            // Records that an attempt happened and against what, never which
            // part of it failed and never anything derived from the password.
            notes: 'Authorization refused for the credentials supplied.',
        });
        throw new AuthorizationError(GENERIC_DENIAL, 403);
    }

    // Authorizing your own request is not an authorization. Someone without the
    // permission cannot be the authorizer anyway (canGrant would have failed),
    // but a holder who somehow reaches this path must not self-elevate: they
    // would simply grant it directly.
    if (Number(authorizer.employee_id) === Number(requestedBy)) {
        await writeLog(executor, {
            action: 'DENIED',
            requestedBy,
            customerId: customer,
            amount,
            notes: 'An employee cannot authorize their own concession.',
        });
        throw new AuthorizationError('You already hold this permission — grant the concession directly.', 400);
    }

    const ttlSeconds = await getTtlSeconds(executor);
    const jti = crypto.randomUUID();

    const token = jwt.sign(
        {
            jti,
            aud: TOKEN_AUDIENCE,
            purpose,
            requested_by: Number(requestedBy),
            authorized_by: Number(authorizer.employee_id),
            customer_id: customer,
            total_amount: amount,
        },
        process.env.JWT_SECRET,
        { expiresIn: ttlSeconds }
    );

    // Claims the jti now, so there is a row to spend later. The partial unique
    // index on (token_jti) WHERE action = 'AUTHORIZED' means the same jti can
    // never be claimed twice; consumed_at, still NULL here, is what makes it
    // spendable exactly once.
    await writeLog(executor, {
        action: 'AUTHORIZED',
        requestedBy,
        authorizedBy: authorizer.employee_id,
        customerId: customer,
        amount,
        tokenJti: jti,
        notes: 'Authorization issued; awaiting the concession it authorizes.',
    });

    return {
        authorization_token: token,
        expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        authorized_by: { employee_id: authorizer.employee_id, username: authorizer.username },
    };
}

/**
 * Spend a token for a concession about to be written.
 *
 * Must be called inside the same transaction that creates the adjustment: the
 * UPDATE that spends the token and the INSERT that creates the document commit
 * or roll back together, so a rejected concession never burns its authorization
 * and an accepted one can never be authorized twice.
 *
 * @returns {number} employee_id of the authorizer, for ar_adjustment.authorized_by
 */
async function consumeAuthorization(client, { token, requestedBy, customerId, totalAmount, purpose, adjustmentId = null }) {
    if (!token) throw new AuthorizationError('An authorization is required to grant this concession.', 403);
    if (!PURPOSES.has(purpose)) {
        throw new AuthorizationError('This concession did not say what kind of authorization it needs.', 400);
    }

    let claims;
    try {
        claims = jwt.verify(token, process.env.JWT_SECRET, { audience: TOKEN_AUDIENCE });
    } catch {
        throw new AuthorizationError('That authorization has expired or is not valid. Ask for it again.', 403);
    }

    const amount = round2(totalAmount);

    // Binding checks. A token is for one kind of concession, one cashier, one
    // customer, and an amount no smaller than what is being written -- so it
    // cannot be carried to another customer, handed to a colleague, converted
    // into a different kind of concession, or reused for a larger one. A smaller
    // amount is allowed: the manager approved more than was taken.
    //
    // The purpose check is what stops an approval given at the counter for a
    // discount on money being collected from being spent instead on a write-off
    // where no money changes hands at all.
    if (claims.purpose !== purpose) {
        throw new AuthorizationError('That authorization was given for a different kind of concession.', 403);
    }
    if (Number(claims.requested_by) !== Number(requestedBy)) {
        throw new AuthorizationError('That authorization was issued to a different user.', 403);
    }
    if (Number(claims.customer_id) !== Number(customerId)) {
        throw new AuthorizationError('That authorization was issued for a different customer.', 403);
    }
    if (amount > Number(claims.total_amount) + 0.005) {
        throw new AuthorizationError(
            `That authorization covers ₱${Number(claims.total_amount).toFixed(2)}; ₱${amount.toFixed(2)} was entered. Ask for it again.`,
            403
        );
    }

    // Re-checked here, not only at issue: revoking a manager's access has to
    // take effect immediately, including on a token they signed minutes ago.
    const { rows } = await client.query(
        `SELECT e.employee_id, e.username, e.is_active, e.permission_level_id,
                COALESCE(BOOL_OR(p.permission_key = $2), false) AS has_grant
           FROM employee e
           LEFT JOIN role_permission rp ON rp.permission_level_id = e.permission_level_id
           LEFT JOIN permission p       ON p.permission_id = rp.permission_id
          WHERE e.employee_id = $1
          GROUP BY e.employee_id`,
        [claims.authorized_by, GRANT_PERMISSION]
    );
    if (!canGrant(rows[0])) {
        throw new AuthorizationError('The employee who authorized this can no longer approve concessions.', 403);
    }

    // Single use, decided in the database rather than in JavaScript. Two
    // concurrent submissions of the same token both reach this statement; the
    // second blocks on the row lock, re-evaluates `consumed_at IS NULL` against
    // the row the first committed, and matches nothing.
    const { rowCount } = await client.query(
        `UPDATE ar_adjustment_authorization_log
            SET consumed_at   = CURRENT_TIMESTAMP,
                adjustment_id = COALESCE($2, adjustment_id)
          WHERE token_jti = $1
            AND action = 'AUTHORIZED'
            AND consumed_at IS NULL`,
        [claims.jti, adjustmentId]
    );
    if (rowCount !== 1) {
        throw new AuthorizationError('That authorization has already been used. Ask for it again.', 403);
    }

    return Number(claims.authorized_by);
}

/**
 * Attach the document to the log row after the fact.
 *
 * consumeAuthorization has to run before the adjustment exists (its own
 * validation may reject the concession), so the adjustment_id is filled in once
 * there is one -- still inside the same transaction.
 */
async function linkAuthorizationToAdjustment(client, { token, adjustmentId }) {
    if (!token || !adjustmentId) return;
    const decoded = jwt.decode(token);
    if (!decoded?.jti) return;
    await client.query(
        `UPDATE ar_adjustment_authorization_log
            SET adjustment_id = $2
          WHERE token_jti = $1 AND action = 'AUTHORIZED' AND adjustment_id IS NULL`,
        [decoded.jti, adjustmentId]
    );
}

module.exports = {
    AuthorizationError,
    TOKEN_AUDIENCE,
    PURPOSES,
    GENERIC_DENIAL,
    GRANT_PERMISSION,
    RATE_LIMIT_MAX_ATTEMPTS,
    RATE_LIMIT_WINDOW_MINUTES,
    issueAuthorization,
    consumeAuthorization,
    linkAuthorizationToAdjustment,
    getTtlSeconds,
};
