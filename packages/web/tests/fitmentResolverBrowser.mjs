import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
const page = await browser.newPage();
const errors = [], requests = [];
let failSave = true;
const combination = { application_id:1,make_id:1,make:'Toyota',model_id:11,model:'Hilux',engine_id:101,engine:'TEST1',transmission:'Manual',variant:'GL',market:'PH',year_start:2010,year_end:2015 };
page.on('pageerror',e=>errors.push(e.message));
await page.setRequestInterception(true);
page.on('request',req=>{
    const path = new URL(req.url()).pathname;
    if (!path.startsWith('/api/')) return req.continue();
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    requests.push({method:req.method(),path,body,headers:req.headers()});
    const respond = (data,status=200) => req.respond({status,contentType:'application/json',body:JSON.stringify(data)});
    if (path === '/api/applications/parse-fitment-text') return respond({fitments:[
        {...combination,confidence_label:'high'},
        {engine:'AMBIGUOUS',confidence_label:'unresolved'},
        {...combination,engine_id:102,engine:'TEST2',alternative_group_id:'choice'},
        {...combination,engine_id:103,engine:'TEST3',alternative_group_id:'choice'},
    ]});
    if (path === '/api/parts/1/applications' && req.method()==='POST') {
        if (failSave) {failSave=false;return req.abort('failed');}
        return respond({rule_id:1},201);
    }
    if (path === '/api/parts/1/applications') return respond([{...combination,rule_id:1,part_app_id:1,row_version:1,approval_status:'needs_review',evidence_status:'legacy_unverified'}]);
    if (path === '/api/application-search') return respond([combination,{...combination,application_id:2,transmission:'Automatic'}]);
    if (path === '/api/makes') return respond([{make_id:1,make_name:'Toyota'}]);
    if (path === '/api/engines') return respond([{engine_id:101,engine_code:'TEST1'}]);
    if (path === '/api/makes/1/models') return respond([{model_id:11,model_name:'Hilux'}]);
    return respond([]);
});
async function click(text) {
    await page.evaluate(t=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===t);if(!button)throw Error(`Missing button ${t}`);button.click();},text);
}
try {
    await page.goto(`${process.env.FITMENT_BROWSER_BASE_URL || 'http://localhost:5173'}/tests/fixtures/fitmentResolverBrowser.html`);
    await page.waitForFunction(()=>typeof window.mountFitment==='function');
    for (const width of [390,1280]) {
        await page.setViewport({width,height:1000});
        await page.evaluate(w=>window.mountFitment(`direct-${w}`),width);
        await page.waitForSelector('textarea');await page.type('textarea','Toyota Hilux');await click('Find Combinations');
        await page.waitForFunction(()=>document.querySelectorAll('input[type="checkbox"]').length===4);
        assert.equal(await page.$$eval('input[type="checkbox"]',es=>es[1].disabled),true);
        await page.$$eval('input[type="checkbox"]',es=>es[2].click());await page.$$eval('input[type="checkbox"]',es=>es[3].click());
        assert.equal(await page.$$eval('input[type="checkbox"]',es=>es[2].checked),false);
        await page.$$eval('input[type="checkbox"]',es=>es[3].click());
        await click('Link Selected Combinations');
        if(width===390) {await page.waitForSelector('[role="alert"]');await click('Link Selected Combinations');}
        await page.waitForFunction(()=>document.body.textContent.includes('Linked'));
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    }
    const saves = requests.filter(r=>r.path==='/api/parts/1/applications'&&r.method==='POST');
    assert.equal(saves[0].headers['idempotency-key'],saves[1].headers['idempotency-key']);
    assert.equal(saves[1].body.transmission,'Manual');assert.equal(saves[1].body.variant,'GL');
    assert.ok(saves.every(r=>r.body.review_id===undefined&&r.body.evidence_status===undefined&&r.body.approval_status===undefined));
    await page.evaluate(()=>window.mountFitment('manager'));
    await page.waitForFunction(()=>document.body.textContent.includes('Linked Vehicle Combinations'));
    assert.ok(!(await page.content()).includes('Needs review'));
    assert.ok(!(await page.content()).includes('Evidence'));
    await page.click('input[placeholder="Search make model engine…"]');
    await page.waitForFunction(()=>document.body.textContent.includes('Automatic'));
    assert.ok((await page.content()).includes('Automatic'));
    await click('New');
    await page.waitForFunction(()=>document.body.textContent.includes('Variant / trim (optional)'));
    assert.ok((await page.content()).includes('Drivetrain (optional)'));
    assert.ok((await page.content()).includes('Chassis code (optional)'));
    assert.ok(!requests.some(r=>/evidence|approval|fitment-reviews|fitment-corrections|research/.test(r.path)));
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({status:'pass',viewports:[390,1280],checks:['direct linking','stable retry keys','classification preserved','exclusive alternatives','no evidence or approval calls','linked display','distinct picker labels','optional classification fields'],api:'intercepted browser contract fixtures; PostgreSQL checked separately'}));
} finally {await browser.close();}
