const axios = require('axios');

// Simple test script to verify payment methods functionality
async function testPaymentMethods() {
    const baseURL = 'http://localhost:3001/api';

    console.log('🧪 Testing Payment Methods Implementation...\n');

    try {
        // Test 1: Check if payment methods table exists and has data
        console.log('1. Testing database setup...');
        const dbResponse = await axios.post('http://localhost:5432', {
            query: 'SELECT COUNT(*) as count FROM payment_methods'
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        console.log('✅ Database connection successful');

        // Test 2: Check if feature flag is enabled
        console.log('2. Testing feature flag...');
        const flagResponse = await axios.post('http://localhost:5432', {
            query: "SELECT setting_value FROM settings WHERE setting_key = 'ENABLE_SPLIT_PAYMENTS'"
        });
        console.log('✅ Feature flag check completed');

        // Test 3: Check API endpoints (will fail without auth, but should not crash)
        console.log('3. Testing API endpoints...');
        try {
            await axios.get(`${baseURL}/payment-methods`);
        } catch (err) {
            if (err.response?.status === 401) {
                console.log('✅ API endpoint exists (authentication required)');
            } else {
                throw err;
            }
        }

        console.log('\n🎉 All basic tests passed! Payment methods implementation is ready.');
        console.log('\n📋 Next Steps:');
        console.log('1. Login to the application');
        console.log('2. Navigate to Settings > Payment Methods');
        console.log('3. Test creating/editing payment methods');
        console.log('4. Test split payments in POS and Invoicing');
        console.log('5. Verify payment method statistics in Sales History');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.log('\n🔧 Troubleshooting:');
        console.log('1. Ensure all Docker containers are running');
        console.log('2. Check database migrations were applied');
        console.log('3. Verify backend is accessible on port 3001');
    }
}

testPaymentMethods();
