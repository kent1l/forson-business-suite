const { Pool } = require('pg');
const DuplicateFinder = require('./packages/api/services/duplicateFinder');

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'forson',
  port: process.env.PGPORT || 5432,
});

async function run() {
  const duplicateFinder = new DuplicateFinder(pool);
  try {
    await duplicateFinder.findDuplicateGroups({
        minSimilarity: 0.8,
        limit: 50,
        excludeMerged: true
    });
    console.log("Success");
  } catch (err) {
    console.error("Error:", err);
  } finally {
    pool.end();
  }
}
run();
