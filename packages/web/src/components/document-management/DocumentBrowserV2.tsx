import React, { useState } from 'react';
import ToolbarV2 from './ToolbarV2';
import { DocumentGrid } from './DocumentGrid';
import { PreviewPane } from './PreviewPane';
import { FilterSidebar } from './FilterSidebar';
import useDocumentSearchV2 from './useDocumentSearchV2';
import CommandPalette from './CommandPalette';
import { DocumentMetadata } from './types';

const DocumentBrowserV2 = () => {
    const [selectedDocument, setSelectedDocument] = useState<DocumentMetadata | null>(null);
    const [isPaletteOpen, setPaletteOpen] = useState(false);
    const [currentView, setCurrentView] = useState<'grid' | 'list'>('grid');
    const [isSidebarOpen, setSidebarOpen] = useState(true);

    const {
        documents,
        loading,
        error,
        hasMore,
        filters,
        applyFilters,
        debouncedSetSearchQuery,
        loadMore
    } = useDocumentSearchV2();

    // Debugger message to see what the component receives from the hook
    console.log('%c[DocumentBrowserV2] Rendering with props from hook:', 'color: orange;', {
        documents,
        loading,
        error,
        hasMore,
    });

    const handleSelectDocument = (doc: DocumentMetadata) => {
        setSelectedDocument(doc);
    };

    const handleClosePreview = () => {
        setSelectedDocument(null);
    };
    
    return (
        <div className="flex h-full bg-gray-50">
            <CommandPalette isOpen={isPaletteOpen} onClose={() => setPaletteOpen(false)} applyFilters={applyFilters} />
            {isSidebarOpen && <FilterSidebar filters={filters} applyFilters={applyFilters} />}
            <div className="flex-1 flex flex-col overflow-hidden">
                <ToolbarV2
                    filters={filters}
                    onSearchChange={(query) => { debouncedSetSearchQuery(query); }}
                    onViewChange={(view) => setCurrentView(view)}
                    currentView={currentView}
                    onFilterToggle={() => setSidebarOpen(s => !s)}
                />
                <main className="flex-1 overflow-y-auto p-4">
                    <DocumentGrid
                        documents={documents}
                        onSelectDoc={handleSelectDocument}
                        loading={loading}
                        hasMore={hasMore}
                        onLoadMore={loadMore}
                        error={error}
                    />
                    {error && <div className="text-red-500 p-4">{error}</div>}
                </main>
            </div>
            {selectedDocument && (
                <PreviewPane document={selectedDocument} onClose={handleClosePreview} />
            )}
        </div>
    );
};

export default DocumentBrowserV2;