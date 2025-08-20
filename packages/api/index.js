const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const db = require('./db');
const { setupMeiliSearch } = require('./meilisearch-setup');

const app = express();

app.use(cors());
app.use(express.json());

// --- Register all API routes ---

// Core Modules
app.use('/api', require('./routes/partRoutes'));
app.use('/api', require('./routes/inventoryRoutes'));
app.use('/api', require('./routes/purchaseOrderRoutes'));
app.use('/api', require('./routes/goodsReceiptRoutes'));

// Sales & Customer Modules
app.use('/api', require('./routes/customerRoutes'));
app.use('/api', require('./routes/invoiceRoutes'));
app.use('/api', require('./routes/paymentRoutes'));
app.use('/api', require('./routes/draftRoutes'));
app.use('/api', require('./routes/refundRoutes')); // <-- Add new refund route

// Entity & Data Management Modules
app.use('/api', require('./routes/supplierRoutes'));
app.use('/api', require('./routes/applicationRoutes'));
app.use('/api', require('./routes/partNumberRoutes'));
app.use('/api', require('./routes/partApplicationRoutes'));
app.use('/api', require('./routes/brandRoutes'));
app.use('/api', require('./routes/groupRoutes'));
app.use('/api', require('./routes/tagRoutes'));
app.use('/api', require('./routes/taxRateRoutes'));

// Admin & System Modules
app.use('/api', require('./routes/employeeRoutes'));
app.use('/api', require('./routes/permissionRoutes'));
app.use('/api', require('./routes/dashboardRoutes'));
app.use('/api', require('./routes/powerSearchRoutes'));
app.use('/api', require('./routes/reportingRoutes'));
app.use('/api', require('./routes/settingsRoutes'));
app.use('/api/data', require('./routes/dataUtilsRoutes'));
app.use('/api/backups', require('./routes/backupRoutes'));

// Special Setup Route
app.use('/api', require('./routes/setupRoutes'));


const PORT = process.env.PORT || 3001;

// Make the listen function async and call the setup function
app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
  await setupMeiliSearch();
});