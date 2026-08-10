import React, { useState, useCallback } from 'react';
import api from '../api';
import toast from 'react-hot-toast';

function parseCSV(text) {
    const lines = [];
    let row = [""];
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const next = text[i+1];

        if (c === '"') {
            if (inQuotes && next === '"') {
                row[row.length - 1] += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (c === ',' && !inQuotes) {
            row.push("");
        } else if ((c === '\r' || c === '\n') && !inQuotes) {
            if (c === '\r' && next === '\n') {
                i++;
            }
            lines.push(row);
            row = [""];
        } else {
            row[row.length - 1] += c;
        }
    }
    if (row.length > 1 || row[0] !== "") {
        lines.push(row);
    }

    if (lines.length === 0) return [];
    const headers = lines[0].map(h => h.trim());
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.length === 1 && line[0] === "") continue; // skip empty rows
        const obj = {};
        for (let j = 0; j < headers.length; j++) {
            obj[headers[j]] = line[j] !== undefined ? line[j].trim() : "";
        }
        data.push(obj);
    }
    return data;
}

export default function SoaGenPage() {
    const [customersFile, setCustomersFile] = useState(null);
    const [transactionsFile, setTransactionsFile] = useState(null);
    
    // Configuration states
    const [statementDate, setStatementDate] = useState(new Date().toISOString().split('T')[0]);
    const [startDate, setStartDate] = useState(
        new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
    );
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);

    // Parsing preview state
    const [previewData, setPreviewData] = useState(null);
    const [selectedCustomerIds, setSelectedCustomerIds] = useState([]);
    const [loading, setLoading] = useState(false);
    const [processingStatus, setProcessingStatus] = useState('');

    const downloadSampleCustomers = () => {
        const csvContent = "CUSTOMER_ID,COMPANY_NAME,TIN,ADDRESS,PHONE,EMAIL,CREDIT_LIMIT,PAYMENT_TERMS,CREDIT_STATUS,WALLET_BALANCE\n" +
                           "CUST-101,Acme Corp,123-45-678,123 Main Street,0917-111-2222,acme@test.com,50000,30 Days Net,ACTIVE,0\n" +
                           "CUST-102,Beta Labs,987-65-432,456 Lab Lane,0918-333-4444,beta@test.com,75000,15 Days Net,ACTIVE,1200\n";
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", "sample_customers.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const downloadSampleTransactions = () => {
        const csvContent = "CUSTOMER_ID,DATE,DUE_DATE,INVOICE#,PHYSICAL_RECEIPT#,DESCRIPTION,DEBIT,CREDIT,Note\n" +
                           "CUST-101,2026-08-01,2026-08-31,INV-1001,OR-1001,Invoice Charged,12000.00,0,PO-991\n" +
                           "CUST-101,2026-08-05,2026-08-05,,OR-8849,Payment Received,0,4000.00,Check #882\n" +
                           "CUST-102,2026-08-02,2026-08-17,INV-1002,OR-1002,Invoice Charged,8500.00,0,PO-992\n";
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", "sample_transactions.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleFileChange = (e, type) => {
        const file = e.target.files[0];
        if (!file) return;

        if (type === 'customers') {
            setCustomersFile(file);
        } else {
            setTransactionsFile(file);
        }
        setPreviewData(null); // Reset preview on new upload
        setSelectedCustomerIds([]);
    };

    const handleToggleSelect = (customerId) => {
        setSelectedCustomerIds(prev => 
            prev.includes(customerId) 
                ? prev.filter(id => id !== customerId) 
                : [...prev, customerId]
        );
    };

    const handleToggleAll = () => {
        if (!previewData) return;
        if (selectedCustomerIds.length === previewData.length) {
            setSelectedCustomerIds([]);
        } else {
            setSelectedCustomerIds(previewData.map(s => s.customerId));
        }
    };

    const handleParsePreview = useCallback(() => {
        if (!customersFile || !transactionsFile) {
            toast.error('Please upload both files first.');
            return;
        }

        setLoading(true);
        setProcessingStatus('Reading and analyzing CSV files...');

        const p1 = new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = parseCSV(e.target.result);
                    resolve(data);
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = (err) => reject(err);
            reader.readAsText(customersFile);
        });

        const p2 = new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = parseCSV(e.target.result);
                    resolve(data);
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = (err) => reject(err);
            reader.readAsText(transactionsFile);
        });

        Promise.all([p1, p2]).then(([custRows, txRows]) => {
            const customerLookup = {};
            const customerNameMap = {}; // name -> ID lookup to handle name-only ledger rows
            custRows.forEach(c => {
                const cleanC = {};
                for (const [k, v] of Object.entries(c)) {
                    cleanC[k.trim()] = v;
                }
                const id = (cleanC.CUSTOMER_ID || cleanC.customer_id || '').trim();
                const name = (cleanC.COMPANY_NAME || cleanC.company_name || cleanC.Correspondent || cleanC.correspondent || '').trim();
                
                if (id) {
                    const cleanId = id.replace(/^CUST-/i, ''); // Strip CUST- prefix for soaPdf template to avoid duplication
                    customerLookup[cleanId] = name || id;
                    if (name) {
                        customerNameMap[name.toLowerCase()] = cleanId;
                    }
                } else if (name) {
                    customerLookup[name] = name;
                }
            });

            // Count transactions and sum balances per customer
            const stats = {};
            txRows.forEach(tx => {
                const cleanTx = {};
                for (const [k, v] of Object.entries(tx)) {
                    cleanTx[k.trim()] = v;
                }
                let cid = (cleanTx.CUSTOMER_ID || cleanTx.customer_id || '').trim();
                const correspondent = (cleanTx.Correspondent || cleanTx.correspondent || cleanTx.COMPANY_NAME || cleanTx.company_name || '').trim();

                if (cid) {
                    cid = cid.replace(/^CUST-/i, ''); // Normalize ID
                } else if (correspondent) {
                    cid = customerNameMap[correspondent.toLowerCase()] || correspondent;
                } else {
                    return;
                }

                if (!stats[cid]) {
                    stats[cid] = {
                        customerId: cid,
                        name: customerLookup[cid] || `Unregistered (${cid})`,
                        txCount: 0,
                        debitSum: 0,
                        creditSum: 0
                    };
                }

                stats[cid].txCount += 1;
                stats[cid].debitSum += parseFloat(cleanTx.DEBIT || cleanTx.debit) || 0;
                stats[cid].creditSum += parseFloat(cleanTx.CREDIT || cleanTx.credit) || 0;
            });

            const parsedStats = Object.values(stats);
            setPreviewData(parsedStats);
            setSelectedCustomerIds(parsedStats.map(s => s.customerId));
            setLoading(false);
            toast.success('CSVs parsed successfully! Check the preview below.');
        }).catch(err => {
            console.error(err);
            setLoading(false);
            toast.error('Failed to parse CSV files.');
        });
    }, [customersFile, transactionsFile]);

    const handleGenerate = async (targetCustomerIds = null) => {
        if (!customersFile || !transactionsFile) {
            toast.error('Please upload both files.');
            return;
        }

        const idsToGenerate = targetCustomerIds || selectedCustomerIds;
        if (idsToGenerate.length === 0) {
            toast.error('Please select at least one customer.');
            return;
        }

        try {
            setLoading(true);
            setProcessingStatus('Generating Statements and PDF layouts...');

            const formData = new FormData();
            formData.append('customersCsv', customersFile);
            formData.append('transactionsCsv', transactionsFile);
            formData.append('statementDate', statementDate);
            formData.append('startDate', startDate);
            formData.append('endDate', endDate);
            formData.append('selectedCustomers', JSON.stringify(idsToGenerate));

            const response = await api.post('/soa-gen/generate', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                responseType: 'blob'
            });

            const contentDisposition = response.headers['content-disposition'];
            let filename = `SOA_Batch_${statementDate}.zip`;
            if (contentDisposition) {
                const match = contentDisposition.match(/filename="(.+?)"/);
                if (match && match[1]) filename = match[1];
            }

            const blob = new Blob([response.data], { type: response.data.type });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);

            toast.success('Statements generated successfully!');
        } catch (error) {
            console.error('Generation failed:', error);
            toast.error('Failed to generate statements. Check CSV layouts.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
            {/* Nav Header */}
            <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <span className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent tracking-wide">
                        FORSON
                    </span>
                    <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full border border-slate-700">
                        A/R Cleanup Utility
                    </span>
                </div>
                <h1 className="text-sm font-medium text-slate-400">Statement of Account Batch Engine</h1>
            </header>

            {/* Main Area */}
            <main className="flex-1 max-w-5xl w-full mx-auto p-6 md:p-8 space-y-8">
                {/* Intro Card */}
                <div className="bg-gradient-to-br from-slate-950 to-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
                    <h2 className="text-lg font-bold text-slate-200 mb-2">Standalone A/R Statement Engine</h2>
                    <p className="text-slate-400 text-sm leading-relaxed max-w-3xl">
                        Upload custom registry and transaction ledger files below to generate statement documents.
                        This utility operates entirely in-memory, computing balance reconciliation and chronological aging breakdowns without modifying database records.
                    </p>
                </div>

                {/* Upload & Setup Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Left & Middle: Files Upload */}
                    <div className="md:col-span-2 bg-slate-950 border border-slate-800 rounded-xl p-6 space-y-5">
                        <h3 className="text-sm font-bold uppercase tracking-wider text-indigo-400">Upload CSV Source Files</h3>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {/* Customers File */}
                            <div className="flex flex-col">
                                <label className="text-xs font-semibold text-slate-400 mb-2">1. Customer Registry (customers.csv)</label>
                                <div className="relative border-2 border-dashed border-slate-800 hover:border-indigo-500/50 rounded-lg p-5 flex flex-col items-center justify-center transition-colors bg-slate-900/50">
                                    <input 
                                        type="file" 
                                        accept=".csv" 
                                        onChange={(e) => handleFileChange(e, 'customers')}
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    />
                                    <span className="text-slate-300 text-xs font-medium truncate max-w-full text-center">
                                        {customersFile ? `📄 ${customersFile.name}` : 'Click or Drag File Here'}
                                    </span>
                                </div>
                                <button 
                                    type="button"
                                    onClick={downloadSampleCustomers}
                                    className="mt-2 text-left text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors font-medium self-start cursor-pointer"
                                >
                                    📥 Download Sample customers.csv
                                </button>
                            </div>

                            {/* Transactions File */}
                            <div className="flex flex-col">
                                <label className="text-xs font-semibold text-slate-400 mb-2">2. Consolidated Ledger (transactions.csv)</label>
                                <div className="relative border-2 border-dashed border-slate-800 hover:border-indigo-500/50 rounded-lg p-5 flex flex-col items-center justify-center transition-colors bg-slate-900/50">
                                    <input 
                                        type="file" 
                                        accept=".csv" 
                                        onChange={(e) => handleFileChange(e, 'transactions')}
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    />
                                    <span className="text-slate-300 text-xs font-medium truncate max-w-full text-center">
                                        {transactionsFile ? `📄 ${transactionsFile.name}` : 'Click or Drag File Here'}
                                    </span>
                                </div>
                                <button 
                                    type="button"
                                    onClick={downloadSampleTransactions}
                                    className="mt-2 text-left text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors font-medium self-start cursor-pointer"
                                >
                                    📥 Download Sample transactions.csv
                                </button>
                            </div>
                        </div>

                        {/* File Action */}
                        <div className="pt-2 flex justify-end">
                            <button
                                onClick={handleParsePreview}
                                disabled={!customersFile || !transactionsFile || loading}
                                className="px-4 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                Validate & Parse Files
                            </button>
                        </div>
                    </div>

                    {/* Right: Statement Settings */}
                    <div className="bg-slate-950 border border-slate-800 rounded-xl p-6 space-y-4">
                        <h3 className="text-sm font-bold uppercase tracking-wider text-indigo-400">Statement Settings</h3>
                        
                        <div className="space-y-3 text-xs">
                            <div className="flex flex-col">
                                <label className="text-slate-400 font-semibold mb-1">Statement Date</label>
                                <input
                                    type="date"
                                    value={statementDate}
                                    onChange={(e) => setStatementDate(e.target.value)}
                                    className="bg-slate-900 border border-slate-800 rounded px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                                />
                            </div>

                            <div className="flex flex-col">
                                <label className="text-slate-400 font-semibold mb-1">Period Start Date</label>
                                <input
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    className="bg-slate-900 border border-slate-800 rounded px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                                />
                            </div>

                            <div className="flex flex-col">
                                <label className="text-slate-400 font-semibold mb-1">Period End Date</label>
                                <input
                                    type="date"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                    className="bg-slate-900 border border-slate-800 rounded px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Loading Status */}
                {loading && (
                    <div className="bg-indigo-950/40 border border-indigo-900/60 rounded-xl p-6 flex items-center justify-between shadow-lg">
                        <div className="flex items-center gap-4">
                            <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                            <span className="text-sm font-medium text-slate-300">{processingStatus}</span>
                        </div>
                    </div>
                )}

                {/* Parser Preview Table */}
                {previewData && (
                    <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
                        <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-950">
                            <div>
                                <h3 className="text-sm font-bold uppercase tracking-wider text-indigo-400">Validated Summary</h3>
                                <p className="text-xs text-slate-500 mt-1">Ready for generation ({previewData.length} customers detected)</p>
                            </div>
                            <button
                                onClick={() => handleGenerate(selectedCustomerIds)}
                                disabled={loading || selectedCustomerIds.length === 0}
                                className="px-5 py-2.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-100 rounded-lg shadow-lg shadow-indigo-600/10 transition-all cursor-pointer"
                            >
                                Generate Selected Statements ({selectedCustomerIds.length})
                            </button>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-900/50 border-b border-slate-800 text-slate-400 text-xs font-semibold">
                                        <th className="px-6 py-3 text-center w-12">
                                            <input 
                                                type="checkbox"
                                                checked={previewData.length > 0 && selectedCustomerIds.length === previewData.length}
                                                onChange={handleToggleAll}
                                                className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500 cursor-pointer w-4 h-4"
                                            />
                                        </th>
                                        <th className="px-6 py-3">Customer ID / Name</th>
                                        <th className="px-6 py-3">Company Name</th>
                                        <th className="px-6 py-3 text-center">Tx Count</th>
                                        <th className="px-6 py-3 text-right">Total Charged</th>
                                        <th className="px-6 py-3 text-right">Total Paid</th>
                                        <th className="px-6 py-3 text-right">Closing Balance</th>
                                        <th className="px-6 py-3 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800 text-xs text-slate-300">
                                    {previewData.map((row) => {
                                        const balance = row.debitSum - row.creditSum;
                                        const isSelected = selectedCustomerIds.includes(row.customerId);
                                        return (
                                            <tr key={row.customerId} className={`transition-colors hover:bg-slate-900/30 ${isSelected ? 'bg-indigo-950/10' : ''}`}>
                                                <td className="px-6 py-3 text-center">
                                                    <input 
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => handleToggleSelect(row.customerId)}
                                                        className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500 cursor-pointer w-4 h-4"
                                                    />
                                                </td>
                                                <td className="px-6 py-3 font-mono font-bold text-indigo-400">{row.customerId}</td>
                                                <td className="px-6 py-3 font-medium">{row.name}</td>
                                                <td className="px-6 py-3 text-center font-mono">{row.txCount}</td>
                                                <td className="px-6 py-3 text-right font-mono">₱{row.debitSum.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                                                <td className="px-6 py-3 text-right font-mono text-emerald-400">₱{row.creditSum.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                                                <td className="px-6 py-3 text-right font-mono font-bold text-amber-400">₱{balance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                                                <td className="px-6 py-3 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleGenerate([row.customerId])}
                                                        disabled={loading}
                                                        className="px-3 py-1 bg-slate-800 hover:bg-indigo-600 active:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-100 font-semibold rounded text-[11px] cursor-pointer transition-colors border border-slate-700 hover:border-indigo-500"
                                                    >
                                                        Download PDF
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
