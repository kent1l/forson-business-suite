const axios = require('axios');
const jwt = require('jsonwebtoken');

// Load JWT secret from environment
require('dotenv').config({ path: '.env' });

// Generate a test JWT token for testing
const testUser = {
  employee_id: 1,
  username: 'kent.pilar',
  permission_level_id: 10
};

// Use the actual JWT secret from the container (Docker environment substitution removes one $)
const JWT_SECRET = 't0X^&*tX%3S@Gg*F$w3@S8K7eYYD0quF7E^83zT^Hb07$&3*T6eRmS434XwSGGyZ';

const token = jwt.sign({
  employee_id: testUser.employee_id,
  username: testUser.username,
  permission_level_id: testUser.permission_level_id
}, JWT_SECRET, {
  expiresIn: '1d'
});

console.log('Test JWT token generated for user:', testUser.username);

const api = axios.create({
  baseURL: 'http://localhost:3001/api',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  }
});

async function testTaxRates() {
  try {
    // Test whoami first
    console.log('Testing GET /_debug/whoami...');
    const whoamiResponse = await api.get('/_debug/whoami');
    console.log('Whoami response:', JSON.stringify(whoamiResponse.data, null, 2));

    // Test GET tax rates
    console.log('\nTesting GET /tax-rates...');
    const getResponse = await api.get('/tax-rates');
    console.log('GET /tax-rates success:', getResponse.data);

    // Test POST tax rate
    console.log('\nTesting POST /tax-rates...');
    const postResponse = await api.post('/tax-rates', {
      rate_name: 'Test Tax Rate ' + Date.now(),
      rate_percentage: 0.12
    });
    console.log('POST /tax-rates success:', postResponse.data);

  } catch (error) {
    console.error('API test error:');
    console.error('Status:', error.response?.status);
    console.error('Data:', JSON.stringify(error.response?.data, null, 2));
    console.error('Message:', error.message);
    if (error.response?.headers) {
      console.error('Response headers:', error.response.headers);
    }
  }
}

testTaxRates();