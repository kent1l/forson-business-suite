require('dotenv').config();
const express = require('express');
const supplierRoutes = require('./routes/supplierRoutes');
const partRoutes = require('./routes/partRoutes'); // Import the new routes

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware to parse JSON bodies
app.use(express.json());

// API Routes
app.use('/api', supplierRoutes);
app.use('/api', partRoutes); // Use the new routes

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
