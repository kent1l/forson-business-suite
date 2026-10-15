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
  if (path.endsWith('/accounts')) return respond(summary(path.split('/')[4]));
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
  await page.waitForFunction((id,actor,allowed)=>{const root=document.querySelector(`[data-account-employee="${id}"][data-account-actor="${actor}"]`);return root&&(allowed?root.textContent.includes('As of')&&root.textContent.includes('No employee loans.'):root.textContent.includes('Financial access required.'));},{},id,actor,!permissions||permissions.includes('employee_finance:view'));

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
  assert.deepEqual(errors, []);
  console.log('PASS Chromium: four exact financial domains; finance-view-only and denied roles; employee/account switch isolation; 390px layout; odd-cent split preview; unknown request reload/replay with unchanged identity and payload.');
} finally {
  await browser.close();
}
