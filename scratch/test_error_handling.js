const jwt = require('jsonwebtoken');
const http = require('http');

const JWT_SECRET = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiYWRtaW4iOnRydWUsImlhdCI6MTUxNjIzOTAyMn0.KMUFsIDTnFmyG3nMiGM6H9FNFUROf3wh7SmqJp-QV30';

const payload = {
    employee_id: 1,
    permission_level_id: 10,
    username: 'kent.pilar'
};

const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });

const options = {
    hostname: 'localhost',
    port: 3001,
    path: '/api/inventory/cycle-count/lines/00000000-0000-0000-0000-000000000000/approve',
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    }
};

const req = http.request(options, res => {
    console.log(`Response Status: ${res.statusCode}`);
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        console.log(`Response Body: ${data}`);
        process.exit(0);
    });
});

req.on('error', error => {
    console.error('Request failed:', error);
    process.exit(1);
});

req.end();
