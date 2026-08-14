const request = require('supertest');
const express = require('express');
const bcrypt = require('bcrypt');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

jest.mock('../db', () => {
    const queryFn = jest.fn();
    const clientQueryFn = jest.fn();
    const releaseFn = jest.fn();
    return {
        query: queryFn,
        getClient: jest.fn(async () => ({ query: clientQueryFn, release: releaseFn })),
        __client: { query: clientQueryFn, release: releaseFn },
    };
});

// Permission gating is configurable per test: `mockGrantedPermissions = null` means
// "allow everything" (the usual case), an array means only those keys pass.
let mockGrantedPermissions = null;
let mockCurrentUser = { employee_id: 1, username: 'testadmin', permission_level_id: 10 };

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = mockCurrentUser;
        next();
    },
    hasPermission: (keyOrKeys) => (req, res, next) => {
        if (mockGrantedPermissions === null) return next();
        const needed = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
        if (needed.some((k) => mockGrantedPermissions.includes(k))) return next();
        return res.status(403).json({ message: 'Forbidden' });
    },
    isAdmin: (req, res, next) => {
        if (Number(mockCurrentUser.permission_level_id) !== 10) {
            return res.status(403).json({ message: 'Admin only' });
        }
        next();
    },
}));

jest.mock('../helpers/documentNumberGenerator', () => ({
    getNextDocumentNumber: jest.fn(async () => 'EMP-202608-0001'),
}));

const db = require('../db');
const employeeRouter = require('../routes/employeeRoutes');
const hrRouter = require('../routes/hrRoutes');

const app = express();
app.use(express.json());
app.use('/api', employeeRouter);
app.use('/api/hr', hrRouter);

beforeEach(() => {
    jest.clearAllMocks();
    mockGrantedPermissions = null;
    mockCurrentUser = { employee_id: 1, username: 'testadmin', permission_level_id: 10 };
});

describe('login with payroll-only employees', () => {
    it('returns 401 rather than crashing when the matched row has no password hash', async () => {
        // A row can only reach this state via direct DB manipulation, but bcrypt.compare
        // throws on a null hash, so the guard has to exist regardless.
        db.query.mockResolvedValueOnce({
            rows: [{ employee_id: 7, username: 'driver', password_hash: null, permission_level_id: null }],
        });

        const res = await request(app).post('/api/login').send({ username: 'driver', password: 'anything' });

        expect(res.status).toBe(401);
        expect(res.body.message).toBe('Invalid credentials');
        // The permissions lookup must never have run.
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('still authenticates a normal account', async () => {
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash('correct-horse', salt);
        db.query
            .mockResolvedValueOnce({
                rows: [{
                    employee_id: 1, username: 'admin', password_hash, password_salt: salt,
                    permission_level_id: 10, first_name: 'Ada', last_name: 'Lovelace',
                }],
            })
            .mockResolvedValueOnce({ rows: [{ permission_key: 'employees:view' }] });

        const res = await request(app).post('/api/login').send({ username: 'admin', password: 'correct-horse' });

        expect(res.status).toBe(200);
        expect(res.body.token).toBeTruthy();
        expect(res.body.user.permissions).toEqual(['employees:view']);
        expect(res.body.user.password_hash).toBeUndefined();
    });
});

describe('POST /employees', () => {
    it('creates a payroll-only employee with no credentials', async () => {
        db.query.mockResolvedValueOnce({
            rows: [{ employee_id: 12, employee_code: 'EMP-202608-0001', username: null, has_system_access: false }],
        });

        const res = await request(app).post('/api/employees').send({
            first_name: 'Juan', last_name: 'Dela Cruz',
            position_title: 'Driver', has_system_access: false,
        });

        expect(res.status).toBe(201);
        expect(res.body.has_system_access).toBe(false);

        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/INSERT INTO employee/);
        // All four credential columns must be inserted as explicit NULLs so the
        // all-or-nothing CHECK constraint is satisfied.
        const columns = sql.match(/INSERT INTO employee \(([^)]+)\)/)[1].split(',').map((s) => s.trim());
        for (const col of ['username', 'password_hash', 'password_salt', 'permission_level_id']) {
            expect(params[columns.indexOf(col)]).toBeNull();
        }
    });

    it('rejects a request that asks for system access without a password', async () => {
        const res = await request(app).post('/api/employees').send({
            first_name: 'Juan', last_name: 'Dela Cruz',
            has_system_access: true, username: 'jdc', permission_level_id: 5,
        });

        expect(res.status).toBe(400);
        expect(db.query).not.toHaveBeenCalled();
    });

    it('still creates a full account when credentials are supplied', async () => {
        db.query.mockResolvedValueOnce({ rows: [{ employee_id: 13, username: 'jdc', has_system_access: true }] });

        const res = await request(app).post('/api/employees').send({
            first_name: 'Juan', last_name: 'Dela Cruz',
            username: 'jdc', password: 'secret123', permission_level_id: 5,
        });

        expect(res.status).toBe(201);
        const [sql, params] = db.query.mock.calls[0];
        const columns = sql.match(/INSERT INTO employee \(([^)]+)\)/)[1].split(',').map((s) => s.trim());
        expect(params[columns.indexOf('username')]).toBe('jdc');
        // The stored value must be a bcrypt hash, never the plaintext.
        expect(params[columns.indexOf('password_hash')]).toMatch(/^\$2[aby]\$/);
        expect(params[columns.indexOf('password_hash')]).not.toBe('secret123');
    });
});

describe('PUT /employees/:id (profile)', () => {
    it('never writes credential columns, even when they are in the body', async () => {
        db.query.mockResolvedValueOnce({ rows: [{ employee_id: 4, username: 'existing' }] });

        const res = await request(app).put('/api/employees/4').send({
            first_name: 'Juan', last_name: 'Dela Cruz', department_id: 2,
            // A malicious or careless caller trying to ride the profile endpoint:
            username: 'hijacked', password: 'newpass', permission_level_id: 10,
        });

        expect(res.status).toBe(200);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/UPDATE employee SET/);
        // Only the SET clause matters here — RETURNING legitimately reads username
        // back so the caller can render the "has login" badge.
        const setClause = sql.match(/UPDATE employee SET([\s\S]*?)WHERE/)[1];
        expect(setClause).not.toMatch(/username/);
        expect(setClause).not.toMatch(/password_hash/);
        expect(setClause).not.toMatch(/password_salt/);
        expect(setClause).not.toMatch(/permission_level_id/);
        expect(params).not.toContain('hijacked');
        expect(params).not.toContain('newpass');
    });

    it('rejects an update that would blank a required name', async () => {
        const res = await request(app).put('/api/employees/4').send({ first_name: '   ' });
        expect(res.status).toBe(400);
        expect(db.query).not.toHaveBeenCalled();
    });
});

describe('PUT /employees/:id/access', () => {
    it('requires a password when granting access to a login-less employee', async () => {
        // blockNonAdminEditingAdmin short-circuits for admins, so the first query
        // is the existing-username lookup.
        db.query.mockResolvedValueOnce({ rows: [{ username: null }] });

        const res = await request(app).put('/api/employees/9/access').send({
            username: 'newuser', permission_level_id: 5,
        });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/password is required/i);
    });

    it('grants access and hashes the password', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ username: null }] })
            .mockResolvedValueOnce({ rows: [{ employee_id: 9, username: 'newuser', permission_level_id: 5 }] });

        const res = await request(app).put('/api/employees/9/access').send({
            username: 'newuser', password: 'secret123', permission_level_id: 5,
        });

        expect(res.status).toBe(200);
        expect(res.body.has_system_access).toBe(true);
        const [, params] = db.query.mock.calls[1];
        expect(params).not.toContain('secret123');
        expect(params.some((p) => typeof p === 'string' && /^\$2[aby]\$/.test(p))).toBe(true);
    });
});

describe('DELETE /employees/:id/access', () => {
    it('clears all four credential columns together', async () => {
        db.query.mockResolvedValueOnce({ rows: [{ employee_id: 9, has_system_access: false }] });

        const res = await request(app).delete('/api/employees/9/access');

        expect(res.status).toBe(200);
        const [sql] = db.query.mock.calls[0];
        for (const col of ['username', 'password_hash', 'password_salt', 'permission_level_id']) {
            expect(sql).toMatch(new RegExp(`${col} = NULL`));
        }
    });

    it('refuses to let an admin revoke their own access', async () => {
        const res = await request(app).delete('/api/employees/1/access');
        expect(res.status).toBe(400);
        expect(db.query).not.toHaveBeenCalled();
    });

    it('is refused for non-admins', async () => {
        mockCurrentUser = { employee_id: 2, permission_level_id: 7 };
        const res = await request(app).delete('/api/employees/9/access');
        expect(res.status).toBe(403);
    });
});

describe('role escalation guards', () => {
    it('blocks assigning a role above your own', async () => {
        mockCurrentUser = { employee_id: 2, permission_level_id: 4 };
        const res = await request(app).put('/api/employees/9/access').send({
            username: 'x', password: 'y', permission_level_id: 7,
        });
        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/higher than your own/i);
    });

    it('blocks changing your own role', async () => {
        mockCurrentUser = { employee_id: 9, permission_level_id: 7 };
        const res = await request(app).put('/api/employees/9/access').send({
            username: 'x', password: 'y', permission_level_id: 7,
        });
        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/your own role/i);
    });

    it('still blocks a non-admin granting Admin', async () => {
        mockCurrentUser = { employee_id: 2, permission_level_id: 7 };
        const res = await request(app).put('/api/employees/9/access').send({
            username: 'x', password: 'y', permission_level_id: 10,
        });
        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/admin/i);
    });

    it('allows assigning a role at or below your own to someone else', async () => {
        mockCurrentUser = { employee_id: 2, permission_level_id: 10 };
        db.query
            .mockResolvedValueOnce({ rows: [{ username: 'existing' }] })
            .mockResolvedValueOnce({ rows: [{ employee_id: 9, username: 'x', permission_level_id: 7 }] });
        const res = await request(app).put('/api/employees/9/access').send({
            username: 'x', password: 'y', permission_level_id: 7,
        });
        expect(res.status).toBe(200);
    });
});

describe('personal data gating on GET /employees/:id', () => {
    const detailRow = { employee_id: 4, first_name: 'Juan', last_name: 'Dela Cruz' };

    it('omits the personal block for a caller without hr:view', async () => {
        mockCurrentUser = { employee_id: 2, permission_level_id: 4, permissions: ['employees:view'] };
        db.query.mockResolvedValueOnce({ rows: [detailRow] });

        const res = await request(app).get('/api/employees/4');

        expect(res.status).toBe(200);
        const [sql] = db.query.mock.calls[0];
        for (const col of ['address_line', 'birth_date', 'emergency_contact_name', 'personal_email', 'mobile_no']) {
            expect(sql).not.toMatch(new RegExp(col));
        }
    });

    it('includes the personal block for a caller with hr:view', async () => {
        mockCurrentUser = { employee_id: 2, permission_level_id: 7, permissions: ['employees:view', 'hr:view'] };
        db.query.mockResolvedValueOnce({ rows: [detailRow] });

        const res = await request(app).get('/api/employees/4');

        expect(res.status).toBe(200);
        const [sql] = db.query.mock.calls[0];
        expect(sql).toMatch(/address_line/);
        expect(sql).toMatch(/emergency_contact_name/);
    });

    it('keeps the personal block out of the list projection entirely', async () => {
        mockCurrentUser = { employee_id: 2, permission_level_id: 10, permissions: [] };
        db.query
            .mockResolvedValueOnce({ rows: [{ total: 0 }] })
            .mockResolvedValueOnce({ rows: [] });

        await request(app).get('/api/employees?paginated=1');

        const listSql = db.query.mock.calls.map((c) => c[0]).join('\n');
        for (const col of ['address_line', 'birth_date', 'emergency_contact_name']) {
            expect(listSql).not.toMatch(new RegExp(col));
        }
    });
});

describe('government IDs', () => {
    it('is refused without hr:view_sensitive', async () => {
        mockGrantedPermissions = ['hr:view', 'hr:manage_employees'];
        const res = await request(app).get('/api/hr/employees/4/government-ids');
        expect(res.status).toBe(403);
        expect(db.query).not.toHaveBeenCalled();
    });

    it('logs an access record on every read', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ employee_id: 4, sss_no: '34-1234567-8' }] })
            .mockResolvedValueOnce({ rows: [] });

        const res = await request(app).get('/api/hr/employees/4/government-ids');

        expect(res.status).toBe(200);
        const [logSql, logParams] = db.query.mock.calls[1];
        expect(logSql).toMatch(/INSERT INTO employee_sensitive_access_log/);
        expect(logParams).toEqual(['4', 1, 'VIEW']);
    });

    it('returns an empty shell rather than 404 when nothing is on file yet', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });

        const res = await request(app).get('/api/hr/employees/4/government-ids');

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ employee_id: 4 });
    });
});

describe('compensation', () => {
    it('resolves the rate in force on a past date, not the latest one', async () => {
        db.query.mockResolvedValueOnce({
            rows: [{ compensation_id: 1, effective_date: '2026-01-01', base_rate: '610.00' }],
        });

        const res = await request(app).get('/api/hr/employees/4/compensation/effective?as_of=2026-06-30');

        expect(res.status).toBe(200);
        expect(res.body.base_rate).toBe('610.00');
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/effective_date <= \$2/);
        expect(sql).toMatch(/ORDER BY effective_date DESC/);
        expect(sql).toMatch(/LIMIT 1/);
        expect(params).toEqual(['4', '2026-06-30']);
    });

    it('404s when the employee has no compensation on record as of that date', async () => {
        db.query.mockResolvedValueOnce({ rows: [] });
        const res = await request(app).get('/api/hr/employees/4/compensation/effective?as_of=2020-01-01');
        expect(res.status).toBe(404);
    });

    it('rejects a negative base rate', async () => {
        const res = await request(app).post('/api/hr/employees/4/compensation')
            .send({ effective_date: '2026-08-01', base_rate: -5 });
        expect(res.status).toBe(400);
        expect(db.query).not.toHaveBeenCalled();
    });

    it('rejects a malformed effective date', async () => {
        const res = await request(app).post('/api/hr/employees/4/compensation')
            .send({ effective_date: '08/01/2026', base_rate: 610 });
        expect(res.status).toBe(400);
        expect(db.query).not.toHaveBeenCalled();
    });
});
