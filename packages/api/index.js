require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');

// Import ALL routes
const setupRoutes = require('./routes/setupRoutes');
const taxRateRoutes = require('./routes/taxRateRoutes');
const supplierRoutes = require('./routes/supplierRoutes');
const partRoutes = require('./routes/partRoutes');
const employeeRoutes = require('./routes/employeeRoutes');
const brandRoutes = require('./routes/brandRoutes');
const groupRoutes = require('./routes/groupRoutes');
const goodsReceiptRoutes = require('./routes/goodsReceiptRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const customerRoutes = require('./routes/customerRoutes');
const partNumberRoutes = require('./routes/partNumberRoutes');
const applicationRoutes = require('./routes/applicationRoutes');
const partApplicationRoutes = require('./routes/partApplicationRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const powerSearchRoutes = require('./routes/powerSearchRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');
const reportingRoutes = require('./routes/reportingRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const backupRoutes = require('./routes/backupRoutes');
const dataUtilsRoutes = require('./routes/dataUtilsRoutes'); // NEW: Import data utility routes

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- API Routes ---
app.use('/api', setupRoutes);

app.use('/api', taxRateRoutes);
app.use('/api', powerSearchRoutes);
app.use('/api', dashboardRoutes);
app.use('/api', partNumberRoutes);
app.use('/api', partApplicationRoutes);
app.use('/api', goodsReceiptRoutes);
app.use('/api', invoiceRoutes);
app.use('/api', customerRoutes);
app.use('/api', applicationRoutes);
app.use('/api', brandRoutes);
app.use('/api', groupRoutes);
app.use('/api', supplierRoutes);
app.use('/api', employeeRoutes);
app.use('/api', inventoryRoutes);
app.use('/api', reportingRoutes);
app.use('/api', settingsRoutes);
app.use('/api/backups', backupRoutes);
app.use('/api/data', dataUtilsRoutes); // NEW: Add data utility routes
app.use('/api', partRoutes); 

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
