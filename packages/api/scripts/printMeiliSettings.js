#!/usr/bin/env node
// Prints current Meilisearch settings for the 'parts' index
// Useful to verify 'searchable_applications' and 'applications' are configured

const { meiliClient } = require('../meilisearch');

(async () => {
  try {
    const idx = meiliClient.index('parts');
    const settings = await idx.getSettings();
    console.log(JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('ERR', e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
