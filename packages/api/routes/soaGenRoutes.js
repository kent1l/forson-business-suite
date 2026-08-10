'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const Papa = require('papaparse');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { generateStatementOfAccountPDF } = require('../helpers/pdf/soaPdf');

// Completely offline company settings defaults (does not access DB)
function getOfflineCompanySettings() {
    return {
        name: 'Forson Business Suite',
        address: '123 Business St, Manila',
        tin: '000-123-456-000',
        phone: '+63 2 1234 5678',
        email: 'billing@forson.com',
        website: 'www.forson.com',
        bank_name: 'Banco de Oro (BDO)',
        bank_account: '00123-4567-890',
        default_terms: '30 Days Net'
    };
}

// FIFO Aging Calculation Function
function calculateFifoAging(transactions, statementDateStr) {
    const statementDate = new Date(statementDateStr);
    const invoices = [];
    const credits = [];

    for (const tx of transactions) {
        const debit = parseFloat(tx.debit) || 0;
        const credit = parseFloat(tx.credit) || 0;
        const date = new Date(tx.date);
        const dueDate = tx.due_date ? new Date(tx.due_date) : date;

        if (debit > 0) {
            invoices.push({
                invoiceNo: tx.invoiceNo || '',
                date,
                dueDate,
                amount: debit,
                remaining: debit
            });
        }
        if (credit > 0) {
            credits.push({
                date,
                amount: credit
            });
        }
    }

    // Sort chronologically
    invoices.sort((a, b) => a.date - b.date);
    credits.sort((a, b) => a.date - b.date);

    // Apply payments (credits) using FIFO
    for (const cr of credits) {
        let creditLeft = cr.amount;
        for (const inv of invoices) {
            if (inv.remaining > 0) {
                if (creditLeft >= inv.remaining) {
                    creditLeft -= inv.remaining;
                    inv.remaining = 0;
                } else {
                    inv.remaining -= creditLeft;
                    creditLeft = 0;
                    break;
                }
            }
        }
    }

    // Allocate remaining open balances to aging buckets
    let current = 0;
    let days_1_30 = 0;
    let days_31_60 = 0;
    let days_61_90 = 0;
    let days_90_plus = 0;

    for (const inv of invoices) {
        if (inv.remaining > 0) {
            const diffTime = statementDate - inv.dueDate;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays <= 0) {
                current += inv.remaining;
            } else if (diffDays >= 1 && diffDays <= 30) {
                days_1_30 += inv.remaining;
            } else if (diffDays >= 31 && diffDays <= 60) {
                days_31_60 += inv.remaining;
            } else if (diffDays >= 61 && diffDays <= 90) {
                days_61_90 += inv.remaining;
            } else {
                days_90_plus += inv.remaining;
            }
        }
    }

    return { current, days_1_30, days_31_60, days_61_90, days_90_plus };
}

// Generate Statement Route
router.post('/soa-gen/generate', upload.fields([
    { name: 'customersCsv', maxCount: 1 },
    { name: 'transactionsCsv', maxCount: 1 }
]), async (req, res) => {
    const tempFiles = [];
    try {
        if (!req.files || !req.files.customersCsv || !req.files.transactionsCsv) {
            return res.status(400).json({ message: 'Both customersCsv and transactionsCsv files are required' });
        }

        const statementDateStr = req.body.statementDate || new Date().toISOString().split('T')[0];
        const startDateStr = req.body.startDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
        const endDateStr = req.body.endDate || new Date().toISOString().split('T')[0];

        // Parse list of selected customers if provided
        let selectedCustomers = [];
        if (req.body.selectedCustomers) {
            try {
                selectedCustomers = JSON.parse(req.body.selectedCustomers);
            } catch (e) {
                selectedCustomers = String(req.body.selectedCustomers).split(',').map(s => s.trim()).filter(Boolean);
            }
        }

        const customersContent = req.files.customersCsv[0].buffer.toString('utf8');
        const transactionsContent = req.files.transactionsCsv[0].buffer.toString('utf8');

        // Parse CSVs using papaparse
        const customersParse = Papa.parse(customersContent, { header: true, skipEmptyLines: true });
        const transactionsParse = Papa.parse(transactionsContent, { header: true, skipEmptyLines: true });

        if (customersParse.errors.length > 0 && customersParse.data.length === 0) {
            return res.status(400).json({ message: 'Error parsing customers CSV', errors: customersParse.errors });
        }
        if (transactionsParse.errors.length > 0 && transactionsParse.data.length === 0) {
            return res.status(400).json({ message: 'Error parsing transactions CSV', errors: transactionsParse.errors });
        }

        // Map customers (trim headers/keys to ensure safety)
        const customersMap = {};
        const customerNameMap = {}; // name -> ID lookup to handle name-only ledger rows
        for (const row of customersParse.data) {
            const cleanRow = {};
            for (const [k, v] of Object.entries(row)) {
                cleanRow[k.trim()] = v;
            }
            const id = (cleanRow.CUSTOMER_ID || cleanRow.customer_id || '').trim();
            const name = (cleanRow.COMPANY_NAME || cleanRow.company_name || cleanRow.Correspondent || cleanRow.correspondent || '').trim();
            
            if (id) {
                const cleanId = id.replace(/^CUST-/i, ''); // Strip CUST- prefix for soaPdf template to avoid duplication
                customersMap[cleanId] = {
                    customer_id: cleanId,
                    company_name: name || id,
                    tin: (cleanRow.TIN || cleanRow.tin || '').trim(),
                    address: (cleanRow.ADDRESS || cleanRow.address || '').trim(),
                    phone: (cleanRow.PHONE || cleanRow.phone || '').trim(),
                    email: (cleanRow.EMAIL || cleanRow.email || '').trim(),
                    credit_limit: parseFloat(cleanRow.CREDIT_LIMIT || cleanRow.credit_limit) || 0,
                    payment_terms: (cleanRow.PAYMENT_TERMS || cleanRow.payment_terms || '30 Days Net').trim(),
                    credit_hold: (cleanRow.CREDIT_STATUS || cleanRow.credit_status || '').trim().toUpperCase() === 'ON_HOLD',
                    credit_hold_reason: (cleanRow.CREDIT_STATUS || cleanRow.credit_status || '').trim().toUpperCase() === 'ON_HOLD' ? 'Account Overdue' : '',
                    wallet_balance: parseFloat(cleanRow.WALLET_BALANCE || cleanRow.wallet_balance) || 0
                };
                if (name) {
                    customerNameMap[name.toLowerCase()] = cleanId;
                }
            } else if (name) {
                customersMap[name] = {
                    customer_id: name,
                    company_name: name,
                    tin: (cleanRow.TIN || cleanRow.tin || '').trim(),
                    address: (cleanRow.ADDRESS || cleanRow.address || '').trim(),
                    phone: (cleanRow.PHONE || cleanRow.phone || '').trim(),
                    email: (cleanRow.EMAIL || cleanRow.email || '').trim(),
                    credit_limit: parseFloat(cleanRow.CREDIT_LIMIT || cleanRow.credit_limit) || 0,
                    payment_terms: (cleanRow.PAYMENT_TERMS || cleanRow.payment_terms || '30 Days Net').trim(),
                    credit_hold: (cleanRow.CREDIT_STATUS || cleanRow.credit_status || '').trim().toUpperCase() === 'ON_HOLD',
                    credit_hold_reason: (cleanRow.CREDIT_STATUS || cleanRow.credit_status || '').trim().toUpperCase() === 'ON_HOLD' ? 'Account Overdue' : '',
                    wallet_balance: parseFloat(cleanRow.WALLET_BALANCE || cleanRow.wallet_balance) || 0
                };
            }
        }

        // Group transactions by customer
        const groupedTransactions = {};
        for (const row of transactionsParse.data) {
            const cleanRow = {};
            for (const [k, v] of Object.entries(row)) {
                cleanRow[k.trim()] = v;
            }
            let customerId = (cleanRow.CUSTOMER_ID || cleanRow.customer_id || '').trim();
            const correspondent = (cleanRow.Correspondent || cleanRow.correspondent || cleanRow.COMPANY_NAME || cleanRow.company_name || '').trim();

            if (customerId) {
                customerId = customerId.replace(/^CUST-/i, ''); // Normalize ID
            } else if (correspondent) {
                customerId = customerNameMap[correspondent.toLowerCase()] || correspondent;
            } else {
                continue;
            }

            if (!groupedTransactions[customerId]) {
                groupedTransactions[customerId] = [];
            }

            groupedTransactions[customerId].push({
                date: (cleanRow.DATE || cleanRow.date || '').trim(),
                due_date: (cleanRow.DUE_DATE || cleanRow.due_date || '').trim(),
                invoiceNo: (cleanRow['INVOICE#'] || cleanRow.invoice_number || cleanRow.reference || cleanRow.reference_no || '').trim(),
                description: (cleanRow.DESCRIPTION || cleanRow.description || '').trim(),
                debit: parseFloat(cleanRow.DEBIT || cleanRow.debit) || 0,
                credit: parseFloat(cleanRow.CREDIT || cleanRow.credit) || 0,
                note: (cleanRow.Note || cleanRow.note || '').trim()
            });
        }

        const company = getOfflineCompanySettings();
        const outputPaths = [];
        const baseDir = os.tmpdir();
        const timestamp = Date.now();

        // Generate Statement Numbers in the format SOA-YYYYMM-XXXX
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const period = `${year}${month}`;
        let sequenceCounter = 1;

        // Process each customer (filtering by selected ones if provided)
        for (let [customerId, txs] of Object.entries(groupedTransactions)) {
            // Reconcile selected customer filtering (handle both raw IDs and cleaned IDs)
            if (selectedCustomers.length > 0) {
                const normalizedSelection = selectedCustomers.map(id => id.replace(/^CUST-/i, ''));
                if (!normalizedSelection.includes(customerId)) {
                    continue;
                }
            }

            const customerData = customersMap[customerId] || {
                customer_id: customerId,
                company_name: customerId,
                tin: '',
                address: '',
                phone: '',
                email: '',
                credit_limit: 0,
                payment_terms: '30 Days Net',
                credit_hold: false,
                wallet_balance: 0
            };

            // Chronological sort
            txs.sort((a, b) => new Date(a.date) - new Date(b.date));

            // Populate chronological ledger details with running balance starting from 0
            let runningBalance = 0;
            let totalInvoiced = 0;
            let totalSettled = 0;

            const ledgerRows = txs.map(tx => {
                const debit = tx.debit;
                const credit = tx.credit;
                runningBalance += debit - credit;

                if (debit > 0) totalInvoiced += debit;
                if (credit > 0) totalSettled += credit;

                return {
                    date: tx.date,
                    due_date: tx.due_date || tx.date,
                    invoice_date: tx.date,
                    primary_ref: tx.invoiceNo || '-',
                    physical_receipt_no: tx.invoiceNo || '-',
                    sub_ref: null,
                    event_type: debit > 0 ? 'INVOICE_POSTED' : 'PAYMENT_SETTLED',
                    type_label: tx.description || (debit > 0 ? 'Invoice Charged' : 'Payment Received'),
                    payment_channel: tx.note || null,
                    description: tx.description || '',
                    debit_amount: debit > 0 ? debit : null,
                    credit_amount: credit > 0 ? credit : null,
                    running_balance: runningBalance,
                    invoice_terms: customerData.payment_terms
                };
            });

            // Calculate aging summary
            const agingSummary = calculateFifoAging(txs, statementDateStr);

            // Sequential statement number
            const statementNumber = `SOA-${period}-${String(sequenceCounter++).padStart(4, '0')}`;

            const options = {
                company,
                statementNumber,
                statementDate: new Date(statementDateStr),
                startDate: new Date(startDateStr),
                endDate: new Date(endDateStr),
                openingBalance: 0,
                totalInvoiced,
                totalSettled,
                closingBalance: runningBalance,
                outputDir: baseDir
            };

            const pdfPath = await generateStatementOfAccountPDF(customerData, ledgerRows, agingSummary, options);
            outputPaths.push({ customerName: customerData.company_name, customerId, path: pdfPath });
            tempFiles.push(pdfPath);
        }

        if (outputPaths.length === 0) {
            return res.status(400).json({ message: 'No statements were generated for the specified selection.' });
        }

        if (outputPaths.length === 1) {
            // Single PDF: send file directly
            const singlePdf = outputPaths[0];
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="SOA_${singlePdf.customerName.replace(/[^A-Za-z0-9_-]/g, '_')}_${statementDateStr}.pdf"`);
            res.sendFile(singlePdf.path, () => {
                cleanupFiles(tempFiles);
            });
        } else {
            // Multiple PDFs: package in a ZIP
            const zipPath = path.join(baseDir, `SOA_Batch_${timestamp}.zip`);
            tempFiles.push(zipPath);

            const fileList = outputPaths.map(p => `"${path.basename(p.path)}"`).join(' ');
            
            // Execute OS zip command from tmp directory to ensure -j flat structure works cleanly
            exec(`cd ${baseDir} && zip -j "${zipPath}" ${fileList}`, (err) => {
                if (err) {
                    console.error('[SOA-GEN] Zip compression failed:', err);
                    cleanupFiles(tempFiles);
                    return res.status(500).json({ message: 'Failed to compress batch statements archive' });
                }

                res.setHeader('Content-Type', 'application/zip');
                res.setHeader('Content-Disposition', `attachment; filename="SOA_Batch_Statements_${statementDateStr}.zip"`);
                res.sendFile(zipPath, () => {
                    cleanupFiles(tempFiles);
                });
            });
        }

    } catch (error) {
        console.error('[SOA-GEN] Unhandled error during generation:', error);
        cleanupFiles(tempFiles);
        res.status(500).json({ message: 'Internal server error during statement generation', error: error.message });
    }
});

function cleanupFiles(files) {
    for (const file of files) {
        fs.unlink(file, (err) => {
            if (err && err.code !== 'ENOENT') {
                console.warn(`[SOA-GEN] Failed to delete temp file ${file}:`, err.message);
            }
        });
    }
}

module.exports = router;
