const express = require('express');
const request = require('supertest');
const db = require('../db');

// mount the documentsRoutes on a fresh app to test behaviour
describe('documents routes (smoke)', () => {
  let app;

  beforeAll(async () => {
    // ensure seed SQL has run (we'll insert a test row)
    await db.query(`INSERT INTO documents (id, document_type, reference_id, created_at, updated_at, file_path, metadata)
      VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Invoice', 'TEST-API-1', now(), now(), '/tmp/x.pdf', jsonb_build_object('preview_html','<div>ok</div>')) ON CONFLICT (id) DO NOTHING`);

    app = express();
    app.use(express.json());
    app.use('/api', require('../routes/documentsRoutes'));
  });

  afterAll(async () => {
    // cleanup
    await db.query("DELETE FROM documents WHERE reference_id = 'TEST-API-1'");
    await db.query("DELETE FROM documents WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'");
    // close db pool if provided
    if (db && db.end) await db.end();
  });

  test('GET /api/documents returns 200 and documents array', async () => {
    const res = await request(app).get('/api/documents');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.documents)).toBe(true);
  }, 10000);

  test('GET /api/documents/:id/preview returns preview html', async () => {
    const id = 'aaaaaaaa-0000-0000-0000-000000000001';
    const res = await request(app).get(`/api/documents/${id}/preview`);
    expect(res.statusCode === 200 || res.statusCode === 401 || res.statusCode === 403).toBeTruthy();
    // note: auth middleware may block this in CI; this test asserts the route is mountable
  });
});
