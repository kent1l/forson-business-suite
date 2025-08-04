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

// PUT - Update an existing application
router.put('/applications/:id', async (req, res) => {
    const { id } = req.params;
    const { make, model, engine } = req.body;

    if (!make || !model) {
        return res.status(400).json({ message: 'Make and Model are required' });
    }

    try {
        const updatedApp = await db.query(
            'UPDATE application SET make = $1, model = $2, engine = $3 WHERE application_id = $4 RETURNING *',
            [make, model, engine, id]
        );

        if (updatedApp.rows.length === 0) {
            return res.status(404).json({ message: 'Application not found' });
        }

        res.json(updatedApp.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// DELETE - Delete an application
router.delete('/applications/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const deleteOp = await db.query('DELETE FROM application WHERE application_id = $1 RETURNING *', [id]);
        if (deleteOp.rowCount === 0) {
            return res.status(404).json({ message: 'Application not found' });
        }
        res.json({ message: 'Application deleted successfully' });
    } catch (err) {
        // Handle foreign key violation error
        if (err.code === '23503') {
            return res.status(400).json({ message: 'Cannot delete this application because it is linked to one or more parts.' });
        }
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
