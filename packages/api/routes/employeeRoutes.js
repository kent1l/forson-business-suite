const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { protect, hasPermission, isAdmin } = require('../middleware/authMiddleware');

// Guards role assignment. Blocking only the Admin level was not enough: a
// Cashier holding employees:edit could set their own role to Manager (7) and
// re-login with everything Manager can reach — which now includes the HR module
// and every employee's personal data. So we block three things:
//   1. granting Admin unless you are Admin,
//   2. granting any level above your own, and
//   3. changing your own role at all.
const blockNonAdminGrantingAdmin = (req, res, next) => {
    const targetLevel = Number(req.body.permission_level_id);
    const requesterLevel = Number(req.user?.permission_level_id);

    if (targetLevel === 10 && requesterLevel !== 10) {
        return res.status(403).json({ message: 'Only an admin can assign the Admin role.' });
    }
    if (Number.isFinite(targetLevel) && Number.isFinite(requesterLevel) && targetLevel > requesterLevel) {
        return res.status(403).json({ message: 'You cannot assign a role higher than your own.' });
    }
    // Only meaningful on routes carrying an :id (the /access endpoints); creation
    // has no target id, and there self-escalation is already covered by rule 2.
    if (req.params.id && Number(req.params.id) === Number(req.user?.employee_id)) {
        return res.status(403).json({ message: 'You cannot change your own role.' });
    }
    next();
};
const { parsePaginationQuery, paginatedResponse } = require('../helpers/pagination');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const router = express.Router();

// Work-roster projection. Assumes `employee e` LEFT JOINed to `department d`.
// `has_system_access` is derived rather than stored: an employee has a login
// exactly when they have a username.
//
// `employees:view` is held broadly (Cashier and Secretary included), so this
// must stay limited to what a colleague directory legitimately shows — no home
// address, birth date, or next-of-kin details.
const EMPLOYEE_LIST_FIELDS = `
    e.employee_id, e.employee_code, e.first_name, e.middle_name, e.last_name, e.suffix,
    e.position_title, e.permission_level_id, e.username, e.is_active,
    e.department_id, d.department_name,
    e.employment_type, e.employment_status,
    TO_CHAR(e.date_hired, 'YYYY-MM-DD') AS date_hired,
    (e.username IS NOT NULL) AS has_system_access
`;

// Org/employment detail — safe for anyone who can already see the roster.
const EMPLOYEE_EMPLOYMENT_FIELDS = `
    e.manager_employee_id, e.is_payroll_eligible,
    e.work_schedule_id,
    NULLIF(TRIM(CONCAT_WS(' ', m.first_name, m.last_name)), '') AS manager_name,
    TO_CHAR(e.date_regularized, 'YYYY-MM-DD') AS date_regularized,
    TO_CHAR(e.date_separated, 'YYYY-MM-DD') AS date_separated,
    e.separation_reason
`;

// Personal, contact and emergency data. This is RA 10173 personal information,
// so it is appended to the detail projection only for callers holding hr:view —
// never for everyone carrying the much broader employees:view.
const EMPLOYEE_PERSONAL_FIELDS = `
    e.gender, e.civil_status, e.photo_url,
    e.mobile_no, e.personal_email,
    e.address_line, e.barangay, e.city, e.province, e.postal_code,
    e.emergency_contact_name, e.emergency_contact_relation, e.emergency_contact_phone,
    -- DATE columns must go through TO_CHAR. Handed back raw, the driver renders
    -- them as JS Dates in Asia/Manila, shifting each one a day earlier.
    TO_CHAR(e.birth_date, 'YYYY-MM-DD') AS birth_date
`;

// HR profile columns a caller may set. Deliberately excludes username,
// password_hash, password_salt and permission_level_id: credentials are only
// ever written by the /access endpoints, so an HR profile edit can never
// rewrite or clear someone's login.
const EMPLOYEE_PROFILE_COLUMNS = [
    'first_name', 'middle_name', 'last_name', 'suffix', 'position_title',
    'birth_date', 'gender', 'civil_status', 'photo_url',
    'mobile_no', 'personal_email', 'address_line', 'barangay', 'city', 'province', 'postal_code',
    'emergency_contact_name', 'emergency_contact_relation', 'emergency_contact_phone',
    'department_id', 'manager_employee_id', 'employment_type', 'employment_status',
    'date_hired', 'date_regularized', 'date_separated', 'separation_reason',
    'is_payroll_eligible', 'is_active',
    // Which weekly pattern (and therefore which rest days) DTR generation uses
    // for this employee. Assignable here so a person on a different rest day
    // does not need a database edit.
    'work_schedule_id',
];

// Narrows a request body to the writable profile columns it actually mentions,
// normalising empty strings to NULL so blank form fields clear rather than
// storing ''. Returns a plain { column: value } map.
const pickProfileFields = (body) => {
    const out = {};
    for (const col of EMPLOYEE_PROFILE_COLUMNS) {
        if (body[col] === undefined) continue;
        const value = body[col];
        out[col] = (typeof value === 'string' && value.trim() === '') ? null : value;
    }
    return out;
};

// Builds the single-employee projection for a given caller. The personal block
// is included only when they hold hr:view, so a Cashier with employees:view
// sees a roster entry while HR sees the full record.
const buildDetailFields = (user) => {
    const canSeePersonal = Number(user?.permission_level_id) === 10
        || (user?.permissions || []).includes('hr:view');
    return `
        ${EMPLOYEE_LIST_FIELDS},
        ${EMPLOYEE_EMPLOYMENT_FIELDS}
        ${canSeePersonal ? `, ${EMPLOYEE_PERSONAL_FIELDS}` : ''}
    `;
};

// Helper to generate a token
const generateToken = (user) => {
    return jwt.sign({
        employee_id: user.employee_id,
        username: user.username,
        permission_level_id: user.permission_level_id
    }, process.env.JWT_SECRET, {
        expiresIn: '1d',
    });
};

// POST /login - User Authentication (Public)
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }
    try {
        const userQuery = await db.query('SELECT * FROM employee WHERE username = $1 AND is_active = TRUE', [username]);
        if (userQuery.rows.length === 0) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        const user = userQuery.rows[0];
        // Payroll-only staff have no credentials at all. bcrypt.compare throws on a
        // null hash, so reject before we get there — and reject with the same generic
        // message, so the response never reveals who exists as a login-less employee.
        if (!user.password_hash) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Fetch user permissions
        const permissionsRes = await db.query(
            `SELECT p.permission_key 
             FROM permission p
             JOIN role_permission rp ON p.permission_id = rp.permission_id
             WHERE rp.permission_level_id = $1`,
            [user.permission_level_id]
        );
        const permissions = permissionsRes.rows.map(p => p.permission_key);

    const { password_hash: _password_hash, password_salt: _password_salt, ...user_data } = user;
    
        res.json({ 
            message: 'Login successful', 
            token: generateToken(user), 
            user: { ...user_data, permissions }
        });
    } catch (error) {
        console.error('Login error', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// PUT /profile - Update current user's profile (username, password)
router.put('/profile', protect, async (req, res) => {
    const { username, password } = req.body;
    const employeeId = req.user.employee_id;

    if (!username) {
        return res.status(400).json({ message: 'Username is required' });
    }

    try {
        let updatedEmployee;
        if (password) {
            const salt = await bcrypt.genSalt(10);
            const password_hash = await bcrypt.hash(password, salt);
            updatedEmployee = await db.query(
                `UPDATE employee SET username = $1, password_hash = $2, password_salt = $3 WHERE employee_id = $4 RETURNING employee_id, username, first_name, last_name`,
                [username, password_hash, salt, employeeId]
            );
        } else {
            updatedEmployee = await db.query(
                `UPDATE employee SET username = $1 WHERE employee_id = $2 RETURNING employee_id, username, first_name, last_name`,
                [username, employeeId]
            );
        }

        if (updatedEmployee.rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json(updatedEmployee.rows[0]);
    } catch (error) {
        console.error('Update profile error', error);
        res.status(500).json({ message: 'Server error updating profile' });
    }
});

// --- SECURED ADMIN ROUTES ---

// GET /employees - list employees with status filter
router.get('/employees', protect, hasPermission('employees:view'), async (req, res) => {
    const { status = 'active', search, sortBy, sortOrder = 'ASC', department, employment_status } = req.query;
    const { paginated, page, pageSize, offset, limit } = parsePaginationQuery(req.query);

    let whereConditions = [];
    let queryParams = [];
    let paramIdx = 1;

    if (status === 'active') {
        whereConditions.push('e.is_active = TRUE');
    } else if (status === 'inactive') {
        whereConditions.push('e.is_active = FALSE');
    }

    if (department) {
        whereConditions.push(`e.department_id = $${paramIdx}`);
        queryParams.push(Number(department));
        paramIdx++;
    }

    if (employment_status) {
        whereConditions.push(`e.employment_status = $${paramIdx}`);
        queryParams.push(employment_status);
        paramIdx++;
    }

    if (search && search.trim()) {
        whereConditions.push(`(
            LOWER(COALESCE(e.first_name, '')) LIKE $${paramIdx} OR
            LOWER(COALESCE(e.last_name, '')) LIKE $${paramIdx} OR
            LOWER(COALESCE(e.username, '')) LIKE $${paramIdx} OR
            LOWER(COALESCE(e.employee_code, '')) LIKE $${paramIdx} OR
            LOWER(COALESCE(e.position_title, '')) LIKE $${paramIdx}
        )`);
        queryParams.push(`%${search.trim().toLowerCase()}%`);
        paramIdx++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const dir = sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    let orderBy = `ORDER BY e.last_name ${dir}, e.first_name ${dir}`;
    if (sortBy === 'full_name') {
        orderBy = `ORDER BY e.first_name ${dir}, e.last_name ${dir}`;
    } else if (sortBy === 'username') {
        orderBy = `ORDER BY e.username ${dir} NULLS LAST`;
    } else if (sortBy === 'position_title') {
        orderBy = `ORDER BY e.position_title ${dir} NULLS LAST`;
    } else if (sortBy === 'employee_code') {
        orderBy = `ORDER BY e.employee_code ${dir} NULLS LAST`;
    } else if (sortBy === 'department_name') {
        orderBy = `ORDER BY d.department_name ${dir} NULLS LAST`;
    } else if (sortBy === 'employment_status') {
        orderBy = `ORDER BY e.employment_status ${dir}`;
    } else if (sortBy === 'date_hired') {
        orderBy = `ORDER BY e.date_hired ${dir} NULLS LAST`;
    } else if (sortBy === 'status') {
        orderBy = `ORDER BY e.is_active ${dir}`;
    }

    const fromClause = `
        FROM employee e
        LEFT JOIN department d ON e.department_id = d.department_id
    `;

    try {
        const baseQuery = `
            SELECT ${EMPLOYEE_LIST_FIELDS}
            ${fromClause}
            ${whereClause}
            ${orderBy}
        `;
        if (!paginated) {
            const { rows } = await db.query(baseQuery, queryParams);
            return res.json(rows);
        }

        const countQuery = `SELECT COUNT(*)::int AS total ${fromClause} ${whereClause}`;
        const countRes = await db.query(countQuery, queryParams);
        const total = countRes.rows[0]?.total || 0;
        const mainParams = [...queryParams, limit, offset];
        const query = `${baseQuery} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
        const { rows } = await db.query(query, mainParams);
        res.json(paginatedResponse({ data: rows, page, pageSize, total }));
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET /employees/:id - get one employee (full HR profile, no government IDs)
router.get('/employees/:id', protect, hasPermission('employees:view'), async (req, res) => {
    const { id } = req.params;
    try {
        const { rows } = await db.query(
            `SELECT ${buildDetailFields(req.user)}
             FROM employee e
             LEFT JOIN department d ON e.department_id = d.department_id
             LEFT JOIN employee m ON e.manager_employee_id = m.employee_id
             WHERE e.employee_id = $1`,
            [id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Employee not found' });
        }
        res.json(rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// POST /employees - create employee, with or without system access.
// `has_system_access: false` (or omitting username/password entirely) creates a
// payroll-only record: no username, no password, no role.
router.post('/employees', protect, hasPermission('employees:edit'), blockNonAdminGrantingAdmin, async (req, res) => {
    const { first_name, last_name, username, password, permission_level_id } = req.body;

    // Default to the legacy behaviour (a login is created) only when credentials
    // were actually supplied, so existing callers keep working unchanged.
    const wantsLogin = req.body.has_system_access !== undefined
        ? Boolean(req.body.has_system_access)
        : Boolean(username || password);

    if (!first_name || !last_name) {
        return res.status(400).json({ message: 'First name and last name are required' });
    }
    if (wantsLogin && (!username || !password || !permission_level_id)) {
        return res.status(400).json({ message: 'Username, password and role are required to grant system access' });
    }

    try {
        let password_hash = null;
        let salt = null;
        if (wantsLogin) {
            salt = await bcrypt.genSalt(10);
            password_hash = await bcrypt.hash(password, salt);
        }

        const employee_code = await getNextDocumentNumber(db, 'EMP');
        const cols = { ...pickProfileFields(req.body), employee_code, first_name, last_name };
        // All four credential columns move together — the employee_login_complete_chk
        // constraint rejects any half-provisioned combination.
        cols.username = wantsLogin ? username : null;
        cols.password_hash = password_hash;
        cols.password_salt = salt;
        cols.permission_level_id = wantsLogin ? permission_level_id : null;

        const names = Object.keys(cols);
        const placeholders = names.map((_, i) => `$${i + 1}`);
        const newEmployee = await db.query(
            `INSERT INTO employee (${names.join(', ')}) VALUES (${placeholders.join(', ')})
             RETURNING employee_id, employee_code, username, first_name, last_name,
                       (username IS NOT NULL) AS has_system_access`,
            names.map((n) => cols[n])
        );
        res.status(201).json(newEmployee.rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ message: 'Username already exists.' });
        }
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Blocks a non-admin from touching an existing Admin's account. Editing an
// admin (password reset, demotion) is the same escalation risk as granting
// Admin outright, so both paths need the check.
const blockNonAdminEditingAdmin = async (req, res, next) => {
    try {
        if (Number(req.user?.permission_level_id) === 10) return next();
        
        const ids = req.body.employee_ids;
        if (ids && Array.isArray(ids) && ids.length > 0) {
            const targets = await db.query('SELECT employee_id FROM employee WHERE employee_id = ANY($1) AND permission_level_id = 10', [ids]);
            if (targets.rows.length > 0) {
                return res.status(403).json({ message: 'Only an admin can modify another admin\'s account.' });
            }
        }
        
        if (req.params.id) {
            const target = await db.query('SELECT permission_level_id FROM employee WHERE employee_id = $1', [req.params.id]);
            if (target.rows[0] && Number(target.rows[0].permission_level_id) === 10) {
                return res.status(403).json({ message: 'Only an admin can modify another admin\'s account.' });
            }
        }
        
        next();
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// PUT /employees/bulk - update multiple HR profiles at once.
router.put('/employees/bulk', protect, hasPermission(['employees:edit', 'hr:manage_employees']), blockNonAdminEditingAdmin, async (req, res) => {
    const { employee_ids } = req.body;
    if (!employee_ids || !Array.isArray(employee_ids) || employee_ids.length === 0) {
        return res.status(400).json({ message: 'No employees selected for bulk edit' });
    }

    const fields = pickProfileFields(req.body);
    // Don't allow clearing names or personal specifics in bulk
    delete fields.first_name;
    delete fields.last_name;
    delete fields.middle_name;
    delete fields.suffix;
    delete fields.mobile_no;
    delete fields.personal_email;
    delete fields.emergency_contact_name;
    delete fields.emergency_contact_phone;

    if (Object.keys(fields).length === 0) {
        return res.status(400).json({ message: 'No updatable fields were provided' });
    }

    try {
        const names = Object.keys(fields);
        const assignments = names.map((n, i) => `${n} = $${i + 1}`);
        const params = names.map((n) => fields[n]);
        params.push(employee_ids);

        const updatedEmployees = await db.query(
            `UPDATE employee SET ${assignments.join(', ')}
             WHERE employee_id = ANY($${params.length})
             RETURNING employee_id`,
            params
        );

        res.json({ updated: updatedEmployees.rowCount });
    } catch (err) {
        if (err.code === '23514') {
            return res.status(400).json({ message: 'Invalid employment type or status.' });
        }
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// PUT /employees/:id - update the HR profile only.
// Credentials and role are NOT settable here; use the /access endpoints below.
router.put('/employees/:id', protect, hasPermission(['employees:edit', 'hr:manage_employees']), blockNonAdminEditingAdmin, async (req, res) => {
    const { id } = req.params;
    const fields = pickProfileFields(req.body);

    if (fields.first_name === null || fields.last_name === null) {
        return res.status(400).json({ message: 'First name and last name cannot be blank' });
    }
    if (Object.keys(fields).length === 0) {
        return res.status(400).json({ message: 'No updatable fields were provided' });
    }

    try {
        const names = Object.keys(fields);
        const assignments = names.map((n, i) => `${n} = $${i + 1}`);
        const params = names.map((n) => fields[n]);
        params.push(id);

        const updatedEmployee = await db.query(
            `UPDATE employee SET ${assignments.join(', ')}
             WHERE employee_id = $${params.length}
             RETURNING employee_id, employee_code, username, first_name, last_name,
                       (username IS NOT NULL) AS has_system_access`,
            params
        );

        if (updatedEmployee.rows.length === 0) {
            return res.status(404).json({ message: 'Employee not found' });
        }
        res.json(updatedEmployee.rows[0]);
    } catch (err) {
        if (err.code === '23514') {
            return res.status(400).json({ message: 'Invalid employment type or status.' });
        }
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// PUT /employees/:id/access - grant or update system access (username, password, role).
// This is the only route that writes credential columns, so the escalation
// guards live here and nowhere else.
router.put('/employees/:id/access', protect, hasPermission('employees:edit'), blockNonAdminGrantingAdmin, blockNonAdminEditingAdmin, async (req, res) => {
    const { id } = req.params;
    const { username, password, permission_level_id } = req.body;

    if (!username || !permission_level_id) {
        return res.status(400).json({ message: 'Username and role are required' });
    }

    try {
        const existing = await db.query('SELECT username FROM employee WHERE employee_id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ message: 'Employee not found' });
        }
        // Granting access to a payroll-only employee must set a password: there is
        // no existing hash to keep, and the all-or-nothing CHECK would reject it.
        const isGrantingNewAccess = existing.rows[0].username === null;
        if (isGrantingNewAccess && !password) {
            return res.status(400).json({ message: 'A password is required when granting system access' });
        }

        let query;
        let params;
        if (password) {
            const salt = await bcrypt.genSalt(10);
            const password_hash = await bcrypt.hash(password, salt);
            query = `UPDATE employee SET username = $1, permission_level_id = $2, password_hash = $3, password_salt = $4
                     WHERE employee_id = $5 RETURNING employee_id, username, permission_level_id`;
            params = [username, permission_level_id, password_hash, salt, id];
        } else {
            query = `UPDATE employee SET username = $1, permission_level_id = $2
                     WHERE employee_id = $3 RETURNING employee_id, username, permission_level_id`;
            params = [username, permission_level_id, id];
        }

        const { rows } = await db.query(query, params);
        res.json({ ...rows[0], has_system_access: true });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ message: 'Username already exists.' });
        }
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// DELETE /employees/:id/access - revoke system access, keeping the HR record.
// Admin-only: this is how an employee becomes payroll-only.
router.delete('/employees/:id/access', protect, isAdmin, async (req, res) => {
    const { id } = req.params;
    if (Number(id) === Number(req.user.employee_id)) {
        return res.status(400).json({ message: 'You cannot revoke your own system access.' });
    }
    try {
        // All four credential columns are cleared together to satisfy
        // employee_login_complete_chk.
        const { rows } = await db.query(
            `UPDATE employee
             SET username = NULL, password_hash = NULL, password_salt = NULL, permission_level_id = NULL
             WHERE employee_id = $1
             RETURNING employee_id, first_name, last_name, false AS has_system_access`,
            [id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Employee not found' });
        }
        res.json(rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
