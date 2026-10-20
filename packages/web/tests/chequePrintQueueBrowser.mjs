import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';

async function runBrowserTests() {
    console.log('--- Starting Cheque Print Queue Browser Reliability Tests ---');

    const browser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium',
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 900 });

        page.on('console', msg => console.log('PAGE LOG:', msg.text()));
        page.on('pageerror', err => console.error('PAGE ERROR:', err));

        // Track external print API calls
        const apiCalls = {
            externalPrint: []
        };

        // Enable request interception to mock backend responses deterministically
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const url = new URL(req.url());
            const pathname = url.pathname;
            const method = req.method();

            if (pathname === '/api/cheques/templates') {
                return req.respond({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify([
                        { id: 1, bank_name: 'Security Bank', is_default: true, page_format: 'voucher' },
                        { id: 2, bank_name: 'BDO Unibank', is_default: false, page_format: 'standard' }
                    ])
                });
            }

            if (pathname === '/api/cheques/printer-profiles') {
                return req.respond({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify([
                        { id: 1, profile_name: 'Default Office Printer', is_default: true, printer_type: 'laser' }
                    ])
                });
            }

            if (pathname === '/api/cheques/history') {
                return req.respond({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify([])
                });
            }

            if (pathname === '/api/cheques/print-queue') {
                const templateId = url.searchParams.get('template_id');
                const unassigned = url.searchParams.get('unassigned');

                if (unassigned === 'true') {
                    return req.respond({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({
                            records: [
                                {
                                    id: 9999,
                                    cheque_number: 'CHK-9999',
                                    payee: 'Unassigned Landlord Corp',
                                    amount: '35000.00',
                                    cheque_date: '2026-10-25',
                                    bank_name: null,
                                    bank_account_name: 'Main Operating Account',
                                    setup_required_reason: 'TEMPLATE_REQUIRED',
                                    status: 'ISSUED'
                                }
                            ],
                            summary: {
                                total: 3,
                                unassigned_count: 1,
                                by_template: [
                                    { template_id: 1, count: 2 },
                                    { template_id: 2, count: 0 }
                                ]
                            }
                        })
                    });
                }

                if (templateId === '1') {
                    return req.respond({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({
                            records: [
                                {
                                    id: 101,
                                    cheque_number: 'CHK-1001',
                                    payee: 'Alpha Construction Supplies',
                                    amount: '5000.00',
                                    cheque_date: '2026-10-21',
                                    bank_name: 'Security Bank',
                                    effective_template_id: 1,
                                    status: 'ISSUED'
                                },
                                {
                                    id: 102,
                                    cheque_number: 'CHK-1002',
                                    payee: 'Beta Electric & Power',
                                    amount: '12500.50',
                                    cheque_date: '2026-10-22',
                                    bank_name: 'Security Bank',
                                    effective_template_id: 1,
                                    status: 'ISSUED'
                                }
                            ],
                            next_cursor: null,
                            summary: {
                                total: 3,
                                unassigned_count: 1,
                                by_template: [
                                    { template_id: 1, count: 2 },
                                    { template_id: 2, count: 0 }
                                ]
                            }
                        })
                    });
                }

                if (templateId === '2') {
                    return req.respond({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({
                            records: [],
                            next_cursor: null,
                            summary: {
                                total: 3,
                                unassigned_count: 1,
                                by_template: [
                                    { template_id: 1, count: 2 },
                                    { template_id: 2, count: 0 }
                                ]
                            }
                        })
                    });
                }
            }

            if (pathname.includes('/record-external-print') && method === 'POST') {
                const body = JSON.parse(req.postData() || '{}');
                apiCalls.externalPrint.push({ url: pathname, body });
                return req.respond({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        success: true,
                        data: { id: 9999, message: 'Cheque acknowledged as printed externally.' }
                    })
                });
            }

            if (pathname === '/api/cheques/generate-pdf' && method === 'POST') {
                const dummyPdf = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\nxref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \ntrailer\n<< /Root 1 0 R /Size 3 >>\nstartxref\n115\n%%EOF';
                return req.respond({
                    status: 200,
                    contentType: 'application/pdf',
                    headers: { 'Content-Type': 'application/pdf' },
                    body: Buffer.from(dummyPdf)
                });
            }

            // Default: continue request for assets, bundles, css
            req.continue();
        });

        // Load the browser fixture page
        console.log('Navigating to fixture...');
        await page.goto('http://forson_frontend_dev:5173/tests/fixtures/chequePrintQueueBrowser.html', {
            waitUntil: 'networkidle0'
        });

        // Initialize ChequePrintingPage via helper
        await page.evaluate(() => {
            if (window.mountChequeQueue) {
                window.mountChequeQueue(['cheques:view', 'cheques:create', 'bank_accounts:view', 'ap-pdc:view']);
            } else {
                console.error('mountChequeQueue is not defined on window!');
            }
        });

        await new Promise(r => setTimeout(r, 1000));
        const rootHtml = await page.evaluate(() => document.getElementById('root')?.innerHTML);
        console.log('Root HTML after mount:', rootHtml?.slice(0, 300));

        // Wait for preset buttons to appear
        await page.waitForFunction(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            return btns.some(b => b.textContent.includes('Security Bank'));
        }, { timeout: 10000 });
        console.log('✓ Component mounted with templates loaded');

        // Verify initial template 1 has 2 queued items
        await page.waitForFunction(() => {
            const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
            return inputs.some(i => i.value.includes('Alpha Construction Supplies'));
        }, { timeout: 5000 });
        console.log('✓ Queued items #1001 & #1002 rendered for Security Bank');

        // Check that queued items have disabled payee/amount fields
        const isQueuedDisabled = await page.evaluate(() => {
            const payeeInputs = Array.from(document.querySelectorAll('input[placeholder="Payee"]'));
            const alphaInput = payeeInputs.find(i => i.value.includes('Alpha Construction Supplies'));
            return alphaInput ? alphaInput.disabled : false;
        });
        assert.equal(isQueuedDisabled, true, 'Queued cheques must be locked against client tampering');
        console.log('✓ Queued cheques are locked (disabled=true)');

        // Enter a draft row in Security Bank
        await page.evaluate(() => {
            const setReactInput = (el, val) => {
                const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                nativeSetter.call(el, val);
                el.dispatchEvent(new Event('input', { bubbles: true }));
            };

            const payeeInputs = Array.from(document.querySelectorAll('input[placeholder="Payee"]'));
            const blankPayee = payeeInputs.find(i => !i.value && !i.disabled);
            if (blankPayee) {
                setReactInput(blankPayee, 'Draft Standalone Payee 1');
            }
            const amountInputs = Array.from(document.querySelectorAll('input[placeholder="0.00"]'));
            const blankAmount = amountInputs.find(i => (!i.value || i.value === '0.00') && !i.disabled);
            if (blankAmount) {
                setReactInput(blankAmount, '1500.00');
            }
        });
        await new Promise(r => setTimeout(r, 200));

        // Verify draft row was set
        const draftExistsBefore = await page.evaluate(() => {
            const payeeInputs = Array.from(document.querySelectorAll('input[placeholder="Payee"]'));
            return payeeInputs.some(i => i.value === 'Draft Standalone Payee 1');
        });
        assert.equal(draftExistsBefore, true, 'Draft row should be present');
        console.log('✓ Standalone draft row entered in Security Bank batch');

        // Switch preset tab to BDO Unibank
        console.log('Switching preset to BDO Unibank...');
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const bdoBtn = btns.find(b => b.textContent.includes('BDO Unibank'));
            if (bdoBtn) bdoBtn.click();
        });
        await new Promise(r => setTimeout(r, 400));

        // Verify BDO has no queued cheques and does not have "Draft Standalone Payee 1"
        const bdoPayees = await page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input[placeholder="Payee"]'));
            return inputs.map(i => i.value).filter(Boolean);
        });
        assert.equal(bdoPayees.includes('Alpha Construction Supplies'), false, 'Template 1 cheques must not leak into Template 2');
        assert.equal(bdoPayees.includes('Draft Standalone Payee 1'), false, 'Template 1 drafts must not leak into Template 2');
        console.log('✓ Preset switching isolates batches: zero cross-template leakage');

        // Enter a draft row in BDO
        await page.evaluate(() => {
            const setReactInput = (el, val) => {
                const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                nativeSetter.call(el, val);
                el.dispatchEvent(new Event('input', { bubbles: true }));
            };
            const payeeInputs = Array.from(document.querySelectorAll('input[placeholder="Payee"]'));
            const blankPayee = payeeInputs.find(i => !i.value);
            if (blankPayee) {
                setReactInput(blankPayee, 'BDO Specific Payee');
            }
        });
        await new Promise(r => setTimeout(r, 200));

        // Switch back to Security Bank
        console.log('Switching back to Security Bank...');
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const secBtn = btns.find(b => b.textContent.includes('Security Bank'));
            if (secBtn) secBtn.click();
        });
        await new Promise(r => setTimeout(r, 400));

        // Verify draft row in Security Bank survived round-trip switch
        const secPayees = await page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input[placeholder="Payee"]'));
            return inputs.map(i => i.value).filter(Boolean);
        });
        assert.ok(secPayees.includes('Alpha Construction Supplies'), 'Alpha Construction Supplies must still be present');
        assert.ok(secPayees.includes('Beta Electric & Power'), 'Beta Electric & Power must still be present');
        assert.ok(secPayees.includes('Draft Standalone Payee 1'), 'Draft row must survive preset round-trip switch');
        console.log('✓ Draft row survived preset round-trip switch');

        // Test removing an issued cheque from the batch
        console.log('Testing cheque removal from batch...');
        await page.evaluate(() => {
            // Find the delete button for the first row (Alpha Construction Supplies)
            const dangerBtns = Array.from(document.querySelectorAll('button[title*="Remove from this batch"]'));
            if (dangerBtns.length > 0) {
                dangerBtns[0].click();
            }
        });
        await new Promise(r => setTimeout(r, 300));

        // Verify "Restore removed cheques" banner is visible
        const restoreBannerText = await page.evaluate(() => {
            const banner = document.querySelector('.bg-gray-50, .dark\\:bg-slate-700\\/50');
            return document.body.innerText;
        });
        assert.ok(restoreBannerText.includes('removed from this mount batch'), 'Removal banner must indicate cheque was removed');
        assert.ok(restoreBannerText.includes('Restore removed cheques'), 'Restore removed cheques button must be visible');
        console.log('✓ Removing cheque shows restore banner with count');

        // Click "Restore removed cheques"
        console.log('Restoring removed cheques...');
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const restoreBtn = btns.find(b => b.textContent.includes('Restore removed cheques'));
            if (restoreBtn) restoreBtn.click();
        });
        await new Promise(r => setTimeout(r, 500));

        // Verify Alpha is back
        const payeesAfterRestore = await page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input[placeholder="Payee"]'));
            return inputs.map(i => i.value).filter(Boolean);
        });
        assert.ok(payeesAfterRestore.includes('Alpha Construction Supplies'), 'Cheque must be restored');
        console.log('✓ Restore removed cheques successfully brought cheque back');

        // Test Setup-Required Banner
        console.log('Verifying Setup-Required banner...');
        const pageText = await page.evaluate(() => document.body.innerText);
        assert.ok(pageText.includes('Setup Required: 1 cheque cannot be auto-queued'), 'Setup required banner must show count');
        assert.ok(pageText.includes('Go to Bank Accounts'), 'Go to Bank Accounts link must be present');
        assert.ok(pageText.includes('Unassigned Landlord Corp'), 'Unassigned payee must be listed');
        assert.ok(pageText.includes('No Default Template'), 'Reason must indicate No Default Template');
        console.log('✓ Setup-Required banner renders with accurate metadata and action links');

        // Test "Record printed elsewhere" action in Setup-Required section
        console.log('Testing "Record printed elsewhere" modal...');
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const recordBtn = btns.find(b => b.textContent.includes('Record printed elsewhere'));
            if (recordBtn) recordBtn.click();
        });
        await new Promise(r => setTimeout(r, 300));

        // Verify modal opened
        const modalOpen = await page.evaluate(() => {
            return document.body.innerText.includes('Acknowledge that physical cheque stock was prepared');
        });
        assert.equal(modalOpen, true, 'External print modal must open');

        // Type notes into modal
        await page.evaluate(() => {
            const textarea = document.querySelector('textarea[placeholder*="Prepared manually"]');
            if (textarea) {
                const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                nativeSetter.call(textarea, 'Handwritten company voucher cheque');
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                textarea.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        await new Promise(r => setTimeout(r, 200));

        // Click "Confirm Acknowledgement"
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const confirmBtn = btns.find(b => b.textContent.includes('Confirm Acknowledgement'));
            if (confirmBtn) confirmBtn.click();
        });
        await new Promise(r => setTimeout(r, 500));

        // Verify API was called
        assert.equal(apiCalls.externalPrint.length, 1, 'API call to /record-external-print must be made');
        assert.equal(apiCalls.externalPrint[0].url, '/api/cheques/9999/record-external-print');
        assert.equal(apiCalls.externalPrint[0].body.notes, 'Handwritten company voucher cheque');
        assert.equal(apiCalls.externalPrint[0].body.confirmation, true);
        console.log('✓ "Record printed elsewhere" modal successfully invoked API with required notes & confirmation');

        // Test Bulk Select/Deselect and Bulk Remove
        console.log('Testing Bulk Select/Deselect and Bulk Remove...');
        // 1. Verify toolbar shows all 2 selected
        const toolbarText1 = await page.evaluate(() => document.body.innerText);
        assert.ok(toolbarText1.includes('2 of 2 selected') || toolbarText1.includes('Select all (2)'), 'Toolbar must show 2 selected');

        // 2. Deselect first row
        await page.evaluate(() => {
            const rowCheckboxes = Array.from(document.querySelectorAll('input[type="checkbox"][title*="exclude from PDF"], input[type="checkbox"][title*="Include in PDF"]'));
            if (rowCheckboxes.length > 0) {
                rowCheckboxes[0].click();
            }
        });
        await new Promise(r => setTimeout(r, 200));

        // Verify count updated to 1 of 2 selected
        const toolbarText2 = await page.evaluate(() => document.body.innerText);
        assert.ok(toolbarText2.includes('1 of 2 selected'), 'Deselecting a row must update toolbar to 1 of 2 selected');
        console.log('✓ Deselecting individual cheque updates bulk toolbar to 1 of 2 selected');

        // 3. Click "Deselect all"
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const deselectBtn = btns.find(b => b.textContent.includes('Deselect all'));
            if (deselectBtn) deselectBtn.click();
        });
        await new Promise(r => setTimeout(r, 200));

        const toolbarText3 = await page.evaluate(() => document.body.innerText);
        assert.ok(toolbarText3.includes('0 of 2 selected'), 'Deselect all must set 0 selected');
        console.log('✓ "Deselect all" sets 0 of 2 selected');

        // 4. Click "Select all"
        await page.evaluate(() => {
            const selectAllLabel = Array.from(document.querySelectorAll('label')).find(l => l.textContent.includes('Select all'));
            if (selectAllLabel) {
                const cb = selectAllLabel.querySelector('input[type="checkbox"]');
                if (cb) cb.click();
            }
        });
        await new Promise(r => setTimeout(r, 200));

        const toolbarText4 = await page.evaluate(() => document.body.innerText);
        assert.ok(toolbarText4.includes('2 of 2 selected'), 'Select all must restore 2 selected');
        console.log('✓ "Select all" restores 2 of 2 selected');

        // 5. Bulk Remove selected (2)
        console.log('Testing "Remove selected (2)" bulk action...');
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const bulkRemoveBtn = btns.find(b => b.textContent.includes('Remove selected'));
            if (bulkRemoveBtn) bulkRemoveBtn.click();
        });
        await new Promise(r => setTimeout(r, 300));

        // Verify both cheques are dismissed
        const restoreBannerTextBulk = await page.evaluate(() => document.body.innerText);
        assert.ok(restoreBannerTextBulk.includes('2 cheques removed from this mount batch'), 'Bulk removal must update dismissed count to 2');
        console.log('✓ "Remove selected" bulk action dismissed both cheques and updated restore banner to 2');

        // 6. Restore all dismissed cheques
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const restoreBtn = btns.find(b => b.textContent.includes('Restore removed cheques'));
            if (restoreBtn) restoreBtn.click();
        });
        await new Promise(r => setTimeout(r, 400));

        const payeesAfterBulkRestore = await page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input[placeholder="Payee"]'));
            return inputs.map(i => i.value).filter(Boolean);
        });
        assert.ok(payeesAfterBulkRestore.includes('Alpha Construction Supplies'), 'Alpha must be restored');
        assert.ok(payeesAfterBulkRestore.includes('Beta Electric & Power'), 'Beta must be restored');
        console.log('✓ Restoring removed cheques brought back all bulk-removed cheques');

        // Test Pop-up Blocker fallback banner
        console.log('Testing Pop-up Blocker fallback banner...');
        // Mock window.open to simulate popup blocker returning null
        await page.evaluate(() => {
            window.open = () => null;
        });

        // Click "Generate Cheques (2)" or similar primary action
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const printBtn = btns.find(b => b.textContent.includes('Generate') || b.textContent.includes('Print'));
            if (printBtn) printBtn.click();
        });
        await new Promise(r => setTimeout(r, 400));

        // In confirm modal, click "Confirm & Generate"
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const confirmBtn = btns.find(b => b.textContent.includes('Confirm & Generate'));
            if (confirmBtn) confirmBtn.click();
        });
        await new Promise(r => setTimeout(r, 800));

        // Check if PDF Recovery Banner is visible
        const pdfRecoveryText = await page.evaluate(() => document.body.innerText);
        assert.ok(pdfRecoveryText.includes('Cheque PDF Generated'), 'PDF recovery banner must be visible');
        assert.ok(pdfRecoveryText.includes('Open PDF'), 'Open PDF button must be available');
        assert.ok(pdfRecoveryText.includes('Download PDF'), 'Download PDF button must be available');
        console.log('✓ Pop-up blocker simulation: Recovery banner displays Open PDF & Download PDF options');

        console.log('--- All Cheque Print Queue Browser Reliability Tests PASSED ---');
    } finally {
        await browser.close();
    }
}

runBrowserTests().catch((err) => {
    console.error('Browser Test Failed:', err);
    process.exit(1);
});
