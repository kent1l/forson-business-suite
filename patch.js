const fs = require('fs');
let code = fs.readFileSync('packages/api/routes/stagedSaleRoutes.js', 'utf8');
code = code.replace(
  "console.error('Error approving staged sale:', err.message);",
  "console.error('Error approving staged sale:', err.stack);"
);
fs.writeFileSync('packages/api/routes/stagedSaleRoutes.js', code);
