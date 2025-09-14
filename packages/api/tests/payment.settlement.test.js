const request = require('supertest');
const express = require('express');

// Mock the db module used by the router
jest.mock('../db', () => ({
  query: jest.fn()
}));

const db = require('../db');

describe('payment settlement endpoints', () => {
  let app;
  beforeAll(() => {
    process.env.PAYMENT_WEBHOOK_SECRET = 'test-secret';
    app = express();
    app.use(express.json());
    const paymentRoutes = require('../routes/paymentRoutes');
    app.use('/api', paymentRoutes);
  });

  afterAll(() => {
    delete process.env.PAYMENT_WEBHOOK_SECRET;
  });

  it('webhook settles payment when external_status indicates success', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ payment_id: 1, payment_status: 'settled' }] });

    const res = await request(app)
      .post('/api/payments/webhook')
      .set('x-payment-webhook-secret', 'test-secret')
      .send({ payment_id: 1, external_status: 'succeeded', settlement_reference: 'ext-123' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message', 'Webhook processed');
    expect(db.query).toHaveBeenCalled();
  });

  it('webhook rejects unsupported status', async () => {
    const res = await request(app)
      .post('/api/payments/webhook')
      .set('x-payment-webhook-secret', 'test-secret')
      .send({ payment_id: 1, external_status: 'pending' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('message', 'Unsupported external_status');
  });
});
