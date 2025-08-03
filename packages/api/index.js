require('dotenv').config();
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3001;

app.get('/api', (req, res) => {
  res.json({ message: "Hello from Forson Business Suite API!" });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});