import React, { useState } from 'react';
import { FilterSidebar } from './FilterSidebar';
import { DocumentGrid } from './DocumentGrid';
import { PreviewPane } from './PreviewPane';
import { Toolbar } from './Toolbar';
import { useDocumentSearch } from './useDocumentSearch';
import { DocumentMetadata } from './types';

const DocumentBrowser: React.FC = () => {
    const [selectedDoc, setSelectedDoc] = useState<DocumentMetadata | null>(null);

    const {
        documents,
        loading,
        error,
        hasMore,
        filters,
        setFilters,
        loadMore,
    } = useDocumentSearch();

    return (
        <div className="flex h-screen bg-gray-50 font-sans text-gray-800">
            <FilterSidebar filters={filters} setFilters={setFilters} />

            <main className="flex-1 flex flex-col overflow-hidden">
                <Toolbar filters={filters} setFilters={setFilters} />
                <DocumentGrid
                    documents={documents}
                    loading={loading}
                    error={error}
                    hasMore={hasMore}
                    onSelectDoc={setSelectedDoc}
                    onLoadMore={loadMore}
                />
            </main>

            <PreviewPane document={selectedDoc} onClose={() => setSelectedDoc(null)} />
        </div>
    );
};

export default DocumentBrowser;
