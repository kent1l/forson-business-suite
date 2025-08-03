require('dotenv').config();
const express = require('express');
const cors = require('cors'); // 1. Import the cors package
const supplierRoutes = require('./routes/supplierRoutes');
const partRoutes = require('./routes/partRoutes');
const employeeRoutes = require('./routes/employeeRoutes');

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middleware ---
app.use(cors()); // 2. Use cors middleware to allow cross-origin requests
app.use(express.json()); // Middleware to parse JSON bodies

// --- API Routes ---
app.use('/api', supplierRoutes);
app.use('/api', partRoutes);
app.use('/api', employeeRoutes);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
