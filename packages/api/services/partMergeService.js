const DuplicateFinder = require('./duplicateFinder');

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
        
        // Validate again before execution
        await this.validateMergeRequest(keepPartId, mergePartIds);
        
        const client = await this.db.connect();
        try {
            await client.query('BEGIN');
            
            // Lock the parts to prevent concurrent modifications
            await this.lockParts(client, [keepPartId, ...mergePartIds]);
            
            // Get current part data
            const keepPart = await this.getPartDetails(keepPartId, client);
            const mergeParts = await Promise.all(
                mergePartIds.map(id => this.getPartDetails(id, client))
            );
            
            // Calculate the final merged part data
            const resolvedPart = this.calculateResolvedPart(keepPart, mergeParts, rules);
            
            // Update the keep part with merged data
            await this.updateKeepPart(client, keepPartId, resolvedPart, rules);
            
            // Merge child records (part_numbers, applications, etc.)
            const childUpdateCounts = await this.mergeChildRecords(client, keepPartId, mergePartIds, rules);
            
            // Reassign all foreign key references
            const fkUpdateCounts = await this.reassignForeignKeys(client, keepPartId, mergePartIds);
            
            // Handle inventory consolidation if applicable
            const inventoryUpdateCounts = await this.consolidateInventory(client, keepPartId, mergePartIds);
            
            // Create aliases for old SKUs/part numbers
            await this.createAliases(client, keepPartId, mergeParts, rules);
            
            // Mark source parts as merged
            await this.markPartsAsMerged(client, mergePartIds, keepPartId);
            
            // Log the merge operation
            await this.logMergeOperations(client, actorEmployeeId, keepPartId, mergePartIds, rules, {
                ...childUpdateCounts,
                ...fkUpdateCounts,
                ...inventoryUpdateCounts
            });
            
            await client.query('COMMIT');
            
            // Sync with Meilisearch (outside transaction)
            await this.syncMeilisearch(keepPartId, mergePartIds);
            
            return {
                keepPartId,
                mergedPartIds: mergePartIds,
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

    async validateMergeRequest(keepPartId, mergePartIds) {
        if (!Array.isArray(mergePartIds) || mergePartIds.length === 0) {
            throw new Error('mergePartIds array is required and must not be empty');
        }
        
        // Check that all part IDs are valid
        const allPartIds = [keepPartId, ...mergePartIds];
        const result = await this.db.query(
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
                               'engine', ve.engine_name
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
            LEFT JOIN vehicle_engine ve ON a.engine_id = ve.engine_id
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
        await client.query(
            'SELECT part_id FROM part WHERE part_id = ANY($1) ORDER BY part_id FOR UPDATE',
            [partIds]
        );
    }

    async updateKeepPart(client, keepPartId, resolvedPart, rules) {
        const updateFields = [];
        const params = [keepPartId];
        let paramIndex = 2;
        
        // Update basic fields if overridden
        if (rules.fieldOverrides) {
            // Map UI override names to actual column names where needed
            const fieldMap = {
                // UI name : DB column
                detail: 'detail',
                barcode: 'barcode',
                brand_id: 'brand_id',
                group_id: 'group_id',
                is_active: 'is_active',
                cost_price: 'last_cost',
                sale_price: 'last_sale_price',
                internal_sku: 'internal_sku',
                tax_rate_id: 'tax_rate_id'
            };
            for (const [field, value] of Object.entries(rules.fieldOverrides)) {
                if (fieldMap[field]) {
                    updateFields.push(`${fieldMap[field]} = $${paramIndex}`);
                    params.push(value);
                    paramIndex++;
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
            const result = await client.query(`
                UPDATE part_number 
                SET part_id = $1 
                WHERE part_id = ANY($2)
                RETURNING part_number_id
            `, [keepPartId, mergePartIds]);
            counts.part_numbers = result.rowCount;
            // Remove duplicates after reassignment using unique(part_id, part_number)
            await client.query(`
                DELETE FROM part_number pn
                USING part_number pn2
                WHERE pn.part_id = $1
                  AND pn.part_id = pn2.part_id
                  AND pn.part_number = pn2.part_number
                  AND pn.part_number_id > pn2.part_number_id
            `, [keepPartId]);
        }
        
        // Merge part_application
        if (rules.mergeApplications) {
            const result = await client.query(`
                UPDATE part_application 
                SET part_id = $1 
                WHERE part_id = ANY($2)
                RETURNING part_app_id
            `, [keepPartId, mergePartIds]);
            counts.part_applications = result.rowCount;
            // Remove duplicates after reassignment using unique(part_id, application_id)
            await client.query(`
                DELETE FROM part_application pa
                USING part_application pa2
                WHERE pa.part_id = $1
                  AND pa.part_id = pa2.part_id
                  AND pa.application_id = pa2.application_id
                  AND pa.part_app_id > pa2.part_app_id
            `, [keepPartId]);
        }
        
        return counts;
    }

    async reassignForeignKeys(client, keepPartId, mergePartIds) {
        const tables = [
            'goods_receipt_line',
            'invoice_line',
            'purchase_order_line',
            'credit_note_line',
            'inventory_transaction'
        ];
        
        const counts = {};
        
        for (const table of tables) {
            try {
                const result = await client.query(
                    `UPDATE ${table} SET part_id = $1 WHERE part_id = ANY($2)`,
                    [keepPartId, mergePartIds]
                );
                counts[table] = result.rowCount;
            } catch (error) {
                console.warn(`Error updating ${table}:`, error.message);
                counts[table] = 0;
            }
        }
        
        return counts;
    }

    async consolidateInventory(_client, _keepPartId, _mergePartIds) {
        // No inventory_locations table; consolidation is achieved by FK reassignment on inventory_transaction
        return { inventory_consolidated: 0 };
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
                internal_sku = internal_sku || '-merged-' || $1,
                date_modified = NOW()
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
        try {
            const { syncPartWithMeili } = require('../meilisearch');
            
            // Sync the keep part
            const keepPart = await this.getPartDetails(keepPartId);
            await syncPartWithMeili(keepPart);
            
            // Remove merged parts from Meilisearch
            // This would depend on your Meilisearch setup
            console.log(`Synced part ${keepPartId} with Meilisearch, removed parts ${mergePartIds.join(', ')}`);
        } catch (error) {
            console.error('Error syncing with Meilisearch:', error);
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
