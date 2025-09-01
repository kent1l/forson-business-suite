const express = require('express');
const request = require('supertest');
const db = require('../db');

describe('Documents API', () => {
  let app;

  beforeAll(async () => {
    // Create a fresh Express app instance for testing
    app = express();
    app.use(express.json());
    app.use('/api', require('../routes/documentsRoutes'));
  });

  afterAll(async () => {
    // Close db pool if needed
    if (db.end) {
      await db.end();
    }
  });

  test('GET /api/documents endpoint exists', async () => {
    const res = await request(app).get('/api/documents');
    // We just test that the endpoint responds (even if with auth error)
    expect(res.status).toBeDefined();
    expect([200, 401, 403]).toContain(res.status);
  });
});
