// Read-only audit of Goods Receipt previews in the configured Paperless instance.
// Run inside the API container: node scripts/auditPaperlessReceiptPreviews.js
// Writes only /tmp/paperless-preview-audit.json; no document/tag/database changes.
const fs=require('node:fs');
const p=require('../services/paperlessService');
const {PDFDocument}=require('pdf-lib');
const {normalizePartyName}=require('../helpers/paperlessMatching');
(async()=>{
 const types=await p.paperlessFetch('/document_types/?page_size=100');
 const type=types.results.find(t=>normalizePartyName(t.name)===normalizePartyName('Goods Receipt'));
 if(!type)throw new Error('Goods Receipt document type not found');
 const docs=[];let page=1,data;
 do{data=await p.listDocuments({documentTypeId:type.id,pageSize:100,page:page++});docs.push(...data.results);}while(data.next);
 const results=[];let cursor=0;
 async function worker(){while(cursor<docs.length){const doc=docs[cursor++];const row={id:doc.id,reference:doc.title,sourceType:doc.mime_type};try{const {buffer,contentType}=await p.getDocumentPreview(doc.id);row.previewType=contentType;row.bytes=buffer.length;if(contentType==='application/pdf'){try{const pdf=await PDFDocument.load(buffer);row.pages=pdf.getPageCount();row.pdfReadable=true;}catch(e){row.pdfReadable=false;row.pdfError=e.message;}}}catch(e){row.error=e.message;row.status=e.status;}results.push(row);if(results.length%50===0)console.log('Checked '+results.length+'/'+docs.length);}}
 await Promise.all(Array.from({length:4},worker));
 results.sort((a,b)=>a.id-b.id);
 const summary={checked:results.length,previewTypes:results.reduce((a,r)=>(a[r.previewType||'error']=(a[r.previewType||'error']||0)+1,a),{}),unreadablePdfs:results.filter(r=>r.pdfReadable===false),failures:results.filter(r=>r.error),reportedReceipt:results.filter(r=>String(r.reference).trim()==='18464')};
 fs.writeFileSync('/tmp/paperless-preview-audit.json',JSON.stringify({summary,results},null,2));
 console.log(JSON.stringify(summary));
 process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1)});
