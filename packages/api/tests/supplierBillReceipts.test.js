// Real PostgreSQL fixtures with a local HTTP Paperless fixture. No database mocks.
const http = require('node:http');
const db = require('../db');
const { getBillReceipts } = require('../services/supplierBillReceiptService');
const paperless = require('../services/paperlessService');

jest.setTimeout(15000);
describe('supplier bill Paperless receipts', () => {
    let server, client, billId, supplierId;
    let documents, requests, originalUrl, originalToken;
    const supplierName = 'Paperless Bill Receipt Fixture';
    beforeAll(async () => {
        originalUrl = process.env.PAPERLESS_API_URL;
        originalToken = process.env.PAPERLESS_API_TOKEN;
        server = http.createServer((req, res) => {
            requests.push(req.url);
            const url = new URL(req.url, 'http://localhost');
            res.setHeader('Content-Type', 'application/json');
            if (url.pathname.includes('/correspondents/')) return res.end(JSON.stringify({results:[{id:1,name:supplierName},{id:2,name:'Other Supplier'}],next:null}));
            if (url.pathname.includes('/document_types/')) return res.end(JSON.stringify({results:[{id:3,name:'Goods Receipt'},{id:4,name:'Sales Invoice'}],next:null}));
            res.end(JSON.stringify({results:documents,next:null}));
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        process.env.PAPERLESS_API_URL = `http://127.0.0.1:${server.address().port}/api`;
        process.env.PAPERLESS_API_TOKEN = 'local-fixture-token';
    });
    beforeEach(async () => {
        requests=[];
        documents=[{id:101,title:'AR-182',correspondent:1,document_type:3}, {id:202,title:'SI-908',correspondent:1,document_type:3}];
        client=await db.getClient();
        await client.query('BEGIN');
        const {rows:[supplier]}=await client.query('INSERT INTO supplier (supplier_name,is_active) VALUES ($1,true) RETURNING supplier_id',[supplierName]);
        supplierId=supplier.supplier_id;
        const {rows:[bill]}=await client.query("INSERT INTO supplier_bill (supplier_id,bill_number,total_amount,supplier_document_no) VALUES ($1,$2,100,'AR-182') RETURNING bill_id",[supplierId,`BILL-PAPERLESS-${supplierId}`]);
        billId=bill.bill_id;
    });
    afterEach(async () => { if(client){await client.query('ROLLBACK');client.release();} });
    afterAll(async () => {
        if(originalUrl===undefined)delete process.env.PAPERLESS_API_URL;else process.env.PAPERLESS_API_URL=originalUrl;
        if(originalToken===undefined)delete process.env.PAPERLESS_API_TOKEN;else process.env.PAPERLESS_API_TOKEN=originalToken;
        if(server)await new Promise(resolve=>server.close(resolve));
    });
    test('resolves primary and linked alias references within the supplier and Goods Receipt type',async()=>{
        await client.query("INSERT INTO supplier_bill_document_identity (bill_id,supplier_id,document_type,document_no,normalized_key) VALUES ($1,$2,'invoice','SI-908','si-908')",[billId,supplierId]);
        documents.push({id:303,title:'AR-182',correspondent:2,document_type:3}, {id:404,title:'AR-182',correspondent:1,document_type:4});
        const result=await getBillReceipts(billId,client);
        expect(result.documents.map(doc=>doc.id).sort()).toEqual([101,202]);
        expect(requests.filter(path=>path.includes('/documents/'))).toHaveLength(1);
        expect(requests.find(path=>path.includes('/documents/'))).toContain('correspondent__id=1');
    });
    test('does not choose an arbitrary or partial-title match',async()=>{
        documents.push({id:505,title:'AR-182',correspondent:1,document_type:3});
        expect((await getBillReceipts(billId,client)).documents).toEqual([]);
        documents=[{id:606,title:'AR-182-extra',correspondent:1,document_type:3}];
        expect((await getBillReceipts(billId,client)).documents).toEqual([]);
    });
    test('deduplicates reference aliases that normalize to the same scan',async()=>{
        await client.query("INSERT INTO supplier_bill_document_identity (bill_id,supplier_id,document_type,document_no,normalized_key) VALUES ($1,$2,'other','AR_182','ar_182')",[billId,supplierId]);
        const result=await getBillReceipts(billId,client);
        expect(result.documents).toHaveLength(1);
        expect(result.documents[0].references).toEqual(expect.arrayContaining(['AR-182','AR_182']));
    });
    test('recovers legacy references from its same-supplier receipt',async()=>{
        const {rows:[actor]}=await client.query('SELECT employee_id FROM employee LIMIT 1');
        await client.query('UPDATE supplier_bill SET supplier_document_no=NULL WHERE bill_id=$1',[billId]);
        await client.query("INSERT INTO goods_receipt (grn_number,supplier_id,received_by,bill_id,supplier_invoice_no,workflow_status) VALUES ($1,$2,$3,$4,'SI-908','Posted')",[`GRN-PAPERLESS-${billId}`,supplierId,actor.employee_id,billId]);
        expect((await getBillReceipts(billId,client)).documents.map(doc=>doc.id)).toEqual([202]);
    });
    test('does not search generated bill numbers or unmatched suppliers',async()=>{
        await client.query('UPDATE supplier_bill SET supplier_document_no=NULL WHERE bill_id=$1',[billId]);
        expect((await getBillReceipts(billId,client)).documents).toEqual([]);
        expect(requests).toHaveLength(0);
        expect(await paperless.findGoodsReceiptDocument('AR-182','Unrelated Supplier')).toBeNull();
    });
    test('reports missing bills and unconfigured Paperless distinctly',async()=>{
        await expect(getBillReceipts(-1,client)).rejects.toMatchObject({statusCode:404});
        process.env.PAPERLESS_API_TOKEN='';
        try {await expect(getBillReceipts(billId,client)).rejects.toMatchObject({statusCode:503});}
        finally {process.env.PAPERLESS_API_TOKEN='local-fixture-token';}
    });
});
