import React, { useEffect, useState, useMemo } from 'react';
import api from '../api';
import Icon from '../components/ui/Icon';
import Modal from '../components/ui/Modal';
import { ICONS } from '../constants';
import toast from 'react-hot-toast';

export default function PaperlessReceiptsPage() {
    const [health, setHealth] = useState({ healthy: false, status: 'loading', message: 'Checking Paperless connection...' });
    const [documents, setDocuments] = useState([]);
    const [tags, setTags] = useState([]);
    const [loadingDocs, setLoadingDocs] = useState(false);

    // Filters
    const [selectedTag, setSelectedTag] = useState('');
    const [searchQuery, setSearchQuery] = useState('');

    // Selection
    const [selectedDocIds, setSelectedDocIds] = useState(new Set());

    // PDF Preview Modal
    const [pdfBlobUrl, setPdfBlobUrl] = useState(null);
    const [generatingPdf, setGeneratingPdf] = useState(false);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);

    // Fetch Connection Health
    const checkHealth = async () => {
        try {
            const res = await api.get('/paperless/health');
            setHealth(res.data);
        } catch (err) {
            setHealth({
                healthy: false,
                status: 'error',
                message: err.response?.data?.message || err.message || 'Failed to reach Paperless API',
            });
        }
    };

    // Fetch Tags
    const fetchTags = async () => {
        try {
            const res = await api.get('/paperless/tags');
            setTags(res.data?.results || []);
        } catch (err) {
            console.error('Failed to fetch Paperless tags', err);
        }
    };

    // Fetch Documents
    const fetchDocuments = async () => {
        setLoadingDocs(true);
        try {
            const params = {};
            if (selectedTag) params.tag = selectedTag;
            if (searchQuery) params.query = searchQuery;
            params.pageSize = 50;

            const res = await api.get('/paperless/documents', { params });
            setDocuments(res.data?.results || []);
        } catch (err) {
            toast.error('Failed to fetch receipts from Paperless-ngx');
            console.error(err);
        } finally {
            setLoadingDocs(false);
        }
    };

    useEffect(() => {
        checkHealth();
        fetchTags();
        fetchDocuments();
    }, []);

    const toggleSelectDoc = (id) => {
        setSelectedDocIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedDocIds.size === documents.length) {
            setSelectedDocIds(new Set());
        } else {
            setSelectedDocIds(new Set(documents.map(d => d.id)));
        }
    };

    const pageCount = useMemo(() => {
        return Math.ceil(selectedDocIds.size / 4) || 0;
    }, [selectedDocIds.size]);

    // Preview a single document (opens in new tab via authenticated blob fetch)
    const handlePreviewDoc = async (docId) => {
        try {
            const res = await api.get(`/paperless/documents/${docId}/preview`, {
                responseType: 'blob',
            });
            const blob = new Blob([res.data], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank', 'noopener,noreferrer');
        } catch (err) {
            toast.error('Failed to load receipt preview');
            console.error(err);
        }
    };

    // Consolidate Selected Receipts into 2x2 A4 PDF
    const handleConsolidate = async () => {
        if (selectedDocIds.size === 0) {
            toast.error('Please select at least 1 receipt to consolidate');
            return;
        }

        setGeneratingPdf(true);
        try {
            const res = await api.post('/paperless/consolidate', {
                document_ids: Array.from(selectedDocIds),
            }, {
                responseType: 'blob',
            });

            const blob = new Blob([res.data], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            setPdfBlobUrl(url);
            setIsPreviewOpen(true);
            toast.success(`Generated 2x2 A4 PDF layout (${selectedDocIds.size} receipts, ${pageCount} page${pageCount > 1 ? 's' : ''})`);
        } catch (err) {
            toast.error('Failed to generate 2x2 PDF layout');
            console.error(err);
        } finally {
            setGeneratingPdf(false);
        }
    };

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                        <Icon icon={ICONS.documents} className="w-7 h-7 text-blue-600" />
                        Paperless Receipts Consolidation
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">
                        Fetch thermal and paper receipts from Paperless-ngx and layout 4 receipts per printable A4 page.
                    </p>
                </div>

                {/* Connection Status Badge */}
                <div className="flex items-center gap-3">
                    <div className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-2 border ${
                        health.healthy 
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                            : health.status === 'loading'
                                ? 'bg-slate-50 text-slate-600 border-slate-200'
                                : 'bg-rose-50 text-rose-700 border-rose-200'
                    }`}>
                        <span className={`w-2 h-2 rounded-full ${
                            health.healthy ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
                        }`} />
                        {health.healthy ? `Connected (${health.latencyMs}ms)` : health.message}
                    </div>

                    <button
                        onClick={checkHealth}
                        className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
                    >
                        Check Connection
                    </button>
                </div>
            </div>

            {/* Filter Bar */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3 flex-1">
                    {/* Tag Filter */}
                    <div className="w-48">
                        <select
                            value={selectedTag}
                            onChange={(e) => setSelectedTag(e.target.value)}
                            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                            <option value="">All Tags</option>
                            {tags.map(t => (
                                <option key={t.id} value={t.name}>{t.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Search Input */}
                    <div className="relative flex-1 min-w-[200px] max-w-md">
                        <input
                            type="text"
                            placeholder="Search physical receipt (e.g. CI-1011, DR-2012)..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && fetchDocuments()}
                            className="w-full text-sm border border-slate-300 rounded-lg pl-9 pr-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <Icon icon={ICONS.search} className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    </div>

                    <button
                        onClick={fetchDocuments}
                        disabled={loadingDocs}
                        className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition disabled:opacity-50"
                    >
                        {loadingDocs ? 'Searching...' : 'Filter'}
                    </button>
                </div>

                {/* Batch Action Button */}
                <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
                        {selectedDocIds.size} Selected ({pageCount} A4 Page{pageCount !== 1 ? 's' : ''})
                    </span>

                    <button
                        onClick={handleConsolidate}
                        disabled={selectedDocIds.size === 0 || generatingPdf}
                        className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition disabled:opacity-50 flex items-center gap-2 shadow-sm"
                    >
                        <Icon icon={ICONS.invoice} className="w-4 h-4" />
                        {generatingPdf ? 'Generating 2x2 PDF...' : 'Consolidate 2x2 A4 PDF'}
                    </button>
                </div>
            </div>

            {/* Document Grid / Table */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-slate-700">
                        <thead className="bg-slate-50 text-slate-500 uppercase text-[11px] tracking-wider font-semibold border-b border-slate-200">
                            <tr>
                                <th className="p-4 w-10">
                                    <input
                                        type="checkbox"
                                        checked={documents.length > 0 && selectedDocIds.size === documents.length}
                                        onChange={toggleSelectAll}
                                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                    />
                                </th>
                                <th className="p-4">Paperless ID</th>
                                <th className="p-4">Physical Receipt / Title</th>
                                <th className="p-4">Created Date</th>
                                <th className="p-4">Tags</th>
                                <th className="p-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                            {loadingDocs ? (
                                <tr>
                                    <td colSpan={6} className="text-center p-8 text-slate-500">
                                        Loading receipts from Paperless-ngx...
                                    </td>
                                </tr>
                            ) : documents.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="text-center p-8 text-slate-500">
                                        No receipts found matching filter criteria.
                                    </td>
                                </tr>
                            ) : (
                                documents.map(doc => {
                                    const isSelected = selectedDocIds.has(doc.id);
                                    return (
                                        <tr
                                            key={doc.id}
                                            className={`hover:bg-slate-50/80 transition ${isSelected ? 'bg-blue-50/50' : ''}`}
                                        >
                                            <td className="p-4">
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleSelectDoc(doc.id)}
                                                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                />
                                            </td>
                                            <td className="p-4 font-mono text-xs font-semibold text-slate-900">
                                                #{doc.id}
                                            </td>
                                            <td className="p-4 font-semibold text-slate-900">
                                                {doc.title}
                                            </td>
                                            <td className="p-4 text-xs text-slate-600">
                                                {doc.created ? new Date(doc.created).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: '2-digit' }) : '—'}
                                            </td>
                                            <td className="p-4">
                                                <div className="flex flex-wrap gap-1">
                                                    {(doc.tags || []).map(tId => (
                                                        <span key={tId} className="px-2 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 rounded">
                                                            Tag #{tId}
                                                        </span>
                                                    ))}
                                                </div>
                                            </td>
                                            <td className="p-4 text-right">
                                                <button
                                                    type="button"
                                                    onClick={() => handlePreviewDoc(doc.id)}
                                                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800"
                                                >
                                                    <Icon icon={ICONS.search} className="w-3.5 h-3.5" />
                                                    Preview
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* PDF Preview Modal */}
            <Modal
                isOpen={isPreviewOpen}
                onClose={() => setIsPreviewOpen(false)}
                title="Consolidated 2x2 A4 Receipt Preview"
                maxWidth="max-w-5xl"
            >
                <div className="space-y-4">
                    {pdfBlobUrl ? (
                        <iframe
                            src={pdfBlobUrl}
                            className="w-full h-[70vh] border border-slate-200 rounded-lg shadow-inner"
                            title="2x2 Receipt PDF Preview"
                        />
                    ) : (
                        <div className="p-8 text-center text-slate-500">
                            Generating preview...
                        </div>
                    )}

                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            onClick={() => setIsPreviewOpen(false)}
                            className="px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50"
                        >
                            Close
                        </button>
                        <a
                            href={pdfBlobUrl}
                            download={`Paperless_2x2_Receipts_${Date.now()}.pdf`}
                            className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition flex items-center gap-2"
                        >
                            Download PDF
                        </a>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
