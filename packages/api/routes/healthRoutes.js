const express = require('express');
const { meiliClient } = require('../meilisearch');
const router = express.Router();

/**
 * General health check endpoint
 */
router.get('/health', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'production',
      version: process.env.npm_package_version || 'unknown'
    };

    res.json(health);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * Detailed health check including external services
 */
router.get('/health/detailed', async (req, res) => {
  const checks = {
    api: { status: 'healthy', timestamp: new Date().toISOString() },
    meilisearch: { status: 'unknown', timestamp: new Date().toISOString() },
    database: { status: 'unknown', timestamp: new Date().toISOString() }
  };

  // Check Meilisearch
  try {
    const meiliHealth = await meiliClient.health();
    checks.meilisearch = {
      status: meiliHealth.status || 'healthy',
      timestamp: new Date().toISOString(),
      details: meiliHealth
    };
  } catch (error) {
    checks.meilisearch = {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message,
      code: error.code || 'UNKNOWN'
    };
  }

  // Check Database (basic connection test)
  try {
    const db = require('../db');
    await db.query('SELECT 1 as health_check');
    checks.database = {
      status: 'healthy',
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    checks.database = {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    };
  }

  // Determine overall status
  const hasUnhealthy = Object.values(checks).some(check => check.status === 'unhealthy');
  const overallStatus = hasUnhealthy ? 'degraded' : 'healthy';
  const statusCode = hasUnhealthy ? 503 : 200;

  res.status(statusCode).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    checks
  });
});

/**
 * Meilisearch-specific health check
 */
router.get('/health/meilisearch', async (req, res) => {
  try {
    const health = await meiliClient.health();
    const stats = await meiliClient.getStats();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      health,
      stats: {
        databaseSize: stats.databaseSize,
        lastUpdate: stats.lastUpdate,
        indexes: Object.keys(stats.indexes || {}).length
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message,
      code: error.code || 'UNKNOWN'
    });
  }
});

/**
 * Trigger Meilisearch reconfiguration
 */
router.post('/health/meilisearch/reconfigure', async (req, res) => {
  try {
    const { setupMeiliSearch } = require('../meilisearch-setup');
    const result = await setupMeiliSearch();
    
    res.json({
      timestamp: new Date().toISOString(),
      result
    });
  } catch (error) {
    res.status(500).json({
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

module.exports = router;