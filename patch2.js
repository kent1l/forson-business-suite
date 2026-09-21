const fs = require('fs');
let code = fs.readFileSync('packages/api/routes/stagedSaleRoutes.js', 'utf8');
code = code.replace(
  "await client.query('BEGIN');",
  "console.log('--- CALLING BEGIN ---'); await client.query('BEGIN'); console.log('--- CALLING SELECT STAGED ---');"
);
fs.writeFileSync('packages/api/routes/stagedSaleRoutes.js', code);
