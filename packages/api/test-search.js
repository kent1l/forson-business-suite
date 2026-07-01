require('dotenv').config();
const { MeiliSearch } = require('meilisearch');
const client = new MeiliSearch({ host: process.env.MEILISEARCH_HOST, apiKey: process.env.MEILISEARCH_MASTER_KEY });
client.index('parts').search('4800049720510').then(res => console.log(JSON.stringify(res.hits[0], null, 2))).catch(console.error);
