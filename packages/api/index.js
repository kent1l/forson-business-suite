const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const db = require('./db');
const { setupMeiliSearch } = require('./meilisearch-setup');
const { startMeiliListener } = require('./meili-listener');
const { startMeiliApplicationsListener } = require('./meili-app-listener');

// Set default timezone to Philippine Time
process.env.TZ = 'Asia/Manila';

const app = express();

app.use(cors());
app.use(express.json());

// --- Register all API routes ---
// --- Register all API routes ---

// Helper to safely require and register routers
function registerRoute(routePrefix, modulePath) {
  try {
    const mod = require(modulePath);

    if (mod && mod.router) {
      app.use(routePrefix, mod.router);
    } else if (mod && mod.default) {
      app.use(routePrefix, mod.default);
    } else {
      app.use(routePrefix, mod);
    }
  } catch (err) {
    // Log registration failures; keep server running so other routes can mount
    console.error(`Failed to register ${modulePath} on ${routePrefix}:`, err && err.stack ? err.stack : err);
  }
}

// Core Modules
registerRoute('/api', './routes/partRoutes');
registerRoute('/api', './routes/partMergeRoutes');
registerRoute('/api', './routes/inventoryRoutes');
registerRoute('/api', './routes/purchaseOrderRoutes');
registerRoute('/api', './routes/goodsReceiptRoutes');

// Sales & Customer Modules
registerRoute('/api', './routes/customerRoutes');
registerRoute('/api', './routes/invoiceRoutes');
registerRoute('/api', './routes/paymentRoutes');
registerRoute('/api', './routes/draftRoutes');
registerRoute('/api', './routes/refundRoutes');
registerRoute('/api', './routes/paymentTermRoutes');

// Documents module (Document Management Interface)
registerRoute('/api', './routes/documentsRoutes');

// Entity & Data Management Modules
registerRoute('/api', './routes/supplierRoutes');
registerRoute('/api', './routes/applicationRoutes');
registerRoute('/api', './routes/partNumberRoutes');
registerRoute('/api', './routes/partApplicationRoutes');
registerRoute('/api', './routes/brandRoutes');
registerRoute('/api', './routes/groupRoutes');
registerRoute('/api', './routes/tagRoutes');
registerRoute('/api', './routes/taxRateRoutes');

// Admin & System Modules
registerRoute('/api', './routes/employeeRoutes');
registerRoute('/api', './routes/permissionRoutes');
registerRoute('/api', './routes/dashboardRoutes');
registerRoute('/api', './routes/powerSearchRoutes');
registerRoute('/api', './routes/applicationSearchRoutes');
registerRoute('/api', './routes/reportingRoutes');
registerRoute('/api', './routes/settingsRoutes');
registerRoute('/api/data', './routes/dataUtilsRoutes');
registerRoute('/api/backups', './routes/backupRoutes');

// Special Setup Route
registerRoute('/api', './routes/setupRoutes');

// Lightweight health endpoint for uptime checks
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Basic 404 handler for unknown routes
app.use((req, res) => res.status(404).json({ error: 'Not Found' }));

// Minimal global error handler
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err && err.stack ? err.stack : err);
  const status = err && err.status ? err.status : 500;
  const payload = { error: err && err.message ? err.message : 'Server Error' };
  if (process.env.NODE_ENV !== 'production') payload.stack = err && err.stack ? err.stack : null;
  res.status(status).json(payload);
});

process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err && err.stack ? err.stack : err));
process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason && reason.stack ? reason.stack : reason));


const PORT = process.env.PORT || 3001;

// Make the listen function async and call the setup function
app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
  await setupMeiliSearch();
  // Start the Postgres listener that keeps Meilisearch in sync
  startMeiliListener();
  startMeiliApplicationsListener();
});