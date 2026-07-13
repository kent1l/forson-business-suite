const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'your_secret_password_here',
  database: 'forson_business_suite',
});

async function main() {
  const invoiceLineCols = await pool.query(`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'invoice_line'
  `);
  console.log('Invoice_line columns:', invoiceLineCols.rows.map(r => `${r.column_name} (${r.data_type}, nullable=${r.is_nullable})`));
  await pool.end();
}
main().catch(console.error);
