'use strict';

/**
 * The inline manager authorization behind a settlement discount.
 *
 * These are the cases a fraud would try, so they are pinned rather than left to
 * a live walkthrough: replay the token, carry it to another customer, inflate
 * the amount, use it after the manager's access is revoked, or brute-force the
 * endpoint. Each of them must fail, and the failures must be indistinguishable
 * from one another to the caller.
 */

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-ar-adjustment-auth';

const auth = require('../services/arAdjustmentAuthService');

const PASSWORD = 'correct horse battery staple';
let PASSWORD_HASH;

beforeAll(async () => {
    PASSWORD_HASH = await bcrypt.hash(PASSWORD, 4);
});

/**
 * A stand-in for a PoolClient that answers the three shapes of query the
 * service issues, driven by a small world description. Keeps the test about the
 * authorization rules rather than about SQL.
 */
function makeExecutor({ employees = [], attemptCount = 0, ttl = '180' } = {}) {
    const log = [];
    let spent = new Set();

    const executor = {
        log,
        spend: (jti) => spent.add(jti),
        query: jest.fn(async (sql, params = []) => {
            if (sql.includes('AR_ADJUSTMENT_AUTH_TTL_SECONDS')) {
                return { rows: [{ setting_value: ttl }] };
            }
            if (sql.includes('COUNT(*)::int AS count')) {
                return { rows: [{ count: attemptCount }] };
            }
            if (sql.includes('FROM employee e') && sql.includes('WHERE e.username = $1')) {
                const row = employees.find(e => e.username === params[0]);
                return { rows: row ? [row] : [] };
            }
            if (sql.includes('FROM employee e') && sql.includes('WHERE e.employee_id = $1')) {
                const row = employees.find(e => Number(e.employee_id) === Number(params[0]));
                return { rows: row ? [row] : [] };
            }
            if (sql.includes('INSERT INTO ar_adjustment_authorization_log')) {
                log.push({ action: params[2], requested_by: params[3], authorized_by: params[4], token_jti: params[7] });
                return { rows: [], rowCount: 1 };
            }
            if (sql.includes('UPDATE ar_adjustment_authorization_log') && sql.includes('SET consumed_at')) {
                const jti = params[0];
                if (spent.has(jti)) return { rows: [], rowCount: 0 };
                spent.add(jti);
                return { rows: [], rowCount: 1 };
            }
            if (sql.includes('UPDATE ar_adjustment_authorization_log')) {
                return { rows: [], rowCount: 1 };
            }
            throw new Error(`Unexpected query in test: ${sql.slice(0, 80)}`);
        }),
    };
    return executor;
}

const MANAGER = {
    employee_id: 7,
    username: 'manager',
    is_active: true,
    permission_level_id: 5,
    has_grant: true,
};

const CASHIER_ID = 42;

const issue = (executor, overrides = {}) => auth.issueAuthorization(executor, {
    username: 'manager',
    password: PASSWORD,
    requestedBy: CASHIER_ID,
    customerId: 99,
    totalAmount: 800,
    purpose: 'SETTLEMENT_DISCOUNT',
    ...overrides,
});

describe('issuing an authorization', () => {
    it('mints a token bound to the cashier, the customer and the amount', async () => {
        const executor = makeExecutor({ employees: [{ ...MANAGER, password_hash: PASSWORD_HASH }] });
        const result = await issue(executor);

        const claims = jwt.verify(result.authorization_token, process.env.JWT_SECRET, { audience: 'ar_adjustment' });
        expect(claims.requested_by).toBe(CASHIER_ID);
        expect(claims.authorized_by).toBe(MANAGER.employee_id);
        expect(claims.customer_id).toBe(99);
        expect(claims.total_amount).toBe(800);
        expect(claims.purpose).toBe('SETTLEMENT_DISCOUNT');
        expect(claims.jti).toBeTruthy();

        expect(result.authorized_by).toEqual({ employee_id: 7, username: 'manager' });
        expect(executor.log).toEqual([
            expect.objectContaining({ action: 'AUTHORIZED', requested_by: CASHIER_ID, authorized_by: 7 }),
        ]);
    });

    it('is not a session token — `protect` would reject it', async () => {
        const executor = makeExecutor({ employees: [{ ...MANAGER, password_hash: PASSWORD_HASH }] });
        const { authorization_token } = await issue(executor);
        const claims = jwt.decode(authorization_token);

        // protect() refuses any token whose login_date is not today's Manila date.
        // A token with no login_date at all can never satisfy that check.
        expect(claims.login_date).toBeUndefined();
        expect(claims.permission_level_id).toBeUndefined();
        expect(claims.aud).toBe('ar_adjustment');
    });

    it('refuses a wrong password with the same message as an unknown username', async () => {
        const known = makeExecutor({ employees: [{ ...MANAGER, password_hash: PASSWORD_HASH }] });
        const unknown = makeExecutor({ employees: [] });

        const wrongPassword = await issue(known, { password: 'not it' }).catch(e => e);
        const noSuchUser = await issue(unknown, { username: 'ghost' }).catch(e => e);

        expect(wrongPassword.message).toBe(auth.GENERIC_DENIAL);
        expect(noSuchUser.message).toBe(auth.GENERIC_DENIAL);
        expect(wrongPassword.statusCode).toBe(403);
        expect(noSuchUser.statusCode).toBe(403);
    });

    it('logs a DENIED row without recording anything derived from the password', async () => {
        const executor = makeExecutor({ employees: [{ ...MANAGER, password_hash: PASSWORD_HASH }] });
        await issue(executor, { password: 'not it' }).catch(() => {});

        expect(executor.log).toEqual([
            expect.objectContaining({ action: 'DENIED', requested_by: CASHIER_ID, authorized_by: null }),
        ]);
        const logged = JSON.stringify(executor.query.mock.calls);
        expect(logged).not.toContain('not it');
        expect(logged).not.toContain(PASSWORD);
    });

    it('refuses an employee who does not hold the permission', async () => {
        const executor = makeExecutor({
            employees: [{ ...MANAGER, has_grant: false, password_hash: PASSWORD_HASH }],
        });
        await expect(issue(executor)).rejects.toMatchObject({ message: auth.GENERIC_DENIAL });
    });

    it('refuses an employee whose account is deactivated', async () => {
        const executor = makeExecutor({
            employees: [{ ...MANAGER, is_active: false, password_hash: PASSWORD_HASH }],
        });
        await expect(issue(executor)).rejects.toMatchObject({ message: auth.GENERIC_DENIAL });
    });

    it('refuses an employee whose system access was revoked', async () => {
        const executor = makeExecutor({
            employees: [{ ...MANAGER, permission_level_id: null, password_hash: PASSWORD_HASH }],
        });
        await expect(issue(executor)).rejects.toMatchObject({ message: auth.GENERIC_DENIAL });
    });

    it('will not let an employee authorize their own request', async () => {
        const executor = makeExecutor({
            employees: [{ ...MANAGER, employee_id: CASHIER_ID, password_hash: PASSWORD_HASH }],
        });
        await expect(issue(executor)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('refuses to mint a token that does not say what it approves', async () => {
        const executor = makeExecutor({ employees: [{ ...MANAGER, password_hash: PASSWORD_HASH }] });
        await expect(issue(executor, { purpose: undefined })).rejects.toMatchObject({ statusCode: 400 });
        await expect(issue(executor, { purpose: 'ANYTHING_ELSE' })).rejects.toMatchObject({ statusCode: 400 });
    });

    it('stops answering after repeated attempts from the same employee', async () => {
        const executor = makeExecutor({
            employees: [{ ...MANAGER, password_hash: PASSWORD_HASH }],
            attemptCount: auth.RATE_LIMIT_MAX_ATTEMPTS,
        });
        await expect(issue(executor)).rejects.toMatchObject({ statusCode: 429 });
    });
});

describe('consuming an authorization', () => {
    async function mint(overrides = {}) {
        const executor = makeExecutor({ employees: [{ ...MANAGER, password_hash: PASSWORD_HASH }] });
        const { authorization_token } = await issue(executor, overrides);
        return { executor, token: authorization_token };
    }

    const consume = (executor, token, overrides = {}) => auth.consumeAuthorization(executor, {
        token,
        requestedBy: CASHIER_ID,
        customerId: 99,
        totalAmount: 800,
        purpose: 'SETTLEMENT_DISCOUNT',
        adjustmentId: 1234,
        ...overrides,
    });

    it('returns the authorizer so the document can name them', async () => {
        const { executor, token } = await mint();
        await expect(consume(executor, token)).resolves.toBe(MANAGER.employee_id);
    });

    it('cannot be spent twice', async () => {
        const { executor, token } = await mint();
        await consume(executor, token);
        await expect(consume(executor, token)).rejects.toMatchObject({
            message: expect.stringContaining('already been used'),
        });
    });

    it('cannot be carried to a different customer', async () => {
        const { executor, token } = await mint();
        await expect(consume(executor, token, { customerId: 100 })).rejects.toMatchObject({
            message: expect.stringContaining('different customer'),
        });
    });

    it('cannot be handed to a different cashier', async () => {
        const { executor, token } = await mint();
        await expect(consume(executor, token, { requestedBy: 43 })).rejects.toMatchObject({
            message: expect.stringContaining('different user'),
        });
    });

    it('cannot be converted into a different kind of concession', async () => {
        // The manager stood at the counter and approved a discount on money being
        // collected. That is not consent to write the same amount off an older
        // invoice with no money collected at all.
        const { executor, token } = await mint();
        await expect(consume(executor, token, { purpose: 'BALANCE_WRITE_DOWN' })).rejects.toMatchObject({
            message: expect.stringContaining('different kind of concession'),
        });
    });

    it('refuses a concession that does not say what authorization it needs', async () => {
        const { executor, token } = await mint();
        await expect(consume(executor, token, { purpose: undefined })).rejects.toMatchObject({ statusCode: 400 });
    });

    it('cannot be inflated to a larger concession', async () => {
        const { executor, token } = await mint();
        await expect(consume(executor, token, { totalAmount: 800.01 })).rejects.toMatchObject({ statusCode: 403 });
    });

    it('still covers a smaller concession than was approved', async () => {
        // The manager approved 800; taking only 500 is within what they allowed.
        const { executor, token } = await mint();
        await expect(consume(executor, token, { totalAmount: 500 })).resolves.toBe(MANAGER.employee_id);
    });

    it('is rejected once the authorizer loses the permission', async () => {
        const { token } = await mint();
        const revoked = makeExecutor({
            employees: [{ ...MANAGER, has_grant: false, password_hash: PASSWORD_HASH }],
        });
        await expect(consume(revoked, token)).rejects.toMatchObject({
            message: expect.stringContaining('can no longer approve'),
        });
    });

    it('is rejected once the authorizer is deactivated', async () => {
        const { token } = await mint();
        const revoked = makeExecutor({
            employees: [{ ...MANAGER, is_active: false, password_hash: PASSWORD_HASH }],
        });
        await expect(consume(revoked, token)).rejects.toMatchObject({ statusCode: 403 });
    });

    it('rejects a token signed with a different secret', async () => {
        const executor = makeExecutor({ employees: [{ ...MANAGER, password_hash: PASSWORD_HASH }] });
        const forged = jwt.sign(
            { jti: 'forged', aud: 'ar_adjustment', requested_by: CASHIER_ID, authorized_by: 7, customer_id: 99, total_amount: 800 },
            'some-other-secret',
            { expiresIn: 180 }
        );
        await expect(consume(executor, forged)).rejects.toMatchObject({ statusCode: 403 });
    });

    it('rejects a token minted for a different purpose', async () => {
        const executor = makeExecutor({ employees: [{ ...MANAGER, password_hash: PASSWORD_HASH }] });
        // A real session token, replayed here. It is signed with the same secret,
        // so only the audience separates it from an authorization.
        const session = jwt.sign(
            { employee_id: 7, username: 'manager', permission_level_id: 10, login_date: '2026-09-06' },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );
        await expect(consume(executor, session)).rejects.toMatchObject({ statusCode: 403 });
    });

    it('rejects an expired token', async () => {
        const executor = makeExecutor({ employees: [{ ...MANAGER, password_hash: PASSWORD_HASH }] });
        const stale = jwt.sign(
            { jti: 'stale', aud: 'ar_adjustment', requested_by: CASHIER_ID, authorized_by: 7, customer_id: 99, total_amount: 800 },
            process.env.JWT_SECRET,
            { expiresIn: -10 }
        );
        await expect(consume(executor, stale)).rejects.toMatchObject({ statusCode: 403 });
    });

    it('refuses outright when no token is supplied', async () => {
        const executor = makeExecutor({ employees: [{ ...MANAGER, password_hash: PASSWORD_HASH }] });
        await expect(consume(executor, null)).rejects.toMatchObject({ statusCode: 403 });
    });
});
