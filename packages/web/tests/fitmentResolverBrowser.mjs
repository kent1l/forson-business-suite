import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
const page=await browser.newPage();
const errors=[];
const requests=[];
let dismissed=false;
let version=1;
let failSave=true;
page.on('pageerror',e=>errors.push(e.message));
await page.setRequestInterception(true);
const baseCandidate={make_id:1,make:'Toyota',model_id:11,model:'Hilux',effect:'include',confidence:'high',confidence_label:'high',candidate_id:1,ui_badge:'Needs review',preselected:true,raw_span:'Toyota Hilux',position:'Front',transmission:'Manual',generation:'Gen 2'};
page.on('request',req=>{
  const path=new URL(req.url()).pathname;
  if(!path.startsWith('/api/'))return req.continue();
  const body=req.postData()?JSON.parse(req.postData()):{};
  requests.push({method:req.method(),path,body,headers:req.headers()});
  const respond=(data,status=200)=>req.respond({status,contentType:'application/json',body:JSON.stringify(data)});
  if(path==='/api/applications/parse-fitment-text'){
    version++;
    const candidates=[{...baseCandidate,disposition:dismissed?'dismissed':'selected'},
      {...baseCandidate,candidate_id:2,model_id:12,model:'Fortuner',already_linked:true,preselected:false,ui_badge:'Already linked'},
      {...baseCandidate,candidate_id:3,model_id:null,model:'Unknown model',preselected:false,confidence_label:'unresolved',ui_badge:'Unresolved'},
      {...baseCandidate,candidate_id:4,engine_id:101,engine:'1KD-FTV',preselected:false,alternative_group_id:'one-clause'},
      {...baseCandidate,candidate_id:5,engine_id:102,engine:'2KD-FTV',preselected:false,alternative_group_id:'one-clause'}];
    return respond({review_id:7,review_version:version,candidates,source:'local'});
  }
  if(path==='/api/applications/fitment-reviews/7'){
    assert.equal(body.expected_version,version);
    if(body.action==='dismiss_candidate')dismissed=true;
    version++;
    return respond({review_id:7,review_version:version});
  }
  if(path==='/api/parts/1/applications'&&req.method()==='POST'){
    if(failSave){failSave=false;return req.abort('failed');}
    return respond({outcome:'saved',rule_id:1},201);
  }
  if(path==='/api/parts/1/fitment-evidence')return respond([]);
  if(path==='/api/applications/fitment-research')return respond({evidence:[{...body.evidence[0],evidence_id:9,row_version:1,approval_status:'needs_review'}]},201);
  if(path==='/api/applications/fitment-evidence/9/approval')return respond({evidence_id:9,row_version:2,source_title:'Browser fixture source',quoted_span:'Fixture supporting passage',approval_status:'approved',claim_type:'part_compatibility',assessment:'supported'});
  if(path==='/api/parts/1/application-rules/1/approval')return respond({rule_id:1,row_version:2,approval_status:'approved'});
  if(path==='/api/parts/1/applications')return respond([
    {...baseCandidate,part_app_id:1,rule_id:1,row_version:1,year_start:2005,year_end:2010,approval_status:'needs_review'},
    {...baseCandidate,part_app_id:1,rule_id:2,effect:'exclude',year_start:2018,year_end:2018,approval_status:'needs_review'},
  ]);
  return respond([]);
});
async function clickText(text){await page.evaluate(t=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===t);if(!b)throw Error(`Missing ${t}`);b.click();},text);}
async function mount(mode){await page.evaluate(m=>window.mountFitment(m),mode);await page.waitForSelector('textarea');}
async function parse(){await page.type('textarea','Toyota Hilux');await page.waitForSelector('#fitment-candidate-4');}
try{
  await page.goto(`${process.env.FITMENT_BROWSER_BASE_URL||'http://localhost:5173'}/tests/fixtures/fitmentResolverBrowser.html`);
  await page.waitForFunction(()=>typeof window.mountFitment==='function');
  for(const width of [390,1280]){
    await page.setViewport({width,height:900});
    await mount(`review-${width}`);await parse();
    assert.equal(await page.$eval('#fitment-candidate-1',e=>e.disabled),true);
    assert.equal(await page.$eval('#fitment-candidate-2',e=>e.disabled),true);
    await page.click('#fitment-candidate-3');await page.click('#fitment-candidate-4');
    assert.equal(await page.$eval('#fitment-candidate-3',e=>e.checked),false);
    await page.click('#fitment-candidate-4');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    await clickText('Save 1 Selected Fitment');
    if(width===390){
      await page.waitForSelector('[role="alert"]');await clickText('Save 1 Selected Fitment');
    }
    await page.waitForFunction(()=>!document.querySelector('#fitment-candidate-0'));
  }
  const saves=requests.filter(r=>r.path==='/api/parts/1/applications'&&r.method==='POST');
  assert.equal(saves[0].headers['idempotency-key'],saves[1].headers['idempotency-key']);
  assert.equal(saves[1].body.expected_version,2);
  assert.equal(saves[1].body.transmission,'Manual');assert.equal(saves[1].body.generation,'Gen 2');
  assert.ok(saves.every(r=>r.body.approval_status===undefined&&r.body.evidence_status===undefined));
  assert.ok(!requests.some(r=>r.path==='/api/applications'&&r.method==='POST'));
  await mount('dismiss');await parse();await clickText('Remove');await page.waitForFunction(()=>document.querySelectorAll('input[type="checkbox"]').length===4);
  await clickText('Parse Description');await page.waitForFunction(()=>document.body.textContent.includes('Already linked')&&!document.querySelector('label[for="fitment-candidate-0"]').textContent.includes('Toyota Hilux'));
  await page.evaluate(()=>window.mountFitment('manager'));
  await page.waitForFunction(()=>document.body.textContent.includes('Linked Applications')&&document.body.textContent.includes('Excluded'));
  assert.ok((await page.content()).includes('2018'));
  await clickText('Evidence');await page.waitForSelector('[aria-label="Evidence source title"]');
  await page.type('[aria-label="Evidence source title"]','Browser fixture source');
  await page.type('[aria-label="Evidence supporting excerpt"]','Fixture supporting passage');
  await page.click('.fixed input[type="checkbox"]');
  await clickText('Record source for review');await page.waitForSelector('[aria-label="Evidence review reason"]');
  assert.equal(requests.filter(r=>r.path.endsWith('/approval')).length,0);
  await page.type('[aria-label="Evidence review reason"]','Exact part and restriction review');
  await clickText('Approve evidence');await page.waitForFunction(()=>document.body.textContent.includes('Evidence approved.'));
  assert.equal(requests.filter(r=>r.path==='/api/parts/1/application-rules/1/approval').length,0);
  await clickText('Approve compatibility');await page.waitForFunction(()=>document.body.textContent.includes('Compatibility approved for this exact'));
  const capture=requests.find(r=>r.path==='/api/applications/fitment-research');assert.equal(capture.body.evidence[0].rights_policy,'permitted_excerpt');
  assert.ok(capture.body.evidence[0].extracted_claim.rule.position==='Front');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'pass',viewports:[390,1280],checks:['versioned saves','stable retry key','qualifiers preserved','unresolved and already-linked disabled','exclusive alternatives','persistent dismissal','manager restriction display','manual evidence capture','separate evidence and compatibility approvals'],api:'intercepted contract fixtures; real SQL is covered separately'}));
}finally{await browser.close();}
