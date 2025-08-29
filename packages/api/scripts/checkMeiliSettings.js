// Standalone script to check Meilisearch 'parts' index settings.
// Does not depend on dotenv or other packages; reads .env manually.
const fs = require('fs');
const path = require('path');

function parseEnv(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const raw = fs.readFileSync(envPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const out = {};
  for (const line of lines) {
    const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (m) {
      out[m[1]] = m[2];
    }
  }
  return out;
}

async function tryFetch(host, key) {
  try {
    const url = new URL('/indexes/parts/settings', host).toString();
    const headers = {};
    if (key) headers['X-Meili-API-Key'] = key;
    const res = await fetch(url, { method: 'GET', headers, redirect: 'follow' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const json = await res.json();
    return { ok: true, json };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

(async function main() {
  try {
    const repoRoot = path.resolve(__dirname, '../../..');
    const envPath = path.join(repoRoot, '.env');
    const env = parseEnv(envPath);
    const candidates = [];
    if (env.MEILISEARCH_HOST) candidates.push(env.MEILISEARCH_HOST);
    candidates.push('http://localhost:7700');
    candidates.push('http://meilisearch:7700');

    const key = env.MEILISEARCH_MASTER_KEY || '';

    for (const host of [...new Set(candidates)]) {
      process.stdout.write(`\n--- Trying ${host} ---\n`);
      const r = await tryFetch(host, key);
      if (!r.ok) {
        console.error('ERROR:', r.error);
        continue;
      }
      console.log('SUCCESS: Retrieved settings:');
      console.log(JSON.stringify(r.json, null, 2));
      const attrs = r.json.searchableAttributes || [];
      if (attrs.includes('searchable_applications')) {
        console.log('\nFOUND: searchable_applications is present in searchableAttributes');
      } else {
        console.log('\nNOT FOUND: searchable_applications is NOT present in searchableAttributes');
      }
      return;
    }
    console.error('\nAll hosts attempted and failed.');
    process.exitCode = 2;
  } catch (err) {
    console.error('Fatal error:', err && err.stack ? err.stack : err);
    process.exitCode = 3;
  }
})();
