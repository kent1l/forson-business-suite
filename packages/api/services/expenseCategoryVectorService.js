/**
 * Vector identity for expense categories.
 *
 * The parser used to bind a category by exact lowercase string equality, so a model
 * that answered "Utility" instead of "Utilities" bound nothing and the entry arrived
 * uncategorised. This service gives each category two vectors and uses them to
 * resolve a category by meaning instead:
 *
 *   definition embedding — name + description. What the category is.
 *   usage centroid       — running mean of the raw text staff actually saved into
 *                          it. What the category has come to mean in this store.
 *
 * The centroid is the learning half. It needs no admin approval (unlike the term
 * lexicon, where every proposal sits pending), so the system gets better simply by
 * being used correctly.
 *
 * Everything here is best-effort: a category with no vectors is skipped, and a
 * failure to embed never blocks recording an expense.
 */
const db = require('./../db');
const embeddingClient = require('./ai/core/embeddingClient');

// Cosine distance beyond which a category is not a plausible home for the text.
// Deliberately tighter than the few-shot retrieval threshold: binding the wrong
// category writes bad data, while retrieving a weak example only weakens a hint.
// Calibrated against real entries — genuine matches land at 0.15-0.27, while
// unrelated text sits at 0.35+.
const MAX_DEFINITION_DISTANCE = 0.38;
const MAX_CENTROID_DISTANCE = 0.32;

// Below these, the match is strong enough to stand on its own.
//
// Categories share a lot of vocabulary once local terms are folded in — every
// category's text contains "bayad sa …" — which legitimately compresses the gap
// between them. Real matches land at 0.22-0.30 while being only ~0.03 clear of the
// runner-up, so demanding a wide margin here would reject correct answers.
const STRONG_DEFINITION_DISTANCE = 0.31;
const STRONG_CENTROID_DISTANCE = 0.28;

// How far ahead of the runner-up a *borderline* match must be.
//
// Applied only in the band between the strong and maximum distances, where the
// text fits nothing especially well. There, being near-equidistant from several
// categories is the signature of text that belongs to none of them: gibberish
// scored 0.390 with a 0.034 margin, and an ambiguous donation scored 0.351 with a
// 0.012 margin. Without this, the category holding the most usage samples quietly
// becomes a magnet for every unrecognised entry — the confidently-wrong behaviour
// this system exists to prevent.
const MIN_MARGIN = 0.08;

// Below this many samples a centroid is one person's phrasing rather than the
// store's, so it is recorded but not yet trusted for matching.
const MIN_CENTROID_SAMPLES = 3;

/**
 * The text that defines a category, used for its definition embedding.
 *
 * Local terms are folded in because staff write Cebuano: with the English
 * description alone, "bayad sa abang sa tindahan" (paying store rent) does not put
 * Rent in its top three categories.
 */
function definitionTextFor(category) {
    return [
        String(category.category_name || '').trim(),
        String(category.description || '').trim(),
        String(category.local_terms || '').trim()
    ].filter(Boolean).join('. ');
}

/**
 * Regenerates definition embeddings for categories whose defining text changed
 * (or that never had one). Returns how many were written.
 */
async function refreshDefinitionEmbeddings({ force = false } = {}) {
    const { rows } = await db.query(
        `SELECT category_id, category_name, description, local_terms, embedding_source
         FROM expense_category
         WHERE is_active = true`
    );

    let updated = 0;
    for (const category of rows) {
        const source = definitionTextFor(category);
        if (!source) continue;
        // Skip untouched categories so a re-run costs nothing.
        if (!force && category.embedding_source === source) continue;

        try {
            const res = await embeddingClient.generateEmbeddingWithPool(source);
            if (!res?.vector) continue;
            await db.query(
                `UPDATE expense_category
                    SET embedding = $1, embedding_model = $2, embedding_source = $3,
                        embedding_updated_at = NOW()
                  WHERE category_id = $4`,
                [JSON.stringify(res.vector), res.model || null, source, category.category_id]
            );
            updated += 1;
        } catch (err) {
            console.warn(`[ExpenseCategoryVectors] Failed to embed category ${category.category_id}:`, err.message);
        }
    }
    return updated;
}

/**
 * Folds one saved entry's text into its category's usage centroid.
 *
 * Kept as an incremental mean (rather than re-averaging the whole history) so the
 * cost per save stays constant no matter how many entries a category accumulates.
 */
async function recordUsage({ categoryId, vector }) {
    if (!categoryId || !Array.isArray(vector) || vector.length === 0) return false;

    const { rows } = await db.query(
        'SELECT usage_centroid, usage_sample_count FROM expense_category WHERE category_id = $1',
        [categoryId]
    );
    if (rows.length === 0) return false;

    const count = rows[0].usage_sample_count || 0;
    const existing = parseVector(rows[0].usage_centroid);

    let next;
    if (!existing || existing.length !== vector.length) {
        next = vector;
    } else {
        // mean_{n+1} = mean_n + (x - mean_n) / (n + 1)
        next = existing.map((v, i) => v + (vector[i] - v) / (count + 1));
    }

    await db.query(
        `UPDATE expense_category
            SET usage_centroid = $1, usage_sample_count = $2, embedding_updated_at = NOW()
          WHERE category_id = $3`,
        [JSON.stringify(next), count + 1, categoryId]
    );
    return true;
}

function parseVector(value) {
    if (!value) return null;
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * Resolves the category whose meaning best fits the given text.
 *
 * Usage centroids are consulted first — what the store actually does beats what a
 * seeded description says — and the definition embedding is the fallback for
 * categories nobody has used yet.
 *
 * Returns null rather than a weak guess: leaving the field blank for a human to
 * fill is safer than quietly filing money in the wrong place.
 */
async function findCategoryByMeaning(text, { vector = null } = {}) {
    const trimmed = String(text || '').trim();
    if (!trimmed && !vector) return null;

    let queryVector = vector;
    if (!queryVector) {
        try {
            const res = await embeddingClient.generateEmbeddingWithPool(trimmed);
            queryVector = res?.vector || null;
        } catch (err) {
            console.warn('[ExpenseCategoryVectors] Failed to embed lookup text:', err.message);
            return null;
        }
    }
    if (!queryVector) return null;

    const json = JSON.stringify(queryVector);
    const { rows } = await db.query(
        `SELECT category_id, category_name, usage_sample_count,
                CASE WHEN usage_centroid IS NOT NULL AND usage_sample_count >= $2
                     THEN usage_centroid <=> $1 END AS centroid_distance,
                CASE WHEN embedding IS NOT NULL
                     THEN embedding <=> $1 END AS definition_distance
           FROM expense_category
          WHERE is_active = true
            AND (usage_centroid IS NOT NULL OR embedding IS NOT NULL)`,
        [json, MIN_CENTROID_SAMPLES]
    );

    // Score every category first, including ones outside their threshold: a close
    // runner-up still proves the winner is not distinctive, so excluding it early
    // would hand an unopposed victory to whichever category happened to qualify.
    const scored = [];
    for (const row of rows) {
        const centroid = row.centroid_distance === null ? null : Number(row.centroid_distance);
        const definition = row.definition_distance === null ? null : Number(row.definition_distance);

        const candidates = [];
        if (centroid !== null) candidates.push({ distance: centroid, basis: 'usage' });
        if (definition !== null) candidates.push({ distance: definition, basis: 'definition' });
        if (candidates.length === 0) continue;

        const nearest = candidates.reduce((a, b) => (b.distance < a.distance ? b : a));
        scored.push({
            category_id: row.category_id,
            category_name: row.category_name,
            distance: nearest.distance,
            basis: nearest.basis,
            sample_count: row.usage_sample_count || 0
        });
    }

    if (scored.length === 0) return null;
    scored.sort((a, b) => a.distance - b.distance);

    const best = scored[0];
    const usage = best.basis === 'usage';
    const cap = usage ? MAX_CENTROID_DISTANCE : MAX_DEFINITION_DISTANCE;
    if (best.distance > cap) return null;

    // A strong fit is accepted on its own; a borderline one must also be clearly
    // better than the alternatives before it is trusted.
    const strong = usage ? STRONG_CENTROID_DISTANCE : STRONG_DEFINITION_DISTANCE;
    const runnerUp = scored.find(s => s.category_id !== best.category_id);
    if (best.distance > strong && runnerUp && (runnerUp.distance - best.distance) < MIN_MARGIN) {
        return null;
    }

    return {
        ...best,
        margin: runnerUp ? +(runnerUp.distance - best.distance).toFixed(3) : null,
        // Distance 0 is a perfect fit, so invert it into something readable next to
        // the model's own per-field confidence scores.
        confidence: Math.max(0, Math.min(1, 1 - best.distance))
    };
}

module.exports = {
    refreshDefinitionEmbeddings,
    recordUsage,
    findCategoryByMeaning,
    definitionTextFor,
    MAX_DEFINITION_DISTANCE,
    MAX_CENTROID_DISTANCE,
    STRONG_DEFINITION_DISTANCE,
    STRONG_CENTROID_DISTANCE,
    MIN_CENTROID_SAMPLES,
    MIN_MARGIN
};
