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

// Include the full reusable classification in every application index writer.
const toDoc = ({ approval_status: _approval, evidence_status: _evidence, ...row }) => ({
  ...row,
  variant: row.variant_descriptor,
  label: [row.make,row.model,row.chassis,row.engine,row.year_start,row.year_end,row.market,row.variant_descriptor,row.drivetrain,row.transmission,row.generation].filter(Boolean).join(' '),
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
