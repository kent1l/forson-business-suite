const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const router = express.Router();

// POST /login - User Authentication
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
    const { password_hash, password_salt, ...user_data } = user;
    res.json({ message: 'Login successful', user: user_data });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// GET /employees - Get all employees (non-sensitive data)
router.get('/employees', async (req, res) => {
    try {
        const { rows } = await db.query('SELECT employee_id, employee_code, first_name, last_name, position_title, permission_level_id, username, is_active FROM employee ORDER BY last_name, first_name');
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET /employees/:id - Get a single employee's details
router.get('/employees/:id', async (req, res) => {
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


// POST /employees - Create a new employee
router.post('/employees', async (req, res) => {
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

// PUT /employees/:id - Update an employee
router.put('/employees/:id', async (req, res) => {
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
