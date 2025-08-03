require('dotenv').config();
const express = require('express');
const supplierRoutes = require('./routes/supplierRoutes');

const app = express();
const PORT = process.env.PORT || 3001;

// API Routes
app.use('/api', supplierRoutes);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});