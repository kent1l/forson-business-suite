const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');

// Only an existing Admin (permission_level_id 10) may grant the Admin role to
// anyone. Without this, any role holding employees:edit could create or edit
// an account and set permission_level_id = 10 to self-escalate.
const blockNonAdminGrantingAdmin = (req, res, next) => {
    const targetLevel = Number(req.body.permission_level_id);
    const requesterLevel = Number(req.user?.permission_level_id);
    if (targetLevel === 10 && requesterLevel !== 10) {
        return res.status(403).json({ message: 'Only an admin can assign the Admin role.' });
    }
    next();
};
const { parsePaginationQuery, paginatedResponse } = require('../helpers/pagination');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const router = express.Router();

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
    const { status = 'active', search, sortBy, sortOrder = 'ASC' } = req.query;
    const { paginated, page, pageSize, offset, limit } = parsePaginationQuery(req.query);

    let whereConditions = [];
    let queryParams = [];
    let paramIdx = 1;

    if (status === 'active') {
        whereConditions.push('is_active = TRUE');
    } else if (status === 'inactive') {
        whereConditions.push('is_active = FALSE');
    }

    if (search && search.trim()) {
        whereConditions.push(`(
            LOWER(COALESCE(first_name, '')) LIKE $${paramIdx} OR
            LOWER(COALESCE(last_name, '')) LIKE $${paramIdx} OR
            LOWER(COALESCE(username, '')) LIKE $${paramIdx} OR
            LOWER(COALESCE(position_title, '')) LIKE $${paramIdx}
        )`);
        queryParams.push(`%${search.trim().toLowerCase()}%`);
        paramIdx++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const dir = sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    let orderBy = `ORDER BY last_name ${dir}, first_name ${dir}`;
    if (sortBy === 'full_name') {
        orderBy = `ORDER BY first_name ${dir}, last_name ${dir}`;
    } else if (sortBy === 'username') {
        orderBy = `ORDER BY username ${dir}`;
    } else if (sortBy === 'position_title') {
        orderBy = `ORDER BY position_title ${dir} NULLS LAST`;
    } else if (sortBy === 'status') {
        orderBy = `ORDER BY is_active ${dir}`;
    }

    try {
        const baseQuery = `
            SELECT employee_id, employee_code, first_name, last_name, position_title, permission_level_id, username, is_active 
            FROM employee 
            ${whereClause} 
            ${orderBy}
        `;
        if (!paginated) {
            const { rows } = await db.query(baseQuery, queryParams);
            return res.json(rows);
        }

        const countQuery = `SELECT COUNT(*)::int AS total FROM employee ${whereClause}`;
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

// GET /employees/:id - get one employee
router.get('/employees/:id', protect, hasPermission('employees:view'), async (req, res) => {
    const { id } = req.params;
    try {
        const { rows } = await db.query('SELECT employee_id, employee_code, first_name, last_name, position_title, permission_level_id, username, is_active FROM employee WHERE employee_id = $1', [id]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Employee not found' });
        }
        res.json(rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// POST /employees - create employee
router.post('/employees', protect, hasPermission('employees:edit'), blockNonAdminGrantingAdmin, async (req, res) => {
    const { first_name, last_name, username, password, permission_level_id, position_title } = req.body;
    if (!username || !password || !first_name || !last_name || !permission_level_id) {
        return res.status(400).json({ message: 'All required fields must be filled' });
    }
    try {
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);
        const employee_code = await getNextDocumentNumber(db, 'EMP');
        const newEmployee = await db.query(
            'INSERT INTO employee (employee_code, first_name, last_name, username, password_hash, password_salt, permission_level_id, position_title) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING employee_id, employee_code, username, first_name, last_name',
            [employee_code, first_name, last_name, username, password_hash, salt, permission_level_id, position_title]
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

// PUT /employees/:id - update employee (optional password change)
router.put('/employees/:id', protect, hasPermission('employees:edit'), blockNonAdminGrantingAdmin, async (req, res) => {
    const { id } = req.params;
    const { first_name, last_name, username, permission_level_id, position_title, is_active, password } = req.body;

    if (!username || !first_name || !last_name || !permission_level_id) {
        return res.status(400).json({ message: 'All required fields must be filled' });
    }

    try {
        // A non-admin editing an existing Admin's account (password reset, demotion, etc.)
        // is just as much an escalation risk as granting Admin outright — block it too.
        if (Number(req.user?.permission_level_id) !== 10) {
            const target = await db.query('SELECT permission_level_id FROM employee WHERE employee_id = $1', [id]);
            if (target.rows[0] && Number(target.rows[0].permission_level_id) === 10) {
                return res.status(403).json({ message: 'Only an admin can modify another admin\'s account.' });
            }
        }

        let updatedEmployee;
        if (password) {
            const salt = await bcrypt.genSalt(10);
            const password_hash = await bcrypt.hash(password, salt);
            updatedEmployee = await db.query(
                `UPDATE employee SET 
                    first_name = $1, last_name = $2, username = $3, permission_level_id = $4, 
                    position_title = $5, is_active = $6, password_hash = $7, password_salt = $8
                WHERE employee_id = $9 RETURNING employee_id, username, first_name, last_name`,
                [first_name, last_name, username, permission_level_id, position_title, is_active, password_hash, salt, id]
            );
        } else {
            updatedEmployee = await db.query(
                `UPDATE employee SET 
                    first_name = $1, last_name = $2, username = $3, permission_level_id = $4, 
                    position_title = $5, is_active = $6 
                WHERE employee_id = $7 RETURNING employee_id, username, first_name, last_name`,
                [first_name, last_name, username, permission_level_id, position_title, is_active, id]
            );
        }

        if (updatedEmployee.rows.length === 0) {
            return res.status(404).json({ message: 'Employee not found' });
        }
        res.json(updatedEmployee.rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ message: 'Username already exists.' });
        }
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
