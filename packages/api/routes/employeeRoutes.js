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
    // Find the user by username
    const userQuery = await db.query('SELECT * FROM employee WHERE username = $1 AND is_active = TRUE', [username]);

    if (userQuery.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' }); // Use a generic message
    }

    const user = userQuery.rows[0];

    // Compare the provided password with the stored hash
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // On successful login, send back user info (without password details)
    // In a real app, you would generate and send a JWT here.
    const { password_hash, password_salt, ...user_data } = user;
    res.json({ message: 'Login successful', user: user_data });

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});


// POST /employees - Create a new employee (User Registration)
router.post('/employees', async (req, res) => {
  const { first_name, last_name, username, password, permission_level_id } = req.body;

  if (!username || !password || !first_name || !last_name || !permission_level_id) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  try {
    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const newEmployee = await db.query(
      'INSERT INTO employee (first_name, last_name, username, password_hash, password_salt, permission_level_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING employee_id, username, first_name, last_name',
      [first_name, last_name, username, password_hash, salt, permission_level_id]
    );

    res.status(201).json(newEmployee.rows[0]);
  } catch (err)
{
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

module.exports = router;
