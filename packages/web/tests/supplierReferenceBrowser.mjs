import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
// Optionally exercise the exact live preview bytes from a reported Paperless document.
let receiptPdf;
if (process.env.REFERENCE_TEST_PAPERLESS_ID) {
 const {getDocumentPreview}=await import('./services/paperlessService.js');
 receiptPdf=(await getDocumentPreview(Number(process.env.REFERENCE_TEST_PAPERLESS_ID))).buffer;
} else {
 const {PDFDocument}=await import('pdf-lib');
 const pdf=await PDFDocument.create();pdf.addPage().drawText('Supplier receipt 18464');receiptPdf=Buffer.from(await pdf.save());
}
const browser = await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
try {
const page = await browser.newPage();
const errors=[]; const matches=[]; const previewRequests=[]; let receiptRetry=false;
page.on('console',msg=>{if(msg.type()==='error') console.error('Browser:',msg.text());});
page.on('response',res=>{if(res.status()>=400) console.error('HTTP',res.status(),res.url());});
page.on('pageerror',e=>{errors.push(e.message);console.error('Page error:',e.message);});
const supplier={supplier_id:1,supplier_name:'Reference Supplier'};
const bills=[{bill_id:42,bill_number:'BILL-202610-0042',supplier_document_no:'AR-00182',supplier_document_type:'other',status:'Unpaid',supplier_id:1,total_amount:1000,amount_paid:0,available_to_schedule:1000,document_references:['AR-00182','SI-908']},
{bill_id:43,bill_number:'BILL-202610-0043',supplier_document_no:'DR-999',status:'Unpaid',supplier_id:1,total_amount:500,amount_paid:0,available_to_schedule:500},
{bill_id:44,bill_number:'BILL-202610-0044',display_supplier_reference:'DR-LEGACY-88',status:'Unpaid',supplier_id:1,total_amount:600,amount_paid:0,available_to_schedule:600},
{bill_id:45,bill_number:'BILL-202610-0045',status:'Unpaid',supplier_id:1,total_amount:700,amount_paid:0,available_to_schedule:700}];
await page.setRequestInterception(true);
page.on('request',req=>{
 const url=new URL(req.url());const path=url.pathname;
 if(!path.startsWith('/api/'))return req.continue();
 const respond=(data,status=200)=>req.respond({status,contentType:'application/json',body:JSON.stringify(data)});
 if(path==='/api/settings')return respond({});
 if(path==='/api/ap/supplier-bills/42/receipts')return respond({data:{documents:[{id:101,title:'AR-00182',references:['AR-00182']},{id:202,title:'SI-908',references:['SI-908']},{id:1236,title:'18464',references:['18464']}]}});
 if(path==='/api/ap/supplier-bills/43/receipts')return respond({data:{documents:[]}});
 if(path==='/api/ap/supplier-bills/44/receipts'){
   if(!receiptRetry){receiptRetry=true;return respond({message:'Paperless unavailable. Please try again.'},502);}
   return respond({data:{documents:[]}});
 }
 if(path==='/api/paperless/documents/1236/preview')return req.respond({status:200,contentType:process.env.REFERENCE_TEST_PDF_MIME || 'application/pdf',body:receiptPdf});
 if(/^\/api\/paperless\/documents\/(101|202)\/preview$/.test(path)){
   previewRequests.push(path);
   return req.respond({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64')});
 }

 if(path==='/api/suppliers')return respond([supplier]);
 if(path==='/api/ap/supplier-bills/matches'){
   matches.push(Object.fromEntries(url.searchParams));
   const rows=url.searchParams.get('document_no')==='AR-00182'?[{...bills[0],match_reason:'exact',existing_receipts:[{grn_id:7,grn_number:'GRN-7',supplier_document_no:'AR-00182',workflow_status:'Posted',bill_id:42}]}]:[];
   return respond({success:true,data:{exact:rows,similar:[],legacy:[]}});
 }
 if(path==='/api/goods-receipts/check-supplier-reference')return respond(url.searchParams.get('document_no')==='AR-00182'?{is_taken:true,grn_id:7,grn_number:'GRN-7',workflow_status:'Posted',receipts:[{grn_id:7,bill_id:42,workflow_status:'Posted'}]}:{is_taken:false,receipts:[]});
 if(path==='/api/ap/supplier-bills')return respond({success:true,data:bills});
 if(path==='/api/ap/supplier-bills/42')return respond({success:true,data:bills[0]});
 if(path==='/api/ap/payment-methods')return respond({data:[{method_id:1,name:'Bank transfer',code:'bank_transfer',config:{}}]});
 if(path==='/api/bank-accounts')return respond({data:[]});
 if(path.startsWith('/api/drafts/'))return respond(req.method()==='GET'?{data:{selectedSupplier:'1',lines:[{part_id:10,internal_sku:'TEST-10',detail:'Test item',quantity:1,cost_price:100,sale_price:150,effective_markup_percent:50}]} }:{last_updated:'fixture-revision'});
 return respond([]);
});
await page.goto((process.env.REFERENCE_BROWSER_BASE_URL||'http://localhost:5173')+'/tests/fixtures/supplierReferenceBrowser.html');
await page.waitForFunction(()=>typeof window.mountReference==='function');
await page.evaluate(()=>window.mountReference('drawer'));
await page.waitForFunction(()=>document.body.innerText.includes('AR-00182'));
const cardReferences = await page.$$eval('[data-supplier-reference]', nodes => nodes.map(node => ({
 text:node.textContent.trim(), size:parseFloat(getComputedStyle(node).fontSize), weight:Number(getComputedStyle(node).fontWeight),
 internalSize:parseFloat(getComputedStyle(node.parentElement.querySelector('[data-internal-bill]')).fontSize),
})));
assert.deepEqual(cardReferences.map(r=>r.text),['AR-00182','DR-999','DR-LEGACY-88','No supplier reference recorded']);
assert.ok(cardReferences.every(r=>r.size>r.internalSize && r.weight>=700));
// View the actual Paperless scan, select another linked scan, and restore focus.
async function clickReceipt(index) {
 const matches=[];
 for(const button of await page.$$('button')) {
   if(await button.evaluate(node=>node.textContent.trim()==='View receipt')) matches.push(button);
 }
 await matches[index].click();
}

await clickReceipt(0);
await page.waitForFunction(()=>{const img=document.querySelector('img[alt="Supplier receipt AR-00182"]');return img?.complete && img.naturalWidth>0;});
await page.select('[role="dialog"] select','202');
await page.waitForFunction(()=>{const img=document.querySelector('img[alt="Supplier receipt SI-908"]');return img?.complete && img.naturalWidth>0;});
assert.deepEqual(previewRequests,['/api/paperless/documents/101/preview','/api/paperless/documents/202/preview']);
await page.select('[role="dialog"] select','1236');
await page.waitForSelector('iframe[title="Supplier receipt 18464"]');
assert.equal(await page.evaluate(async()=>{
 const frame=document.querySelector('iframe[title="Supplier receipt 18464"]');
 const response=await fetch(frame.src);return (await response.blob()).type;
}),'application/pdf');
assert.ok(await page.evaluate(()=>document.body.innerText.includes('Open PDF in a new tab')));
assert.equal(await page.evaluate(()=>document.body.innerText.includes('This receipt preview could not be displayed.')),false);

await page.keyboard.press('Escape');
await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'View receipt');
await clickReceipt(1);
await page.waitForFunction(()=>document.body.innerText.includes('No supplier receipt available in Paperless'));
await page.keyboard.press('Escape');
await clickReceipt(2);
await page.waitForFunction(()=>document.body.innerText.includes('Paperless unavailable. Please try again.'));
await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Try again').click());
await page.waitForFunction(()=>document.body.innerText.includes('No supplier receipt available in Paperless'));
await page.keyboard.press('Escape');


await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Attach Items').click());
await page.waitForSelector('#supplier-document-number');
assert.equal(await page.evaluate(()=>window.referenceNavigation.page),'goods_receipt');
assert.equal(await page.evaluate(()=>window.referenceNavigation.state.billId),42);
await page.type('#supplier-document-number','AR-00182');
await page.waitForFunction(()=>document.body.textContent.includes('Matching Supplier Bill'));
assert.equal(matches.at(-1).document_no,'AR-00182');
assert.equal(matches.at(-1).document_type,undefined);
assert.ok(await page.evaluate(()=>document.body.innerText.includes('Payable: AR-00182')));
await page.waitForFunction(()=>document.body.innerText.includes('Already used by GRN-7'));
assert.ok(await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>/Post Transaction/.test(b.textContent))?.disabled));
await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Record another delivery').click());
await page.waitForFunction(()=>document.body.innerText.includes('Another physical arrival confirmed'));
assert.equal(await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>/Post Transaction/.test(b.textContent))?.disabled),false);
await page.evaluate(()=>window.mountReference('payment'));
await page.waitForSelector('#payment-bill-search');
assert.ok(await page.evaluate(()=>document.body.innerText.includes('AR-00182')));
await page.type('#payment-bill-search','SI-908');
assert.ok(await page.evaluate(()=>document.body.innerText.includes('AR-00182')));
assert.equal(await page.evaluate(()=>document.body.innerText.includes('DR-999')),false);
await page.evaluate(()=>window.mountReference('new'));
await page.waitForFunction(()=>document.body.innerText.includes('Supplier Document No.'));
const refInput=await page.$('input[placeholder="e.g. AR-182, DR-456 or SI-908"]');
await refInput.type('AR-00182');
await page.waitForFunction(()=>document.body.innerText.includes('Already recorded: AR-00182'));
await page.setViewport({width:390,height:844});
assert.deepEqual(errors,[]);
console.log('PASS: Attach Items context, reference-first matching, duplicate review, another-delivery acknowledgement, payment alias search and duplicate-payable display, Paperless previews, empty/error/retry states and focus restoration.');
} finally {await browser.close();}
