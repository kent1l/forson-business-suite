const fs = require('fs');
let code = fs.readFileSync('packages/api/tests/stagedSales.test.js', 'utf8');
code = code.replace(
  "expect(res.status).toBe(200);",
  "console.log('--- CLIENT QUERY CALLS ---'); console.log(client.query.mock.calls.map(c => c[0].substring(0, 50))); expect(res.status).toBe(200);"
);
fs.writeFileSync('packages/api/tests/stagedSales.test.js', code);
