require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');

// Import Routes
const supplierRoutes = require('./routes/supplierRoutes');
const partRoutes = require('./routes/partRoutes');
const employeeRoutes = require('./routes/employeeRoutes');
const brandRoutes = require('./routes/brandRoutes');
const groupRoutes = require('./routes/groupRoutes');
const goodsReceiptRoutes = require('./routes/goodsReceiptRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const customerRoutes = require('./routes/customerRoutes'); // 1. Import

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- API Routes ---
app.use('/api', supplierRoutes);
app.use('/api', partRoutes);
app.use('/api', employeeRoutes);
app.use('/api', brandRoutes);
app.use('/api', groupRoutes);
app.use('/api', goodsReceiptRoutes);
app.use('/api', invoiceRoutes);
app.use('/api', customerRoutes); // 2. Use

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
