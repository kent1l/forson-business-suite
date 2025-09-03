const { meiliClient } = require('./meilisearch');

// Minimal retry borrowed via meilisearch.js by reusing the client and keeping operations small
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const isRetryable = (err) => {
  if (!err) return false;
  if (err.statusCode && (err.statusCode >= 500 || err.statusCode === 429)) return true;
  if (err.code && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(err.code)) return true;
  if (err.message && /timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|network|ENOTFOUND/i.test(err.message)) return true;
  return false;
};

const retryAsync = async (fn, { attempts = 4, baseDelay = 200 } = {}) => {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || i === attempts - 1) break;
      const delay = Math.round(baseDelay * Math.pow(2, i) * (0.5 + Math.random() * 0.5));
      await wait(delay);
    }
  }
  throw lastErr;
};

const index = () => meiliClient.index('applications');

// Shape helper for a row of application_view
const toDoc = (row) => ({
  application_id: row.application_id,
  make_id: row.make_id,
  model_id: row.model_id,
  engine_id: row.engine_id,
  make: row.make || '',
  model: row.model || '',
  engine: row.engine || '',
  label: [row.make, row.model, row.engine].filter(Boolean).join(' ')
});

const syncApplications = async (docs) => {
  const toAdd = Array.isArray(docs) ? docs : [docs];
  if (!toAdd.length) return;
  await retryAsync(() => index().addDocuments(toAdd, { primaryKey: 'application_id' }));
};

const removeApplication = async (id) => {
  await retryAsync(() => index().deleteDocument(id));
};

module.exports = { index, toDoc, syncApplications, removeApplication };
