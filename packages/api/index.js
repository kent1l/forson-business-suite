require('dotenv').config();
const express = require('express');
const cors = require('cors');
const supplierRoutes = require('./routes/supplierRoutes');
const partRoutes = require('./routes/partRoutes');
const employeeRoutes = require('./routes/employeeRoutes');
const brandRoutes = require('./routes/brandRoutes');
const groupRoutes = require('./routes/groupRoutes');
const goodsReceiptRoutes = require('./routes/goodsReceiptRoutes'); // 1. Import

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middleware ---
// IMPORTANT: We need to get the raw pool from db.js for transactions
const db = require('./db'); 
app.use((req, res, next) => {
    req.db = db;
    next();
});

app.use(cors());
app.use(express.json());

// --- API Routes ---
app.use('/api', supplierRoutes);
app.use('/api', partRoutes);
app.use('/api', employeeRoutes);
app.use('/api', brandRoutes);
app.use('/api', groupRoutes);
app.use('/api', goodsReceiptRoutes); // 2. Use

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
