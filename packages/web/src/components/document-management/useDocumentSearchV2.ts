import { useState, useEffect, useMemo } from 'react';
import api from '../../api'; // Assuming your api instance is correctly configured
import { DocumentMetadata, DocumentSearchFilters } from './types';

// A simple debounce utility
const debounce = <F extends (...args: any[]) => any>(func: F, waitFor: number) => {
    let timeout: ReturnType<typeof setTimeout>;
    return (...args: Parameters<F>): Promise<ReturnType<F>> =>
        new Promise(resolve => {
            if (timeout) {
                clearTimeout(timeout);
            }
            timeout = setTimeout(() => resolve(func(...args)), waitFor);
        });
};

export const useDocumentSearchV2 = () => {
    const [filters, setFilters] = useState<DocumentSearchFilters>({
        type: 'All',
        searchQuery: '',
        sortBy: 'date',
        sortDir: 'desc',
        page: 1,
        limit: 50,
    });
    const [documents, setDocuments] = useState<DocumentMetadata[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(true);

    const debouncedSetSearchQuery = useMemo(
        () => debounce((query: string) => {
            setFilters(f => ({ ...f, searchQuery: query, page: 1 }));
        }, 300),
        []
    );

    useEffect(() => {
        const loadDocuments = async () => {
            setLoading(true);
            setError(null);
            try {
                const params: any = {
                    page: filters.page,
                    limit: filters.limit,
                    sort_by: filters.sortBy,
                    sort_dir: filters.sortDir,
                    ...(filters.type !== 'All' && { type: filters.type }),
                    ...(filters.searchQuery && { q: filters.searchQuery }),
                };

                const { data } = await api.get('/documents', { params });
                const fetchedDocs = data.documents || [];
                const isNewSearch = filters.page === 1;

                setDocuments(prevDocs => isNewSearch ? fetchedDocs : [...prevDocs, ...fetchedDocs]);
                setHasMore(fetchedDocs.length === filters.limit);

            } catch (err) {
                setError('Failed to load documents.');
            } finally {
                setLoading(false);
            }
        };

        loadDocuments();
    }, [filters.page, filters.sortBy, filters.sortDir, filters.type, filters.searchQuery]);

    const loadMore = () => {
        if (!loading && hasMore) {
            setFilters(f => ({ ...f, page: f.page + 1 }));
        }
    };

    const applyFilters = (newFilters: Partial<DocumentSearchFilters>) => {
        setFilters(f => ({ ...f, ...newFilters, page: 1 }));
    };

    return { documents, loading, error, hasMore, filters, applyFilters, debouncedSetSearchQuery, loadMore };
};

export default useDocumentSearchV2;
