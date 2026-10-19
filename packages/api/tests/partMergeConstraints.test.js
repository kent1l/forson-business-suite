const db = require('../db');
const PartMergeService = require('../services/partMergeService');

// Exercise PostgreSQL constraints, not mocked query responses. Temporary tables
// shadow public tables on this connection; every test rolls back its fixtures.
describe('part merge PostgreSQL constraint regressions', () => {
    let client;
    let service;

    beforeEach(async () => {
        client = await db.getClient();
        await client.query('BEGIN');
        service = new PartMergeService(db);
        await client.query(`
            CREATE TEMP TABLE part_tag (part_id int, tag_id int,
                PRIMARY KEY (part_id, tag_id)) ON COMMIT DROP;
            CREATE TEMP TABLE part_aliases (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                part_id bigint NOT NULL, alias_value varchar(255) NOT NULL,
                alias_type varchar(50) NOT NULL, source_part_id bigint
            ) ON COMMIT DROP;
            CREATE TEMP TABLE part_exclusion (
                part_id_1 int, part_id_2 int, created_at timestamp DEFAULT now(),
                source varchar(50) DEFAULT 'USER', reason text,
                PRIMARY KEY (part_id_1, part_id_2), CHECK (part_id_1 < part_id_2)
            ) ON COMMIT DROP;
            CREATE TEMP TABLE part_barcode (barcode_id int, part_id int, barcode text) ON COMMIT DROP;
            CREATE TEMP TABLE part_inventory_stats (part_id int PRIMARY KEY,
                last_counted_at timestamp, audit_requested boolean) ON COMMIT DROP;
            CREATE TEMP TABLE staged_sale (staged_sale_id int, status text) ON COMMIT DROP;
            CREATE TEMP TABLE staged_sale_line (staged_line_id int, staged_sale_id int, part_id int) ON COMMIT DROP;
            CREATE TEMP TABLE dedupe_scan_queue (part_id int) ON COMMIT DROP;
            CREATE TEMP TABLE ai_match_cache (part_id_1 int, part_id_2 int) ON COMMIT DROP;
            CREATE TEMP TABLE ai_verification_queue (part_id_1 int, part_id_2 int) ON COMMIT DROP;
        `);
    });

    afterEach(async () => {
        if (client) {
            await client.query('ROLLBACK');
            client.release();
        }
    });

    test('unions tags shared by sources and survivor with immediate primary key checks', async () => {
        await client.query('INSERT INTO part_tag VALUES (1,1),(2,1),(3,1),(2,2),(3,2),(4,2),(4,3)');
        const counts = await service.mergeChildRecords(client, 1, [4, 3, 2], {});
        expect(counts.part_tags).toBe(2);
        expect((await client.query('SELECT * FROM part_tag ORDER BY tag_id')).rows)
            .toEqual([{ part_id: 1, tag_id: 1 }, { part_id: 1, tag_id: 2 }, { part_id: 1, tag_id: 3 }]);
    });

    test('leaves shared source tags alone when mergeTags is disabled', async () => {
        await client.query('INSERT INTO part_tag VALUES (2,2),(3,2)');
        await service.mergeChildRecords(client, 1, [2, 3], { mergeTags: false });
        expect((await client.query('SELECT * FROM part_tag ORDER BY part_id')).rows)
            .toEqual([{ part_id: 2, tag_id: 2 }, { part_id: 3, tag_id: 2 }]);
    });

    test.each([1, 9])('canonicalizes exclusions and drops internal pairs for survivor %i', async keepId => {
        await client.query(`INSERT INTO part_exclusion (part_id_1, part_id_2, source, reason)
            VALUES (2,3,'AI','internal'),(2,5,'USER','outside'),(3,5,'USER','outside')`);
        await service.mergeChildRecords(client, keepId, [2, 3], {});
        expect((await client.query('SELECT part_id_1,part_id_2,source,reason FROM part_exclusion')).rows)
            .toEqual([{ part_id_1: Math.min(keepId, 5), part_id_2: Math.max(keepId, 5),
                source: 'USER', reason: 'outside' }]);
    });

    test.each([false, true])('creates aliases with legacy unique index present: %s', async unique => {
        if (unique) await client.query('CREATE UNIQUE INDEX ON part_aliases (alias_value, alias_type)');
        const sources = [{ part_id: 2, internal_sku: 'SOURCE-2', display_name: 'Source',
            part_numbers: [{ part_number: 'PN-2' }, { part_number: 'PN-2' }] }];
        await service.createAliases(client, 1, sources, {});
        await service.createAliases(client, 1, sources, {});
        expect((await client.query('SELECT alias_value,alias_type,source_part_id FROM part_aliases ORDER BY alias_type')).rows)
            .toEqual([
                { alias_value: 'Source', alias_type: 'display_name', source_part_id: '2' },
                { alias_value: 'PN-2', alias_type: 'part_number', source_part_id: '2' },
                { alias_value: 'SOURCE-2', alias_type: 'sku', source_part_id: '2' }
            ]);
    });

    test('preserves provenance for shared part-number aliases without a global unique index', async () => {
        const sources = [2, 3].map(partId => ({ part_id: partId, internal_sku: `SOURCE-${partId}`,
            part_numbers: [{ part_number: 'SHARED' }] }));
        await service.createAliases(client, 1, sources, {});
        await service.createAliases(client, 1, sources, {});
        expect((await client.query("SELECT source_part_id FROM part_aliases WHERE alias_value='SHARED' ORDER BY source_part_id")).rows)
            .toEqual([{ source_part_id: '2' }, { source_part_id: '3' }]);
    });
});
