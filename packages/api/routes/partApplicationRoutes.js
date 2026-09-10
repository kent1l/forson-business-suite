const express = require('express');
const db = require('../db');
const { syncPartWithMeili } = require('../meilisearch');
const { enqueuePartUpsert } = require('../services/meiliOutboxService');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const { withYearTokens } = require('../helpers/vehicleFitmentSearch');
const { vehicleFitmentParserAI } = require('../services/ai');
const vehicleTaxonomyIndex = require('../helpers/vehicleTaxonomyIndex');
const { parseFitmentText: parseFitmentTextLocally, buildShortlist } = require('../helpers/fitmentTextParser');
const { normalizeAlias } = require('../helpers/engineCodeGrammar');
const router = express.Router();

function isValidYearRange(year_start, year_end) {
    if (year_start == null || year_end == null) return true;
    return Number(year_start) <= Number(year_end);
}

// Helper function to get all data for a part for Meilisearch indexing
const getPartDataForMeili = async (client, partId) => {
    const query = `
        WITH app_data AS (
            SELECT
                pa.part_id,
                jsonb_agg(
                    jsonb_build_object(
                        'application_id', a.application_id,
                        'make_id', a.make_id,
                        'model_id', a.model_id,
                        'engine_id', a.engine_id,
                        'make', vmk.make_name,
                        'model', vmd.model_name,
                        'engine', eng.engine_code,
                        'year_start', pa.year_start,
                        'year_end', pa.year_end,
                        'display', CONCAT(
                            COALESCE(vmk.make_name, ''),
                            CASE WHEN vmd.model_name IS NOT NULL THEN CONCAT(' ', vmd.model_name) ELSE '' END,
                            CASE WHEN eng.engine_code IS NOT NULL THEN CONCAT(' ', eng.engine_code) ELSE '' END,
                            CASE
                                WHEN pa.year_start IS NOT NULL AND pa.year_end IS NOT NULL THEN CONCAT(' (', pa.year_start, '-', pa.year_end, ')')
                                WHEN pa.year_start IS NOT NULL THEN CONCAT(' (', pa.year_start, ')')
                                WHEN pa.year_end IS NOT NULL THEN CONCAT(' (', pa.year_end, ')')
                                ELSE ''
                            END
                        )
                    )
                ) AS applications,
                array_agg(a.application_id) AS application_ids,
                array_agg(pa.year_start) AS year_starts,
                array_agg(pa.year_end) AS year_ends,
                string_agg(
                    CONCAT(
                        COALESCE(vmk.make_name, ''),
                        CASE WHEN vmd.model_name IS NOT NULL THEN CONCAT(' ', vmd.model_name) ELSE '' END,
                        CASE WHEN eng.engine_code IS NOT NULL THEN CONCAT(' ', eng.engine_code) ELSE '' END
                    ),
                    '; '
                ) AS searchable_applications_base
            FROM part_application pa
            JOIN application a ON pa.application_id = a.application_id
            LEFT JOIN vehicle_make vmk ON a.make_id = vmk.make_id
            LEFT JOIN vehicle_model vmd ON a.model_id = vmd.model_id
            LEFT JOIN engine eng ON a.engine_id = eng.engine_id
            WHERE pa.part_id = $1
            GROUP BY pa.part_id
        )
        SELECT
            pv.*,
            app_data.applications as applications_array,
            app_data.searchable_applications_base,
            app_data.year_starts,
            app_data.year_ends,
            (SELECT array_agg(tag_name) FROM tag t JOIN part_tag pt ON t.tag_id = pt.tag_id WHERE pt.part_id = pv.part_id) AS tags_array
        FROM public.parts_view AS pv
        LEFT JOIN app_data ON app_data.part_id = pv.part_id
        WHERE pv.part_id = $1;
    `;
    const res = await client.query(query, [partId]);
    if (res.rows.length === 0) return null;

    const part = res.rows[0];
    const yearRanges = (part.year_starts || []).map((ys, i) => [ys, (part.year_ends || [])[i]]);

    return {
        ...part,
        // display_name is natively provided by parts_view
        applications: part.applications_array || [],
        searchable_applications: withYearTokens(part.searchable_applications_base, yearRanges),
        tags: part.tags_array || []
    };
};

// Whenever a part is fitted to a concrete make+model+engine application, record
// that "this engine appears in this model" in vehicle_engine_fitment -- no
// separate maintenance workflow, this just piggybacks on normal fitment entry
// (Phase 0 step 4 of the vehicle fitment plan).
async function deriveVehicleEngineFitment(client, applicationId, yearStart, yearEnd) {
    const { rows } = await client.query(
        'SELECT model_id, engine_id FROM application WHERE application_id = $1',
        [applicationId]
    );
    const app = rows[0];
    if (!app || !app.model_id || !app.engine_id) return;

    await client.query(
        `INSERT INTO vehicle_engine_fitment (model_id, engine_id, year_start, year_end)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (model_id, engine_id) DO UPDATE SET
             -- LEAST/GREATEST ignore NULL arguments in Postgres (unlike MySQL),
             -- so this widens the known range and only stays NULL if both sides are.
             year_start = LEAST(vehicle_engine_fitment.year_start, EXCLUDED.year_start),
             year_end = GREATEST(vehicle_engine_fitment.year_end, EXCLUDED.year_end)`,
        [app.model_id, app.engine_id, yearStart || null, yearEnd || null]
    );
}

// GET all applications for a specific part
router.get('/parts/:partId/applications', protect, hasPermission('applications:view'), async (req, res) => {
  const { partId } = req.params;
    try {
        const query = `
            SELECT
                pa.*,
                a.make_id,
                a.model_id,
                a.engine_id,
                vmk.make_name AS make,
                vmd.model_name AS model,
                eng.engine_code AS engine
            FROM part_application pa
            JOIN application a ON pa.application_id = a.application_id
            LEFT JOIN vehicle_make vmk ON a.make_id = vmk.make_id
            LEFT JOIN vehicle_model vmd ON a.model_id = vmd.model_id
            LEFT JOIN engine eng ON a.engine_id = eng.engine_id
            WHERE pa.part_id = $1
            ORDER BY vmk.make_name, vmd.model_name, eng.engine_code;
        `;
        const { rows } = await db.query(query, [partId]);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// POST a new application link for a part
router.post('/parts/:partId/applications', protect, hasPermission('applications:edit'), async (req, res) => {
  const { partId } = req.params;
  const { application_id, year_start, year_end } = req.body;

  if (!application_id) {
    return res.status(400).json({ message: 'Application ID is required.' });
  }
  if (!isValidYearRange(year_start, year_end)) {
    return res.status(400).json({ message: 'Year start must be less than or equal to year end.' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const query = `
        INSERT INTO part_application (part_id, application_id, year_start, year_end)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (part_id, application_id) DO NOTHING
        RETURNING *;
    `;
    const result = await client.query(query, [partId, application_id, year_start || null, year_end || null]);

    await deriveVehicleEngineFitment(client, application_id, year_start, year_end);
    await client.query('COMMIT');

    // Re-sync part with Meilisearch
    const partForMeili = await getPartDataForMeili(db, partId);
    if (partForMeili) {
        await enqueuePartUpsert(partForMeili.part_id, {
            source: 'partApplicationRoutes.create',
            version_ts: partForMeili.date_modified || partForMeili.date_created || new Date().toISOString()
        });
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23514') { // check constraint violation (year range)
        return res.status(400).json({ message: 'Year start must be less than or equal to year end.' });
    }
    console.error(err.message);
    res.status(500).send('Server Error');
  } finally {
    client.release();
  }
});

// PUT - Update year range for an existing application link
router.put('/part-applications/:partAppId', protect, hasPermission('applications:edit'), async (req, res) => {
    const { partAppId } = req.params;
    const { year_start, year_end } = req.body;

    if (!isValidYearRange(year_start, year_end)) {
        return res.status(400).json({ message: 'Year start must be less than or equal to year end.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const updatedLink = await client.query(
            'UPDATE part_application SET year_start = $1, year_end = $2 WHERE part_app_id = $3 RETURNING *',
            [year_start || null, year_end || null, partAppId]
        );

        if (updatedLink.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Application link not found' });
        }

        await deriveVehicleEngineFitment(client, updatedLink.rows[0].application_id, year_start, year_end);
        await client.query('COMMIT');

        // Re-sync part with Meilisearch
        const partId = updatedLink.rows[0].part_id;
        const partForMeili = await getPartDataForMeili(db, partId);
        if (partForMeili) {
            await enqueuePartUpsert(partForMeili.part_id, {
                source: 'partApplicationRoutes.update',
                version_ts: partForMeili.date_modified || partForMeili.date_created || new Date().toISOString()
            });
        }

        res.json(updatedLink.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23514') {
            return res.status(400).json({ message: 'Year start must be less than or equal to year end.' });
        }
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});


// DELETE an application link from a part
router.delete('/parts/:partId/applications/:appId', protect, hasPermission('applications:edit'), async (req, res) => {
    const { partId, appId } = req.params;
    try {
        const deleteOp = await db.query(
            'DELETE FROM part_application WHERE part_id = $1 AND application_id = $2',
            [partId, appId]
        );
        if (deleteOp.rowCount === 0) {
            return res.status(404).json({ message: 'Application link not found.' });
        }

        // Re-sync part with Meilisearch
        const partForMeili = await getPartDataForMeili(db, partId);
        if (partForMeili) {
            await enqueuePartUpsert(partForMeili.part_id, {
                source: 'partApplicationRoutes.delete',
                version_ts: partForMeili.date_modified || partForMeili.date_created || new Date().toISOString()
            });
        }

        res.json({ message: 'Application link deleted successfully.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// POST /applications/parse-fitment-text - natural-language fitment entry.
//
// Phase 8 (PRD-FBS-FIT-002 §8): deterministic-first. The local parser
// (helpers/fitmentTextParser.js) handles the regular majority of input in
// microseconds with no LLM call at all. Only genuine residue -- text the
// grammar and gazetteer could not account for -- escalates to the AI, and then
// with a SHORTLIST of plausible taxonomy rows rather than the entire taxonomy,
// so the fallback prompt no longer grows with the catalog.
//
// Unchanged from Phase 5: this endpoint only ever PROPOSES. Nothing is written
// to the taxonomy or to part_application here; the frontend reviews each
// candidate and commits through the normal /applications and
// /parts/:partId/applications endpoints, which independently re-validate ids.
router.post('/applications/parse-fitment-text', protect, hasPermission('applications:edit'), async (req, res) => {
    const { text } = req.body;
    if (!text || !String(text).trim()) {
        return res.status(400).json({ message: 'Fitment description text is required.' });
    }

    let local;
    let index;
    try {
        index = await vehicleTaxonomyIndex.getIndex();
        local = parseFitmentTextLocally(text, index);
    } catch (error) {
        // A local-parser failure must not take the feature down -- fall through
        // to the AI path, which is self-sufficient.
        console.error('[parse-fitment-text] local parse failed, falling back to AI:', error.message);
        local = null;
    }

    if (local && local.fullyResolved) {
        return res.json({
            fitments: local.fitments,
            notes: '',
            source: 'local',
            ai_used: false,
        });
    }

    try {
        // A shortlist only helps if it actually contains plausible candidates.
        // When the residue is nothing like any taxonomy row the shortlist comes
        // back empty -- and passing an empty grounding would be actively
        // harmful, because the AI parser validates returned ids against the
        // grounding snapshot and would strip every one of them. Fall back to the
        // full taxonomy in that case; correctness beats the token saving.
        const shortlist = (local && index) ? buildShortlist(local.residue, index) : null;
        const shortlistSize = shortlist
            ? shortlist.makes.length + shortlist.models.length + shortlist.engines.length
            : 0;

        const aiResult = await vehicleFitmentParserAI.parseFitmentText(
            text,
            shortlistSize > 0 ? { grounding: shortlist } : {}
        );

        // Prefer the locally resolved rows where we have them: they are
        // deterministic and already confirmed against the taxonomy. The AI's
        // rows fill in what the local pass could not account for.
        const merged = mergeFitmentCandidates(local ? local.fitments : [], aiResult.fitments || []);

        return res.json({
            fitments: merged,
            notes: aiResult.notes || '',
            source: local && local.fitments.length ? 'hybrid' : 'ai',
            ai_used: true,
            residue: local ? local.residue : [],
        });
    } catch (error) {
        // The AI is unavailable, but a partial local parse is still genuinely
        // useful -- return it rather than failing the whole request.
        if (local && local.fitments.length) {
            return res.json({
                fitments: local.fitments,
                notes: 'AI assistance was unavailable; showing locally recognized fitments only. Review carefully for anything missing.',
                source: 'local',
                ai_used: false,
                degraded: true,
            });
        }
        if (error.statusCode === 503) {
            return res.status(503).json({ error: error.message, fallback: 'manual' });
        }
        console.error('Error in /applications/parse-fitment-text:', error);
        return res.status(503).json({ error: 'AI fitment parsing failed', fallback: 'manual' });
    }
});

// Deduplicates local and AI candidates onto one review list. Local rows win on
// a collision because they were resolved deterministically against the real
// taxonomy rather than proposed by a model.
function mergeFitmentCandidates(localRows, aiRows) {
    const keyOf = row => [
        row.make_id ?? (row.make || '').toLowerCase(),
        row.model_id ?? (row.model || '').toLowerCase(),
        row.engine_id ?? (row.engine || '').toLowerCase(),
        row.year_start ?? '',
        row.year_end ?? '',
    ].join('|');

    const merged = [];
    const seen = new Set();
    for (const row of localRows) {
        const key = keyOf(row);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push({ ...row, source: 'local' });
    }
    for (const row of aiRows) {
        const key = keyOf(row);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push({ ...row, source: 'ai' });
    }
    return merged;
}

// GET /applications/display-dictionary - shorthand + ambiguity data for rendering
// dense fitment lists (PRD-FBS-FIT-002 §10a).
//
// The frontend shortens fitment text in three ways, and all three need facts
// only the server has:
//   1. curated `display_short` abbreviations for long names;
//   2. which model names are ambiguous across makes, so the make can be dropped
//      from every OTHER model safely -- this catalog has exactly two such names
//      ("Ranger" is both Ford and Hino, "Rosa" both Mitsubishi Fuso and Hino),
//      and dropping the make on those would mislead someone at the counter;
//   3. nothing else -- year shorthand is pure formatting and needs no data.
//
// Served from the cached taxonomy index, so this is not an extra round trip to
// the database. Everything here is presentation-only: none of it is ever stored
// on a record or indexed into Meilisearch, which keeps full names so a search
// for "Mitsubishi" still matches.
router.get('/applications/display-dictionary', protect, hasPermission('applications:view'), async (req, res) => {
    try {
        const index = await vehicleTaxonomyIndex.getIndex();

        const makes = {};
        for (const m of index.makes) {
            if (m.display_short) makes[m.make_name] = m.display_short;
        }

        const models = {};
        const modelMakeCount = new Map();
        for (const m of index.models) {
            if (m.display_short) models[m.model_name] = m.display_short;
            const key = String(m.model_name).trim().toLowerCase();
            if (!modelMakeCount.has(key)) modelMakeCount.set(key, new Set());
            modelMakeCount.get(key).add(m.make_id);
        }

        const engines = {};
        for (const e of index.engines) {
            if (e.display_short) engines[e.engine_code] = e.display_short;
        }

        const ambiguousModels = [...modelMakeCount.entries()]
            .filter(([, makeIds]) => makeIds.size > 1)
            .map(([name]) => name);

        res.json({ makes, models, engines, ambiguousModels });
    } catch (err) {
        console.error('Error in /applications/display-dictionary:', err.message);
        res.status(500).send('Server Error');
    }
});

// POST /applications/fitment-alias - records that a human confirmed a raw input
// string means a particular taxonomy row (PRD-FBS-FIT-002 §8.3).
//
// This is the learning loop that makes the deterministic parser get better with
// use: once staff accept that "Mits" is Mitsubishi or that some informal engine
// code is a specific engine, that mapping resolves locally forever after and
// never needs the AI again. Aliases are only ever recorded from an explicit
// accept, never inferred from a silent save.
router.post('/applications/fitment-alias', protect, hasPermission('applications:edit'), async (req, res) => {
    const { alias_text, make_id, model_id, engine_id } = req.body || {};
    const alias = normalizeAlias(alias_text);

    if (!alias || alias.length < 2) {
        return res.status(400).json({ message: 'alias_text is required.' });
    }
    const targets = [make_id, model_id, engine_id].filter(v => v != null);
    if (targets.length !== 1) {
        return res.status(400).json({ message: 'Exactly one of make_id, model_id or engine_id is required.' });
    }

    const spec = make_id != null
        ? { table: 'vehicle_make_alias', column: 'make_id', id: make_id, parent: 'vehicle_make', parentCol: 'make_id' }
        : model_id != null
            ? { table: 'vehicle_model_alias', column: 'model_id', id: model_id, parent: 'vehicle_model', parentCol: 'model_id' }
            : { table: 'engine_alias', column: 'engine_id', id: engine_id, parent: 'engine', parentCol: 'engine_id' };

    if (!Number.isInteger(Number(spec.id))) {
        return res.status(400).json({ message: 'Target id must be an integer.' });
    }

    try {
        // Re-validate the target exists -- the id reaches us from a client that
        // may have been showing an AI suggestion.
        const exists = await db.query(
            `SELECT 1 FROM ${spec.parent} WHERE ${spec.parentCol} = $1`,
            [spec.id]
        );
        if (!exists.rows.length) {
            return res.status(404).json({ message: 'Target taxonomy row not found.' });
        }

        // Never let a learned alias shadow a real canonical name -- that would
        // make an existing engine or model unreachable by its own code.
        const collision = await db.query(
            `SELECT 1 FROM engine WHERE upper(engine_code) = $1
             UNION ALL SELECT 1 FROM vehicle_make WHERE upper(make_name) = $1
             UNION ALL SELECT 1 FROM vehicle_model WHERE upper(model_name) = $1`,
            [alias]
        );
        if (collision.rows.length) {
            return res.status(409).json({ message: 'That text is already a canonical taxonomy name.' });
        }

        await db.query(
            `INSERT INTO ${spec.table} (${spec.column}, alias_text, source)
             VALUES ($1, $2, 'learned')
             ON CONFLICT DO NOTHING`,
            [spec.id, alias]
        );

        vehicleTaxonomyIndex.invalidate();
        res.status(201).json({ message: 'Alias recorded.', alias_text: alias });
    } catch (err) {
        console.error('Error in /applications/fitment-alias:', err.message);
        res.status(500).send('Server Error');
    }
});

// POST /reindex/parts - Reindex all parts in Meilisearch
router.post('/reindex/parts', protect, hasPermission('applications:edit'), async (req, res) => {
    try {
        const allPartsQuery = `
            SELECT DISTINCT p.part_id
            FROM part p
            LEFT JOIN part_application pa ON p.part_id = pa.part_id
        `;
        const { rows } = await db.query(allPartsQuery);

        // Process parts in batches
        const batchSize = 50;
        let indexed = 0;

        for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize);
            const partDataPromises = batch.map(row => getPartDataForMeili(db, row.part_id));
            const partDataBatch = await Promise.all(partDataPromises);
            const validPartData = partDataBatch.filter(Boolean);

            if (validPartData.length > 0) {
                await syncPartWithMeili(validPartData);
                indexed += validPartData.length;
            }
        }

        res.json({ indexed });
    } catch (err) {
        console.error('Parts reindex failed:', err.message);
        res.status(500).json({ error: 'Reindex failed' });
    }
});

module.exports = router;
