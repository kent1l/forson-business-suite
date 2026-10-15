import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.setViewport({
  width: 390,
  height: 844
});
await page.setRequestInterception(true);
const posts = [];
let unknown = true;
let testFilterRace = false;
const summary = id => ({
  employee_id: id,
  as_of: '2026-10-15T01:00:00Z',
  partial: false,
  categories: {
    owed_to_company: {
      outstanding: id === '22' ? '22.02' : '150.01'
    },
    owed_to_employee: {
      unpaid_salary: '0.01',
      pending: '0.00'
    },
    government_loans: {
      obligations: [],
      withheld: []
    },
    business_advances: {
      records: []
    }
  },
  transactions: {
    data: [],
    balances: [],
    page: 1,
    totalPages: 1,
    total: 0
  }
});
page.on('request', req => {
  const path = new URL(req.url()).pathname;
  if (!path.startsWith('/api/')) return req.continue();
  const respond = data => req.respond({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(data)
  });
  if (req.method() === 'POST') {
    posts.push({
      path,
      body: JSON.parse(req.postData())
    });
    if (unknown) {
      unknown = false;
      return req.abort('failed');
    }
    return req.respond({
      status: 201,
      contentType: 'application/json',
      body: '{"loan_id":123,"version":1}'
    });
  }
  if (path.endsWith('/accounts')) {
    const id = path.split('/')[4]; const data = summary(id);
    if (id === '33') data.transactions.data = [{source_type:'LOAN_PAYMENT',source_id:901,domain:'COMPANY',occurred_at:'2026-10-15T01:00:00Z',description:'Verified direct repayment',amount:'12.34'}];
    const domain = new URL(req.url()).searchParams.get('domain');
    if (testFilterRace && domain) {
      data.transactions.data = [{source_type:'LOAN_PAYMENT',source_id:901,domain,occurred_at:'2026-10-15T01:00:00Z',description:domain==='COMPANY'?'Stale company filter':'Current employee filter',amount:'12.34'}];
      return setTimeout(()=>respond(data),domain==='COMPANY'?350:10);
    }
    return respond(data);
  }
  if (path.includes('/account-sources/')) return respond({payment_id:901,amount:'12.34',occurred_at:'2026-10-15T01:00:00Z',reason:'Verified fixture receipt',version:1,request_id:'hidden-request'});
  if (path === '/api/cash-drawers/sessions') return respond({data:[{session_id:41,version:7,drawer_name:'Main counter',session_code:'DRAWER-41'}]});
  if (path === '/api/cash-drawers/sessions/41/approvals') return respond({data:[{approval_id:81,action:'MANUAL_RELEASE',decision:'APPROVED',bound_version:7,bound_amount:'100.01',requester_id:1,reason:'Independent review'}]});
  if (path === '/api/hr/employees/33/loans') return respond([{loan_id:71,version:1,creditor:'COMPANY',loan_type:'CASH_ADVANCE',reference_no:'VALE-71',activation_state:'DRAFT',status:'Active',outstanding:'100.01',collectible_opening:'100.01',amount_paid:'0.00',original_principal:'100.01',schedules:[{schedule_id:1,effective_from:'2026-11-01',schedule:'SPLIT_HALF',monthly_installment:'100.01',version:1,reason:'Signed agreement'}],activity:[]}]);
  if (path === '/api/hr/employees/33/payables') return respond([{payslip_id:51,payslip_no:'PS-51',pay_date:'2026-10-15',net_pay:'1000.01',correction_amount:'0.00',rounding_amount:'0.00',actual_paid:'900.00',remaining_payable:'100.01',pending_amount:'0.00',settlement_id:11,status:'Approved',version:1,recoveries:[]}]);

  if (path === '/api/hr/employee-finance/employees') return respond({data:[{employee_id:new URL(req.url()).searchParams.get('search') ? 44 : 33,employee_code:'EMP-33',employee_name:new URL(req.url()).searchParams.get('search') ? 'Other Employee' : 'Ana Santos',employment_status:'Active'}],totalPages:1});
  if (path === '/api/hr/loan-remittances') return respond({withholdings:[],remittances:[]});
  if (path.endsWith('/loan-withholdings')) return respond({
    withholdings: [],
    remittances: []
  });
  if (path.endsWith('/bank-accounts')) return respond([{
    bank_account_id: 1,
    account_name: 'Test bank',
    bank_name: 'Fixture'
  }]);
  return respond([]);
});
const base = process.env.FINANCE_BROWSER_BASE_URL || 'http://localhost:5173';
async function mount(id, actor = 1, permissions) {
  await page.evaluate((a, b, c) => window.mountFinance(a, b, c), id, actor, permissions);
  await page.waitForFunction((id,actor,allowed)=>{const root=document.querySelector(`[data-account-employee="${id}"][data-account-actor="${actor}"]`);return root&&(allowed?root.textContent.includes('As of'):root.textContent.includes('Financial access required.'));},{},id,actor,!permissions||permissions.includes('employee_finance:view'));

}
async function clickText(text) {
  await page.evaluate(t => {
    const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === t);
    if (!b) throw Error(`Missing ${t}`);
    b.click();
  }, text);
}
async function field(label, value) {
  await page.evaluate((label, value) => {
    const input = [...document.querySelectorAll('label')].find(x => x.querySelector('span')?.textContent === label)?.querySelector('input');
    if (!input) throw Error(`Missing field ${label}`);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', {
      bubbles: true
    }));
    input.dispatchEvent(new Event('change', {
      bubbles: true
    }));
  }, label, value);
}
try {
  await page.goto(`${base}/tests/fixtures/employeeFinanceBrowser.html`);
  await page.waitForFunction(() => typeof window.mountFinance === 'function');
  await mount('11', 1, ['employee_finance:view']);
  const text = await page.evaluate(() => document.body.textContent);
  for (const label of ['Owed to company', 'Owed to employee', 'Government loans', 'Business advances', '₱150.01', '₱0.01']) assert.ok(text.includes(label), label);
  assert.ok(!text.includes('Create loan / vale draft'));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile full figures fit the viewport');
  await page.screenshot({path:'/tmp/employee-finance-overview-mobile.png',fullPage:true});
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({path:'/tmp/employee-finance-overview-dark.png',fullPage:true});
  await clickText('Loans & vale');
  await page.waitForFunction(() => document.body.textContent.includes('No employee loans.'));
  await clickText('Salary & payouts');
  await page.waitForFunction(() => document.body.textContent.includes('No approved wage entitlements.'));
  await clickText('Government loans');
  await page.waitForFunction(() => document.body.textContent.includes('No payroll agency-loan withholdings.'));
  await mount('22', 1, ['employee_finance:view']);
  await page.waitForFunction(() => document.body.textContent.includes('₱22.02'));
  assert.ok(!(await page.evaluate(() => document.body.textContent)).includes('₱150.01'));
  await mount('11', 2, []);
  assert.ok((await page.evaluate(() => document.body.textContent)).includes('Financial access required.'));
  await mount('11', 1);
  await clickText('Create loan / vale draft');
  for (const [label, value] of [['Original principal', '100.01'], ['Explicit agreed interest / fees', '0.00'], ['Total collectible opening', '100.01'], ['Recovery eligibility start date', '2090-01-16'], ['Loan reference', 'BROWSER-1'], ['Purpose', 'Browser test vale'], ['Agreement / enrollment evidence', 'Signed fixture'], ['Monthly installment amount', '100.01'], ['Deduction authorization', 'Signed deduction consent']]) await field(label, value);
  const schedule = await page.evaluateHandle(() => [...document.querySelectorAll('label')].find(l => l.querySelector('span')?.textContent === 'Deduct on').querySelector('select'));
  await schedule.asElement().select('SPLIT_HALF');
  await page.evaluate(() => {
    const e = [...document.querySelectorAll('label')].find(l => l.querySelector('span')?.textContent === 'Effective recovery month').querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, '2090-01');
    e.dispatchEvent(new Event('input', {
      bubbles: true
    }));
    e.dispatchEvent(new Event('change', {
      bubbles: true
    }));
  });
  await page.waitForFunction(() => document.body.textContent.includes('First cutoff ₱50.01; second cutoff ₱50.00'));
  await page.screenshot({path:'/tmp/employee-finance-draft-mobile.png',fullPage:true});
  await clickText('Create draft');
  await page.waitForFunction(() => document.body.textContent.includes('Outcome unknown.'));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.monthly_installment, '100.01');
  assert.equal(posts[0].body.schedule, 'SPLIT_HALF');
  assert.ok(posts[0].body.request_id);
  await page.reload();
  await page.waitForFunction(() => typeof window.mountFinance === 'function');
  await mount('11', 1);
  await clickText('Create loan / vale draft');
  await page.waitForFunction(() => document.body.textContent.includes('Reconcile same request'));
  await clickText('Reconcile same request');
  await page.waitForFunction(() => !document.body.textContent.includes('Reconcile same request'));
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0], posts[1]);
  await mount('11', 2);
  await clickText('Create loan / vale draft');
  assert.ok(!(await page.evaluate(() => document.body.textContent)).includes('Reconcile same request'));
  await page.keyboard.press('Escape');
  assert.equal(await page.$('[role=dialog]'),null,'Escape closes finance dialog');
  await mount('33', 1, ['employee_finance:view','employee_finance:approve','cash_drawer:view']);
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.evaluate(() => {const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Loan payment #901');b.focus();b.click();});
  await page.waitForFunction(() => document.body.textContent.includes('Verified fixture receipt'));
  assert.ok(!(await page.evaluate(() => document.querySelector('[role=dialog]').textContent)).includes('hidden-request'));
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()),'Loan payment #901','Source dialog restores focus');
  await clickText('Salary & payouts');
  await page.waitForFunction(() => document.body.textContent.includes('PS-51'));
  assert.ok((await page.evaluate(()=>document.body.textContent)).includes('₱1,000.01'));
  const salaryText = await page.evaluate(() => document.body.textContent);
  assert.ok(salaryText.includes('Use Mark Paid on the payroll run'));
  assert.ok(!salaryText.includes('Record actual payout across current / older payslips'));
  assert.ok(!salaryText.includes('Execute approved noncash settlement'));
  assert.ok(!salaryText.includes('Actual total amount'));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),'Populated salary cards fit mobile');
  await clickText('Loans & vale');
  await page.waitForFunction(() => document.body.textContent.includes('VALE-71'));
  await clickText('Approve & activate');
  await page.waitForFunction(() => document.body.textContent.includes('Release evidence / reference'));
  const releaseInput = await page.evaluateHandle(() => [...document.querySelectorAll('label')].find(l=>l.querySelector('span')?.textContent==='Release evidence / reference').querySelector('input'));
  await releaseInput.asElement().type('Signed release voucher #VALE-71');
  assert.ok(!(await page.evaluate(()=>document.querySelector('[role=dialog]').textContent)).includes('Method'),'Cash drawer method not required');
  await page.screenshot({path:'/tmp/employee-finance-cash-mobile.png',fullPage:true});
  await page.keyboard.press('Escape');
  await page.setViewport({width:1440,height:1000});
  await clickText('Overview & statement');
  await page.waitForFunction(() => document.body.textContent.includes('As of'));
  await new Promise(resolve=>setTimeout(resolve,250));
  await page.screenshot({path:'/tmp/employee-finance-desktop-dark.png',fullPage:true});
  testFilterRace = true;
  const category = await page.evaluateHandle(() => [...document.querySelectorAll('label')].find(l=>l.querySelector('span')?.textContent==='Category').querySelector('select'));
  const firstRequest = page.waitForRequest(req=>req.url().includes('domain=COMPANY'));
  await category.asElement().select('COMPANY'); await firstRequest;
  await category.asElement().select('EMPLOYEE');
  await page.waitForFunction(() => document.body.textContent.includes('Current employee filter'));
  await new Promise(resolve=>setTimeout(resolve,450));
  assert.ok(!(await page.evaluate(()=>document.body.textContent)).includes('Stale company filter'),'Late statement response cannot overwrite current filter');
  testFilterRace = false;
  await page.evaluate(()=>window.mountFinancePage());
  await page.waitForFunction(()=>document.body.textContent.includes('Ana Santos'));
  const employeeSelect = await page.evaluateHandle(() => [...document.querySelectorAll('label')].find(l=>l.querySelector('span')?.textContent==='Employee').querySelector('select'));
  await employeeSelect.asElement().select('33');
  await page.waitForFunction(()=>document.body.textContent.includes('As of'));
  await field('Search employees','Other');
  await page.waitForFunction(()=>document.body.textContent.includes('Other Employee'));
  assert.equal(await employeeSelect.asElement().evaluate(el=>el.value),'33','Employee identity stays visible across register searches');
  await page.screenshot({path:'/tmp/employee-finance-workspace-desktop.png',fullPage:true});
  await clickText('Agency remittances');
  await page.waitForFunction(()=>document.body.textContent.includes('No payroll agency-loan withholdings.'));

  assert.deepEqual(errors, []);
  console.log('PASS Chromium: four exact financial domains; finance-view-only and denied roles; employee/account switch isolation; 390px layout; odd-cent split preview; unknown request reload/replay with unchanged identity and payload; tab navigation; populated salary cards; source dialog focus/keyboard; current cash drawer and independent approval selectors; mobile and desktop dark-mode renders; stale statement response suppression; full employee register search and agency workspace.');
} finally {
  await browser.close();
}
