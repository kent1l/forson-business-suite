import { useEffect, useRef, useState } from 'react';
import api from '../../api';
import Modal from '../ui/Modal';
import { supplierReference } from '../../utils/supplierReference';

export default function BillReceiptViewer({ bill, onClose }) {
    const dialogRef = useRef(null);
    const [documents, setDocuments] = useState([]);
    const [selectedId, setSelectedId] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [previewUrl, setPreviewUrl] = useState('');
    const [previewType, setPreviewType] = useState('');
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState('');
    const [attempt, setAttempt] = useState(0);
    const billId = bill.bill_id;

    useEffect(() => {
        const origin = document.activeElement;
        dialogRef.current?.querySelector('button')?.focus();
        const onKeyDown = event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
            if (event.key !== 'Tab') return;
            const controls = [...(dialogRef.current?.querySelectorAll('button:not(:disabled), select, a[href]') || [])];
            const first = controls[0];
            const last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('keydown', onKeyDown, true);
            if (origin?.isConnected) origin.focus();
        };
    }, [onClose]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError('');
        setDocuments([]);
        setSelectedId('');
        api.get(`/ap/supplier-bills/${billId}/receipts`)
            .then(({ data }) => {
                if (cancelled) return;
                const found = data?.data?.documents || [];
                setDocuments(found);
                setSelectedId(found[0]?.id ? String(found[0].id) : '');
            })
            .catch(err => { if (!cancelled) setError(err.response?.data?.message || 'Could not load the supplier receipt. Please try again.'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [billId, attempt]);

    useEffect(() => {
        let cancelled = false;
        let objectUrl;
        setPreviewUrl('');
        setPreviewType('');
        setPreviewError('');
        if (!selectedId) { setPreviewLoading(false); return undefined; }
        setPreviewLoading(true);
        api.get(`/paperless/documents/${selectedId}/preview`, { responseType: 'blob' })
            .then(async ({ data, headers }) => {
                // Some older proxies label PDF bytes as image/png. Check the file
                // itself as well, and correct the blob MIME before embedding it.
                const isPdf = await data.slice(0, 5).text() === '%PDF-';
                if (cancelled) return;
                const contentType = isPdf ? 'application/pdf'
                    : (headers['content-type'] || data.type || '').split(';')[0].trim().toLowerCase();
                setPreviewType(contentType);
                objectUrl = URL.createObjectURL(new Blob([data], { type: contentType }));
                setPreviewUrl(objectUrl);
            })
            .catch(() => { if (!cancelled) setPreviewError('Could not load this receipt preview. Please try again.'); })
            .finally(() => { if (!cancelled) setPreviewLoading(false); });
        return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [selectedId, attempt]);

    const selected = documents.find(doc => String(doc.id) === selectedId);
    return (
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={`Supplier receipt for ${supplierReference(bill)}`}>
            <Modal isOpen onClose={onClose} title={`Receipt — ${supplierReference(bill)}`} maxWidth="max-w-5xl" zIndexClass="z-50">
                <div className="space-y-4">
                    {loading && <p role="status" className="text-sm text-gray-500 dark:text-slate-400">Finding linked supplier receipts in Paperless…</p>}
                    {error && <p role="alert" className="text-sm text-danger-600 dark:text-danger-400">{error}</p>}
                    {!loading && !error && documents.length === 0 && (
                        <p role="status" className="text-sm text-gray-600 dark:text-slate-300">No supplier receipt available in Paperless for this bill’s references.</p>
                    )}
                    {documents.length > 1 && (
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Linked receipt
                            <select value={selectedId} onChange={e => setSelectedId(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2">
                                {documents.map(doc => <option key={doc.id} value={doc.id}>{doc.title} · {doc.references.join(', ')}</option>)}
                            </select>
                        </label>
                    )}
                    {selected && <p className="text-sm text-gray-600 dark:text-slate-300">Paperless receipt: <span className="font-mono font-semibold">{selected.title}</span></p>}
                    {previewLoading && <p role="status" className="text-sm text-gray-500 dark:text-slate-400">Loading receipt preview…</p>}
                    {previewError && <p role="alert" className="text-sm text-danger-600 dark:text-danger-400">{previewError}</p>}
                    {previewUrl && previewType === 'application/pdf' && (
                        <div className="space-y-2">
                            <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary-600 dark:text-primary-400 underline">Open PDF in a new tab</a>
                            <iframe src={previewUrl} title={`Supplier receipt ${selected?.title || supplierReference(bill)}`} className="h-[65vh] w-full rounded border border-gray-200 dark:border-slate-700 bg-white" />
                        </div>
                    )}
                    {previewUrl && previewType !== 'application/pdf' && <img src={previewUrl} alt={`Supplier receipt ${selected?.title || supplierReference(bill)}`} className="mx-auto h-auto max-w-full rounded border border-gray-200 dark:border-slate-700 bg-white" onError={() => { setPreviewError('This receipt preview could not be displayed.'); setPreviewUrl(''); }} />}
                    <div className="flex justify-end gap-3">
                        {(error || previewError) && <button type="button" onClick={() => setAttempt(value => value + 1)} className="rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-2 text-sm">Try again</button>}
                        <button type="button" onClick={onClose} className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white">Close receipt</button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
