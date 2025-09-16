const axios = require('axios');

const API_BASE = 'http://localhost:3001/api';

// Sample credentials - adjust as needed
const testCredentials = {
    username: 'kent.pilar',
    password: 'onelpilar1123'
};

let authToken = null;

const apiRequest = async (endpoint, params = {}) => {
    try {
        const response = await axios.get(`${API_BASE}${endpoint}`, {
            headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {},
            params
        });
        return response.data;
    } catch (error) {
        console.error(`❌ Error calling ${endpoint}:`, error.response?.data?.message || error.message);
        throw error;
    }
};

async function testAREndpointsWithData() {
    console.log('🧪 Testing AR API Endpoints with Data...\n');

    try {
        // 1. Login to get auth token
        console.log('1. Authenticating...');
        const loginResponse = await axios.post(`${API_BASE}/login`, testCredentials);
        authToken = loginResponse.data.token;
        console.log('✅ Authentication successful');

        // 2. Test dashboard stats
        console.log('\n2. Testing /ar/dashboard-stats...');
        const dashboardStats = await apiRequest('/ar/dashboard-stats', {
            startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
            endDate: new Date().toISOString()
        });
        console.log('✅ Dashboard stats:', dashboardStats);

        // 3. Test aging summary
        console.log('\n3. Testing /ar/aging-summary...');
        const agingSummary = await apiRequest('/ar/aging-summary');
        console.log('✅ Aging summary:', agingSummary);

        // 4. Test overdue invoices
        console.log('\n4. Testing /ar/overdue-invoices...');
        const overdueInvoices = await apiRequest('/ar/overdue-invoices', {
            limit: 10,
            offset: 0
        });
        console.log('✅ Overdue invoices count:', overdueInvoices.length);

        // 5. Test trends
        console.log('\n5. Testing /ar/trends...');
        const trends = await apiRequest('/ar/trends');
        console.log('✅ Trends:', trends);

        // 6. Test drill-down (new endpoint)
        console.log('\n6. Testing /ar/drill-down-invoices...');
        const drillDown = await apiRequest('/ar/drill-down-invoices', {
            bucket: 'current',
            limit: 5
        });
        console.log('✅ Drill-down invoices count:', drillDown.length);

        console.log('\n🎉 All AR endpoints working correctly!');

    } catch (error) {
        console.error('\n💥 Test failed:', error.message);
        process.exit(1);
    }
}

// Run the test
testAREndpointsWithData();