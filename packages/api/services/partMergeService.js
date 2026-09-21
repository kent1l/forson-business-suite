const DuplicateFinder = require('./duplicateFinder');
const { enqueuePartUpsert, enqueuePartDelete } = require('./meiliOutboxService');

const REVERTABLE_TABLES = Object.freeze([
    { name: 'part', key: "part_id::text", where: 'part_id = ANY($1::bigint[])' },
    { name: 'part_number', key: "part_number_id::text", where: 'part_id = ANY($1::bigint[])' },
    { name: 'part_application', key: "part_app_id::text", where: 'part_id = ANY($1::bigint[])' },
    { name: 'part_barcode', key: "barcode_id::text", where: 'part_id = ANY($1::bigint[])' },
    { name: 'part_tag', key: "concat(part_id, ':', tag_id)", where: 'part_id = ANY($1::bigint[])' },
    { name: 'part_inventory_stats', key: "part_id::text", where: 'part_id = ANY($1::bigint[])' },
    { name: 'part_aliases', key: "id::text", where: 'part_id = ANY($1::bigint[]) OR source_part_id = ANY($1::bigint[])' },
    { name: 'staged_sale_line', key: "staged_line_id::text", where: 'part_id = ANY($1::bigint[])' },
    { name: 'dedupe_scan_queue', key: "part_id::text", where: 'part_id = ANY($1::bigint[])' },
    { name: 'ai_match_cache', key: "concat(part_id_1, ':', part_id_2)", where: 'part_id_1 = ANY($1::bigint[]) OR part_id_2 = ANY($1::bigint[])' },
    { name: 'ai_verification_queue', key: "concat(part_id_1, ':', part_id_2)", where: 'part_id_1 = ANY($1::bigint[]) OR part_id_2 = ANY($1::bigint[])' },
    { name: 'part_exclusion', key: "concat(part_id_1, ':', part_id_2)", where: 'part_id_1 = ANY($1::bigint[]) OR part_id_2 = ANY($1::bigint[])' },
    { name: 'inventory_transaction', key: "inv_trans_id::text", where: 'part_id = ANY($1::bigint[])' }
]);

/**
 * Service for merging parts and managing the merge process
 */
class PartMergeService {
    constructor(db) {
        this.db = db;
        this.duplicateFinder = new DuplicateFinder(db);
    }

    /**
     * Preview the impact of a merge operation without executing it
     * @param {Object} mergeRequest - The merge request
     * @param {number} mergeRequest.keepPartId - ID of the part to keep
     * @param {Array} mergeRequest.mergePartIds - IDs of parts to merge into keepPart
     * @param {Object} mergeRequest.rules - Merge rules and field overrides
     * @returns {Object} Preview of the merge impact
     */
    async previewMerge(mergeRequest) {
        const { keepPartId, mergePartIds, rules } = mergeRequest;
        
        console.log('DEBUG: Validating merge request...');
        // Validate input
        await this.validateMergeRequest(keepPartId, mergePartIds);
        
        console.log('DEBUG: Getting part details for keepPartId:', keepPartId);
        // Get detailed part data
        const keepPart = await this.getPartDetails(keepPartId);
        const mergeParts = await Promise.all(
            mergePartIds.map(id => this.getPartDetails(id))
        );
        
        // Calculate resolved part data
        const resolvedPartDraft = this.calculateResolvedPart(keepPart, mergeParts, rules);
        
        // Calculate impact counts
        const impact = await this.calculateMergeImpact(keepPartId, mergePartIds);
        
        // Check for conflicts
        const conflicts = await this.detectConflicts(keepPart, mergeParts, rules);
        
        return {
            resolvedPartDraft,
            impact,
            conflicts,
            warnings: this.generateWarnings(impact, conflicts)
        };
    }

    /**
     * Execute the merge operation
     * @param {Object} mergeRequest - The merge request
     * @param {number} actorEmployeeId - ID of the employee performing the merge
     * @returns {Object} Result of the merge operation
     */
    async executeMerge(mergeRequest, actorEmployeeId) {
        const { keepPartId, mergePartIds, rules } = mergeRequest;
        
        // Validate input before allocating a client. A second, authoritative
        // validation occurs after the transaction-scoped advisory locks.
        await this.validateMergeRequest(keepPartId, mergePartIds);
        
        const client = await this.db.getClient();
        try {
            await client.query('BEGIN');

            const allPartIds = [keepPartId, ...mergePartIds];
            await this.lockParts(client, allPartIds);
            await this.validateMergeRequest(keepPartId, mergePartIds, client);
            const operation = await this.createMergeOperation(client, actorEmployeeId, keepPartId, mergePartIds);
            await this.captureMergeSnapshots(client, operation.operation_id, allPartIds);
            
            // Get current part data
            const keepPart = await this.getPartDetails(keepPartId, client);
            const mergeParts = await Promise.all(
                mergePartIds.map(id => this.getPartDetails(id, client))
            );
            
            // Update the keep part with merged data
            await this.updateKeepPart(client, keepPartId, keepPart, mergeParts, rules);
            
            // Merge child records (part_numbers, applications, etc.)
            const childUpdateCounts = await this.mergeChildRecords(client, keepPartId, mergePartIds, rules);
            
            // Snapshot stock by its original part before reassignment. Moving
            // transactions first would make every source quantity zero and
            // silently omit its WAC from the weighted calculation.
            const inventoryUpdateCounts = await this.consolidateInventory(client, keepPartId, mergePartIds);

            // Reassign all foreign key references after WAC is consolidated.
            const fkUpdateCounts = await this.reassignForeignKeys(client, keepPartId, mergePartIds);
            
            // Create aliases for old SKUs/part numbers
            if (rules.preserveAliases !== false) {
                await this.createAliases(client, keepPartId, mergeParts, rules);
            }
            
            // Mark source parts as merged
            await this.markPartsAsMerged(client, mergePartIds, keepPartId);
            
            // Log the merge operation
            await this.logMergeOperations(client, actorEmployeeId, keepPartId, mergePartIds, rules, {
                ...childUpdateCounts,
                ...fkUpdateCounts,
                ...inventoryUpdateCounts
            });

            await this.completeMergeOperation(client, operation.operation_id);
            await enqueuePartUpsert(keepPartId, { source: 'partMergeService.merge', version_ts: new Date().toISOString() }, client);
            for (const mergedPartId of mergePartIds) {
                await enqueuePartDelete(mergedPartId, { source: 'partMergeService.merge', version_ts: new Date().toISOString() }, client);
            }
            
            await client.query('COMMIT');
            
            return {
                keepPartId,
                mergedPartIds: mergePartIds,
                operationId: operation.operation_id,
                updatedCounts: {
                    ...childUpdateCounts,
                    ...fkUpdateCounts,
                    ...inventoryUpdateCounts
                },
                warnings: []
            };
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async validateMergeRequest(keepPartId, mergePartIds, executor = this.db) {
        if (!Array.isArray(mergePartIds) || mergePartIds.length === 0) {
            throw new Error('mergePartIds array is required and must not be empty');
        }
        
        // Check that all part IDs are valid
        const allPartIds = [keepPartId, ...mergePartIds];
        const result = await executor.query(
            'SELECT part_id, merged_into_part_id FROM part WHERE part_id = ANY($1)',
            [allPartIds]
        );
        
        if (result.rows.length !== allPartIds.length) {
            throw new Error('Some part IDs are invalid');
        }
        
        // Check that no parts are already merged
        const alreadyMerged = result.rows.filter(row => row.merged_into_part_id !== null);
        if (alreadyMerged.length > 0) {
            throw new Error(`Parts ${alreadyMerged.map(r => r.part_id).join(', ')} are already merged`);
        }
        
        // Check that keepPartId is not in mergePartIds
        if (mergePartIds.includes(keepPartId)) {
            throw new Error('Keep part cannot be in the list of parts to merge');
        }
        
        // Check for duplicates in mergePartIds
        if (new Set(mergePartIds).size !== mergePartIds.length) {
            throw new Error('Duplicate part IDs in merge list');
        }
    }

    async getPartDetails(partId, client = null) {
        console.log('DEBUG: Getting part details for partId:', partId);
        const db = client || this.db;
        const result = await db.query(`
            SELECT p.*, 
                   b.brand_name, 
                   g.group_name,
                   -- Provide a display_name for UI (fallback to SKU since part has no display_name column)
                   p.internal_sku as display_name,
                   COALESCE(
                       json_agg(
                           DISTINCT jsonb_build_object(
                               'id', pn.part_number_id,
                               'part_number', pn.part_number,
                               'part_number_type', pn.number_type
                           )
                       ) FILTER (WHERE pn.part_number_id IS NOT NULL), 
                       '[]'::json
                   ) as part_numbers,
                   COALESCE(
                       json_agg(
                           DISTINCT jsonb_build_object(
                               'application_id', pa.application_id,
                               'make', vm.make_name,
                               'model', vmo.model_name,
                               'engine', ve.engine_code
                           )
                       ) FILTER (WHERE pa.application_id IS NOT NULL), 
                       '[]'::json
                   ) as applications
            FROM part p
            LEFT JOIN brand b ON p.brand_id = b.brand_id
            LEFT JOIN "group" g ON p.group_id = g.group_id
            LEFT JOIN part_number pn ON p.part_id = pn.part_id
            LEFT JOIN part_application pa ON p.part_id = pa.part_id
            LEFT JOIN application a ON pa.application_id = a.application_id
            LEFT JOIN vehicle_make vm ON a.make_id = vm.make_id
            LEFT JOIN vehicle_model vmo ON a.model_id = vmo.model_id
            LEFT JOIN engine ve ON a.engine_id = ve.engine_id
            WHERE p.part_id = $1
            GROUP BY p.part_id, b.brand_name, g.group_name
        `, [partId]);
        
        if (result.rows.length === 0) {
            throw new Error(`Part ${partId} not found`);
        }
        
        return result.rows[0];
    }

    calculateResolvedPart(keepPart, mergeParts, rules) {
        const resolved = { ...keepPart };
        
        // Apply field overrides from rules
        if (rules.fieldOverrides) {
            Object.assign(resolved, rules.fieldOverrides);
        }
        
        // Merge arrays based on rules
        if (rules.mergePartNumbers) {
            const allPartNumbers = [
                ...(keepPart.part_numbers || []),
                ...mergeParts.flatMap(p => p.part_numbers || [])
            ];
            resolved.part_numbers = this.deduplicatePartNumbers(allPartNumbers);
        }
        
        if (rules.mergeApplications) {
            const allApplications = [
                ...(keepPart.applications || []),
                ...mergeParts.flatMap(p => p.applications || [])
            ];
            resolved.applications = this.deduplicateApplications(allApplications);
        }
        
        if (rules.mergeTags) {
            const allTags = [
                ...(keepPart.tags || []),
                ...mergeParts.flatMap(p => p.tags || [])
            ];
            resolved.tags = [...new Set(allTags)];
        }
        
        return resolved;
    }

    async calculateMergeImpact(keepPartId, mergePartIds) {
        // Use actual schema table names
        const tables = [
            'goods_receipt_line',
            'invoice_line',
            'purchase_order_line',
            'credit_note_line'
        ];
        
        const impact = { byTable: {} };
        
        for (const table of tables) {
            try {
                const result = await this.db.query(
                    `SELECT COUNT(*) as count FROM ${table} WHERE part_id = ANY($1)`,
                    [mergePartIds]
                );
                impact.byTable[table] = parseInt(result.rows[0].count);
            } catch (error) {
                console.warn(`Error counting ${table}:`, error.message);
                impact.byTable[table] = 0;
            }
        }
        
        // Calculate inventory impact using inventory_transaction table
        impact.inventory = await this.calculateInventoryImpact(mergePartIds);
        
        return impact;
    }

    async calculateInventoryImpact(mergePartIds) {
        // No inventory_locations table; infer stock from inventory_transaction
        // Calculate combined inventory for merge parts only
        const stockResult = await this.db.query(
            `SELECT part_id, COALESCE(SUM(quantity),0) AS stock_on_hand FROM public.inventory_transaction WHERE part_id = ANY($1) GROUP BY part_id`,
            [mergePartIds]
        );
        const wacResult = await this.db.query(
            `SELECT part_id, COALESCE(wac_cost,0) AS wac_cost FROM public.part WHERE part_id = ANY($1)`,
            [mergePartIds]
        );

        const stockByPart = Object.fromEntries(stockResult.rows.map(r => [String(r.part_id), Number(r.stock_on_hand)]));
        const wacByPart = Object.fromEntries(wacResult.rows.map(r => [String(r.part_id), Number(r.wac_cost)]));

        let totalQty = 0;
        let totalCost = 0;
        for (const id of mergePartIds) {
            const qty = stockByPart[String(id)] || 0;
            const wac = wacByPart[String(id)] || 0;
            totalQty += qty;
            totalCost += qty * wac;
        }
        const avgWac = totalQty > 0 ? totalCost / totalQty : 0;

        return {
            // Present a single consolidated pseudo-location for the UI
            locations: [
                { location_id: 'all', quantity: totalQty, avg_wac: avgWac }
            ]
        };
    }

    async detectConflicts(keepPart, mergeParts, _rules) {
        const conflicts = [];
        
        // Check for unique constraint conflicts
        const allPartNumbers = [
            ...(keepPart.part_numbers || []),
            ...mergeParts.flatMap(p => p.part_numbers || [])
        ];
        
        const partNumberCounts = {};
        allPartNumbers.forEach(pn => {
            const key = `${pn.part_number}_${pn.part_number_type}`;
            partNumberCounts[key] = (partNumberCounts[key] || 0) + 1;
        });
        
        Object.entries(partNumberCounts).forEach(([key, count]) => {
            if (count > 1) {
                conflicts.push({
                    type: 'duplicate_part_number',
                    description: `Duplicate part number: ${key.split('_')[0]}`,
                    severity: 'warning'
                });
            }
        });
        
        return conflicts;
    }

    generateWarnings(impact, conflicts) {
        const warnings = [];
        
        const totalRecords = Object.values(impact.byTable).reduce((sum, count) => sum + count, 0);
        if (totalRecords > 1000) {
            warnings.push(`Large merge operation: ${totalRecords} records will be updated`);
        }
        
        if (conflicts.length > 0) {
            warnings.push(`${conflicts.length} potential conflicts detected`);
        }
        
        return warnings;
    }

    async lockParts(client, partIds) {
        // Every merge takes these locks in the same deterministic order. Other
        // workflows can adopt this key convention to serialize their writes
        // against a merge without retaining any lock after the transaction.
        for (const partId of [...partIds].sort((a, b) => Number(a) - Number(b))) {
            await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [partId]);
        }
        await client.query(
            'SELECT part_id FROM part WHERE part_id = ANY($1) ORDER BY part_id FOR UPDATE',
            [partIds]
        );
    }

    async createMergeOperation(client, actorEmployeeId, keepPartId, mergePartIds) {
        const { rows } = await client.query(`
            INSERT INTO part_merge_operation
                (actor_employee_id, keep_part_id, merged_part_ids, undo_expires_at)
            VALUES ($1, $2, $3::bigint[], NOW() + INTERVAL '24 hours')
            RETURNING operation_id, undo_expires_at
        `, [actorEmployeeId, keepPartId, mergePartIds]);
        return rows[0];
    }

    async captureMergeSnapshots(client, operationId, partIds) {
        for (const table of REVERTABLE_TABLES) {
            await client.query(`
                INSERT INTO part_merge_snapshot (operation_id, table_name, record_id, before_image)
                SELECT $1, $2, ${table.key}, to_jsonb(source)
                FROM ${table.name} source
                WHERE ${table.where}
                ON CONFLICT (operation_id, table_name, record_id) DO NOTHING
            `, [operationId, table.name, partIds]);
        }
    }

    async completeMergeOperation(client, operationId) {
        await client.query(`
            UPDATE part_merge_operation
            SET completed_at = NOW(), status = 'active'
            WHERE operation_id = $1 AND status = 'pending'
        `, [operationId]);
    }

    async getRevertableOperations(partId = null) {
        try {
            const { rows } = await this.db.query(`
                SELECT operation_id, keep_part_id, merged_part_ids, completed_at,
                       undo_expires_at, status
                FROM part_merge_operation
                WHERE status = 'active'
                  AND undo_expires_at > NOW()
                  AND ($1::bigint IS NULL OR keep_part_id = $1 OR $1 = ANY(merged_part_ids))
                ORDER BY completed_at DESC
            `, [partId]);
            return rows;
        } catch (error) {
            // A rolling deployment can serve the new page briefly before its
            // migration is applied. The optional undo panel must stay empty,
            // not break the entire cleanup workflow.
            if (error.code === '42P01') return [];
            throw error;
        }
    }

    async revertMerge(operationId, actorEmployeeId, reason) {
        if (!reason || !reason.trim()) throw new Error('A revert reason is required');
        const client = await this.db.getClient();
        try {
            await client.query('BEGIN');
            const { rows } = await client.query(`
                SELECT * FROM part_merge_operation
                WHERE operation_id = $1
                FOR UPDATE
            `, [operationId]);
            const operation = rows[0];
            if (!operation) throw new Error('Merge operation not found');
            if (operation.status !== 'active' || new Date(operation.undo_expires_at) <= new Date()) {
                await client.query(`UPDATE part_merge_operation SET status = 'expired'
                                    WHERE operation_id = $1 AND status = 'active'`, [operationId]);
                throw new Error('This merge is no longer eligible for revert');
            }

            const partIds = [operation.keep_part_id, ...operation.merged_part_ids];
            await this.lockParts(client, partIds);
            await this.assertRevertIsSafe(client, operation, partIds);
            await this.restoreMergeSnapshots(client, operationId, partIds);
            await client.query(`
                UPDATE part_merge_operation
                SET status = 'reverted', reverted_at = NOW(),
                    reverted_by_employee_id = $2, revert_reason = $3
                WHERE operation_id = $1
            `, [operationId, actorEmployeeId, reason.trim()]);
            for (const partId of partIds) {
                await enqueuePartUpsert(partId, { source: 'partMergeService.revert', version_ts: new Date().toISOString() }, client);
            }
            await client.query('COMMIT');
            return { operationId, restoredPartIds: partIds };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async assertRevertIsSafe(client, operation, partIds) {
        const partChanges = await client.query(`
            SELECT part_id FROM part
            WHERE part_id = ANY($1::bigint[])
              AND date_modified > $2
        `, [partIds, operation.completed_at]);
        if (partChanges.rows.length) {
            throw new Error('Cannot revert: a merged part was edited after the merge');
        }

        const inventoryChanges = await client.query(`
            SELECT it.inv_trans_id
            FROM inventory_transaction it
            WHERE it.part_id = ANY($1::bigint[])
              AND it.transaction_date > $2
              AND NOT EXISTS (
                  SELECT 1 FROM part_merge_snapshot s
                  WHERE s.operation_id = $3
                    AND s.table_name = 'inventory_transaction'
                    AND s.record_id = it.inv_trans_id::text
              )
            LIMIT 1
        `, [partIds, operation.completed_at, operation.operation_id]);
        if (inventoryChanges.rows.length) {
            throw new Error('Cannot revert: inventory activity occurred after the merge');
        }
    }

    async restoreMergeSnapshots(client, operationId, partIds) {
        // Remove the merge-era representation first. Rows with the original
        // primary keys are then restored from immutable before-images.
        for (const table of REVERTABLE_TABLES.filter(t => t.name !== 'part')) {
            await client.query(`DELETE FROM ${table.name} WHERE ${table.where}`, [partIds]);
        }

        const { rows: columns } = await client.query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'part'
            ORDER BY ordinal_position
        `);
        const writable = columns.map(r => r.column_name).filter(column => column !== 'part_id');
        const assignments = writable.map(column => `"${column}" = restored."${column}"`).join(', ');
        await client.query(`
            UPDATE part current
            SET ${assignments}
            FROM part_merge_snapshot snapshot
            CROSS JOIN LATERAL jsonb_populate_record(NULL::part, snapshot.before_image) restored
            WHERE snapshot.operation_id = $1
              AND snapshot.table_name = 'part'
              AND current.part_id = restored.part_id
        `, [operationId]);

        for (const table of REVERTABLE_TABLES.filter(t => t.name !== 'part')) {
            await client.query(`
                INSERT INTO ${table.name}
                SELECT (jsonb_populate_record(NULL::${table.name}, before_image)).*
                FROM part_merge_snapshot
                WHERE operation_id = $1 AND table_name = $2
            `, [operationId, table.name]);
        }
    }

    async purgeExpiredMergeSnapshots() {
        const client = await this.db.getClient();
        try {
            await client.query('BEGIN');
            await client.query(`
                UPDATE part_merge_operation
                SET status = 'expired'
                WHERE status = 'active' AND undo_expires_at <= NOW()
            `);
            const result = await client.query(`
                DELETE FROM part_merge_snapshot snapshot
                USING part_merge_operation operation
                WHERE snapshot.operation_id = operation.operation_id
                  AND operation.undo_expires_at < NOW() - INTERVAL '90 days'
                RETURNING snapshot.operation_id
            `);
            await client.query('COMMIT');
            return result.rowCount;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async updateKeepPart(client, keepPartId, keepPart, mergeParts, rules) {
        const updateFields = [];
        const params = [keepPartId];
        let paramIndex = 2;
        
        // Update basic fields if overridden
        if (rules.fieldOverrides) {
            // Map UI override names to actual column names where needed
            const fieldMap = {
                // UI name : DB column
                detail: 'detail',
                brand_id: 'brand_id',
                group_id: 'group_id',
                is_active: 'is_active',
                is_service: 'is_service',
                cost_price: 'last_cost',
                sale_price: 'last_sale_price',
                internal_sku: 'internal_sku',
                tax_rate_id: 'tax_rate_id'
            };
            // Ensure field overrides actually match a part being merged
            for (const [field, value] of Object.entries(rules.fieldOverrides)) {
                if (fieldMap[field]) {
                    // Make sure the value actually exists on keepPart or mergeParts
                    // Special case for boolean overrides since they aren't part-specific ID swaps
                    let isValueValid = false;
                    if (typeof value === 'boolean') {
                        isValueValid = true;
                    } else if (field === 'brand_id' || field === 'group_id' || field === 'tax_rate_id') {
                        // For IDs, check if any of the merged parts or the keep part has this value
                        isValueValid = (keepPart[fieldMap[field]] === value) ||
                            mergeParts.some(p => p[fieldMap[field]] === value);
                    } else {
                        // For other fields like string and numbers
                        isValueValid = true;
                    }

                    if (isValueValid) {
                        updateFields.push(`${fieldMap[field]} = $${paramIndex}`);
                        params.push(value);
                        paramIndex++;
                    }
                }
            }
        }
        
        if (updateFields.length > 0) {
            updateFields.push(`date_modified = NOW()`);
            await client.query(
                `UPDATE part SET ${updateFields.join(', ')} WHERE part_id = $1`,
                params
            );
        }
    }

    async mergeChildRecords(client, keepPartId, mergePartIds, rules) {
        const counts = {};
        
        // Merge part_number
        if (rules.mergePartNumbers) {
            // Retire source aliases already present on the keep part before moving
            // anything. The partial unique index only allows one active alias per
            // part, so cleanup after an UPDATE is too late.
            await client.query(`
                UPDATE part_number pn
                SET deleted_at = NOW()
                WHERE pn.part_id = ANY($2)
                  AND pn.deleted_at IS NULL
                  AND EXISTS (
                      SELECT 1
                      FROM part_number keep_pn
                      WHERE keep_pn.part_id = $1
                        AND keep_pn.part_number = pn.part_number
                        AND keep_pn.deleted_at IS NULL
                  )
            `, [keepPartId, mergePartIds]);

            // Delete surplus source aliases before moving the single winner for
            // each number. The dependency on retired makes this safe with the
            // immediate partial unique index during this statement.
            const result = await client.query(`
                WITH ranked AS (
                    SELECT pn.part_number_id,
                           ROW_NUMBER() OVER (
                               PARTITION BY pn.part_number
                               ORDER BY pn.part_number_id
                           ) AS rn
                    FROM part_number pn
                    WHERE pn.part_id = ANY($2)
                      AND pn.deleted_at IS NULL
                ), retired AS (
                    UPDATE part_number pn
                    SET deleted_at = NOW()
                    FROM ranked r
                    WHERE pn.part_number_id = r.part_number_id
                      AND r.rn > 1
                    RETURNING pn.part_number_id
                ), reassigned AS (
                    UPDATE part_number pn
                    SET part_id = $1
                    FROM ranked r
                    CROSS JOIN (SELECT COUNT(*) FROM retired) AS retired_count
                    WHERE pn.part_number_id = r.part_number_id
                      AND r.rn = 1
                    RETURNING pn.part_number_id
                )
                SELECT COUNT(*)::integer AS reassigned_count FROM reassigned
            `, [keepPartId, mergePartIds]);
            counts.part_numbers = result.rows[0].reassigned_count;
        }
        
        // Merge part_application
        if (rules.mergeApplications) {
            // Remove links already represented on the keep part before changing
            // their part_id, otherwise the immediate unique constraint fires.
            await client.query(`
                DELETE FROM part_application pa
                WHERE pa.part_id = ANY($2)
                  AND EXISTS (
                      SELECT 1
                      FROM part_application keep_pa
                      WHERE keep_pa.part_id = $1
                        AND keep_pa.application_id = pa.application_id
                  )
            `, [keepPartId, mergePartIds]);

            const result = await client.query(`
                WITH ranked AS (
                    SELECT pa.part_app_id,
                           ROW_NUMBER() OVER (
                               PARTITION BY pa.application_id
                               ORDER BY pa.part_app_id
                           ) AS rn
                    FROM part_application pa
                    WHERE pa.part_id = ANY($2)
                ), retired AS (
                    DELETE FROM part_application pa
                    USING ranked r
                    WHERE pa.part_app_id = r.part_app_id
                      AND r.rn > 1
                    RETURNING pa.part_app_id
                ), reassigned AS (
                    UPDATE part_application pa
                    SET part_id = $1
                    FROM ranked r
                    CROSS JOIN (SELECT COUNT(*) FROM retired) AS retired_count
                    WHERE pa.part_app_id = r.part_app_id
                      AND r.rn = 1
                    RETURNING pa.part_app_id
                )
                SELECT COUNT(*)::integer AS reassigned_count FROM reassigned
            `, [keepPartId, mergePartIds]);
            counts.part_applications = result.rows[0].reassigned_count;
        }

        // Barcodes live in part_barcode, not part. The barcode is globally unique,
        // but retire an anomalous source duplicate first so a merge stays safe even
        // if historical data was imported without that constraint.
        await client.query(`
            DELETE FROM part_barcode pb
            WHERE pb.part_id = ANY($2)
              AND EXISTS (
                  SELECT 1
                  FROM part_barcode keep_pb
                  WHERE keep_pb.part_id = $1
                    AND keep_pb.barcode = pb.barcode
              )
        `, [keepPartId, mergePartIds]);
        const barcodeResult = await client.query(`
            UPDATE part_barcode
            SET part_id = $1
            WHERE part_id = ANY($2)
            RETURNING barcode_id
        `, [keepPartId, mergePartIds]);
        counts.barcodes = barcodeResult.rowCount;

        // --- §4-A: part_tag (Move) ---
        // PK is (part_id, tag_id). Delete source tags already on the keep part,
        // then reassign the rest. Gated on rules.mergeTags (default: true).
        if (rules.mergeTags !== false) {
            await client.query(`
                DELETE FROM part_tag
                WHERE part_id = ANY($2)
                  AND tag_id IN (
                      SELECT tag_id FROM part_tag WHERE part_id = $1
                  )
            `, [keepPartId, mergePartIds]);
            const tagResult = await client.query(`
                UPDATE part_tag SET part_id = $1
                WHERE part_id = ANY($2)
                RETURNING tag_id
            `, [keepPartId, mergePartIds]);
            counts.part_tags = tagResult.rowCount;
        }

        // --- §4-A: part_inventory_stats (Aggregate) ---
        // PK is part_id — cannot bulk-move. Merge into survivor row (latest
        // last_counted_at, OR audit_requested), then delete source rows.
        const statsResult = await client.query(`
            INSERT INTO part_inventory_stats (part_id, last_counted_at, audit_requested)
            SELECT
                $1,
                MAX(last_counted_at),
                BOOL_OR(COALESCE(audit_requested, false))
            FROM part_inventory_stats
            WHERE part_id = ANY($2::int[])
            ON CONFLICT (part_id) DO UPDATE
                SET last_counted_at = GREATEST(
                        part_inventory_stats.last_counted_at,
                        EXCLUDED.last_counted_at
                    ),
                    audit_requested = part_inventory_stats.audit_requested
                        OR EXCLUDED.audit_requested
            RETURNING part_id
        `, [keepPartId, mergePartIds]);
        await client.query(
            `DELETE FROM part_inventory_stats WHERE part_id = ANY($1)`,
            [mergePartIds]
        );
        counts.part_inventory_stats = statsResult.rowCount;

        // --- §4-A: existing part_aliases rows (Move + reconcile) ---
        // createAliases() writes new provenance aliases. Here we move any
        // pre-existing alias rows that belong to source parts.
        // Skip rows whose alias_value+alias_type already exist on the survivor.
        const aliasResult = await client.query(`
            UPDATE part_aliases
            SET part_id = $1
            WHERE part_id = ANY($2)
              AND NOT EXISTS (
                  SELECT 1 FROM part_aliases keep_a
                  WHERE keep_a.part_id       = $1
                    AND keep_a.alias_value   = part_aliases.alias_value
                    AND keep_a.alias_type    = part_aliases.alias_type
              )
            RETURNING id
        `, [keepPartId, mergePartIds]);
        // Delete any source alias rows that were exact duplicates of survivor rows
        // (the NOT EXISTS guard above left them untouched).
        await client.query(
            `DELETE FROM part_aliases WHERE part_id = ANY($1)`,
            [mergePartIds]
        );
        counts.part_aliases_reconciled = aliasResult.rowCount;

        // --- §4-A: staged_sale_line open drafts (Move, P2 decision) ---
        // Only move lines in sales that are not yet approved or rejected.
        // Completed/approved sales preserve the original source part identity
        // so historical receipts remain attributable to the correct part.
        const stagingResult = await client.query(`
            UPDATE staged_sale_line ssl
            SET part_id = $1
            FROM staged_sale ss
            WHERE ssl.staged_sale_id = ss.staged_sale_id
              AND ssl.part_id = ANY($2)
              AND ss.status NOT IN ('APPROVED', 'REJECTED')
            RETURNING ssl.staged_line_id
        `, [keepPartId, mergePartIds]);
        counts.staged_sale_lines_moved = stagingResult.rowCount;

        // --- §4-B: dedupe_scan_queue (Rebuild) ---
        // Queue entries for source parts are meaningless after merge.
        // The survivor will be re-enqueued by the normal scan cycle.
        await client.query(
            `DELETE FROM dedupe_scan_queue WHERE part_id = ANY($1)`,
            [mergePartIds]
        );

        // --- §4-B: ai_match_cache / ai_verification_queue (Rebuild) ---
        // Cache and queue pairs involving source parts are stale post-merge.
        await client.query(`
            DELETE FROM ai_match_cache
            WHERE part_id_1 = ANY($1) OR part_id_2 = ANY($1)
        `, [mergePartIds]);
        await client.query(`
            DELETE FROM ai_verification_queue
            WHERE part_id_1 = ANY($1) OR part_id_2 = ANY($1)
        `, [mergePartIds]);

        // --- §4-B: part_exclusion (Transfer) ---
        // Remap exclusion pairs that reference source parts to the survivor.
        // PK is (part_id_1, part_id_2) — ON CONFLICT DO NOTHING avoids
        // duplicating pairs that already exist for the survivor.
        // After insertion, remove self-pairs (survivor, survivor) and the
        // original source rows.
        await client.query(`
            INSERT INTO part_exclusion (part_id_1, part_id_2)
            SELECT
                CASE WHEN part_id_1 = ANY($2) THEN $1 ELSE part_id_1 END,
                CASE WHEN part_id_2 = ANY($2) THEN $1 ELSE part_id_2 END
            FROM part_exclusion
            WHERE part_id_1 = ANY($2) OR part_id_2 = ANY($2)
            ON CONFLICT DO NOTHING
        `, [keepPartId, mergePartIds]);
        await client.query(
            `DELETE FROM part_exclusion WHERE part_id_1 = $1 AND part_id_2 = $1`,
            [keepPartId]
        );
        await client.query(`
            DELETE FROM part_exclusion
            WHERE part_id_1 = ANY($1) OR part_id_2 = ANY($1)
        `, [mergePartIds]);

        // --- §4-C: Preserve (explicit no-op) ---
        // The following tables are intentionally left with their original part_id.
        // Callers resolve current catalog identity via part.merged_into_part_id:
        //
        //   goods_receipt_line, invoice_line, purchase_order_line, credit_note_line
        //     P1 decision: historical transaction documents retain original attribution.
        //
        //   cycle_count_line, cycle_count_audit_log
        //     P3 decision: count snapshots are historical; do not re-attribute.
        //
        //   stock_reconciliation_log, wac_correction_audit_log, wac_repair_log
        //     Immutable audit logs — never rewritten.

        return counts;
    }

    async reassignForeignKeys(client, keepPartId, mergePartIds) {
        // inventory_transaction follows the survivor after consolidateInventory()
        // has taken its original-owner stock snapshot.
        //
        // goods_receipt_line, invoice_line, purchase_order_line, credit_note_line are
        // intentionally NOT reassigned here (P1 decision — see §4-C comment in
        // mergeChildRecords). Callers resolve current catalog identity via
        // part.merged_into_part_id joins in reports.
        const result = await client.query(
            `UPDATE inventory_transaction SET part_id = $1 WHERE part_id = ANY($2)`,
            [keepPartId, mergePartIds]
        );
        return { inventory_transaction: result.rowCount };
    }


    async consolidateInventory(client, keepPartId, mergePartIds) {
        const allPartIds = [keepPartId, ...mergePartIds];

        // Calculate combined weighted average cost across all parts being merged.
        // We read quantities before reassignForeignKeys() changes their owner.
        // Per-part WAC captures how each part's stock was valued independently.
        const wacResult = await client.query(`
            WITH stock_qty AS (
                SELECT part_id, COALESCE(SUM(quantity), 0) AS stock_on_hand
                FROM inventory_transaction
                WHERE part_id = ANY($1)
                GROUP BY part_id
            )
            SELECT
                p.part_id,
                COALESCE(p.wac_cost, 0)       AS wac_cost,
                COALESCE(sq.stock_on_hand, 0)  AS qty
            FROM part p
            LEFT JOIN stock_qty sq ON p.part_id = sq.part_id
            WHERE p.part_id = ANY($1)
        `, [allPartIds]);

        let totalValue = 0;
        let totalQty   = 0;

        for (const row of wacResult.rows) {
            const qty = Number(row.qty);
            const wac = Number(row.wac_cost);
            // Include all signed quantities so that returns/adjustments (negative qty)
            // correctly reduce the cost pool. Skipping non-positive parts overstates WAC.
            totalValue += qty * wac;
            totalQty   += qty;
        }

        // If combined net quantity is ≤ 0 (fully returned stock), retain the
        // survivor's existing WAC rather than zeroing — zeroing would corrupt the
        // cost basis for any future receipts on the same part.
        let newWac;
        if (totalQty > 0) {
            newWac = totalValue / totalQty;
        } else {
            const keepRow = wacResult.rows.find(r => String(r.part_id) === String(keepPartId));
            newWac = keepRow ? Number(keepRow.wac_cost) : 0;
        }

        await client.query(
            `UPDATE part SET wac_cost = $1 WHERE part_id = $2`,
            [newWac, keepPartId]
        );

        return { inventory_consolidated: totalQty, new_wac: newWac };
    }

    async createAliases(client, keepPartId, mergeParts, _rules) {
        const aliases = [];
        
        for (const part of mergeParts) {
            // Create SKU alias
            aliases.push({
                part_id: keepPartId,
                alias_value: part.internal_sku,
                alias_type: 'sku',
                source_part_id: part.part_id
            });
            
            // Create display name alias
            if (part.display_name) {
                aliases.push({
                    part_id: keepPartId,
                    alias_value: part.display_name,
                    alias_type: 'display_name',
                    source_part_id: part.part_id
                });
            }
            
            // Create part number aliases
            if (part.part_numbers && part.part_numbers.length > 0) {
                for (const pn of part.part_numbers) {
                    aliases.push({
                        part_id: keepPartId,
                        alias_value: pn.part_number,
                        alias_type: 'part_number',
                        source_part_id: part.part_id
                    });
                }
            }
        }
        
        if (aliases.length > 0) {
            const values = aliases.map((alias, index) => 
                `($${index * 4 + 1}, $${index * 4 + 2}, $${index * 4 + 3}, $${index * 4 + 4})`
            ).join(', ');
            
            const params = aliases.flatMap(alias => [
                alias.part_id, alias.alias_value, alias.alias_type, alias.source_part_id
            ]);
            
            await client.query(`
                INSERT INTO part_aliases (part_id, alias_value, alias_type, source_part_id)
                VALUES ${values}
                ON CONFLICT (alias_value, alias_type) DO NOTHING
            `, params);
        }
    }

    async markPartsAsMerged(client, mergePartIds, keepPartId) {
        await client.query(`
            UPDATE part 
            SET merged_into_part_id = $1, 
                is_active = false,
                date_modified = NOW()
            WHERE part_id = ANY($2)
        `, [keepPartId, mergePartIds]);
        
        // Mark part_number records of merged parts as deleted
        await client.query(`
            UPDATE part_number 
            SET deleted_at = NOW(), 
                deleted_by = (SELECT created_by FROM part WHERE part_id = $1 LIMIT 1)
            WHERE part_id = ANY($2)
        `, [keepPartId, mergePartIds]);
    }

    async logMergeOperations(client, actorEmployeeId, keepPartId, mergePartIds, rules, counts) {
        const logEntries = mergePartIds.map(mergedPartId => [
            actorEmployeeId,
            keepPartId,
            mergedPartId,
            JSON.stringify(rules.fieldOverrides || {}),
            JSON.stringify(rules),
            JSON.stringify(counts),
            JSON.stringify([])
        ]);
        
        const values = logEntries.map((_, index) => 
            `($${index * 7 + 1}, $${index * 7 + 2}, $${index * 7 + 3}, $${index * 7 + 4}, $${index * 7 + 5}, $${index * 7 + 6}, $${index * 7 + 7})`
        ).join(', ');
        
        const params = logEntries.flat();
        
        await client.query(`
            INSERT INTO part_merge_log 
            (actor_employee_id, keep_part_id, merged_part_id, field_overrides, merge_rules, updated_counts, warnings)
            VALUES ${values}
        `, params);
    }

    async syncMeilisearch(keepPartId, mergePartIds) {
        let syncPartWithMeili;

        try {
            ({ syncPartWithMeili } = require('../meilisearch'));
        } catch (error) {
            console.error('Error loading Meilisearch module during part merge sync:', error);
            return;
        }

        try {
            const keepPart = await this.getPartDetails(keepPartId);
            await syncPartWithMeili(keepPart);
        } catch (error) {
            console.error(`Error syncing keep part ${keepPartId} with Meilisearch:`, error);
        }

        for (const mergedPartId of mergePartIds) {
            try {
                const mergedPart = await this.getPartDetails(mergedPartId);
                await syncPartWithMeili(mergedPart);
            } catch (error) {
                console.error(`Error syncing merged part ${mergedPartId} with Meilisearch:`, error);
            }
        }
    }

    deduplicatePartNumbers(partNumbers) {
        const seen = new Set();
        return partNumbers.filter(pn => {
            const key = `${pn.part_number}_${pn.part_number_type}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    deduplicateApplications(applications) {
        const seen = new Set();
        return applications.filter(app => {
            const key = app.application_id;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    /**
     * Get merge history for a part
     * @param {number} partId - Part ID
     * @returns {Array} Merge history
     */
    async getMergeHistory(partId) {
        const result = await this.db.query(`
            SELECT 
                pml.*,
                e.first_name || ' ' || e.last_name as actor_name,
                kp.internal_sku as keep_part_sku,
                mp.internal_sku as merged_part_sku
            FROM part_merge_log pml
            LEFT JOIN employee e ON pml.actor_employee_id = e.employee_id
            LEFT JOIN part kp ON pml.keep_part_id = kp.part_id
            LEFT JOIN part mp ON pml.merged_part_id = mp.part_id
            WHERE pml.keep_part_id = $1 OR pml.merged_part_id = $1
            ORDER BY pml.merged_at DESC
        `, [partId]);
        
        return result.rows;
    }
}

module.exports = PartMergeService;
