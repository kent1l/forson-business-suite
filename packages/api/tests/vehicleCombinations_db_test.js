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
  try{await fixture.connect();const sql=fs.readFileSync(schemaFile,'utf8').replace(/^\\(?:un)?restrict.*$/gm,'');await fixture.query(sql);await fixture.query('SET search_path TO public');const migration=fs.readFileSync(path.join(root,'database/migrations/20261101_02_vehicle_combinations_direct_links.sql'),'utf8');await fixture.query(migration);await fixture.query(migration);}finally{await fixture.end();}
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
 app.use('/api',require(path.join(root,'packages/api/routes/applicationSearchRoutes')));
 app.use('/api',require(path.join(root,'packages/api/routes/draftRoutes')));
 const token=id=>jwt.sign({employee_id:id,login_date:manilaDateString()},process.env.JWT_SECRET,{expiresIn:'5m'});
 const send=(method,url,body={},id=1,key)=>{let r=request(app)[method]('/api'+url).set('Authorization','Bearer '+token(id));if(key)r=r.set('Idempotency-Key',key);return r.send(body).timeout({response:10000,deadline:15000});};
 const results=[];
 async function test(name,fn){try{await fn();results.push({name,status:'pass'});}catch(e){results.push({name,status:'fail',error:e.message});e.message+=' Logs: '+JSON.stringify(logs.slice(-4));throw e;}}
 const link=body=>send('post','/parts/1/applications',body);
 await test('empty draft metadata is a successful null result and existing revisions stay intact',async()=>{
  let r=await send('get','/drafts/goods-receipt?meta=true');assert.equal(r.status,200);assert.equal(r.body.data,null);assert.equal(r.body.last_updated,null);
  assert.equal((await send('get','/drafts/goods-receipt')).status,404);
  r=await send('post','/drafts/goods-receipt',{data:{lines:[{detail:'Fixture'}]},expected_revision:null});assert.equal(r.status,200,JSON.stringify(r.body));
  r=await send('get','/drafts/goods-receipt?meta=true');assert.equal(r.status,200);assert.equal(r.body.data.lines[0].detail,'Fixture');assert.ok(r.body.last_updated);
 });
 await test('direct link works for editor without approval permission and records no source',async()=>{
  const r=await link({application_id:1});assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(r.body.claim_id,null);
  assert.equal(r.body.approval_status,null);assert.equal(r.body.evidence_status,null);
  for(const table of ['fitment_claim','fitment_rule_source','fitment_evidence','fitment_review','fitment_review_candidate','fitment_research_job'])assert.equal((await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0,table);
 });
 await test('concurrent retries deduplicate links and preserve idempotency conflicts',async()=>{
  const replies=await Promise.all(Array.from({length:12},()=>send('post','/parts/1/applications',{application_id:1,position:'Front'},1,'direct-race')));
  assert.ok(replies.every(r=>[200,201].includes(r.status)),JSON.stringify(replies.map(r=>r.body)));
  assert.equal(new Set(replies.map(r=>r.body.rule_id)).size,1);
  assert.equal((await send('post','/parts/1/applications',{application_id:1,position:'Rear'},1,'direct-race')).status,409);
 });
 let manual,automatic;
 await test('same base vehicle has distinct reusable classifications and normalized deduplication',async()=>{
  const base={make_id:1,model_id:11,engine_id:101,year_start:2010,year_end:2015,market:'PH',variant:'GL',drivetrain:'2WD',generation:'Gen 2',fuel_type:'diesel',displacement_liters:2.5};
  let r=await send('post','/applications',{...base,transmission:'Manual'});assert.ok([200,201].includes(r.status),JSON.stringify(r.body));manual=r.body;assert.equal(manual.transmission,'Manual');
  r=await send('post','/applications',{...base,transmission:'Automatic'});assert.ok([200,201].includes(r.status),JSON.stringify(r.body));automatic=r.body;assert.notEqual(manual.application_id,automatic.application_id);
  r=await send('post','/applications',{...base,transmission:' manual ',market:'ph'});assert.equal(r.body.application_id,manual.application_id,JSON.stringify(r.body));
  r=await send('get','/application-search?q=Hilux%20Automatic%20GL');assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.length,1);assert.equal(r.body[0].application_id,automatic.application_id);
  r=await send('get','/applications?search=Automatic');assert.equal(r.status,200);assert.equal(r.body[0].transmission,'Automatic');
 });
 await test('link inherits combination details while preserving narrower link years and position',async()=>{
  let r=await link({application_id:manual.application_id,position:'Rear'});assert.equal(r.status,201,JSON.stringify(r.body));
  r=await link({application_id:manual.application_id,year_start:2012,year_end:2013,position:'Front'});assert.equal(r.status,201,JSON.stringify(r.body));
  const rows=(await send('get','/parts/1/applications')).body.filter(r=>r.application_id===manual.application_id);
  assert.equal(rows.length,2);const rear=rows.find(r=>r.position==='Rear');assert.equal(rear.year_start,2010);assert.equal(rear.transmission,'Manual');assert.equal(rear.variant,'GL');assert.equal(rear.market,'PH');assert.equal(rear.approval_status,undefined);
  assert.equal(rows.find(r=>r.position==='Front').year_start,2012);
 });
 await test('partial make, engine and chassis combinations can be linked immediately',async()=>{
  for(const payload of [{make_id:2},{engine_id:102},{chassis:'DIRECT-CHASSIS'}]){let r=await link(payload);assert.equal(r.status,201,JSON.stringify(r.body));assert.ok(r.body.application_id);}
 });
 await test('parsing is transient and selections save without review tokens',async()=>{
  let r=await send('post','/applications/parse-fitment-text',{text:'Toyota Fortuner',part_id:1,disable_ai:true});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.review_id,undefined);assert.ok(r.body.fitments.length);
  r=await link(r.body.fitments[0]);assert.ok([200,201].includes(r.status),JSON.stringify(r.body));
  for(const table of ['fitment_claim','fitment_review','fitment_review_candidate','fitment_evidence'])assert.equal((await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0,table);
 });
 await test('evidence and approval endpoints cannot create records',async()=>{
  for(const url of ['/applications/fitment-research','/applications/fitment-evidence/1/approval','/parts/1/application-rules/1/approval','/applications/fitment-corrections'])assert.equal((await send('post',url,{part_id:1,evidence:[{source_title:'No longer saved'}]})).status,410,url);
 });
 await test('basic invalid years, IDs and parent mismatches still fail atomically',async()=>{
  for(const payload of [{make_id:2,model_id:11},{application_id:1,model:'Fortuner'},{year_start:2020,year_end:2010,engine_id:101},{engine_id:101,fuel_type:'unknown'},{engine_id:101,displacement_liters:2.55}])assert.equal((await link(payload)).status,422,JSON.stringify(payload));
  assert.equal((await send('post','/parts/1/applications',{application_id:2},2)).status,403);
 });
 await test('shared classifications can be corrected without approval; links follow changes',async()=>{
  let r=await send('put',`/applications/${manual.application_id}`,{make_id:1,model_id:11,engine_id:101,year_start:2011,expected_version:manual.row_version});assert.equal(r.status,200,JSON.stringify(r.body));manual=r.body;
  r=await send('get','/parts/1/applications');assert.equal(r.body.find(r=>r.application_id===manual.application_id&&r.position==='Rear').year_start,2011);
  const narrower=r.body.find(r=>r.application_id===manual.application_id&&r.position==='Front');assert.equal(narrower.year_start,2012);
  r=await send('put',`/parts/1/application-rules/${narrower.rule_id}`,{position:'Left',expected_version:narrower.row_version});assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal((await send('put',`/parts/1/application-rules/${narrower.rule_id}`,{position:'Right',expected_version:narrower.row_version})).status,409);
  assert.equal((await send('delete',`/applications/${manual.application_id}`)).status,409);
 });
 await test('staged part creation and edit share the same direct link policy',async()=>{
  let r=await send('post','/parts',{brand_id:1,group_id:1,detail:'Direct staged part',applications:[{application_id:automatic.application_id,position:'Front'}]});assert.equal(r.status,201,JSON.stringify(r.body));
  const id=r.body.part_id;
  r=await send('get',`/parts/${id}/applications`);assert.equal(r.body.length,1);assert.equal(r.body[0].transmission,'Automatic');
  r=await send('put',`/parts/${id}`,{brand_id:1,group_id:1,detail:'Edited direct staged part',applications:[{engine_id:102}]});assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal((await db.query('SELECT count(*)::int n FROM fitment_claim')).rows[0].n,0);
 });
 await test('GRN parsed names create classified fitments atomically and reuse combinations',async()=>{
  const applications=[{make:'Toyota',model:'Hilux',engine:'TEST1',year_start:2005,year_end:2015,drivetrain:'4WD',position:'Front'}, {engine:'TEST2',position:'Rear'}];
  let r=await send('post','/parts',{brand_id:1,group_id:1,detail:'GRN prefilled part',applications});assert.equal(r.status,201,JSON.stringify(r.body));
  const partId=r.body.part_id;
  r=await send('get',`/parts/${partId}/applications`);assert.equal(r.body.length,2);assert.ok(r.body.some(a=>a.year_start===2005&&a.drivetrain==='4WD'&&a.position==='Front'));
  r=await send('post',`/parts/${partId}/applications`,applications[0]);assert.ok([200,201].includes(r.status),JSON.stringify(r.body));
  assert.equal((await send('get',`/parts/${partId}/applications`)).body.length,2);
 });
 await test('application ID sequence drift recovers without losing the new part or fitment',async()=>{
  const seq=(await db.query("SELECT last_value FROM application_application_id_seq")).rows[0].last_value;
  const occupied=(await db.query('SELECT min(application_id) id FROM application')).rows[0].id;
  try {
   await db.query("SELECT setval('application_application_id_seq',$1,false)",[occupied]);
   const r=await send('post','/parts',{brand_id:1,group_id:1,detail:'GRN collision recovery',applications:[{engine_id:102,market:'Collision fixture'}]});
   assert.equal(r.status,201,JSON.stringify(r.body));
   assert.equal((await send('get',`/parts/${r.body.part_id}/applications`)).body.length,1);
   assert.equal((await db.query("SELECT count(*)::int n FROM part WHERE detail='GRN collision recovery'")).rows[0].n,1);
  } finally { await db.query("SELECT setval('application_application_id_seq',$1,true)",[Math.max(Number(seq), Number((await db.query('SELECT max(application_id) id FROM application')).rows[0].id))]); }
 });
 await test('lookup matches direct links without evidence and keeps explicit conflicts',async()=>{
  const {evaluateFitmentRules}=require('../helpers/fitmentMatcher');const {effectiveRuleColumns}=require('../helpers/fitmentDocumentSql');
  const rules=(await db.query(`SELECT r.*,a.make_id,a.model_id,a.engine_id,a.chassis_id,${effectiveRuleColumns()} FROM part_application_rule r JOIN application a USING(application_id) WHERE r.part_id=1`)).rows;
  assert.equal(evaluateFitmentRules(rules,{model_id:11,engine_id:101}).status,'linked');
  assert.equal(evaluateFitmentRules([{engine_id:101,effect:'include',evidence_current:false}],{engine_id:101}).status,'linked');
  assert.equal(evaluateFitmentRules([{engine_id:101,effect:'include'}],{engine_id:102}).state,'conflict');
  assert.equal(evaluateFitmentRules([{engine_id:101,effect:'exclude'}],{engine_id:101}).status,'excluded');
 });
 await test('catalog exports linked combinations and optional details without approval metadata',async()=>{
  const row=(await require('../services/catalogSyncService').buildCatalogRows([1]))[0];assert.equal(row.fitment_schema_version,3);assert.equal(row.applications_status,'linked');assert.ok(row.fitment_rules.some(r=>r.transmission==='Manual'));assert.ok(row.fitment_rules.every(r=>r.approval_status===undefined&&r.evidence_status===undefined));
 });
 await test('power search returns direct links and respects distinct transmissions',async()=>{
  const {meiliClient}=require('../meilisearch');
  meiliClient.index=()=>({search:async()=>({hits:[{part_id:1}],estimatedTotalHits:1})});
  app.use('/api',require('../routes/powerSearchRoutes'));
  let r=await send('get','/power-search/parts?model_id=11&engine_id=101&transmission=Manual&year=2012');assert.equal(r.status,200,JSON.stringify(r.body));assert.ok(r.body.some(x=>x.part_id===1));assert.ok(!r.body[0].fitment.reasons.some(reason=>/evidence|verified|approv/.test(reason)));
  r=await send('get','/power-search/parts?model_id=11&engine_id=101&transmission=Automatic&year=2012');assert.equal(r.status,200,JSON.stringify(r.body));
  const catalog=(await require('../services/catalogSyncService').buildCatalogRows([1]))[0];assert.match(catalog.applications,/Manual/);assert.match(catalog.applications,/GL/);
 });
 await test('unlink removes only the selected part link',async()=>{
  let r=await send('get','/parts/1/applications');const selected=r.body.find(r=>r.application_id===manual.application_id&&r.position==='Rear');
  r=await send('delete',`/parts/1/application-rules/${selected.rule_id}`,{expected_version:selected.row_version});assert.equal(r.status,200,JSON.stringify(r.body));
  r=await send('get','/parts/1/applications');assert.ok(!r.body.some(r=>r.rule_id===selected.rule_id));assert.ok(r.body.some(r=>r.application_id===manual.application_id));
 });
 await test('model groups page whole identities and retain exact combinations',async()=>{
  // A model name reused by another make must remain a separate group.
  await db.query(`INSERT INTO vehicle_model(model_id,make_id,model_name) VALUES(14,2,'Hilux');
    INSERT INTO application(make_id,model_id,engine_id) VALUES(2,14,102),(NULL,NULL,101),(NULL,NULL,102) ON CONFLICT DO NOTHING;`);
  const flat=await send('get','/applications');assert.equal(flat.status,200);assert.ok(Array.isArray(flat.body));
  const expectedGroups=new Set(flat.body.map(row=>row.model_id?`model:${row.model_id}`:`application:${row.application_id}`));
  const groups=[];
  for(let page=1;page<=expectedGroups.size;page++){
   const r=await send('get',`/applications?groupBy=model&paginated=1&pageSize=1&page=${page}&sortBy=model`);
   assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.total,expectedGroups.size);assert.equal(r.body.data.length,1);
   groups.push(r.body.data[0]);
  }
  assert.equal(new Set(groups.map(g=>g.group_key)).size,expectedGroups.size);
  assert.deepEqual(groups.flatMap(g=>g.combinations.map(r=>r.application_id)).sort((a,b)=>a-b),flat.body.map(r=>r.application_id).sort((a,b)=>a-b));
  const hilux=groups.find(g=>g.group_key==='model:11');
  assert.ok(hilux.combinations.some(row=>row.application_id===manual.application_id));
  assert.ok(hilux.combinations.some(row=>row.application_id===automatic.application_id));
  const saved=hilux.combinations.find(row=>row.application_id===manual.application_id);
  assert.equal(saved.row_version,manual.row_version);assert.equal(saved.transmission,'Manual');assert.ok(saved.linked_parts_count>0);
  assert.equal(saved.approval_status,undefined);assert.equal(saved.evidence_status,undefined);
  assert.equal(groups.filter(g=>g.model==='Hilux').length,2);
  assert.ok(groups.filter(g=>!g.model).every(g=>g.combinations.length===1));
  for(const sortBy of ['make','model','engine']){
   const url=`/applications?groupBy=model&paginated=1&pageSize=100&sortBy=${sortBy}&sortOrder=DESC`;
   const first=await send('get',url),second=await send('get',url);
   assert.equal(first.status,200);assert.deepEqual(first.body.data.map(g=>g.group_key),second.body.data.map(g=>g.group_key));
  }
  const filtered=await send('get','/applications?groupBy=model&paginated=1&search=Automatic');
  assert.equal(filtered.status,200);assert.equal(filtered.body.total,1);
  assert.ok(filtered.body.data[0].combinations.some(row=>row.transmission==='Manual'));
  assert.equal((await send('get','/applications?groupBy=model',{},2)).status,403);
 });
 await test('search responses supply current structured fitments independently of index labels',async()=>{
  const excluded=await link({application_id:2,effect:'exclude'});assert.ok([200,201].includes(excluded.status),JSON.stringify(excluded.body));
  for(const url of ['/power-search/parts?keyword=fixture','/parts?search=fixture','/parts?search=fixture&paginated=1']){
   const r=await send('get',url);assert.equal(r.status,200,JSON.stringify(r.body));
   const part=(Array.isArray(r.body)?r.body:r.body.data).find(row=>row.part_id===1);assert.ok(part,url);
   assert.ok(Array.isArray(part.fitment_rules));
   assert.ok(part.fitment_rules.some(row=>row.application_id===manual.application_id&&row.transmission==='Manual'&&row.position==='Left'));
   assert.ok(part.fitment_rules.some(row=>row.effect==='exclude'&&row.application_id===2));
   const manualRule=part.fitment_rules.find(row=>row.application_id===manual.application_id&&row.position==='Left');
   assert.equal(manualRule.year_start,2012);assert.equal(manualRule.engine,'TEST1');assert.equal(manualRule.model,'Hilux');
   assert.ok(!part.fitment_rules.some(row=>row.position==='Rear'));
  }
 });
 let regression = null;
 if (process.argv.includes('--regression-jest')) {
   const run = spawnSync('npm', ['run','-w','packages/api','test','--','--runInBand',
     'tests/fitmentResolverPhase1To3.test.js','tests/fitmentTextParser.test.js','tests/poCataloging.test.js',
     'tests/powerSearchInterchangeableParts.test.js','tests/partMergeConstraints.test.js','tests/partMergeService.test.js'],
     {cwd:root,env:process.env,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
   fs.writeFileSync('/tmp/direct-link-regression-tests.txt',run.stdout+run.stderr);
   assert.equal(run.status,0,(run.stdout+run.stderr).slice(-2200));
   regression = (run.stdout+run.stderr).slice(-700);
 }
 process.stdout.write(JSON.stringify({results,passed:results.length,regression,migration:'applied twice',environment:'disposable schema-only PostgreSQL fixture'},null,2));process.exit(0);
}
(process.argv.includes('--worker')?worker():parent()).catch(e=>{process.stderr.write(JSON.stringify({error:e.message,stack:e.stack}));process.exit(1);});
