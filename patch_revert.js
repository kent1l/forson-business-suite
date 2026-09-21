const fs = require('fs');
let code = fs.readFileSync('packages/api/routes/stagedSaleRoutes.js', 'utf8');
code = code.replace(
  "console.log('--- CALLING BEGIN ---'); await client.query('BEGIN'); console.log('--- CALLING SELECT STAGED ---');",
  "await client.query('BEGIN');"
);
code = code.replace(
  "console.error('Error approving staged sale:', err.stack);",
  "console.error('Error approving staged sale:', err.message);"
);
fs.writeFileSync('packages/api/routes/stagedSaleRoutes.js', code);

let code2 = fs.readFileSync('packages/api/tests/stagedSales.test.js', 'utf8');
code2 = code2.replace(
  "console.log('--- CLIENT QUERY CALLS ---'); console.log(client.query.mock.calls.map(c => c[0].substring(0, 50))); expect(res.status).toBe(200);",
  "expect(res.status).toBe(200);"
);
fs.writeFileSync('packages/api/tests/stagedSales.test.js', code2);
