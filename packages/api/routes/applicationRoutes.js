const express = require('express');
const db = require('../db');
const router = express.Router();

// GET all vehicle applications
router.get('/applications', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM application ORDER BY make, model, engine');
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// POST a new vehicle application
router.post('/applications', async (req, res) => {
    const { make, model, engine } = req.body;
    if (!make || !model) {
        return res.status(400).json({ message: 'Make and Model are required.' });
    }
    try {
        const newApp = await db.query(
            'INSERT INTO application (make, model, engine) VALUES ($1, $2, $3) RETURNING *',
            [make, model, engine]
        );
        res.status(201).json(newApp.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});


module.exports = router;
