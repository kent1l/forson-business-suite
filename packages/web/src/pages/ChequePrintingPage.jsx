import { useEffect, useMemo, useState } from 'react';
import { format, parse, isValid } from 'date-fns';
import toast from 'react-hot-toast';
import api from '../api';

const LETTER_SIZE = { width: 612, height: 792 };

const blankRow = () => ({ date: format(new Date(), 'MM/dd/yyyy'), payee: '', amount: '', memo: '' });

const DEFAULT_FIELD_POSITIONS = {
    date: { x: 430, y: 700, fontSize: 11 },
    payee: { x: 90, y: 655, fontSize: 12 },
    amountNumeric: { x: 490, y: 655, fontSize: 12 },
    amountWords: { x: 90, y: 625, fontSize: 11 },
    memo: { x: 90, y: 585, fontSize: 10 },
    currency: { x: 515, y: 655, fontSize: 11 }
};

const numberToWords = (value) => {
    const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
    const teens = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
    const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

    const chunk = (n) => {
        let out = '';
        if (n >= 100) {
            out += `${ones[Math.floor(n / 100)]} hundred `;
            n %= 100;
        }
        if (n >= 20) {
            out += `${tens[Math.floor(n / 10)]} `;
            n %= 10;
        } else if (n >= 10) {
            out += `${teens[n - 10]} `;
            n = 0;
        }
        if (n > 0) out += `${ones[n]} `;
        return out.trim();
    };

    const n = Number(value || 0);
    const whole = Math.floor(n);
    const cents = Math.round((n - whole) * 100);
    if (whole === 0) return `zero and ${cents.toString().padStart(2, '0')}/100`;

    const parts = [];
    const billions = Math.floor(whole / 1_000_000_000);
    const millions = Math.floor((whole % 1_000_000_000) / 1_000_000);
    const thousands = Math.floor((whole % 1_000_000) / 1000);
    const hundreds = whole % 1000;

    if (billions) parts.push(`${chunk(billions)} billion`);
    if (millions) parts.push(`${chunk(millions)} million`);
    if (thousands) parts.push(`${chunk(thousands)} thousand`);
    if (hundreds) parts.push(chunk(hundreds));

    return `${parts.join(' ')} and ${cents.toString().padStart(2, '0')}/100`.trim();
};

const escapePdfText = (value) => String(value || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

const buildPdf = (pages) => {
    let output = '%PDF-1.4\n';
    const offsets = [];
    const objects = [];

    const addObject = (body) => {
        const id = objects.length + 1;
        objects.push({ id, body });
        return id;
    };

    const pageObjectIds = [];
    pages.forEach((pageLines) => {
        const stream = pageLines.join('\n');
        const contentId = addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
        const pageId = addObject(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LETTER_SIZE.width} ${LETTER_SIZE.height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
        pageObjectIds.push(pageId);
    });

    objects.unshift({ id: 3, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' });
    objects.unshift({ id: 2, body: `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>` });
    objects.unshift({ id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' });

    objects.sort((a, b) => a.id - b.id).forEach((obj) => {
        offsets[obj.id] = output.length;
        output += `${obj.id} 0 obj\n${obj.body}\nendobj\n`;
    });

    const xref = output.length;
    output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i += 1) {
        output += `${String(offsets[i] || 0).padStart(10, '0')} 00000 n \n`;
    }
    output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

    return new TextEncoder().encode(output);
};

const ChequePrintingPage = () => {
    const [templates, setTemplates] = useState([]);
    const [selectedTemplateId, setSelectedTemplateId] = useState('');
    const [rows, setRows] = useState([blankRow()]);
    const [history, setHistory] = useState([]);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    const selectedTemplate = useMemo(() => templates.find((tpl) => String(tpl.id) === String(selectedTemplateId)), [templates, selectedTemplateId]);

    const loadData = async () => {
        try {
            const [templatesRes, historyRes] = await Promise.all([api.get('/cheques/templates'), api.get('/cheques/history')]);
            const loadedTemplates = templatesRes.data || [];
            setTemplates(loadedTemplates);
            setHistory(historyRes.data || []);
            if (loadedTemplates.length && !selectedTemplateId) setSelectedTemplateId(String(loadedTemplates[0].id));
        } catch {
            toast.error('Failed to load cheque module data.');
        }
    };

    useEffect(() => { loadData(); }, []);

    const updateRow = (idx, field, value) => {
        setRows((prev) => {
            const next = [...prev];
            next[idx] = { ...next[idx], [field]: value };
            if (idx === next.length - 1 && (next[idx].payee || next[idx].amount || next[idx].memo)) next.push(blankRow());
            return next;
        });
    };

    const activeRows = rows.filter((row) => row.payee || row.amount || row.memo).map((row) => ({ ...row, amount: (Math.round(Number(row.amount || 0) * 100) / 100).toFixed(2) }));

    const validate = (row) => {
        if (!row.payee.trim()) return 'Payee is required';
        if (Number.isNaN(Number(row.amount))) return 'Amount must be numeric';
        const fmt = selectedTemplate?.date_format || 'MM/dd/yyyy';
        if (!isValid(parse(row.date, fmt, new Date()))) return `Date must follow ${fmt}`;
        return null;
    };

    const generatePdf = async (sourceRows = activeRows, persist = true) => {
        if (!selectedTemplate) return toast.error('Select a template first.');
        if (!sourceRows.length) return toast.error('Add at least one cheque entry.');
        for (const row of sourceRows) {
            const error = validate(row);
            if (error) return toast.error(error);
        }

        setSaving(true);
        try {
            const positions = selectedTemplate.field_positions || DEFAULT_FIELD_POSITIONS;
            const pages = sourceRows.map((row) => {
                const fmt = selectedTemplate.date_format || 'MM/dd/yyyy';
                const dateValue = format(parse(row.date, fmt, new Date()), fmt);
                const words = selectedTemplate.amount_format === 'upper' ? numberToWords(row.amount).toUpperCase() : numberToWords(row.amount);
                const lines = [
                    `BT /F1 ${positions.date?.fontSize || 11} Tf ${positions.date?.x || 430} ${positions.date?.y || 700} Td (${escapePdfText(dateValue)}) Tj ET`,
                    `BT /F1 ${positions.payee?.fontSize || 12} Tf ${positions.payee?.x || 90} ${positions.payee?.y || 655} Td (${escapePdfText(row.payee)}) Tj ET`,
                    `BT /F1 ${positions.amountNumeric?.fontSize || 12} Tf ${positions.amountNumeric?.x || 490} ${positions.amountNumeric?.y || 655} Td (${escapePdfText(row.amount)}) Tj ET`,
                    `BT /F1 ${positions.amountWords?.fontSize || 11} Tf ${positions.amountWords?.x || 90} ${positions.amountWords?.y || 625} Td (${escapePdfText(words)}) Tj ET`,
                    `BT /F1 ${positions.memo?.fontSize || 10} Tf ${positions.memo?.x || 90} ${positions.memo?.y || 585} Td (${escapePdfText(row.memo || '')}) Tj ET`
                ];
                if (selectedTemplate.currency_settings?.enabled !== false) {
                    lines.push(`BT /F1 ${positions.currency?.fontSize || 11} Tf ${positions.currency?.x || 515} ${positions.currency?.y || 655} Td (${escapePdfText(selectedTemplate.currency_settings?.label || 'USD')}) Tj ET`);
                }
                return lines;
            });

            const pdfBytes = buildPdf(pages);
            const url = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }));
            window.open(url, '_blank', 'noopener,noreferrer');

            if (persist) {
                await api.post('/cheques/records', {
                    template_id: Number(selectedTemplateId),
                    records: sourceRows.map((row) => ({ ...row, date: parse(row.date, selectedTemplate.date_format || 'MM/dd/yyyy', new Date()) }))
                });
                toast.success('PDF generated. Print at 100% scale.');
                setRows([blankRow()]);
                loadData();
            }
        } catch (error) {
            toast.error(error?.response?.data?.message || 'PDF generation failed.');
        } finally {
            setSaving(false);
        }
    };



    const handleDelete = async (id) => {
        try {
            await api.delete(`/cheques/history/${id}`);
            toast.success('Record deleted.');
            loadData();
        } catch {
            toast.error('Delete failed.');
        }
    };

    const handleReprint = async (entry) => {
        const template = templates.find((tpl) => String(tpl.id) === String(selectedTemplateId));
        if (!template) return toast.error('Select a preset for reprint.');
        await generatePdf([{
            payee: entry.payee,
            amount: Number(entry.amount).toFixed(2),
            date: format(new Date(entry.cheque_date || new Date()), template.date_format || 'MM/dd/yyyy'),
            memo: entry.memo || ''
        }], false);
    };

    const updateTemplate = async (fieldPath, value) => {
        if (!selectedTemplate) return;
        const payload = { ...selectedTemplate, [fieldPath]: value };
        try {
            const response = await api.put(`/cheques/templates/${selectedTemplate.id}`, payload);
            setTemplates((prev) => prev.map((tpl) => (tpl.id === response.data.id ? response.data : tpl)));
        } catch {
            toast.error('Failed to update template');
        }
    };

    return (
        <div className="space-y-4">
            <div className="bg-white border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Bank Preset</span>
                    <select className="border rounded-lg px-3 py-2 text-sm" value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
                        {templates.map((template) => <option key={template.id} value={template.id}>{template.bank_name}</option>)}
                    </select>
                </div>
                <div className="flex gap-2">
                    <button className="px-3 py-2 border rounded-lg text-sm" onClick={() => setSettingsOpen(true)}>Settings</button>
                    <button className="px-3 py-2 border rounded-lg text-sm" onClick={() => setHistoryOpen(true)}>History</button>
                    <button className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg disabled:opacity-50" disabled={saving} onClick={() => generatePdf()}>{saving ? 'Generating…' : 'Generate PDF'}</button>
                </div>
            </div>

            {rows.map((row, idx) => (
                <div key={idx} className="bg-white border rounded-xl p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
                    <input className="border rounded-lg px-3 py-2 text-sm" value={row.date} onChange={(e) => updateRow(idx, 'date', e.target.value)} placeholder="Date" />
                    <input className="border rounded-lg px-3 py-2 text-sm" value={row.payee} onChange={(e) => updateRow(idx, 'payee', e.target.value)} placeholder="Payee" />
                    <input className="border rounded-lg px-3 py-2 text-sm" value={row.amount} onChange={(e) => updateRow(idx, 'amount', e.target.value)} placeholder="Amount" />
                    <input className="border rounded-lg px-3 py-2 text-sm" value={row.memo} onChange={(e) => updateRow(idx, 'memo', e.target.value)} placeholder="Memo" />
                </div>
            ))}

            {settingsOpen && selectedTemplate && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                    <div className="bg-white w-full max-w-xl rounded-xl border">
                        <div className="p-4 border-b flex justify-between"><h3 className="font-semibold">Cheque Settings</h3><button onClick={() => setSettingsOpen(false)}>Close</button></div>
                        <div className="p-4 space-y-3 text-sm">
                            <label className="block">Date Format
                                <select className="w-full mt-1 border rounded px-3 py-2" value={selectedTemplate.date_format || 'MM/dd/yyyy'} onChange={(e) => updateTemplate('date_format', e.target.value)}>
                                    <option value="MM/dd/yyyy">MM/dd/yyyy</option><option value="dd/MM/yyyy">dd/MM/yyyy</option><option value="MMM dd, yyyy">MMM dd, yyyy</option>
                                </select>
                            </label>
                            <label className="block">Amount Words Style
                                <select className="w-full mt-1 border rounded px-3 py-2" value={selectedTemplate.amount_format || 'title_case'} onChange={(e) => updateTemplate('amount_format', e.target.value)}>
                                    <option value="title_case">Title Case</option><option value="upper">UPPER</option>
                                </select>
                            </label>
                            <label className="flex items-center gap-2"><input type="checkbox" checked={selectedTemplate.currency_settings?.enabled !== false} onChange={(e) => updateTemplate('currency_settings', { ...selectedTemplate.currency_settings, enabled: e.target.checked })} /> Show Currency Label</label>
                        </div>
                    </div>
                </div>
            )}

            {historyOpen && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                    <div className="bg-white w-full max-w-5xl rounded-xl border">
                        <div className="p-4 border-b flex justify-between"><h3 className="font-semibold">Cheque History</h3><button onClick={() => setHistoryOpen(false)}>Close</button></div>
                        <div className="max-h-[70vh] overflow-auto">
                            <table className="w-full text-sm"><thead className="bg-gray-50"><tr><th className="p-2 text-left">Created</th><th className="p-2 text-left">Payee</th><th className="p-2 text-left">Amount</th><th className="p-2 text-left">Bank</th><th className="p-2 text-left">Date Issued</th><th className="p-2 text-right">Actions</th></tr></thead>
                                <tbody>{history.map((entry) => <tr key={entry.id} className="border-t"><td className="p-2">{format(new Date(entry.created_at), 'yyyy-MM-dd HH:mm')}</td><td className="p-2">{entry.payee}</td><td className="p-2">{entry.amount}</td><td className="p-2">{entry.bank_preset || '-'}</td><td className="p-2">{entry.cheque_date ? format(new Date(entry.cheque_date), 'yyyy-MM-dd') : '-'}</td><td className="p-2 text-right space-x-2"><button className="px-2 py-1 border rounded" onClick={() => handleReprint(entry)}>Reprint</button><button className="px-2 py-1 border rounded text-red-600" onClick={() => handleDelete(entry.id)}>Delete</button></td></tr>)}</tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ChequePrintingPage;
