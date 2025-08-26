import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../api';
import PreviewComponent from './PreviewComponent';
import { parsePaymentTermsDays } from '../../utils/terms';

// Design system components (assumed available)
// Lightweight local UI primitives to avoid external design-system dependency in dev
const Button: React.FC<any> = ({ children, className = '', ...props }) => (
    <button {...props} className={`px-3 py-1 rounded bg-blue-600 text-white text-sm ${className}`}>{children}</button>
);

const Select: React.FC<any> = ({ options = [], value, onChange, className = '' }) => (
    <select value={value} onChange={(e) => onChange && onChange(e.target.value)} className={`border rounded px-2 py-1 ${className}`}>
        {options.map((o:any) => (<option key={String(o.value)} value={o.value}>{o.label}</option>))}
    </select>
);

const Input: React.FC<any> = (props) => (
    // pass through props; className can be provided
    <input {...props} className={`border rounded px-2 py-1 ${props.className || ''}`} />
);

const Spinner: React.FC<any> = () => (
    <div className="inline-block text-sm text-gray-500">Loading...</div>
);

const Card: React.FC<any> = ({ children, className = '', ...props }) => (
    <div {...props} className={`shadow-sm border rounded bg-white ${className}`}>
        {children}
    </div>
);

type DocumentType = 'GRN' | 'Sales' | 'Invoice' | 'PurchaseOrders';
type DocumentStatus = 'Draft' | 'Final' | 'Cancelled' | 'Archived';

export interface DocumentMetadata {
    id: string;
    date: string; // ISO
    type: DocumentType;
    referenceId: string;
    status: DocumentStatus;
    iconPath?: string;
    metadata?: Record<string, any>;
}

interface DocumentInterfaceProps {
    viewMode?: 'grid' | 'list';
    documentTypes?: DocumentType[];
    dateRangePresets?: number[]; // days
    itemsPerPageOptions?: number[];
}

// Simple projectCache wrapper
const projectCache = {
    get(key: string) { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; } },
    set(key: string, val: any) { try { sessionStorage.setItem(key, JSON.stringify(val)); } catch {} }
};

const DEFAULT_ITEMS = 25;

const DocumentInterface: React.FC<DocumentInterfaceProps> = ({
    viewMode = 'grid',
    documentTypes = ['GRN','Sales','Invoice','PurchaseOrders'],
    dateRangePresets = [7,30,90],
    itemsPerPageOptions = [25,50,100]
}) => {
    const [filtersOpen, setFiltersOpen] = useState(true);
    const [typeFilter, setTypeFilter] = useState<DocumentType | 'All'>('All');
    const [dateRange, setDateRange] = useState<number | 'custom' | null>(dateRangePresets[1]);
    const [customRange, setCustomRange] = useState<{from?: string,to?: string}>({});
    const [search, setSearch] = useState('');
    const [sortBy, setSortBy] = useState<{field: string, dir: 'asc'|'desc'}>({field:'date', dir:'desc'});
    const [itemsPerPage, setItemsPerPage] = useState(DEFAULT_ITEMS);

    const [docs, setDocs] = useState<DocumentMetadata[]>([]);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(true);
    const [selected, setSelected] = useState<DocumentMetadata | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    const cacheKey = useMemo(() => `documents:${typeFilter}:${dateRange}:${search}:${sortBy.field}:${sortBy.dir}:${itemsPerPage}:${page}`,
        [typeFilter,dateRange,search,sortBy,itemsPerPage,page]);

    useEffect(() => {
        const cached = projectCache.get(cacheKey);
        if (cached) {
            setDocs(cached.docs);
            setHasMore(cached.hasMore);
            return;
        }

        let cancelled = false;
        async function load() {
            setLoading(true); setError(null);
            try {
                const params: any = { page, limit: itemsPerPage, sort_by: sortBy.field, sort_dir: sortBy.dir };
                if (typeFilter !== 'All') params.type = typeFilter;
                if (dateRange && dateRange !== 'custom') params.last_days = dateRange;
                if (dateRange === 'custom' && customRange.from && customRange.to) {
                    params.from = customRange.from; params.to = customRange.to;
                }
                if (search) params.q = search;

                const res = await api.get('/documents', { params });
                if (cancelled) return;
                const fetched: DocumentMetadata[] = res.data.documents || [];
                const total = res.data.total || null;
                setDocs(existing => page === 1 ? fetched : [...existing, ...fetched]);
                const existingCount = existingDocsCount();
                const newHasMore = fetched.length === itemsPerPage && (total === null || (existingCount + fetched.length) < total);
                setHasMore(newHasMore);
                projectCache.set(cacheKey, { docs: page === 1 ? fetched : [...(projectCache.get(cacheKey)?.docs || []), ...fetched], hasMore: newHasMore });
            } catch (err: any) {
                setError(err?.message || 'Failed to load documents');
            } finally {
                setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, [cacheKey]);

    function prevCount(prev: DocumentMetadata[]) { return prev?.length || 0; }
    function existingDocsCount() { return docs?.length || 0; }

    // Lazy load on scroll bottom
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const onScroll = () => {
            if (loading || !hasMore) return;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 150) {
                setPage(p => p + 1);
            }
        };
        el.addEventListener('scroll', onScroll);
        return () => el.removeEventListener('scroll', onScroll);
    }, [loading, hasMore]);

    // Actions
    const handleView = (doc: DocumentMetadata) => setSelected(doc);
    const handleDownload = async (doc: DocumentMetadata) => {
        const res = await api.get(`/documents/${doc.id}/download`, { responseType: 'blob' });
        const url = window.URL.createObjectURL(res.data);
        const a = document.createElement('a'); a.href = url; a.download = `${doc.referenceId}.pdf`; a.click();
        window.URL.revokeObjectURL(url);
    };
    const handleShare = async (doc: DocumentMetadata) => {
        const res = await api.post(`/documents/${doc.id}/share`, { ttl_minutes: 60 });
        const { url } = res.data;
        navigator.clipboard.writeText(url);
        alert('Share URL copied to clipboard');
    };

    // keyboard navigation
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setSelected(null);
            if (e.key === 'Enter' && document.activeElement && document.activeElement instanceof HTMLElement) {
                const id = document.activeElement.getAttribute('data-doc-id');
                if (id) {
                    const d = docs.find(x => x.id === id);
                    if (d) handleView(d);
                }
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [docs]);

    // render
    return (
        <div className="flex h-full overflow-hidden">
            {/* Left filters */}
            <aside style={{ width: filtersOpen ? 250 : 48 }} className="border-r p-3 transition-width">
                <div className="flex items-center justify-between">
                    <h3 className="font-semibold">Filters</h3>
                    <Button onClick={() => setFiltersOpen(v => !v)} aria-label="Toggle filters">{filtersOpen ? '<' : '>'}</Button>
                </div>
                {filtersOpen && (
                    <div className="mt-4 space-y-3">
                        <label className="block text-sm">Type</label>
                        <Select value={typeFilter} onChange={(v:any)=>setTypeFilter(v)} options={[{label:'All',value:'All'},...documentTypes.map(t=>({label:t,value:t}))]} />

                        <label className="block text-sm">Date Range</label>
                        <Select value={String(dateRange)} onChange={(v:any)=>setDateRange(v==='custom'?'custom':Number(v))} options={[...dateRangePresets.map(d=>({label:`Last ${d} days`, value:String(d)})), {label:'Custom', value:'custom'}]} />
                        {dateRange === 'custom' && (
                            <div>
                                <Input type="date" value={customRange.from||''} onChange={e=>setCustomRange(c=>({...c,from:e.target.value}))} />
                                <Input type="date" value={customRange.to||''} onChange={e=>setCustomRange(c=>({...c,to:e.target.value}))} />
                            </div>
                        )}

                        <label className="block text-sm">Search</label>
                        <Input placeholder="number, ref, metadata..." value={search} onChange={e=>{setSearch(e.target.value); setPage(1);}} />

                        <label className="block text-sm">Items per page</label>
                        <Select value={String(itemsPerPage)} onChange={(v:any)=>{setItemsPerPage(Number(v)); setPage(1);}} options={itemsPerPageOptions.map(n=>({label:String(n), value:String(n)}))} />
                    </div>
                )}
            </aside>

            {/* Center list */}
            <main className="flex-1 p-4 overflow-auto" ref={containerRef}>
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-2">
                        <Select value={sortBy.field} onChange={(f:any)=>setSortBy(s=>({...s, field:f}))} options={[{label:'Date',value:'date'},{label:'Type',value:'type'},{label:'Reference',value:'referenceId'}]} />
                        <Select value={sortBy.dir} onChange={(d:any)=>setSortBy(s=>({...s,dir:d}))} options={[{label:'Desc',value:'desc'},{label:'Asc',value:'asc'}]} />
                    </div>
                    <div>{loading && <Spinner />}{error && <span className="text-red-500">{error}</span>}</div>
                </div>

                <div className={viewMode === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4' : ''}>
                    {docs.map(doc => (
                        <Card key={doc.id} className="p-3" tabIndex={0} data-doc-id={doc.id} onClick={()=>handleView(doc)}>
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="font-semibold">{doc.referenceId}</div>
                                    <div className="text-sm text-gray-500">{new Date(doc.date).toLocaleString()} • {doc.type}</div>
                                </div>
                                <div className="space-x-2">
                                    <Button onClick={(e:any)=>{ e.stopPropagation(); handleDownload(doc); }}>Download</Button>
                                    <Button onClick={(e:any)=>{ e.stopPropagation(); handleShare(doc); }}>Share</Button>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>

                <div className="mt-4 flex justify-center">
                    {loading ? <Spinner /> : hasMore ? <Button onClick={()=>setPage(p=>p+1)}>Load more</Button> : <span className="text-sm text-gray-500">No more documents</span>}
                </div>
            </main>

            {/* Right preview */}
            <aside style={{ width: selected ? 400 : 0 }} className="border-l p-3 transition-width overflow-auto">
                {selected ? (
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <h4 className="font-semibold">Preview</h4>
                            <Button onClick={()=>setSelected(null)}>Close</Button>
                        </div>
                        <PreviewComponent documentId={selected.id} />
                    </div>
                ) : (
                    <div className="text-gray-500">Select a document to preview</div>
                )}
            </aside>
        </div>
    );
};

export default DocumentInterface;
