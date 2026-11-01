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
 const name='fitment_resolver_'+Date.now()+'_'+crypto.randomBytes(3).toString('hex')+'_test';
 const source=process.env.DB_NAME;
 if(!/^fitment_resolver_[0-9]+_[a-f0-9]{6}_test$/.test(name)||name===source)throw new Error('Unsafe disposable name');
 const admin=new Client({...config,database:source});let created=false;
 try{
  await admin.connect();await admin.query(`CREATE DATABASE "${name}"`);created=true;
  const fixture=new Client({...config,database:name});
  try{await fixture.connect();const sql=fs.readFileSync(schemaFile,'utf8').replace(/^\\(?:un)?restrict.*$/gm,'');await fixture.query(sql);await fixture.query('SET search_path TO public');const migration=fs.readFileSync(path.join(root,'database/migrations/20261101_01_fitment_review_integrity.sql'),'utf8');await fixture.query(migration);await fixture.query(migration);}finally{await fixture.end();}
  const child=spawnSync(process.execPath,[__filename,'--worker',...process.argv.slice(2)],{cwd:root,env:{...process.env,DB_HOST:config.host,DB_NAME:name,FITMENT_PHASE0_OWNED_DB:name,JWT_SECRET:'phase0-disposable-fixture-secret',JEV_ENABLED:'false',DISABLE_MEILI_OUTBOX_WORKER:'true',DISABLE_SEARCH_REPAIR_WORKER:'true',DISABLE_DEDUPE_SCAN_WORKER:'true'},encoding:'utf8',maxBuffer:8*1024*1024,timeout:180000});
  if(child.status!==0)throw new Error('Disposable worker failed: '+child.stderr.slice(-2000));
  const report=JSON.parse(child.stdout);report.cleanup='pending';
  await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);created=false;report.cleanup='owned disposable database dropped';
  console.log(JSON.stringify(report,null,2));if(report.full_jest?.status!==undefined&&report.full_jest.status!==0)process.exitCode=1;
 }finally{if(created)await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();}
}
async function worker(){
 if(!process.env.DB_NAME?.startsWith('fitment_resolver_')||process.env.DB_NAME!==process.env.FITMENT_PHASE0_OWNED_DB)throw new Error('Refusing non-owned database');
 global.fetch=async()=>{throw new Error('External network disabled in resolver fixtures');};
 const logs=[];for(const k of ['log','warn','error'])console[k]=(...args)=>logs.push(args.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' '));
 const assert=require('node:assert/strict');
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
 const send=(method,url,body={},id=1,key)=>{let r=request(app)[method]('/api'+url).set('Authorization','Bearer '+token(id));if(key)r=r.set('Idempotency-Key',key);return r.send(body).timeout({response:10000,deadline:15000});};
 const results=[];
 async function test(name,fn){try{await fn();results.push({name,status:'pass'});}catch(e){results.push({name,status:'fail',error:e.message});e.message+=' Logs: '+JSON.stringify(logs.slice(-4));throw e;}}
 const link=body=>send('post','/parts/1/applications',body);
 await test('all writers reject valid wrong IDs atomically',async()=>{
  let r=await link({application_id:1,model:'Fortuner'});assert.equal(r.status,422,JSON.stringify(r.body));
  for(const [method,url,payload] of [['post','/applications',{make_id:1,model_id:11,model:'Fortuner'}],['post','/parts',{brand_id:1,group_id:1,detail:'Rejected fixture',applications:[{application_id:1,model:'Fortuner'}]}],['put','/parts/1',{brand_id:1,group_id:1,detail:'Must roll back',applications:[{application_id:1,model:'Fortuner'}]}]]){r=await send(method,url,payload);assert.equal(r.status,422,JSON.stringify(r.body));}
  assert.equal((await db.query('SELECT count(*)::int n FROM part')).rows[0].n,1);
  assert.equal((await db.query('SELECT detail FROM part WHERE part_id=1')).rows[0].detail,'Synthetic fixture part');
 });
 await test('20 concurrent retries preserve one rule and no association facts',async()=>{
  const replies=await Promise.all(Array.from({length:20},()=>send('post','/parts/1/applications',{application_id:1,year_start:2005,year_end:2010},1,'fixture-race')));
  assert.ok(replies.every(r=>[200,201].includes(r.status)),JSON.stringify(replies.map(r=>[r.status,r.body])));
  assert.equal(new Set(replies.map(r=>r.body.rule_id)).size,1);
  const semanticRetries=await Promise.all(Array.from({length:20},()=>link({application_id:1,year_start:2005,year_end:2010})));assert.ok(semanticRetries.every(r=>r.status===200&&r.body.outcome==='existing'));
  assert.equal((await db.query('SELECT count(*)::int n FROM part_application_rule')).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int n FROM vehicle_engine_fitment')).rows[0].n,0);
  assert.equal((await send('post','/parts/1/applications',{application_id:1,year_start:2005,year_end:2010,market:'PH'},1,'fixture-race')).status,409);
 });
 await test('distinct qualifiers, years and exclusions survive direct and staged writes',async()=>{
  for(const payload of [{year_start:2015,year_end:2020},{market:'PH'},{market:'JP'},{position:'Front'},{position:'Rear'},{variant:'Turbo'},{variant:'Non-turbo'},{effect:'exclude',year_start:2018,year_end:2018}]){const r=await link({application_id:1,...payload});assert.equal(r.status,201,JSON.stringify(r.body));}
  const staged=[{application_id:1,market:'PH',position:'Front',transmission:'Manual',generation:'Gen 2'},{application_id:1,effect:'exclude',market:'JP',position:'Rear',displacement_liters:2.5,fuel_type:'diesel'}];
  let r=await send('post','/parts',{brand_id:1,group_id:1,detail:'Staged fixture',applications:staged});assert.equal(r.status,201,JSON.stringify(r.body));
  const partId=r.body.part_id;
  r=await send('get',`/parts/${partId}/applications`);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.length,2);assert.equal(r.body.find(x=>x.effect==='exclude').position,'Rear');assert.equal(r.body.find(x=>x.effect==='include').transmission,'Manual');
  const rules=(await db.query('SELECT * FROM part_application_rule WHERE part_id=1')).rows;assert.equal(rules.length,9);assert.equal(rules.filter(x=>x.effect==='exclude').length,1);
 });
 await test('unsafe unrestricted input and client verification flags reject without projection',async()=>{
  for(const body of [{application_id:2,engine_mode:'unrestricted'},{application_id:2,market_mode:'unrestricted'},{application_id:2,verified:true},{application_id:2,year_start:2020,year_end:2000},{application_id:2,fuel_type:'unknown'},{application_id:2,displacement_liters:2.55}])assert.equal((await link(body)).status,422);
  assert.equal((await db.query('SELECT count(*)::int n FROM part_application WHERE part_id=1 AND application_id=2')).rows[0].n,0);
 });
 await test('unauthorized staged/direct writes leave no partial mutations',async()=>{
  assert.equal((await send('post','/parts/1/applications',{application_id:2},2)).status,403);
  const before=(await db.query('SELECT count(*)::int n FROM part')).rows[0].n;
  assert.equal((await send('post','/parts',{brand_id:1,group_id:1,detail:'Unauthorized fixture',applications:[{application_id:2}]},2)).status,403);
  assert.equal((await db.query('SELECT count(*)::int n FROM part')).rows[0].n,before);
 });
 await test('versioned edits clear qualifiers, revoke verification and retain other rules',async()=>{
  let r=await send('get','/parts/1/applications');const rule=r.body.find(x=>x.market==='PH');
  r=await send('put',`/parts/1/application-rules/${rule.rule_id}`,{expected_version:rule.row_version-1,market:'USA'});assert.equal(r.status,409);
  r=await send('put',`/parts/1/application-rules/${rule.rule_id}`,{expected_version:rule.row_version,market:null,position:'Left'});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.market,null);assert.equal(r.body.market_mode,'not_supplied');assert.equal(r.body.position,'Left');
  assert.equal((await send('delete',`/parts/1/applications/${rule.application_id}`)).status,409);
  assert.equal((await send('delete',`/part-applications/${rule.part_app_id}`)).status,409);
  const del=await send('delete',`/parts/1/application-rules/${rule.rule_id}`,{expected_version:r.body.row_version});assert.equal(del.status,200,JSON.stringify(del.body));
  assert.equal((await send('get','/parts/1/applications')).body.length,8);
 });
 await test('review dismissal is persistent and versioned',async()=>{
  let r=await send('post','/applications/parse-fitment-text',{text:'Toyota Hilux',part_id:1,disable_ai:true});assert.equal(r.status,200,JSON.stringify(r.body));let review=r.body;
  assert.ok(review.review_id);assert.ok(review.review_version);assert.ok(review.candidates.length);
  r=await send('patch',`/applications/fitment-reviews/${review.review_id}`,{expected_version:review.review_version,dismiss:[{candidate_id:review.candidates[0].candidate_id,reason:'fixture dismissal'}]});assert.equal(r.status,200,JSON.stringify(r.body));
  r=await send('patch',`/applications/fitment-reviews/${review.review_id}`,{expected_version:review.review_version,dismiss:[]});assert.equal(r.status,409);
  r=await send('post','/applications/parse-fitment-text',{text:'Toyota Hilux',part_id:1,disable_ai:true});assert.equal(r.status,200);assert.equal(r.body.fitments.length,0);
  assert.equal((await send('patch',`/applications/fitment-reviews/${review.review_id}`,{expected_version:r.body.review_version,candidate_id:review.candidates[0].candidate_id,disposition:'pending'})).status,422);
 });
 await test('review save rejects stale taxonomy and stores source provenance',async()=>{
  let r=await send('post','/applications/parse-fitment-text',{text:'Toyota Fortuner',part_id:1,disable_ai:true});assert.equal(r.status,200,JSON.stringify(r.body));
  const review=r.body;const candidate=review.candidates[0];const payload={...candidate,review_id:review.review_id,candidate_id:candidate.candidate_id,expected_version:review.review_version};
  r=await link(payload);assert.equal(r.status,201,JSON.stringify(r.body));
  const claim=(await db.query('SELECT * FROM fitment_claim WHERE claim_id=$1',[r.body.claim_id])).rows[0];assert.ok(claim.raw_text||claim.clause_text);
  r=await send('post','/applications/parse-fitment-text',{text:'Toyota Hiace',part_id:1,disable_ai:true});const next=r.body;
  await db.query("UPDATE vehicle_model SET model_name='Hiace revised' WHERE model_id=13");
  r=await link({...next.candidates[0],review_id:next.review_id,expected_version:next.review_version});assert.equal(r.status,409,JSON.stringify(r.body));
 });
 await test('catalog exports structured atomic rules and no confirmation from text',async()=>{
  const catalog=require(path.join(root,'packages/api/services/catalogSyncService'));const row=(await catalog.buildCatalogRows([1]))[0];assert.equal(row.fitment_schema_version,2);assert.ok(row.fitment_rules.length);assert.ok(row.fitment_rules.some(r=>r.effect==='exclude'));assert.equal(row.fitment_confirmation,false);
 });
 await test('shared identity edits, deletion and merges cannot reinterpret historical claims',async()=>{
  let r=await send('put','/applications/1',{make_id:1,model_id:12,engine_id:101,expected_version:1});assert.equal(r.status,409,JSON.stringify(r.body));
  r=await send('delete','/applications/1');assert.equal(r.status,409,JSON.stringify(r.body));
  r=await send('post','/applications/1/merge',{targetApplicationId:2});assert.equal(r.status,409);
  assert.equal((await db.query('SELECT model_id FROM application WHERE application_id=1')).rows[0].model_id,11);
 });
 await test('chassis and make-only identities retain unknown scope without fake engines',async()=>{
  let r=await send('post','/applications',{chassis:'FIXTURE-CH1'});assert.equal(r.status,201,JSON.stringify(r.body));assert.ok(r.body.chassis_id);assert.equal(r.body.engine_id,null);assert.equal(r.body.model_id,null);
  const part=(await db.query("INSERT INTO part(brand_id,group_id,detail) VALUES(1,1,'Chassis fixture') RETURNING part_id")).rows[0].part_id;
  r=await send('post',`/parts/${part}/applications`,{application_id:r.body.application_id});assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(r.body.engine_mode,'not_supplied');assert.equal(r.body.approval_status,'needs_review');
  r=await send('post','/applications',{make_id:1});assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(r.body.model_id,null);assert.equal(r.body.engine_id,null);assert.equal(r.body.approval_status,'needs_review');
 });
 await test('research is metadata/manual only; identity lookup cannot manufacture evidence',async()=>{
  const unavailable=await send('post','/applications/fitment-research',{query:'Toyota Hilux'});assert.equal(unavailable.status,503);
  const capture=await send('post','/applications/fitment-research',{query:'Toyota Hilux',allow_offline_capture:true});assert.equal(capture.status,201,JSON.stringify(capture.body));assert.deepEqual(capture.body.evidence,[]);assert.equal(capture.body.outcome,'insufficient');
  const metadata=await send('post','/applications/fitment-research',{query:'Synthetic metadata',evidence:[{source_type:'manual_note',source_title:'Fixture',quoted_span:'No rights supplied'}]});assert.equal(metadata.status,201,JSON.stringify(metadata.body));assert.equal(metadata.body.evidence[0].quoted_span,'');assert.equal(metadata.body.evidence[0].approval_status,'needs_review');
 });
 await test('evidence approval cannot silently approve compatibility or cross scope',async()=>{
  await db.query("INSERT INTO permission(permission_id,permission_key) VALUES(6,'applications:approve');INSERT INTO role_permission VALUES(1,6)");
  const rule=(await db.query('SELECT r.*,a.make_id,a.model_id,a.chassis_id,a.engine_id FROM part_application_rule r JOIN application a USING(application_id) WHERE r.part_id=1 AND r.is_active=TRUE ORDER BY r.rule_id LIMIT 1')).rows[0];
  const evidenceBody={query:'Synthetic exact part claim',part_id:1,evidence:[{source_type:'manual_note',source_title:'Synthetic fixture catalog excerpt',quoted_span:'Synthetic compatibility claim for this fixture only',rights_policy:'permitted_excerpt',claim_type:'part_compatibility',assessment:'supported',extracted_claim:{application_id:rule.application_id,rule}}]};
  let r=await send('post','/applications/fitment-research',evidenceBody);assert.equal(r.status,201,JSON.stringify(r.body));let ev=r.body.evidence[0];
  r=await send('post',`/applications/fitment-evidence/${ev.evidence_id}/approval`,{decision:'approve',expected_version:ev.row_version,reason:'Fixture evidence review'});assert.equal(r.status,200,JSON.stringify(r.body));ev=r.body;
  assert.equal((await db.query('SELECT approval_status FROM part_application_rule WHERE rule_id=$1',[rule.rule_id])).rows[0].approval_status,'needs_review');
  const approval={decision:'approve',expected_version:rule.row_version,evidence_ids:[ev.evidence_id],reason:'Fixture exact scope review'};
  r=await send('post',`/parts/1/application-rules/${rule.rule_id}/approval`,approval);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.evidence_status,'sourced_verified');
  let list=await send('get','/parts/1/fitment-evidence');assert.equal(list.status,200);assert.ok(list.body.some(e=>e.evidence_id===ev.evidence_id));
  assert.equal((await send('get','/parts/1/fitment-evidence',{},2)).status,403);
  let displayed=(await send('get','/parts/1/applications')).body.find(r=>r.rule_id===rule.rule_id);assert.equal(displayed.evidence_current,true);
  await db.query("UPDATE fitment_evidence SET expires_at=NOW()-INTERVAL '1 day' WHERE evidence_id=$1",[ev.evidence_id]);
  displayed=(await send('get','/parts/1/applications')).body.find(r=>r.rule_id===rule.rule_id);assert.equal(displayed.evidence_current,false);
  await db.query('UPDATE fitment_evidence SET expires_at=NULL WHERE evidence_id=$1',[ev.evidence_id]);
  const other=(await db.query('SELECT * FROM part_application_rule WHERE part_id=1 AND rule_id<>$1 AND is_active=TRUE LIMIT 1',[rule.rule_id])).rows[0];
  r=await send('post',`/parts/1/application-rules/${other.rule_id}/approval`,{...approval,expected_version:other.row_version});assert.equal(r.status,422,JSON.stringify(r.body));
  r=await send('post',`/applications/fitment-evidence/${ev.evidence_id}/approval`,{decision:'invalidate',expected_version:ev.row_version,reason:'Fixture source retracted'});assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal((await db.query('SELECT approval_status FROM part_application_rule WHERE rule_id=$1',[rule.rule_id])).rows[0].approval_status,'needs_review');
 });
 await test('part merge and undo preserve disjoint qualifiers and claim sources',async()=>{
  const PartMergeService=require(path.join(root,'packages/api/services/partMergeService'));
  const service=new PartMergeService(db);
  const source=(await db.query("INSERT INTO part(brand_id,group_id,detail) VALUES(1,1,'Merge source fixture') RETURNING part_id")).rows[0].part_id;
  for(const transmission of ['Manual','Automatic']){const r=await send('post',`/parts/${source}/applications`,{application_id:1,transmission});assert.equal(r.status,201,JSON.stringify(r.body));}
  const before=(await db.query('SELECT rule_id,part_id,transmission,is_active FROM part_application_rule WHERE part_id=ANY($1::int[]) ORDER BY rule_id',[[1,source]])).rows;
  const client=await db.getClient();
  try{await client.query('BEGIN');const operation=await service.createMergeOperation(client,1,1,[source]);const opId=operation.operation_id || operation;await service.captureMergeSnapshots(client,opId,[1,source]);
   await service.mergeChildRecords(client,1,[source],{mergeApplications:true});
   const moved=(await client.query('SELECT transmission FROM part_application_rule WHERE part_id=1 AND is_active=TRUE')).rows;assert.ok(moved.some(x=>x.transmission==='Manual'));assert.ok(moved.some(x=>x.transmission==='Automatic'));
   await service.restoreMergeSnapshots(client,opId,[1,source]);
   assert.deepEqual((await client.query('SELECT rule_id,part_id,transmission,is_active FROM part_application_rule WHERE part_id=ANY($1::int[]) ORDER BY rule_id',[[1,source]])).rows,before);
  }finally{await client.query('ROLLBACK');client.release();}
 });
 const {fitmentRulesSql}=require(path.join(root,'packages/api/helpers/fitmentDocumentSql'));
 await test('all index projections retain atomic scope and status facts',async()=>{
  const rows=(await db.query(`SELECT ${fitmentRulesSql('p')} AS fitment_rules FROM part p WHERE p.part_id=1`)).rows;
  assert.ok(rows[0].fitment_rules.some(r=>r.engine_id===101));assert.ok(rows[0].fitment_rules.some(r=>r.effect==='exclude'));
 });
 await test('power search uses the shared evaluator and never model-engine inference as compatibility',async()=>{
  // External search ranking is stubbed; the filter and result data use real SQL.
  const meili=require(path.join(root,'packages/api/meilisearch'));
  const originalIndex=meili.meiliClient.index;meili.meiliClient.index=()=>({search:async()=>({hits:[]})});
  app.use('/api',require(path.join(root,'packages/api/routes/powerSearchRoutes')));
  try{
   await db.query('INSERT INTO vehicle_engine_fitment(model_id,engine_id) VALUES(11,102) ON CONFLICT DO NOTHING');
   let r=await send('get','/power-search/parts?model_id=11&engine_id=102');assert.equal(r.status,200,JSON.stringify(r.body));assert.ok(!r.body.some(p=>p.part_id===1));
   r=await send('get','/power-search/parts?model_id=11&engine_id=101&year=2018');assert.equal(r.status,200);assert.ok(!r.body.some(p=>p.part_id===1));
   r=await send('get','/power-search/parts?model_id=11&engine_id=101&year=2007');assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.find(p=>p.part_id===1).fitment.status,'needs_details');
   r=await send('get','/power-search/parts?engine_id=101oops');assert.equal(r.status,400);
  }finally{meili.meiliClient.index=originalIndex;}
 });
 const timings=[];
 const {evaluateFitmentRules}=require(path.join(root,'packages/api/helpers/fitmentMatcher'));
 async function measuredLookup(record){const start=process.hrtime.bigint();const rules=(await db.query('SELECT r.*,a.make_id,a.model_id,a.chassis_id,a.engine_id FROM part_application_rule r JOIN application a USING(application_id) WHERE r.part_id=$1 AND r.is_active=TRUE',[1])).rows;evaluateFitmentRules(rules,{make_id:1,model_id:11,engine_id:101,year:2007});if(record)timings.push(Number(process.hrtime.bigint()-start)/1e6);}
 for(let n=0;n<100;n++)await measuredLookup(false);
 for(let n=0;n<200;n++)await Promise.all(Array.from({length:5},()=>measuredLookup(true)));
 timings.sort((a,b)=>a-b);
 const metrics={lookup_samples:timings.length,concurrency:5,warmup:100,lookup_p50_ms:timings[499],lookup_p95_ms:timings[949],scope:'synthetic fixture DB query + evaluator only; excludes HTTP, providers and production scale'};
 const report={environment:{database:process.env.DB_NAME,schema:'development schema only',data:'synthetic',providers:'disabled'},results,metrics};
 if(process.argv.includes('--full-jest')) {
  // The fixture uses explicit IDs. Advance every serial sequence before other
  // suites insert ordinary rows, and supply the standard admin role reference.
  await db.query("INSERT INTO permission_level(permission_level_id,level_name) VALUES(10,'Admin') ON CONFLICT DO NOTHING");
  const documentSeed=fs.readFileSync(path.join(root,'database/migrations/20261021_01_physical_document_system.sql'),'utf8').match(/INSERT INTO public\.physical_document_type[\s\S]*?ON CONFLICT \(code\) DO NOTHING;/)[0];
  await db.query(documentSeed);
  for (const [file,table] of [['20250913_create_payment_methods_table.sql','public.payment_methods'],['20260802_06_create_customer_wallet.sql','payment_methods'],['20260906_05_ar_adjustment_tables.sql','public.ar_adjustment_reason'],['20260813_14_hr_payroll_expense_posting.sql','expense_category']]) {
    const text=fs.readFileSync(path.join(root,'database/migrations',file),'utf8');
    const start=text.indexOf(`INSERT INTO ${table}`);
    await db.query(text.slice(start,text.indexOf(';',start)+1));
  }
  await db.query(fs.readFileSync(path.join(root,'database/migrations/20261022_01_configurable_document_types_and_last_selection.sql'),'utf8'));

  const sequences=(await db.query(`SELECT table_name,column_name,pg_get_serial_sequence(format('public.%I',table_name),column_name) AS seq FROM information_schema.columns WHERE table_schema='public' AND column_default LIKE 'nextval(%'`)).rows;
  for(const {table_name,column_name,seq} of sequences) if(seq) await db.query(`SELECT setval($1,COALESCE((SELECT MAX("${column_name}") FROM "${table_name}"),1),EXISTS(SELECT 1 FROM "${table_name}"))`,[seq]);
  const testContainer=process.env.FITMENT_JEST_CONTAINER;
  const testCommand=testContainer?'docker':'npm';
  const testArgs=testContainer?['exec',...(process.env.FITMENT_JEST_REFERENCE ? ['-w','/tmp/fitment-reference/packages/api'] : []),'-e',`DB_NAME=${process.env.DB_NAME}`,'-e','JEV_ENABLED=false','-e','DISABLE_MEILI_OUTBOX_WORKER=true',testContainer,'npm','test','--','--runInBand']:['run','-w','packages/api','test','--','--runInBand'];
  if(process.env.FITMENT_JEST_REFERENCE)testArgs.push('tests/chequeReplacementAndDeletion.test.js','tests/transactionDateService.test.js');
  const run=spawnSync(testCommand,testArgs,{cwd:root,env:process.env,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});fs.writeFileSync('/tmp/fitment-full-jest.log',run.stdout+run.stderr);report.full_jest={status:run.status,tail:(run.stdout+run.stderr).slice(-1700)};}
 process.stdout.write(JSON.stringify(report,null,2));process.exit(0);
}
(process.argv.includes('--worker')?worker():parent()).catch(e=>{process.stderr.write(JSON.stringify({error:e.message,stack:e.stack}));process.exit(1);});
