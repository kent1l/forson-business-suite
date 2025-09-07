#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { meiliClient } = require('../meilisearch');

const synonymsPath = path.join(__dirname, '..', 'config', 'meili-synonyms.json');

const buildSymmetricSynonyms = (groups) => {
  const map = {};
  if (!Array.isArray(groups)) return map;
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    const normalized = group.map(s => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
    for (const term of normalized) {
      const others = normalized.filter(t => t !== term);
      if (!map[term]) map[term] = [];
      for (const o of others) if (!map[term].includes(o)) map[term].push(o);
    }
  }
  return map;
};

(async function run() {
  try {
    if (!fs.existsSync(synonymsPath)) {
      console.error('Synonyms file not found at', synonymsPath);
      process.exit(1);
    }
    const groups = require(synonymsPath);
    const synonyms = buildSymmetricSynonyms(groups);
    const index = meiliClient.index('parts');
    console.log('Applying', Object.keys(synonyms).length, 'synonym entries to Meilisearch parts index');
    await index.updateSettings({ synonyms });
    console.log('Synonyms applied.');
  } catch (err) {
    console.error('Failed to apply synonyms:', err && err.stack ? err.stack : err);
    process.exit(2);
  }
})();
