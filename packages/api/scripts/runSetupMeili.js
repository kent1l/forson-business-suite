(async function(){
  try{
    const s = require('../meilisearch-setup');
    await s.setupMeiliSearch();
    console.log('SETUP_OK');
  }catch(e){
    console.error('SETUP_ERR', e && e.stack?e.stack:e);
    process.exit(1);
  }
})();
