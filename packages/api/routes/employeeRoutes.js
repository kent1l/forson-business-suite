const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { protect, isAdmin } = require('../middleware/authMiddleware'); // 1. Import the middleware
const router = express.Router();

// Helper to generate a token
const generateToken = (user) => {
    return jwt.sign({
        employee_id: user.employee_id,
        username: user.username,
        permission_level_id: user.permission_level_id
    }, process.env.JWT_SECRET, {
        expiresIn: '1d', // Token expires in 1 day
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

    // On success, send back user data and the new token
    const { password_hash, password_salt, ...user_data } = user;
    res.json({ 
        message: 'Login successful', 
        user: user_data,
        token: generateToken(user_data) 
    });

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});


// --- SECURED ADMIN ROUTES ---

// 2. Apply the middleware. Requests must have a valid token AND be from an admin.
router.get('/employees', protect, isAdmin, async (req, res) => {
    try {
        const { rows } = await db.query('SELECT employee_id, employee_code, first_name, last_name, position_title, permission_level_id, username, is_active FROM employee ORDER BY last_name, first_name');
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

router.get('/employees/:id', protect, isAdmin, async (req, res) => {
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

router.post('/employees', protect, isAdmin, async (req, res) => {
  const { first_name, last_name, username, password, permission_level_id, position_title } = req.body;
  if (!username || !password || !first_name || !last_name || !permission_level_id) {
    return res.status(400).json({ message: 'All required fields must be filled' });
  }
  try {
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);
    const newEmployee = await db.query(
      'INSERT INTO employee (first_name, last_name, username, password_hash, password_salt, permission_level_id, position_title) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING employee_id, username, first_name, last_name',
      [first_name, last_name, username, password_hash, salt, permission_level_id, position_title]
    );
    res.status(201).json(newEmployee.rows[0]);
  } catch (err) {
    if (err.code === '23505') { // Unique constraint violation
        return res.status(409).json({ message: 'Username already exists.' });
    }
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

router.put('/employees/:id', protect, isAdmin, async (req, res) => {
    const { id } = req.params;
    const { first_name, last_name, username, permission_level_id, position_title, is_active } = req.body;

    if (!username || !first_name || !last_name || !permission_level_id) {
        return res.status(400).json({ message: 'All required fields must be filled' });
    }

    try {
        const updatedEmployee = await db.query(
            `UPDATE employee SET 
                first_name = $1, last_name = $2, username = $3, permission_level_id = $4, 
                position_title = $5, is_active = $6 
            WHERE employee_id = $7 RETURNING employee_id, username, first_name, last_name`,
            [first_name, last_name, username, permission_level_id, position_title, is_active, id]
        );
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
