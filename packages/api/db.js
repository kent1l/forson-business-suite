const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Add this line for debugging
console.log("Database connection pool configured for:", pool.options);

module.exports = {
  query: (text, params) => pool.query(text, params),
};