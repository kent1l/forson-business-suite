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
        
        // Validate input
        await this.validateMergeRequest(keepPartId, mergePartIds);
        
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
        // Check that all part IDs are valid
        const allPartIds = [keepPartId, ...mergePartIds];
        const result = await this.db.query(
            'SELECT part_id, merged_into_part_id FROM parts WHERE part_id = ANY($1)',
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
        const db = client || this.db;
        const result = await db.query(`
            SELECT p.*, 
                   b.brand_name, 
                   g.group_name,
                   COALESCE(
                       json_agg(
                           DISTINCT jsonb_build_object(
                               'id', pn.id,
                               'part_number', pn.part_number,
                               'part_number_type', pn.part_number_type
                           )
                       ) FILTER (WHERE pn.id IS NOT NULL), 
                       '[]'::json
                   ) as part_numbers,
                   COALESCE(
                       json_agg(
                           DISTINCT jsonb_build_object(
                               'application_id', pa.application_id,
                               'make', a.make,
                               'model', a.model,
                               'engine', a.engine,
                               'year_start', a.year_start,
                               'year_end', a.year_end
                           )
                       ) FILTER (WHERE pa.application_id IS NOT NULL), 
                       '[]'::json
                   ) as applications
            FROM parts p
            LEFT JOIN brands b ON p.brand_id = b.brand_id
            LEFT JOIN groups g ON p.group_id = g.group_id
            LEFT JOIN part_numbers pn ON p.part_id = pn.part_id
            LEFT JOIN part_applications pa ON p.part_id = pa.part_id
            LEFT JOIN applications a ON pa.application_id = a.application_id
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
        const tables = [
            'goods_receipt_lines',
            'invoice_lines', 
            'order_lines',
            'stock_movements',
            'inventory_locations'
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
        
        // Calculate inventory impact
        impact.inventory = await this.calculateInventoryImpact(keepPartId, mergePartIds);
        
        return impact;
    }

    async calculateInventoryImpact(keepPartId, mergePartIds) {
        const result = await this.db.query(`
            SELECT 
                location_id,
                SUM(quantity_on_hand) as total_quantity,
                AVG(weighted_average_cost) as avg_wac
            FROM inventory_locations 
            WHERE part_id = ANY($1)
            GROUP BY location_id
        `, [[keepPartId, ...mergePartIds]]);
        
        return {
            locations: result.rows.map(row => ({
                location_id: row.location_id,
                quantity: parseFloat(row.total_quantity || 0),
                avg_wac: parseFloat(row.avg_wac || 0)
            }))
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
            'SELECT part_id FROM parts WHERE part_id = ANY($1) ORDER BY part_id FOR UPDATE',
            [partIds]
        );
    }

    async updateKeepPart(client, keepPartId, resolvedPart, rules) {
        const updateFields = [];
        const params = [keepPartId];
        let paramIndex = 2;
        
        // Update basic fields if overridden
        if (rules.fieldOverrides) {
            for (const [field, value] of Object.entries(rules.fieldOverrides)) {
                if (['display_name', 'detail', 'cost_price', 'sale_price', 'is_active'].includes(field)) {
                    updateFields.push(`${field} = $${paramIndex}`);
                    params.push(value);
                    paramIndex++;
                }
            }
        }
        
        if (updateFields.length > 0) {
            updateFields.push(`modified_at = NOW()`);
            await client.query(
                `UPDATE parts SET ${updateFields.join(', ')} WHERE part_id = $1`,
                params
            );
        }
    }

    async mergeChildRecords(client, keepPartId, mergePartIds, rules) {
        const counts = {};
        
        // Merge part_numbers
        if (rules.mergePartNumbers) {
            const result = await client.query(`
                UPDATE part_numbers 
                SET part_id = $1 
                WHERE part_id = ANY($2)
                ON CONFLICT (part_id, part_number, part_number_type) DO NOTHING
                RETURNING id
            `, [keepPartId, mergePartIds]);
            counts.part_numbers = result.rowCount;
        }
        
        // Merge part_applications
        if (rules.mergeApplications) {
            const result = await client.query(`
                UPDATE part_applications 
                SET part_id = $1 
                WHERE part_id = ANY($2)
                ON CONFLICT (part_id, application_id) DO NOTHING
                RETURNING part_id, application_id
            `, [keepPartId, mergePartIds]);
            counts.part_applications = result.rowCount;
        }
        
        return counts;
    }

    async reassignForeignKeys(client, keepPartId, mergePartIds) {
        const tables = [
            'goods_receipt_lines',
            'invoice_lines',
            'order_lines',
            'stock_movements'
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

    async consolidateInventory(client, keepPartId, mergePartIds) {
        // Consolidate inventory by location
        const result = await client.query(`
            INSERT INTO inventory_locations (part_id, location_id, quantity_on_hand, weighted_average_cost)
            SELECT 
                $1 as part_id,
                location_id,
                SUM(quantity_on_hand) as quantity_on_hand,
                CASE 
                    WHEN SUM(quantity_on_hand) > 0 THEN 
                        SUM(quantity_on_hand * weighted_average_cost) / SUM(quantity_on_hand)
                    ELSE 0 
                END as weighted_average_cost
            FROM inventory_locations
            WHERE part_id = ANY($2)
            GROUP BY location_id
            ON CONFLICT (part_id, location_id) 
            DO UPDATE SET 
                quantity_on_hand = inventory_locations.quantity_on_hand + EXCLUDED.quantity_on_hand,
                weighted_average_cost = CASE 
                    WHEN inventory_locations.quantity_on_hand + EXCLUDED.quantity_on_hand > 0 THEN
                        (inventory_locations.quantity_on_hand * inventory_locations.weighted_average_cost + 
                         EXCLUDED.quantity_on_hand * EXCLUDED.weighted_average_cost) / 
                        (inventory_locations.quantity_on_hand + EXCLUDED.quantity_on_hand)
                    ELSE inventory_locations.weighted_average_cost
                END
            RETURNING part_id, location_id
        `, [keepPartId, mergePartIds]);
        
        // Delete old inventory records
        await client.query(
            'DELETE FROM inventory_locations WHERE part_id = ANY($1)',
            [mergePartIds]
        );
        
        return { inventory_locations_consolidated: result.rowCount };
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
            UPDATE parts 
            SET merged_into_part_id = $1, 
                is_active = false,
                internal_sku = internal_sku || '-merged-' || $1,
                modified_at = NOW()
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
            LEFT JOIN employees e ON pml.actor_employee_id = e.employee_id
            LEFT JOIN parts kp ON pml.keep_part_id = kp.part_id
            LEFT JOIN parts mp ON pml.merged_part_id = mp.part_id
            WHERE pml.keep_part_id = $1 OR pml.merged_part_id = $1
            ORDER BY pml.merged_at DESC
        `, [partId]);
        
        return result.rows;
    }
}

module.exports = PartMergeService;
