const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  user: 'postgres',
  password: 'your_secret_password_here',
  database: 'forson_business_suite',
  port: 5432,
});

async function run() {
  const result = await pool.query('SELECT part_id, internal_sku, detail, last_sale_price, last_cost FROM part LIMIT 5');
  console.log("Parts:");
  console.log(JSON.stringify(result.rows, null, 2));

  const countResult = await pool.query('SELECT COUNT(*) FROM part');
  console.log("Total parts:", countResult.rows[0].count);

  const inventoryResult = await pool.query('SELECT COUNT(*) FROM inventory_transaction');
  console.log("Total inventory transactions:", inventoryResult.rows[0].count);

  const nonZeroPrice = await pool.query('SELECT COUNT(*) FROM part WHERE last_sale_price > 0');
  console.log("Parts with price > 0:", nonZeroPrice.rows[0].count);

  pool.end();
}

run().catch(console.error);
