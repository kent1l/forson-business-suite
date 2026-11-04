// Offline characterization against actual existing functions. No DB calls or provider calls.
process.env.DOTENV_CONFIG_QUIET = 'true';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const { buildIndex } = require(path.join(root,'packages/api/helpers/vehicleTaxonomyIndex'));
const { parseFitmentText, buildShortlist } = require(path.join(root,'packages/api/helpers/fitmentTextParser'));
const ai = require(path.join(root,'packages/api/services/ai/features/vehicleFitmentParserAI'));
// This private helper has no export. Evaluate its exact source without loading the route,
// starting workers, opening sockets or replacing dependencies. Fail if its boundary drifts.
const route = fs.readFileSync(path.join(root,'packages/api/routes/partApplicationRoutes.js'),'utf8');
const mergeSource = route.match(/function mergeFitmentCandidates\(localRows, aiRows\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(mergeSource, 'Merge source boundary changed: update characterization harness');
const merge = vm.runInNewContext(`(${mergeSource})`);
const raw = {
 makes:[{make_id:1,make_name:'Toyota'},{make_id:2,make_name:'Other'}],
 models:[{model_id:11,make_id:1,model_name:'Hilux'},{model_id:12,make_id:1,model_name:'Fortuner'},{model_id:13,make_id:1,model_name:'Hiace'}],
 engines:[{engine_id:101,engine_code:'TEST1',displacement_liters:2.5,fuel_type:'diesel'},{engine_id:102,engine_code:'TEST2',displacement_liters:3,fuel_type:'diesel'}],
 makeAliases:[],modelAliases:[],engineAliases:[],modelEnginePairs:[{model_id:11,engine_id:101},{model_id:12,engine_id:101}]
};
const index=buildIndex(raw);
const results=[];
function check(id,input,run,expected) {const actual=run();let passes=true,error;try{expected(actual);}catch(e){passes=false;error=e.message;}results.push({id,input,actual,target_passes:passes,...error?{difference:error}:{}});}
check('B01','TOYOTA HILUX, FORTUNER, HI-ACE',()=>parseFitmentText('TOYOTA HILUX, FORTUNER, HI-ACE',index),r=>{assert.deepEqual(r.fitments.map(f=>f.model_id),[11,12,13]);assert.ok(r.fitments.every(f=>f.engine_id===null&&f.year_start===null&&f.fuel_type===null));});
check('B02','Toyota Hilux 2005-2015 2.5L diesel, Fortuner',()=>parseFitmentText('Toyota Hilux 2005-2015 2.5L diesel, Fortuner',index),r=>{const f=r.fitments[1];assert.equal(f.year_start,null);assert.equal(f.displacement_liters,null);assert.equal(f.fuel_type,null);assert.equal(f.engine_id,null);});
check('B03','Toyota Hilux 2005-2015 2.5L diesel, Fortuner same years',()=>parseFitmentText('Toyota Hilux 2005-2015 2.5L diesel, Fortuner same years',index),r=>{assert.equal(r.fitments[1].year_start,2005);assert.equal(r.fitments[1].engine_id,null);assert.equal(r.fitments[1].fuel_type,null);});
check('B04','TEST1, TEST2',()=>parseFitmentText('TEST1, TEST2',index),r=>{assert.deepEqual(r.fitments.map(f=>f.engine_id),[101,102]);assert.ok(r.fitments.every(f=>f.model_id===null));});
check('B05','Repeated local text',()=>parseFitmentText('Toyota Hilux, Toyota Hilux',index),r=>assert.equal(r.fitments.length,1));
const local=parseFitmentText('Toyota Hilux',index).fitments[0];
check('B06','Same interpretation, AI omitted make id',()=>merge([local],[{...local,make_id:null}]),r=>assert.equal(r.length,1));
check('B07','Same IDs/year, contradictory fuel/qualifier',()=>merge([local],[{...local,fuel_type:'gasoline'}]),r=>assert.equal(r.length,2));
check('B08','Valid but wrong ID/name',()=>ai._validateResult({fitments:[{make:'Toyota',make_id:1,model:'Fortuner',model_id:11,confidence:'high'}]},raw),r=>assert.ok(r.fitments[0].model_id!==11 || r.fitments[0].confidence!=='high'));
check('B09','Shortlist residue excludes recognized clause',()=>buildShortlist(['Other'],index),r=>assert.ok(r.models.some(m=>m.model_id===11)));
check('B10','Paired models and engines in one clause',()=>parseFitmentText('Hilux TEST1 / Fortuner TEST2',index),r=>assert.equal(r.fitments.length,2));
check('B11','Toyota Hilux except 2010',()=>parseFitmentText('Toyota Hilux except 2010',index),r=>assert.ok(r.fitments.some(f=>f.effect==='exclude'&&f.year_start===2010)));
console.log(JSON.stringify({fixture:'Synthetic identifiers; no compatibility evidence',results,summary:{cases:results.length,target_pass:results.filter(r=>r.target_passes).length,target_fail:results.filter(r=>!r.target_passes).length}},null,2));
if(process.argv.includes('--enforce') && results.some(r=>!r.target_passes)) process.exitCode=1;
