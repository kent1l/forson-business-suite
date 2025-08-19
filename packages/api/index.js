const express = require('express');
const cors = require('cors');
require('dotenv').config();
const db = require('./db');
const { setupMeiliSearch } = require('./meilisearch-setup');

const app = express();

app.use(cors());
app.use(express.json());

// --- Register all your API routes ---
app.use('/api', require('./routes/partRoutes'));
app.use('/api', require('./routes/supplierRoutes'));
app.use('/api', require('./routes/customerRoutes'));
app.use('/api', require('./routes/applicationRoutes'));
app.use('/api', require('./routes/partNumberRoutes'));
app.use('/api', require('./routes/partApplicationRoutes'));
app.use('/api', require('./routes/brandRoutes'));
app.use('/api', require('./routes/groupRoutes'));
app.use('/api', require('./routes/inventoryRoutes'));
app.use('/api', require('./routes/invoiceRoutes'));
app.use('/api', require('./routes/goodsReceiptRoutes'));
app.use('/api', require('./routes/powerSearchRoutes'));
app.use('/api', require('./routes/reportingRoutes'));
app.use('/api', require('./routes/settingsRoutes'));
app.use('/api/data', require('./routes/dataUtilsRoutes'));
app.use('/api', require('./routes/setupRoutes'));
app.use('/api', require('./routes/employeeRoutes'));
app.use('/api', require('./routes/permissionRoutes'));
app.use('/api', require('./routes/taxRateRoutes'));
app.use('/api', require('./routes/dashboardRoutes'));
app.use('/api', require('./routes/backupRoutes'));
app.use('/api', require('./routes/purchaseOrderRoutes'));
app.use('/api', require('./routes/draftRoutes'));
app.use('/api', require('./routes/paymentRoutes'));


const PORT = process.env.PORT || 3001;

// Make the listen function async and call the setup function
app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
  await setupMeiliSearch();
});
