const request = require('supertest');
const express = require('express');

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, _res, next) => { req.user = { employee_id: 7 }; next(); },
    hasPermission: () => (_req, _res, next) => next(),
}));

jest.mock('../services/salesCorrectionService', () => ({
    preview: jest.fn(), createCase: jest.fn(), approveAndExecute: jest.fn(), getCase: jest.fn(),
}));

const corrections = require('../services/salesCorrectionService');

describe('sales correction routes', () => {
    const app = express();
    app.use(express.json());
    app.use('/api', require('../routes/salesCorrectionRoutes'));

    beforeEach(() => jest.clearAllMocks());

    it('returns a server-side state preview for an invoice', async () => {
        corrections.preview.mockResolvedValue({ proposal: { resolution: 'CANCEL_ONLY', automatic: true } });
        const res = await request(app).post('/api/sales-corrections/preview').send({ invoice_id: 42 });
        expect(res.status).toBe(200);
        expect(corrections.preview).toHaveBeenCalledWith(42);
    });

    it('rejects a malformed preview request before calling the service', async () => {
        const res = await request(app).post('/api/sales-corrections/preview').send({ invoice_id: 'bad' });
        expect(res.status).toBe(400);
        expect(corrections.preview).not.toHaveBeenCalled();
    });

    it('uses the authenticated employee and idempotency key when creating a case', async () => {
        corrections.createCase.mockResolvedValue({ correction_case_id: 12, state: 'PENDING_APPROVAL' });
        const res = await request(app).post('/api/sales-corrections').set('Idempotency-Key', 'd2719d8d-b79a-4d42-95f8-9d2a0623ed82').send({
            invoice_id: 42, reason_code: 'ENTRY_ERROR', reason_text: 'Incorrect quantity entered',
        });
        expect(res.status).toBe(201);
        expect(corrections.createCase).toHaveBeenCalledWith(expect.objectContaining({
            invoiceId: 42, requestedBy: 7, idempotencyKey: 'd2719d8d-b79a-4d42-95f8-9d2a0623ed82',
        }));
    });

    it('approves through the dedicated correction service rather than the void endpoint', async () => {
        corrections.approveAndExecute.mockResolvedValue({ correction_case_id: 12, state: 'COMPLETED' });
        const res = await request(app).post('/api/sales-corrections/12/approve');
        expect(res.status).toBe(200);
        expect(corrections.approveAndExecute).toHaveBeenCalledWith(12, 7);
    });
});
