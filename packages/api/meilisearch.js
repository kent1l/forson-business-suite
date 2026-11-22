const { MeiliSearch } = require('meilisearch');
const { normalizePartData } = require('./helpers/normalizePart');

const client = new MeiliSearch({
  host: process.env.MEILISEARCH_HOST || 'http://localhost:7700',
  apiKey: process.env.MEILISEARCH_MASTER_KEY || 'masterKey',
});

// Simple retry helper with exponential backoff + jitter
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const isRetryable = (err) => {
  if (!err) return false;
  // Retry on 5xx and rate limiting, and common network errors
  if (err.statusCode && (err.statusCode >= 500 || err.statusCode === 429)) return true;
  if (err.code && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(err.code)) return true;
  if (err.message && /timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|network|ENOTFOUND/i.test(err.message)) return true;
  return false;
};

const retryAsync = async (fn, { attempts = 4, baseDelay = 200 } = {}) => {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || i === attempts - 1) break;
      const delay = Math.round(baseDelay * Math.pow(2, i) * (0.5 + Math.random() * 0.5));
      console.warn(`Meili operation failed (attempt ${i + 1}/${attempts}), retrying in ${delay}ms:`, err && err.message ? err.message : err);
      await wait(delay);
    }
  }
  throw lastErr;
};

/**
 * Syncs one or more part documents with Meilisearch.
 * @param {object|object[]} documents - A single part object or an array of part objects.
 */
const syncPartWithMeili = async (documents) => {
  try {
    const index = client.index('parts');
    const rawDocuments = Array.isArray(documents) ? documents : [documents];
    const documentsToAdd = rawDocuments
      .filter((doc) => doc && typeof doc === 'object')
      .map((doc) => {
        if (
          !Array.isArray(doc.normalized_part_numbers)
          || doc.normalized_part_numbers.length === 0
          || !Array.isArray(doc.normalized_detail)
        ) {
          return { ...doc, ...normalizePartData(doc) };
        }
        return doc;
      });

    if (documentsToAdd.length > 0) {
      console.log(`Syncing ${documentsToAdd.length} part(s) with MeiliSearch`);
      await retryAsync(() => index.addDocuments(documentsToAdd, { primaryKey: 'part_id' }));
    }
  } catch (error) {
    // Log the full error from Meilisearch for better debugging
    console.error('Error syncing part with Meilisearch:', error.message);
  }
};

const removePartFromMeili = async (partId) => {
  try {
  const index = client.index('parts');
  await retryAsync(() => index.deleteDocument(partId));
  } catch (error) {
    console.error('Error removing part from Meilisearch:', error.message);
  }
};

module.exports = {
  meiliClient: client,
  syncPartWithMeili,
  removePartFromMeili,
};