// Actual Express/auth/SQL characterization in an owned disposable PostgreSQL DB.
// Requires schema-only pg_dump of the development schema, never business rows.
process.env.DOTENV_CONFIG_QUIET='true';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
require('dotenv').config({quiet:true});
const {Client}=require('pg');
const root=path.resolve(__dirname,'../../..');
const config={host:process.env.FITMENT_AUDIT_HOST||'127.0.0.1',port:process.env.DB_PORT||5432,user:process.env.DB_USER,password:process.env.DB_PASSWORD,connectionTimeoutMillis:5000};
async function parent(){
 const schemaFile=process.env.FITMENT_PHASE0_SCHEMA;
 if(!schemaFile)throw new Error('Set FITMENT_PHASE0_SCHEMA to a schema-only pg_dump file; source data must not be copied.');
 const name='fitment_phase0_'+Date.now()+'_'+crypto.randomBytes(3).toString('hex');
 const source=process.env.DB_NAME;
 if(!/^fitment_phase0_[0-9]+_[a-f0-9]{6}$/.test(name)||name===source)throw new Error('Unsafe disposable name');
 const admin=new Client({...config,database:source});let created=false;
 try{
  await admin.connect();await admin.query(`CREATE DATABASE "${name}"`);created=true;
  const fixture=new Client({...config,database:name});
  try{await fixture.connect();const sql=fs.readFileSync(schemaFile,'utf8').replace(/^\\(?:un)?restrict.*$/gm,'');await fixture.query(sql);}finally{await fixture.end();}
  const child=spawnSync(process.execPath,[__filename,'--worker'],{cwd:root,env:{...process.env,DB_HOST:config.host,DB_NAME:name,FITMENT_PHASE0_OWNED_DB:name,JWT_SECRET:'phase0-disposable-fixture-secret',JEV_ENABLED:'false',DISABLE_MEILI_OUTBOX_WORKER:'true',DISABLE_SEARCH_REPAIR_WORKER:'true',DISABLE_DEDUPE_SCAN_WORKER:'true'},encoding:'utf8',maxBuffer:8*1024*1024,timeout:60000});
  if(child.status!==0)throw new Error('Disposable worker failed: '+child.stderr.slice(-2000));
  const report=JSON.parse(child.stdout);report.cleanup='pending';
  await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);created=false;report.cleanup='owned disposable database dropped';
  console.log(JSON.stringify(report,null,2));
 }finally{if(created)await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();}
}
async function worker(){
 if(!process.env.DB_NAME?.startsWith('fitment_phase0_')||process.env.DB_NAME!==process.env.FITMENT_PHASE0_OWNED_DB)throw new Error('Refusing non-owned database');
 // No provider/index traffic is allowed. Fail closed if a route unexpectedly requests it.
 global.fetch=async()=>{throw new Error('External network disabled in Phase 0 fixture');};
 const logs=[];for(const k of ['log','warn','error'])console[k]=(...args)=>logs.push(args.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' '));
 const db=require(path.join(root,'packages/api/db'));
 await db.query(`INSERT INTO permission_level(permission_level_id,level_name) VALUES(1,'fixture editor'),(2,'fixture parts only');
 INSERT INTO permission(permission_id,permission_key) VALUES(1,'applications:view'),(2,'applications:edit'),(3,'parts:create'),(4,'parts:edit'),(5,'parts:view');
 INSERT INTO role_permission VALUES(1,1),(1,2),(1,3),(1,4),(1,5),(2,3),(2,4),(2,5);
 INSERT INTO employee(employee_id,first_name,last_name,username,password_hash,password_salt,permission_level_id) VALUES(1,'Fixture','Editor','fixture_editor','unused','unused',1),(2,'Fixture','Parts','fixture_parts','unused','unused',2);
 INSERT INTO brand(brand_id,brand_name,brand_code) VALUES(1,'Fixture','FX');
 INSERT INTO "group"(group_id,group_name,group_code) VALUES(1,'Fixture','FX');
 INSERT INTO vehicle_make(make_id,make_name) VALUES(1,'Toyota'),(2,'Other');
 INSERT INTO vehicle_model(model_id,make_id,model_name) VALUES(11,1,'Hilux'),(12,1,'Fortuner'),(13,1,'Hiace');
 INSERT INTO engine(engine_id,engine_code,displacement_liters,fuel_type) VALUES(101,'TEST1',2.5,'diesel'),(102,'TEST2',3,'diesel');
 INSERT INTO application(application_id,make_id,model_id,engine_id) VALUES(1,1,11,101),(2,1,12,NULL);
 INSERT INTO part(part_id,brand_id,group_id,detail) VALUES(1,1,1,'Synthetic fixture part');
 SELECT setval(pg_get_serial_sequence('part','part_id'),1,true);
 SELECT setval(pg_get_serial_sequence('application','application_id'),2,true);`);
 const express=require('express');const request=require('supertest');const jwt=require('jsonwebtoken');
 const {manilaDateString}=require(path.join(root,'packages/api/helpers/manilaDate'));
 const app=express();app.use(express.json());app.use('/api',require(path.join(root,'packages/api/routes/applicationRoutes')));app.use('/api',require(path.join(root,'packages/api/routes/partApplicationRoutes')));app.use('/api',require(path.join(root,'packages/api/routes/partRoutes')).router);
 const token=id=>jwt.sign({employee_id:id,login_date:manilaDateString()},process.env.JWT_SECRET,{expiresIn:'5m'});
 const send=(method,url,body,id=1)=>request(app)[method]('/api'+url).set('Authorization','Bearer '+token(id)).send(body).timeout({response:5000,deadline:7000});
 const results=[];
 let r=await send('post','/applications',{make_id:1,model_id:11,model:'Fortuner'});
 results.push({id:'H01',scenario:'Existing model ID with conflicting supplied label',status:r.status,actual:r.body,target:'422 ID/name mismatch; no identity write'});
 r=await send('post','/applications',{model_id:12});const modelOnly=r.body.application_id;
 results.push({id:'H02',scenario:'Model-only versus derived-make representation',status:r.status,actual:r.body,equivalent_row_count:Number((await db.query('SELECT count(*) FROM application WHERE model_id=12 AND engine_id IS NULL')).rows[0].count),target:'One canonical identity with derived parent, not two specificity representations'});
 const first=await send('post','/parts/1/applications',{application_id:1,year_start:2005,year_end:2010});
 const retry=await send('post','/parts/1/applications',{application_id:1,year_start:1990,year_end:2020});
 results.push({id:'H03',scenario:'Duplicate link with changed years still derives association',first:{status:first.status,body:first.body},retry:{status:retry.status,body:retry.body,text:retry.text},links:(await db.query('SELECT application_id,year_start,year_end FROM part_application WHERE part_id=1')).rows,association:(await db.query('SELECT model_id,engine_id,year_start,year_end FROM vehicle_engine_fitment')).rows,target:'Explicit existing/conflict outcome; no knowledge widening on no-op link'});
 const concurrent=await Promise.all(Array.from({length:20},()=>send('post','/applications',{engine_id:102})));
 results.push({id:'H04',scenario:'20 concurrent identical engine-only application creations',statuses:concurrent.map(x=>x.status),rows:Number((await db.query('SELECT count(*) FROM application WHERE make_id IS NULL AND model_id IS NULL AND engine_id=102')).rows[0].count),target:'One row; all calls saved/existing with deterministic status, no 500'});
 r=await send('post','/parts/1/applications',{application_id:2},2);
 results.push({id:'H06',scenario:'Parts-only user dedicated link route',status:r.status,target:'403'});
 r=await send('post','/parts',{brand_id:1,group_id:1,detail:'Synthetic staged application permission test',applications:[{application_id:2}]},2);
 results.push({id:'H07',scenario:'Parts-only user staged part creation',status:r.status,part_id:r.body.part_id,links:r.body.part_id?(await db.query('SELECT application_id FROM part_application WHERE part_id=$1',[r.body.part_id])).rows:[],target:'403 and zero part/link writes'});
 r=await send('post','/applications/fitment-alias',{alias_text:'Toyota Hilux 2005 diesel',model_id:11});
 results.push({id:'H08',scenario:'Whole application phrase learned as model alias',status:r.status,aliases:(await db.query("SELECT alias_text,model_id,source FROM vehicle_model_alias WHERE alias_text LIKE 'TOYOTA%'")).rows,target:'422: phrase is correction, not identity synonym'});
 r=await send('post','/applications',{make_id:2,model_id:11});
 results.push({id:'H09',scenario:'Mismatched make/model parent',status:r.status,target:'400 or422; no row'});
 r=await send('put','/part-applications/1',{year_start:2015,year_end:2000});
 results.push({id:'H10',scenario:'Reversed link years',status:r.status,target:'400 or422; no mutation'});
 const parse=await send('post','/applications/parse-fitment-text',{text:'TEST1'});
 results.push({id:'H11',scenario:'Local engine-only API without provider',status:parse.status,actual:parse.body,target:'Engine-only, no fabricated vehicle, no provider call'});
 const attempts=[
  ['H12','Chassis-only request without irrelevant engine','post','/applications',{chassis:'FIXTURE-CH1'},'Chassis claim retained; currently schema has no chassis dimension'],
  ['H13','Make-only claim approval/unknown scope visibility','post','/applications',{make_id:1},'Review-only make claim; absent dimensions not unrestricted'],
  ['H14','Version token and verification flags on existing link update','put','/part-applications/1',{year_start:2006,year_end:2010,expected_rule_version:-1,verified:true},'409 stale /400 unknown client-owned verification flags; no update'],
  ['H15','Review/dismissal persistence endpoint','patch','/applications/fitment-reviews/00000000-0000-0000-0000-000000000001',{review_version:1,dismiss:[]},'Versioned review API; current route absent'],
  ['H16','Research disabled/manual recovery endpoint','post','/applications/fitment-research',{review_id:'00000000-0000-0000-0000-000000000001',candidate_id:'fixture'},'Explicit503/manual fallback; current route absent'],
  ['H17','Separate correction endpoint','post','/applications/fitment-corrections',{review_id:'00000000-0000-0000-0000-000000000001',candidate_id:'fixture',corrected_fields:{model_id:11}},'Reviewable correction without alias side effect; current route absent'],
 ];
 for(const [id,scenario,method,url,payload,target]of attempts){const response=await send(method,url,payload);results.push({id,scenario,status:response.status,actual:response.body,target});}
 const search=require(path.join(root,'packages/api/meili-applications'));
 const catalog=require(path.join(root,'packages/api/services/catalogSyncService'));
 results.push({id:'H18',scenario:'Actual search and catalog shapes',application_document:search.toDoc({application_id:1,make_id:1,model_id:11,engine_id:101,make:'Toyota',model:'Hilux',engine:'TEST1'}),catalog:(await catalog.buildCatalogRows([1])).map(x=>({part_id:x.part_id,applications:x.applications})),target:'Canonical facts with qualifier/evidence status; flattened text discovery cannot confirm compatibility'});
 await db.query('INSERT INTO vehicle_engine_fitment(model_id,engine_id) VALUES(11,102) ON CONFLICT DO NOTHING');
 const sqlExposure=(await db.query(`SELECT count(*)::int AS rows FROM application a WHERE (a.engine_id=102 OR (a.model_id IS NOT NULL AND a.model_id IN (SELECT model_id FROM vehicle_engine_fitment WHERE engine_id=102))) AND a.engine_id IS NOT NULL AND a.engine_id<>102`)).rows;
 results.push({id:'H19',scenario:'Search predicate fixture setup',actual:sqlExposure,target:'Explicit different engine must not match via model association; real exposure count in audit.json'});
 const counts=(await db.query('SELECT (SELECT count(*) FROM application)::int AS applications,(SELECT count(*) FROM part_application)::int AS links,(SELECT count(*) FROM meili_sync_outbox)::int AS outbox')).rows[0];
 const dbVersion=(await db.query('SELECT version()')).rows[0].version;
 const links=await Promise.allSettled(Array.from({length:20},()=>send('post','/parts/1/applications',{application_id:2})));
 const inspect=new Client({...config,database:process.env.DB_NAME});await inspect.connect();
 const waiting=(await inspect.query("SELECT state,wait_event_type,wait_event,left(query,100) AS query FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() ORDER BY pid")).rows;
 const linkRows=Number((await inspect.query('SELECT count(*) FROM part_application WHERE part_id=1 AND application_id=2')).rows[0].count);await inspect.end();
 results.push({id:'H05',scenario:'20 concurrent identical links',statuses:links.map(x=>x.status==='fulfilled'?x.value.status:'timeout'),pool_activity:waiting,empty_bodies:links.filter(x=>x.status==='fulfilled'&&!x.value.text).length,rows:linkRows,target:'One link and explicit saved/existing result for every call; no pool starvation'});
 process.stdout.write(JSON.stringify({baseline:'e09e7bf',environment:{database:process.env.DB_NAME,version:dbVersion,schema:'development schema-only dump',schema_sha256:crypto.createHash('sha256').update(fs.readFileSync(process.env.FITMENT_PHASE0_SCHEMA)).digest('hex'),data:'synthetic fixture only',providers:'disabled',workers:'not started'},results,counts,fixture_log_tail:logs.slice(-8)}));
 process.exit(0);
}
(process.argv.includes('--worker')?worker():parent()).catch(e=>{process.stderr.write(JSON.stringify({error:e.message,code:e.code}));process.exit(1);});
