const db = require('./db');

async function testConnection() {
  try {
    const res = await db.query('SELECT 1');
    console.log('Connection successful:', res.rows);
  } catch (err) {
    console.error('Connection failed:', err.message);
  }
}

testConnection();