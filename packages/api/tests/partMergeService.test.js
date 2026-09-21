const PartMergeService = require('../services/partMergeService');

describe('PartMergeService Unit Tests', () => {
    let mockDb;
    let service;

    beforeEach(() => {
        mockDb = {
            query: jest.fn()
        };
        service = new PartMergeService(mockDb);
    });

    describe('validateMergeRequest', () => {
        test('should throw error if mergePartIds is empty or invalid', async () => {
            await expect(service.validateMergeRequest(1, []))
                .rejects.toThrow('mergePartIds array is required and must not be empty');
        });

        test('should throw error if any part ID does not exist in database', async () => {
            mockDb.query.mockResolvedValueOnce({ rows: [{ part_id: 1, merged_into_part_id: null }] });
            await expect(service.validateMergeRequest(1, [2]))
                .rejects.toThrow('Some part IDs are invalid');
        });

        test('should throw error if keepPartId is included in mergePartIds', async () => {
            mockDb.query.mockResolvedValueOnce({
                rows: [
                    { part_id: 1, merged_into_part_id: null },
                    { part_id: 1, merged_into_part_id: null }
                ]
            });
            await expect(service.validateMergeRequest(1, [1]))
                .rejects.toThrow('Keep part cannot be in the list of parts to merge');
        });

        test('should validate successfully when valid IDs provided', async () => {
            mockDb.query.mockResolvedValueOnce({
                rows: [
                    { part_id: 1, merged_into_part_id: null },
                    { part_id: 2, merged_into_part_id: null }
                ]
            });
            await expect(service.validateMergeRequest(1, [2])).resolves.not.toThrow();
        });
    });

    describe('calculateMergeImpact', () => {
        test('should calculate referenced rows across tables into byTable and inventory', async () => {
            mockDb.query
                .mockResolvedValueOnce({ rows: [{ count: '2' }] })  // goods_receipt_line
                .mockResolvedValueOnce({ rows: [{ count: '5' }] })  // invoice_line
                .mockResolvedValueOnce({ rows: [{ count: '1' }] })  // purchase_order_line
                .mockResolvedValueOnce({ rows: [{ count: '0' }] })  // credit_note_line
                .mockResolvedValueOnce({ rows: [{ part_id: 2, stock_on_hand: 10 }] }) // stockResult
                .mockResolvedValueOnce({ rows: [{ part_id: 2, wac_cost: 50.00 }] });  // wacResult

            const impact = await service.calculateMergeImpact(1, [2]);

            expect(impact.byTable.goods_receipt_line).toBe(2);
            expect(impact.byTable.invoice_line).toBe(5);
            expect(impact.byTable.purchase_order_line).toBe(1);
            expect(impact.byTable.credit_note_line).toBe(0);
            expect(impact.inventory.locations[0].quantity).toBe(10);
            expect(impact.inventory.locations[0].avg_wac).toBe(50.00);
        });
    });

    describe('calculateResolvedPart', () => {
        test('should merge fields using keepPart defaults and fieldOverrides', () => {
            const keepPart = {
                part_id: 1,
                detail: 'Keep Detail',
                group_id: 10,
                brand_id: 20
            };
            const mergeParts = [
                { part_id: 2, detail: 'Merge Detail', group_id: 11, brand_id: 20 }
            ];
            const rules = {
                fieldOverrides: {
                    detail: 'Custom Detail Override'
                }
            };

            const resolved = service.calculateResolvedPart(keepPart, mergeParts, rules);

            expect(resolved.detail).toBe('Custom Detail Override');
            expect(resolved.group_id).toBe(10);
            expect(resolved.brand_id).toBe(20);
        });
    });

    describe('updateKeepPart', () => {
        test('does not try to update the removed part.barcode column', async () => {
            await service.updateKeepPart(
                mockDb,
                1,
                { part_id: 1 },
                [],
                { fieldOverrides: { barcode: '123456789', detail: 'Updated detail' } }
            );

            expect(mockDb.query).toHaveBeenCalledTimes(1);
            expect(mockDb.query.mock.calls[0][0]).toContain('detail = $2');
            expect(mockDb.query.mock.calls[0][0]).not.toContain('barcode =');
            expect(mockDb.query.mock.calls[0][1]).toEqual([1, 'Updated detail']);
        });
    });

    describe('mergeChildRecords', () => {
        test('deduplicates overlapping source part numbers and applications before reassignment', async () => {
            mockDb.query
                .mockResolvedValueOnce({ rowCount: 1 })
                .mockResolvedValueOnce({ rows: [{ reassigned_count: 2 }] })
                .mockResolvedValueOnce({ rowCount: 1 })
                .mockResolvedValueOnce({ rows: [{ reassigned_count: 3 }] })
                .mockResolvedValueOnce({ rowCount: 0 })
                .mockResolvedValueOnce({ rowCount: 2 });

            const counts = await service.mergeChildRecords(mockDb, 1, [2, 3, 4], {
                mergePartNumbers: true,
                mergeApplications: true
            });

            const queries = mockDb.query.mock.calls.map(([sql]) => sql);
            expect(queries[0]).toContain('keep_pn.part_id = $1');
            expect(queries[0]).toContain('pn.deleted_at IS NULL');
            expect(queries[1]).toContain('ROW_NUMBER() OVER');
            expect(queries[1]).toContain('PARTITION BY pn.part_number');
            expect(queries[1]).toContain('r.rn > 1');
            expect(queries[1]).toContain('r.rn = 1');
            expect(queries[2]).toContain('keep_pa.part_id = $1');
            expect(queries[3]).toContain('PARTITION BY pa.application_id');
            expect(queries[3]).toContain('r.rn > 1');
            expect(queries[3]).toContain('r.rn = 1');
            expect(mockDb.query.mock.calls[1][1]).toEqual([1, [2, 3, 4]]);
            expect(mockDb.query.mock.calls[3][1]).toEqual([1, [2, 3, 4]]);
            expect(counts).toEqual({ part_numbers: 2, part_applications: 3, barcodes: 2 });
        });

        test('reassigns source barcodes through part_barcode', async () => {
            mockDb.query
                .mockResolvedValueOnce({ rowCount: 0 })
                .mockResolvedValueOnce({ rowCount: 4 });

            const counts = await service.mergeChildRecords(mockDb, 1, [2], {});

            expect(mockDb.query).toHaveBeenCalledTimes(2);
            expect(mockDb.query.mock.calls[0][0]).toContain('DELETE FROM part_barcode');
            expect(mockDb.query.mock.calls[0][0]).toContain('keep_pb.barcode = pb.barcode');
            expect(mockDb.query.mock.calls[1][0]).toContain('UPDATE part_barcode');
            expect(mockDb.query.mock.calls[1][1]).toEqual([1, [2]]);
            expect(counts).toEqual({ barcodes: 4 });
        });
    });
});
