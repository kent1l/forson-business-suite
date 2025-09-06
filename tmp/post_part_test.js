const http = require('http');
const data = JSON.stringify({ brand_id: 61, group_id: 6, detail: 'Test part from script', created_by: 1 });

const options = {
  hostname: '127.0.0.1',
  port: 3001,
  path: '/api/parts',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  res.setEncoding('utf8');
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log('BODY:', body);
  });
});

req.on('error', (e) => console.error('Request error', e));
req.write(data);
req.end();
