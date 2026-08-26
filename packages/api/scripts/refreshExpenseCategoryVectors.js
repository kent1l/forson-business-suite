/**
 * Generates the vector identity for expense categories.
 *
 * Run once after applying database/migrations/20260823_02_expense_category_embeddings.sql,
 * and again whenever categories are renamed or their descriptions are rewritten —
 * `embedding_source` is compared against the current text, so an unchanged category
 * costs nothing on a re-run.
 *
 * `--rebuild-centroids` additionally recomputes each category's usage centroid from
 * scratch, averaging the stored embeddings of every non-void expense filed under it.
 * Use it to seed centroids from history the first time, or to repair one that has
 * been dragged off course by miskeyed entries. Without the flag, centroids are left
 * alone and continue to be maintained incrementally as entries are saved.
 *
 * Usage: node scripts/refreshExpenseCategoryVectors.js [--force] [--rebuild-centroids] [--json]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

if (process.env.NODE_ENV !== 'production') {
  process.env.DB_HOST = process.env.DB_HOST || 'localhost';
}

const db = require('../db');
const categoryVectors = require('../services/expenseCategoryVectorService');

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const force = args.includes('--force');
const rebuildCentroids = args.includes('--rebuild-centroids');

// Averages the embeddings of the text staff actually typed for entries that ended
// up in each category. The parse log is the only place that text survives, so
// categories used exclusively through the manual form have nothing to learn from
// and keep a null centroid — matching then falls back to their definition.
const CENTROID_QUERY = `
  WITH samples AS (
    SELECT e.category_id,
           l.embedding,
           l.embedding_model
    FROM expense e
    JOIN expense_ai_parse_log l ON l.expense_id = e.expense_id
    WHERE e.is_void = false
      AND l.embedding IS NOT NULL
  )
  SELECT category_id,
         AVG(embedding)::vector AS centroid,
         COUNT(*)::integer AS sample_count
  FROM samples
  GROUP BY category_id
`;

(async function run() {
  try {
    const updated = await categoryVectors.refreshDefinitionEmbeddings({ force });

    let centroidsRebuilt = 0;
    if (rebuildCentroids) {
      const { rows } = await db.query(CENTROID_QUERY);
      for (const row of rows) {
        await db.query(
          `UPDATE expense_category
              SET usage_centroid = $1, usage_sample_count = $2, embedding_updated_at = NOW()
            WHERE category_id = $3`,
          [row.centroid, row.sample_count, row.category_id]
        );
        centroidsRebuilt += 1;
      }
    }

    const { rows: state } = await db.query(
      `SELECT category_name,
              (embedding IS NOT NULL) AS has_definition,
              usage_sample_count
         FROM expense_category
        WHERE is_active = true
        ORDER BY sort_order, category_name`
    );

    if (jsonOutput) {
      console.log(JSON.stringify({
        refreshed_at: new Date().toISOString(),
        definitions_written: updated,
        centroids_rebuilt: centroidsRebuilt,
        categories: state
      }, null, 2));
    } else {
      console.log(`Expense category vectors — ${new Date().toISOString()}`);
      console.log(`Definition embeddings written: ${updated}`);
      if (rebuildCentroids) console.log(`Usage centroids rebuilt: ${centroidsRebuilt}`);
      console.log('');
      console.log('category | definition_vector | usage_samples');
      for (const c of state) {
        console.log(`${c.category_name} | ${c.has_definition ? 'yes' : 'MISSING'} | ${c.usage_sample_count}`);
      }
      const missing = state.filter((c) => !c.has_definition).length;
      if (missing > 0) {
        console.log('');
        console.log(`${missing} categor${missing === 1 ? 'y has' : 'ies have'} no definition vector — check the embedding provider and re-run.`);
      }
    }

    process.exitCode = state.some((c) => !c.has_definition) ? 1 : 0;
  } catch (err) {
    console.error('Category vector refresh failed:', err && err.stack ? err.stack : err);
    process.exitCode = 2;
  } finally {
    process.exit();
  }
})();
