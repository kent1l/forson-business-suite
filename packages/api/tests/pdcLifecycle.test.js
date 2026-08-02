'use strict';

const request = require('supertest');
const express = require('express');

// Mock db module
jest.mock('../db', () => {
    const queryFn = jest.fn();
    const client = {
        query: queryFn,
        release: jest.fn()
    };
    return {
        query: queryFn,
        getClient: jest.fn().mockResolvedValue(client)
    };
});

// Mock auth middleware
jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = { user_id: 1, employee_id: 1, username: 'admin', permissions: ['ar:view', 'ar:manage'] };
        next();
    },
    hasPermission: () => (req, res, next) => next()
}));

// Mock arLedgerService
jest.mock('../services/arLedgerService', () => ({
    appendEntry: jest.fn().mockResolvedValue(101)
}));

const db = require('../db');
const arLedgerService = require('../services/arLedgerService');
const pdcService = require('../services/pdcService');
const arRoutes = require('../routes/arRoutes');

const app = express();
app.use(express.json());
app.use('/api', arRoutes);

describe('PDC & Bounced Cheque Lifecycle Engine', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('pdcService.getCollectionsClearanceList', () => {
        test('queries pending payments and PDCs awaiting clearance', async () => {
            const mockRows = [
                { payment_id: 10, invoice_id: 100, amount: '5000.00', pdc_status: 'RECEIVED', payment_status: 'pending' },
                { payment_id: 11, invoice_id: 101, amount: '2500.00', pdc_status: 'DEPOSITED', payment_status: 'pending' }
            ];
            db.query.mockResolvedValueOnce({ rows: mockRows });

            const result = await pdcService.getCollectionsClearanceList(db);

            expect(db.query).toHaveBeenCalledTimes(1);
            expect(db.query.mock.calls[0][0]).toContain('WHERE ip.pdc_status IN (\'RECEIVED\', \'HELD_IN_SAFE\', \'DEPOSITED\', \'CLEARED\', \'BOUNCED\')');
            expect(result).toEqual(expect.arrayContaining([
                expect.objectContaining({ payment_id: 10, pdc_status: 'RECEIVED', maturity_status: 'DUE_TODAY' }),
                expect.objectContaining({ payment_id: 11, pdc_status: 'DEPOSITED', maturity_status: 'DUE_TODAY' })
            ]));
        });
    });

    describe('pdcService.verifyPayment', () => {
        test('updates payment_status to settled and pdc_status to CLEARED', async () => {
            const mockClient = {
                query: jest.fn()
                    .mockResolvedValueOnce({ rows: [{ payment_id: 10, invoice_id: 100, amount: '5000.00' }] }) // SELECT FOR UPDATE
                    .mockResolvedValueOnce({ rows: [{ payment_id: 10, invoice_id: 100, amount: '5000.00', payment_status: 'settled', pdc_status: 'CLEARED' }] }) // UPDATE
            };

            const result = await pdcService.verifyPayment(mockClient, { paymentId: 10, userId: 1 });

            expect(mockClient.query).toHaveBeenCalledTimes(3);
            expect(mockClient.query.mock.calls[1][0]).toContain("pdc_status = 'CLEARED'");
            expect(result.pdc_status).toBe('CLEARED');
            expect(result.payment_status).toBe('settled');
        });

        test('throws error if payment not found', async () => {
            const mockClient = {
                query: jest.fn().mockResolvedValueOnce({ rows: [] })
            };

            await expect(pdcService.verifyPayment(mockClient, { paymentId: 999 }))
                .rejects.toThrow('Payment #999 not found');
        });
    });

    describe('pdcService.processBouncedCheque', () => {
        test('replaces payment status to failed, logs PDC_BOUNCED_REVERSAL, BOUNCE_FEE_PENALTY, and sets customer credit hold', async () => {
            const mockClient = {
                query: jest.fn()
                    .mockResolvedValueOnce({
                        rows: [{ payment_id: 10, invoice_id: 100, amount: '5000.00', customer_id: 5, reference_number: 'CHQ-8899' }]
                    }) // SELECT payment
                    .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // COUNT attempts
                    .mockResolvedValueOnce({ rows: [] }) // UPDATE payment_status = failed, pdc_status = BOUNCED
                    .mockResolvedValueOnce({ rows: [] }) // UPDATE customer credit_hold = true
                    .mockResolvedValueOnce({ rows: [] }) // INSERT cheque_clearance_log
            };

            const result = await pdcService.processBouncedCheque(mockClient, {
                paymentId: 10,
                bounceFee: 250,
                reason: 'Insufficient Funds',
                userId: 1
            });

            // 1. SELECT + COUNT + UPDATE payment + UPDATE customer + INSERT audit log
            expect(mockClient.query).toHaveBeenCalledTimes(5);
            expect(mockClient.query.mock.calls[2][0]).toContain("pdc_status = 'BOUNCED'");
            expect(mockClient.query.mock.calls[3][0]).toContain("credit_hold = true");

            // 2. Check ledger logging: PDC_BOUNCED_REVERSAL and BOUNCE_FEE_PENALTY
            expect(arLedgerService.appendEntry).toHaveBeenCalledTimes(2);

            // Reversal entry (+5000.00)
            expect(arLedgerService.appendEntry).toHaveBeenNthCalledWith(1, mockClient, expect.objectContaining({
                customerId: 5,
                invoiceId: 100,
                paymentId: 10,
                entryType: 'PDC_BOUNCED_REVERSAL',
                amount: 5000,
                referenceNo: 'CHQ-8899',
            }));

            // Penalty fee entry (+250)
            expect(arLedgerService.appendEntry).toHaveBeenNthCalledWith(2, mockClient, expect.objectContaining({
                customerId: 5,
                invoiceId: 100,
                paymentId: 10,
                entryType: 'BOUNCE_FEE_PENALTY',
                amount: 250,
                referenceNo: 'CHQ-8899',
            }));

            expect(result).toEqual({
                paymentId: 10,
                invoiceId: 100,
                customerId: 5,
                amountReversed: 5000,
                bounceFee: 250,
                bounceAttempt: 1,
                creditHold: true,
                creditHoldReason: 'Bounced Cheque CHQ-8899 (Attempt #1): Insufficient Funds',
            });
        });
    });

    describe('Collections Clearance Routes', () => {
        test('GET /api/ar/collections-clearance returns list of pending clearance payments', async () => {
            const mockList = [
                { payment_id: 10, amount: '5000.00', pdc_status: 'RECEIVED' }
            ];
            db.query.mockResolvedValueOnce({ rows: mockList });

            const res = await request(app).get('/api/ar/collections-clearance');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toEqual(expect.arrayContaining([
                expect.objectContaining({ payment_id: 10, pdc_status: 'RECEIVED', maturity_status: 'DUE_TODAY' })
            ]));
        });

        test('POST /api/ar/collections-clearance/:paymentId/verify clears payment inside transaction', async () => {
            const mockClient = {
                query: jest.fn()
                    .mockResolvedValueOnce({ rows: [] }) // BEGIN
                    .mockResolvedValueOnce({ rows: [{ payment_id: 10, amount: '5000.00' }] }) // SELECT
                    .mockResolvedValueOnce({ rows: [{ payment_id: 10, payment_status: 'settled', pdc_status: 'CLEARED' }] }) // UPDATE
                    .mockResolvedValueOnce({ rows: [] }), // COMMIT
                release: jest.fn()
            };
            db.getClient.mockResolvedValueOnce(mockClient);

            const res = await request(app).post('/api/ar/collections-clearance/10/verify');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.pdc_status).toBe('CLEARED');
            expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
            expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
        });

        test('POST /api/ar/collections-clearance/:paymentId/fail bounces cheque inside transaction', async () => {
            const mockClient = {
                query: jest.fn()
                    .mockResolvedValueOnce({ rows: [] }) // BEGIN
                    .mockResolvedValueOnce({ rows: [{ payment_id: 10, invoice_id: 100, amount: '5000.00', customer_id: 5, reference_number: 'CHQ-100' }] }) // SELECT
                    .mockResolvedValueOnce({ rows: [] }) // UPDATE payment
                    .mockResolvedValueOnce({ rows: [] }) // UPDATE customer hold
                    .mockResolvedValueOnce({ rows: [] }), // COMMIT
                release: jest.fn()
            };
            db.getClient.mockResolvedValueOnce(mockClient);

            const res = await request(app)
                .post('/api/ar/collections-clearance/10/fail')
                .send({ bounce_fee: 150, reason: 'Bounced' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.creditHold).toBe(true);
            expect(res.body.amountReversed).toBe(5000);
            expect(res.body.bounceFee).toBe(150);
            expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
            expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
        });

        test('POST /api/ar/collections-clearance/:paymentId/redeposit re-deposits bounced cheque', async () => {
            const mockClient = {
                query: jest.fn()
                    .mockResolvedValueOnce({ rows: [] }) // BEGIN
                    .mockResolvedValueOnce({ rows: [{ payment_id: 10, invoice_id: 100, amount: '5000.00', customer_id: 5, reference_number: 'CHQ-100', pdc_status: 'BOUNCED' }] }) // SELECT
                    .mockResolvedValueOnce({ rows: [] }) // UPDATE payment pdc_status = DEPOSITED, payment_status = pending
                    .mockResolvedValueOnce({ rows: [] }) // UPDATE customer credit_hold = false
                    .mockResolvedValueOnce({ rows: [] }), // COMMIT
                release: jest.fn()
            };
            db.getClient.mockResolvedValueOnce(mockClient);

            const res = await request(app)
                .post('/api/ar/collections-clearance/10/redeposit')
                .send({ lift_credit_hold: true });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.pdc_status).toBe('DEPOSITED');
            expect(res.body.data.liftedCreditHold).toBe(true);
            expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
            expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
        });
    });
});
