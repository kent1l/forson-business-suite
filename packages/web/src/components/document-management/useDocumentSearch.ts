import { useState, useEffect, useMemo } from 'react';
import api from '../../api';
import { DocumentMetadata, DocumentSearchFilters } from './types';

const projectCache = {
    get: (key: string) => { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; } },
    set: (key: string, val: any) => { try { sessionStorage.setItem(key, JSON.stringify(val)); } catch {} }
};

export const useDocumentSearch = () => {
    const [filters, setFilters] = useState<DocumentSearchFilters>({
        type: 'All',
    datePreset: 30,
    from: undefined,
    to: undefined,
        searchQuery: '',
        sortBy: 'date',
        sortDir: 'desc',
        page: 1,
        limit: 25,
    });
    const [documents, setDocuments] = useState<DocumentMetadata[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(true);

    // cache key excludes page so cached pages can be appended
    const cacheKey = useMemo(() => `docs:${JSON.stringify({ ...filters, page: undefined })}`, [filters]);

    // debounce for searchQuery changes
    useEffect(() => {
        const handler = setTimeout(() => {
            // nothing here — the main effect below reads filters.searchQuery and will run when it changes after debounce
            setFilters(f => ({ ...f, page: 1 }));
        }, 300);

        return () => clearTimeout(handler);
    }, [filters.searchQuery]);

    useEffect(() => {
        const cached = projectCache.get(cacheKey);
        if (cached && filters.page > 1) { // Only use cache to append later pages
            setDocuments(prev => [...prev, ...cached.documents]);
            setHasMore(cached.hasMore);
            return;
        }

        const loadDocuments = async () => {
            setLoading(true);
            setError(null);
            try {
                const params: any = {
                    page: filters.page,
                    limit: filters.limit,
                    sort_by: filters.sortBy,
                    sort_dir: filters.sortDir,
                };
                if (filters.type !== 'All') params.type = filters.type;
                if (filters.searchQuery) params.q = filters.searchQuery;
                if (filters.datePreset === 'custom' && filters.from && filters.to) {
                    params.from = filters.from;
                    params.to = filters.to;
                } else if (filters.datePreset !== 'custom') {
                    params.last_days = filters.datePreset;
                }
                
                const { data } = await api.get('/documents', { params });
                
                const fetchedDocs = data.documents || [];
                const isNewSearch = filters.page === 1;

                setDocuments(prevDocs => isNewSearch ? fetchedDocs : [...prevDocs, ...fetchedDocs]);
                setHasMore(fetchedDocs.length === filters.limit);
                
                projectCache.set(cacheKey, {
                    documents: fetchedDocs,
                    hasMore: fetchedDocs.length === filters.limit
                });

            } catch (err: any) {
                setError('Failed to load documents.');
            } finally {
                setLoading(false);
            }
        };

        loadDocuments();

    }, [filters.page, filters.sortBy, filters.sortDir, filters.type, filters.datePreset, filters.from, filters.to, cacheKey]);
    
    const loadMore = () => {
        if (!loading && hasMore) {
            setFilters(f => ({ ...f, page: f.page + 1 }));
        }
    };

    return { documents, loading, error, hasMore, filters, setFilters, loadMore };
};
