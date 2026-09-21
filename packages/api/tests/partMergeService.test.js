jest.mock('../services/meiliOutboxService', () => ({
    enqueuePartUpsert: jest.fn().mockResolvedValue(undefined),
    enqueuePartDelete: jest.fn().mockResolvedValue(undefined)
}));

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

    describe('merge transaction safety', () => {
        test('treats a not-yet-applied revert migration as an empty optional list', async () => {
            mockDb.query.mockRejectedValue({ code: '42P01' });
            await expect(service.getRevertableOperations()).resolves.toEqual([]);
        });

        test('takes advisory locks in ascending part order before locking rows', async () => {
            mockDb.query.mockResolvedValue({ rows: [] });
            await service.lockParts(mockDb, [9, 2, 5]);

            expect(mockDb.query.mock.calls.slice(0, 3)).toEqual([
                ['SELECT pg_advisory_xact_lock($1::bigint)', [2]],
                ['SELECT pg_advisory_xact_lock($1::bigint)', [5]],
                ['SELECT pg_advisory_xact_lock($1::bigint)', [9]]
            ]);
            expect(mockDb.query.mock.calls[3][0]).toContain('FOR UPDATE');
        });

        test('calculates WAC before inventory transactions are reassigned', async () => {
            const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
            mockDb.getClient = jest.fn().mockResolvedValue(client);
            service.validateMergeRequest = jest.fn().mockResolvedValue(undefined);
            service.lockParts = jest.fn().mockResolvedValue(undefined);
            service.createMergeOperation = jest.fn().mockResolvedValue({ operation_id: 'op-1' });
            service.captureMergeSnapshots = jest.fn().mockResolvedValue(undefined);
            service.getPartDetails = jest.fn().mockResolvedValue({ part_id: 1 });
            service.updateKeepPart = jest.fn().mockResolvedValue(undefined);
            service.mergeChildRecords = jest.fn().mockResolvedValue({});
            service.consolidateInventory = jest.fn().mockResolvedValue({});
            service.reassignForeignKeys = jest.fn().mockResolvedValue({});
            service.createAliases = jest.fn().mockResolvedValue(undefined);
            service.markPartsAsMerged = jest.fn().mockResolvedValue(undefined);
            service.logMergeOperations = jest.fn().mockResolvedValue(undefined);
            service.completeMergeOperation = jest.fn().mockResolvedValue(undefined);

            await service.executeMerge({ keepPartId: 1, mergePartIds: [2], rules: {} }, 10);

            expect(service.consolidateInventory.mock.invocationCallOrder[0])
                .toBeLessThan(service.reassignForeignKeys.mock.invocationCallOrder[0]);
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
        // Helper: produce a chain of N successful no-op mock responses so that
        // only the queries we care about need explicit mock return values.
        function mockChain(client, responses) {
            responses.forEach(r => client.query.mockResolvedValueOnce(r));
        }

        // Full §4-A + §4-B chain when both mergePartNumbers and mergeApplications
        // are true (14 query calls total):
        //   0  UPDATE part_number  – retire overlapping source numbers
        //   1  CTE ranked/retired/reassigned part_number
        //   2  DELETE part_application – remove overlapping source applications
        //   3  CTE ranked/retired/reassigned part_application
        //   4  DELETE part_barcode  – retire overlapping barcodes
        //   5  UPDATE part_barcode  – move remaining barcodes
        //   6  DELETE part_tag      – retire overlapping tags
        //   7  UPDATE part_tag      – move remaining tags
        //   8  INSERT part_inventory_stats ON CONFLICT DO UPDATE
        //   9  DELETE part_inventory_stats
        //  10  UPDATE part_aliases  – move non-duplicate aliases
        //  11  DELETE part_aliases  – remove source duplicates
        //  12  UPDATE staged_sale_line
        //  13  DELETE dedupe_scan_queue
        //  14  DELETE ai_match_cache
        //  15  DELETE ai_verification_queue
        //  16  INSERT part_exclusion
        //  17  DELETE part_exclusion self-pair
        //  18  DELETE part_exclusion source rows

        test('deduplicates overlapping source part numbers and applications before reassignment', async () => {
            mockChain(mockDb, [
                { rowCount: 1 },                        //  0 retire overlapping part_numbers
                { rows: [{ reassigned_count: 2 }] },    //  1 rank/retire/reassign part_numbers
                { rowCount: 1 },                        //  2 delete overlapping part_applications
                { rows: [{ reassigned_count: 3 }] },    //  3 rank/retire/reassign part_applications
                { rowCount: 0 },                        //  4 delete overlapping barcodes
                { rowCount: 2 },                        //  5 move barcodes
                { rowCount: 0 },                        //  6 delete overlapping tags
                { rowCount: 1, rows: [] },               //  7 move tags
                { rows: [{ part_id: 1 }] },             //  8 upsert inventory_stats
                { rowCount: 0 },                        //  9 delete source inventory_stats
                { rowCount: 0, rows: [] },               // 10 move aliases
                { rowCount: 0 },                        // 11 delete orphan aliases
                { rowCount: 0, rows: [] },               // 12 staged_sale_line open drafts
                { rowCount: 0 },                        // 13 dedupe_scan_queue
                { rowCount: 0 },                        // 14 ai_match_cache
                { rowCount: 0 },                        // 15 ai_verification_queue
                { rowCount: 0 },                        // 16 insert part_exclusion
                { rowCount: 0 },                        // 17 delete self-pair
                { rowCount: 0 },                        // 18 delete source exclusions
            ]);

            const counts = await service.mergeChildRecords(mockDb, 1, [2, 3, 4], {
                mergePartNumbers: true,
                mergeApplications: true
            });

            const queries = mockDb.query.mock.calls.map(([sql]) => sql);
            // part_number overlap retire
            expect(queries[0]).toContain('keep_pn.part_id = $1');
            expect(queries[0]).toContain('pn.deleted_at IS NULL');
            // part_number rank/retire/reassign
            expect(queries[1]).toContain('ROW_NUMBER() OVER');
            expect(queries[1]).toContain('PARTITION BY pn.part_number');
            expect(queries[1]).toContain('r.rn > 1');
            expect(queries[1]).toContain('r.rn = 1');
            // part_application overlap delete
            expect(queries[2]).toContain('keep_pa.part_id = $1');
            // part_application rank/retire/reassign
            expect(queries[3]).toContain('PARTITION BY pa.application_id');
            expect(queries[3]).toContain('r.rn > 1');
            expect(queries[3]).toContain('r.rn = 1');
            expect(mockDb.query.mock.calls[1][1]).toEqual([1, [2, 3, 4]]);
            expect(mockDb.query.mock.calls[3][1]).toEqual([1, [2, 3, 4]]);
            expect(counts.part_numbers).toBe(2);
            expect(counts.part_applications).toBe(3);
            expect(counts.barcodes).toBe(2);
            expect(counts.part_tags).toBe(1);
        });

        test('reassigns source barcodes through part_barcode', async () => {
            // When mergePartNumbers and mergeApplications are both falsy, the
            // first two real queries are the barcode deduplicate + move.
            mockChain(mockDb, [
                { rowCount: 0 },                    //  4 delete overlapping barcodes
                { rowCount: 4 },                    //  5 move barcodes
                { rowCount: 0 },                    //  6 delete overlapping tags
                { rowCount: 1, rows: [] },           //  7 move tags
                { rows: [] },                       //  8 upsert inventory_stats (empty source)
                { rowCount: 0 },                    //  9 delete source inventory_stats
                { rowCount: 0, rows: [] },           // 10 move aliases
                { rowCount: 0 },                    // 11 delete orphan aliases
                { rowCount: 0, rows: [] },           // 12 staged_sale_line
                { rowCount: 0 },                    // 13 dedupe_scan_queue
                { rowCount: 0 },                    // 14 ai_match_cache
                { rowCount: 0 },                    // 15 ai_verification_queue
                { rowCount: 0 },                    // 16 insert part_exclusion
                { rowCount: 0 },                    // 17 delete self-pair
                { rowCount: 0 },                    // 18 delete source exclusions
            ]);

            const counts = await service.mergeChildRecords(mockDb, 1, [2], {});

            const queries = mockDb.query.mock.calls.map(([sql]) => sql);
            // First two queries are barcode dedup + move
            expect(queries[0]).toContain('DELETE FROM part_barcode');
            expect(queries[0]).toContain('keep_pb.barcode = pb.barcode');
            expect(queries[1]).toContain('UPDATE part_barcode');
            expect(mockDb.query.mock.calls[1][1]).toEqual([1, [2]]);
            expect(counts.barcodes).toBe(4);
        });

        test('§4-A: part_tag — deletes overlap then moves remainder', async () => {
            mockChain(mockDb, [
                { rowCount: 0 },                    // barcode dedup
                { rowCount: 0 },                    // barcode move
                { rowCount: 2 },                    // tag overlap delete
                { rowCount: 5, rows: [] },           // tag move
                { rows: [] },                       // inventory_stats upsert
                { rowCount: 0 },                    // inventory_stats delete
                { rowCount: 0, rows: [] },           // aliases move
                { rowCount: 0 },                    // aliases delete
                { rowCount: 0, rows: [] },           // staged_sale
                { rowCount: 0 }, { rowCount: 0 }, { rowCount: 0 },  // queue rebuilds
                { rowCount: 0 }, { rowCount: 0 }, { rowCount: 0 },  // exclusion
            ]);

            const counts = await service.mergeChildRecords(mockDb, 1, [2], {});

            const queries = mockDb.query.mock.calls.map(([sql]) => sql);
            expect(queries[2]).toContain('DELETE FROM part_tag');
            expect(queries[2]).toContain('SELECT tag_id FROM part_tag WHERE part_id = $1');
            expect(queries[3]).toContain('UPDATE part_tag SET part_id = $1');
            expect(counts.part_tags).toBe(5);
        });

        test('§4-A: part_tag — skipped when rules.mergeTags is false', async () => {
            mockChain(mockDb, [
                { rowCount: 0 }, { rowCount: 0 },   // barcode
                // no tag queries
                { rows: [] }, { rowCount: 0 },      // inventory_stats
                { rowCount: 0, rows: [] }, { rowCount: 0 },  // aliases
                { rowCount: 0, rows: [] },           // staged_sale
                { rowCount: 0 }, { rowCount: 0 }, { rowCount: 0 },  // queues
                { rowCount: 0 }, { rowCount: 0 }, { rowCount: 0 },  // exclusion
            ]);

            const counts = await service.mergeChildRecords(mockDb, 1, [2], { mergeTags: false });
            expect(counts.part_tags).toBeUndefined();
            const queries = mockDb.query.mock.calls.map(([sql]) => sql);
            expect(queries.some(q => q.includes('part_tag'))).toBe(false);
        });

        test('§4-A: part_inventory_stats — aggregates then deletes source rows', async () => {
            mockChain(mockDb, [
                { rowCount: 0 }, { rowCount: 0 },   // barcode
                { rowCount: 0 }, { rowCount: 0 },   // tags
                { rowCount: 1 },                    // inventory_stats upsert — rowCount from RETURNING
                { rowCount: 2 },                    // inventory_stats delete source
                { rowCount: 0, rows: [] }, { rowCount: 0 },  // aliases
                { rowCount: 0, rows: [] },           // staged_sale
                { rowCount: 0 }, { rowCount: 0 }, { rowCount: 0 },
                { rowCount: 0 }, { rowCount: 0 }, { rowCount: 0 },
            ]);

            const counts = await service.mergeChildRecords(mockDb, 1, [2, 3], {});

            const queries = mockDb.query.mock.calls.map(([sql]) => sql);
            const statsUpsert = queries[4];
            expect(statsUpsert).toContain('INSERT INTO part_inventory_stats');
            expect(statsUpsert).toContain('MAX(last_counted_at)');
            expect(statsUpsert).toContain('BOOL_OR');
            expect(statsUpsert).toContain('ON CONFLICT (part_id) DO UPDATE');
            expect(queries[5]).toContain('DELETE FROM part_inventory_stats');
            expect(counts.part_inventory_stats).toBe(1);

        });

        test('§4-A: part_aliases — moves non-duplicate rows, deletes orphans', async () => {
            mockChain(mockDb, [
                { rowCount: 0 }, { rowCount: 0 },   // barcode
                { rowCount: 0 }, { rowCount: 0 },   // tags
                { rows: [] }, { rowCount: 0 },      // inventory_stats
                { rowCount: 3, rows: [] },           // aliases move
                { rowCount: 1 },                    // aliases delete orphans
                { rowCount: 0, rows: [] },
                { rowCount: 0 }, { rowCount: 0 }, { rowCount: 0 },
                { rowCount: 0 }, { rowCount: 0 }, { rowCount: 0 },
            ]);

            const counts = await service.mergeChildRecords(mockDb, 1, [2], {});

            const queries = mockDb.query.mock.calls.map(([sql]) => sql);
            expect(queries[6]).toContain('UPDATE part_aliases');
            expect(queries[6]).toContain('NOT EXISTS');
            expect(queries[7]).toContain('DELETE FROM part_aliases');
            expect(counts.part_aliases_reconciled).toBe(3);
        });

        test('§4-A: staged_sale_line — only moves open (non-APPROVED, non-REJECTED) drafts', async () => {
            mockChain(mockDb, [
                { rowCount: 0 }, { rowCount: 0 },
                { rowCount: 0 }, { rowCount: 0 },
                { rows: [] }, { rowCount: 0 },
                { rowCount: 0, rows: [] }, { rowCount: 0 },
                { rowCount: 2, rows: [] },           // staged_sale_line open drafts
                { rowCount: 0 }, { rowCount: 0 }, { rowCount: 0 },
                { rowCount: 0 }, { rowCount: 0 }, { rowCount: 0 },
            ]);

            const counts = await service.mergeChildRecords(mockDb, 1, [2], {});

            const queries = mockDb.query.mock.calls.map(([sql]) => sql);
            const stagingQuery = queries[8];
            expect(stagingQuery).toContain('UPDATE staged_sale_line ssl');
            expect(stagingQuery).toContain("ss.status NOT IN ('APPROVED', 'REJECTED')");
            expect(counts.staged_sale_lines_moved).toBe(2);
        });

        test('§4-B: deletes stale dedupe queue, AI cache, AI queue rows for source parts', async () => {
            mockChain(mockDb, [
                { rowCount: 0 }, { rowCount: 0 },
                { rowCount: 0 }, { rowCount: 0 },
                { rows: [] }, { rowCount: 0 },
                { rowCount: 0, rows: [] }, { rowCount: 0 },
                { rowCount: 0, rows: [] },
                { rowCount: 3 },                    // dedupe_scan_queue
                { rowCount: 2 },                    // ai_match_cache
                { rowCount: 1 },                    // ai_verification_queue
                { rowCount: 0 }, { rowCount: 0 }, { rowCount: 0 },
            ]);

            await service.mergeChildRecords(mockDb, 1, [2, 3], {});

            const queries = mockDb.query.mock.calls.map(([sql]) => sql);
            expect(queries[9]).toContain('DELETE FROM dedupe_scan_queue');
            expect(queries[10]).toContain('DELETE FROM ai_match_cache');
            expect(queries[11]).toContain('DELETE FROM ai_verification_queue');
        });

        test('§4-B: part_exclusion — transfers pairs to survivor, removes self-pairs and source rows', async () => {
            mockChain(mockDb, [
                { rowCount: 0 }, { rowCount: 0 },
                { rowCount: 0 }, { rowCount: 0 },
                { rows: [] }, { rowCount: 0 },
                { rowCount: 0, rows: [] }, { rowCount: 0 },
                { rowCount: 0, rows: [] },
                { rowCount: 0 }, { rowCount: 0 }, { rowCount: 0 },
                { rowCount: 1 },                    // insert part_exclusion
                { rowCount: 0 },                    // delete self-pair
                { rowCount: 2 },                    // delete source rows
            ]);

            await service.mergeChildRecords(mockDb, 1, [2], {});

            const queries = mockDb.query.mock.calls.map(([sql]) => sql);
            expect(queries[12]).toContain('INSERT INTO part_exclusion');
            expect(queries[12]).toContain('ON CONFLICT DO NOTHING');
            expect(queries[13]).toContain('DELETE FROM part_exclusion');
            expect(queries[13]).toContain('part_id_1 = $1 AND part_id_2 = $1');
            expect(queries[14]).toContain('DELETE FROM part_exclusion');
            expect(queries[14]).toContain('part_id_1 = ANY($1) OR part_id_2 = ANY($1)');
        });
    });

    describe('consolidateInventory (WAC)', () => {
        test('§5: includes non-positive quantity parts in WAC calculation', async () => {
            // Part 1 (keep): 10 units @ 100 = 1000 value
            // Part 2 (source): -2 units @ 80 = -160 value (returns)
            // Combined: 8 units, 840 value → WAC = 105
            mockDb.query.mockResolvedValueOnce({
                rows: [
                    { part_id: 1, wac_cost: '100', qty: '10' },
                    { part_id: 2, wac_cost: '80',  qty: '-2' },
                ]
            });
            mockDb.query.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE part

            const result = await service.consolidateInventory(mockDb, 1, [2]);
            expect(result.inventory_consolidated).toBe(8);
            expect(result.new_wac).toBeCloseTo(105, 5);
        });

        test('§5: retains survivor WAC when combined net quantity is ≤ 0', async () => {
            // Part 1 (keep): -5 units @ 200 (all returned), Part 2: -3 units @ 150
            mockDb.query.mockResolvedValueOnce({
                rows: [
                    { part_id: 1, wac_cost: '200', qty: '-5' },
                    { part_id: 2, wac_cost: '150', qty: '-3' },
                ]
            });
            mockDb.query.mockResolvedValueOnce({ rowCount: 1 });

            const result = await service.consolidateInventory(mockDb, 1, [2]);
            expect(result.inventory_consolidated).toBe(-8);
            // Should retain survivor's WAC (200) rather than 0
            expect(result.new_wac).toBe(200);
        });
    });
});
