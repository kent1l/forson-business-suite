// Read-only, repeatable Phase 0 audit. Run from repository root; never prints credentials.
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const root = path.resolve(__dirname, '../../..');
const tables = ['vehicle_make','vehicle_model','engine','vehicle_engine','vehicle_engine_fitment','application','part_application','vehicle_make_alias','vehicle_model_alias','engine_alias','schema_migrations'];
(async () => {
 const client = new Client({host:process.env.FITMENT_AUDIT_HOST || '127.0.0.1',port:process.env.DB_PORT || 5432,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectionTimeoutMillis:5000});
 const out = { baseline: 'e09e7bf', captured_at:new Date().toISOString(), access:'READ ONLY, REPEATABLE READ, 15s statement timeout', queries:{} };
 try {
  await client.connect();
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout = '15s'");
  async function q(key, sql, params=[]) { out.queries[key] = { sql, rows:(await client.query(sql,params)).rows }; }
  await q('environment', 'SELECT current_database() AS database, current_user AS role, version(), pg_is_in_recovery() AS replica');
  await q('columns', 'SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema=\'public\' AND table_name=ANY($1) ORDER BY table_name,ordinal_position',[tables]);
  await q('constraints', `SELECT c.conrelid::regclass::text AS table_name,c.conname,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE t.relnamespace='public'::regnamespace AND t.relname=ANY($1) ORDER BY 1,2`,[tables]);
  await q('indexes', 'SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname=\'public\' AND tablename=ANY($1) ORDER BY 1,2',[tables]);
  await q('triggers', `SELECT c.relname AS table_name,t.tgname,pg_get_triggerdef(t.oid) AS definition,pg_get_functiondef(t.tgfoid) AS function FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relnamespace='public'::regnamespace AND c.relname=ANY($1) ORDER BY 1,2`,[tables]);
  await q('dependent_views', `SELECT DISTINCT v.relname,pg_get_viewdef(v.oid) AS definition FROM pg_depend d JOIN pg_rewrite r ON r.oid=d.objid JOIN pg_class v ON v.oid=r.ev_class JOIN pg_class src ON src.oid=d.refobjid WHERE src.relname=ANY($1) AND src.relnamespace='public'::regnamespace AND v.relkind IN ('v','m')`,[tables]);
  for (const table of tables) if (out.queries.columns.rows.some(r=>r.table_name===table)) await q('count_'+table,`SELECT count(*)::int AS count FROM public.${table}`);
  await q('migrations','SELECT * FROM schema_migrations ORDER BY 1');
  const migrations = out.queries.migrations.rows;
  out.migration_comparison = migrations.map(row=>{ const filename=row.filename || row.name || row.version; const file=filename && path.join(root,'database/migrations',filename); return {filename,record:row,file_exists:!!file&&fs.existsSync(file),file_sha256:file&&fs.existsSync(file)?crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'):null}; });
  out.pending_migrations = fs.readdirSync(path.join(root,'database/migrations')).filter(f=>f.endsWith('.sql') && f!=='20250821_seed_documents.sql' && !migrations.some(m=>m.filename===f)).sort();
  await q('duplicate_make_keys',"SELECT regexp_replace(upper(make_name),'[^A-Z0-9]','','g') AS key,count(*)::int, array_agg(make_id) AS ids FROM vehicle_make GROUP BY 1 HAVING count(*)>1 LIMIT 20");
  await q('duplicate_model_keys',"SELECT make_id,regexp_replace(upper(model_name),'[^A-Z0-9]','','g') AS key,count(*)::int,array_agg(model_id) AS ids FROM vehicle_model GROUP BY 1,2 HAVING count(*)>1 LIMIT 20");
  await q('duplicate_engine_keys',"SELECT regexp_replace(upper(engine_code),'[^A-Z0-9/]','','g') AS key,count(*)::int,array_agg(engine_id) AS ids FROM engine GROUP BY 1 HAVING count(*)>1 LIMIT 20");
  await q('duplicate_applications','SELECT make_id,model_id,engine_id,count(*)::int FROM application GROUP BY 1,2,3 HAVING count(*)>1 LIMIT 20');
  await q('duplicate_links','SELECT count(*)::int AS groups FROM (SELECT part_id,application_id FROM part_application GROUP BY 1,2 HAVING count(*)>1) x');
  await q('mismatched_parents','SELECT a.application_id,a.make_id,m.make_id AS model_make_id,a.model_id FROM application a JOIN vehicle_model m USING(model_id) WHERE a.make_id IS NOT NULL AND a.make_id<>m.make_id LIMIT 20');
  await q('orphan_counts',`SELECT count(*) FILTER (WHERE a.make_id IS NOT NULL AND mk.make_id IS NULL)::int AS makes,count(*) FILTER (WHERE a.model_id IS NOT NULL AND m.model_id IS NULL)::int AS models,count(*) FILTER (WHERE a.engine_id IS NOT NULL AND e.engine_id IS NULL)::int AS engines FROM application a LEFT JOIN vehicle_make mk USING(make_id) LEFT JOIN vehicle_model m USING(model_id) LEFT JOIN engine e USING(engine_id)`);
  await q('application_scopes','SELECT make_id IS NOT NULL AS make,model_id IS NOT NULL AS model,engine_id IS NOT NULL AS engine,count(*)::int FROM application GROUP BY 1,2,3 ORDER BY 1,2,3');
  await q('link_year_quality','SELECT count(*) FILTER(WHERE year_start IS NULL AND year_end IS NULL)::int AS unknown_years,count(*) FILTER(WHERE year_start>year_end)::int AS reversed_years FROM part_application');
  await q('combined_engines',"SELECT engine_id,engine_code,displacement_liters,fuel_type FROM engine WHERE engine_code ~ '[/,&]' LIMIT 20");
  await q('duplicate_model_details',"SELECT model_id,make_id,model_name FROM vehicle_model WHERE model_id IN (14,29,23,81) ORDER BY model_id");
  await q('duplicate_engine_details',"SELECT engine_id,engine_code,displacement_liters,fuel_type FROM engine WHERE engine_id IN (11,15) ORDER BY engine_id");
  await q('contradictory_known_engine_filter',`SELECT count(*)::int AS applications_with_other_engine FROM application a WHERE a.engine_id IS NOT NULL AND EXISTS (SELECT 1 FROM vehicle_engine_fitment v WHERE v.model_id=a.model_id AND v.engine_id<>a.engine_id)`);
  await q('orphan_links','SELECT count(*)::int FROM part_application p LEFT JOIN application a USING(application_id) LEFT JOIN part t USING(part_id) WHERE a.application_id IS NULL OR t.part_id IS NULL');
  await q('spec_gaps','SELECT count(*) FILTER(WHERE displacement_liters IS NULL)::int AS unknown_displacement,count(*) FILTER(WHERE fuel_type IS NULL)::int AS unknown_fuel FROM engine');
  await q('alias_ambiguity',"SELECT upper(alias_text) AS alias,count(DISTINCT engine_id)::int AS targets FROM engine_alias GROUP BY 1 HAVING count(DISTINCT engine_id)>1 LIMIT 20");
  await q('learned_aliases',"SELECT 'make' AS kind,alias_text FROM vehicle_make_alias WHERE source='learned' UNION ALL SELECT 'model',alias_text FROM vehicle_model_alias WHERE source='learned' UNION ALL SELECT 'engine',alias_text FROM engine_alias WHERE source='learned' LIMIT 20");
  await q('cross_make_models','SELECT upper(model_name),count(DISTINCT make_id)::int FROM vehicle_model GROUP BY 1 HAVING count(DISTINCT make_id)>1 LIMIT 20');
  const raw = {};
  for (const [key,sql] of Object.entries({makes:'SELECT make_id,make_name,display_short FROM vehicle_make ORDER BY make_id',models:'SELECT m.*,mk.make_name FROM vehicle_model m JOIN vehicle_make mk USING(make_id) ORDER BY model_id',engines:'SELECT * FROM engine ORDER BY engine_id',makeAliases:'SELECT make_id,alias_text FROM vehicle_make_alias',modelAliases:'SELECT model_id,alias_text FROM vehicle_model_alias',engineAliases:'SELECT engine_id,alias_text FROM engine_alias',modelEnginePairs:'SELECT DISTINCT model_id,engine_id FROM application WHERE model_id IS NOT NULL AND engine_id IS NOT NULL'})) raw[key]=(await client.query(sql)).rows;
  const {buildIndex}=require(path.join(root,'packages/api/helpers/vehicleTaxonomyIndex'));
  const {parseFitmentText}=require(path.join(root,'packages/api/helpers/fitmentTextParser'));
  const index=buildIndex(raw);
  out.real_taxonomy_baseline=['TOYOTA HILUX, FORTUNER, HI-ACE','Toyota Hilux 2005-2015 2.5L diesel, Fortuner','Toyota Hilux 2005-2015 2.5L diesel, Fortuner same years','Toyota Hilux, Toyota Hilux','4D55/6','Toyota Hilux except 2010'].map(text=>({text,actual:parseFitmentText(text,index)}));
  out.taxonomy_coverage = {};
  for (const [kind, rows, textOf, idField] of [['models',raw.models,m=>m.make_name+' '+m.model_name,'model_id'],['engines',raw.engines,e=>e.engine_code,'engine_id']]) {
   const failures=[]; for(const row of rows) {const actual=parseFitmentText(textOf(row),index);if(!actual.fitments.some(f=>f[idField]===row[idField])) failures.push({id:row[idField],input:textOf(row),actual});}
   out.taxonomy_coverage[kind]={total:rows.length,matched:rows.length-failures.length,failures};
  }
  const timings=[];for(let i=0;i<300;i++){const start=performance.now();parseFitmentText('TOYOTA HILUX, FORTUNER, HI-ACE',index);timings.push(performance.now()-start);}timings.sort((a,b)=>a-b);out.local_parse_timing_ms={samples:300,p50:timings[149],p95:timings[284],scope:'Warm pure parser, real taxonomy, no DB/AI/network'};
  out.mapping_preview={policy:'Identity mapping only; no merges or approvals',applications:(await client.query('SELECT application_id AS old_id,application_id AS target_id,\'legacy_unverified\' AS target_status FROM application ORDER BY application_id LIMIT 20')).rows};
  out.identity_mapping = {};
  for (const [table,key] of [['vehicle_make','make_id'],['vehicle_model','model_id'],['engine','engine_id'],['application','application_id']]) out.identity_mapping[table]=(await client.query(`SELECT ${key} AS old_id, ${key} AS target_id, 'preserve_identity_unverified' AS action FROM ${table} ORDER BY ${key}`)).rows;
  out.identity_mapping.part_application=(await client.query("SELECT part_app_id AS old_id, 'legacy:part_application:' || part_app_id AS proposed_claim_key, 'legacy_unverified' AS status FROM part_application ORDER BY part_app_id")).rows;
  await client.query('ROLLBACK');
  console.log(JSON.stringify(out,null,2));
 } catch(error) { console.error(JSON.stringify({error:error.message,code:error.code}));process.exitCode=1; }
 finally {await client.end();}
})();
