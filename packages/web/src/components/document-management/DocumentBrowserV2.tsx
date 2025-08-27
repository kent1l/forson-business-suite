import React, { useState, useEffect } from 'react';
import { DocumentGrid } from './DocumentGrid';
import DocumentListItem from './DocumentListItem';
import { PreviewPane } from './PreviewPane';
import ToolbarV2 from './ToolbarV2';
import { FilterSidebar } from './FilterSidebar';
import useDocumentSearchV2 from './useDocumentSearchV2';
import CommandPalette from './CommandPalette';
import { DocumentMetadata } from './types';

const DocumentBrowserV2: React.FC = () => {
    const [selectedDoc, setSelectedDoc] = useState<DocumentMetadata | null>(null);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

    const {
        documents,
        loading,
        error,
        hasMore,
        filters,
        applyFilters,
        debouncedSetSearchQuery,
        loadMore,
    } = useDocumentSearchV2();

    const handleSetFilters = (newFilters: any) => {
        applyFilters(newFilters);
    };

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const key = event.key.toLowerCase();
            if ((event.metaKey || event.ctrlKey) && key === 'k') {
                event.preventDefault();
                setIsCommandPaletteOpen(true);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    return (
        <div className="flex h-screen bg-gray-50 font-sans text-gray-800 overflow-hidden">
            {/* Filter Panel */}
            {isFilterOpen && <FilterSidebar filters={filters} setFilters={handleSetFilters} />}

            <main className="flex-1 flex flex-col">
                <ToolbarV2
                    filters={filters}
                    onSearchChange={debouncedSetSearchQuery}
                    onViewChange={setViewMode}
                    currentView={viewMode}
                    onFilterToggle={() => setIsFilterOpen(!isFilterOpen)}
                />

                {viewMode === 'grid' ? (
                    <DocumentGrid
                        documents={documents}
                        loading={loading}
                        error={error}
                        hasMore={hasMore}
                        onSelectDoc={setSelectedDoc}
                        onLoadMore={loadMore}
                    />
                ) : (
                    <div className="flex-1 p-4 overflow-y-auto">
                        <div className="space-y-1">
                            {documents.map(doc => (
                                <DocumentListItem key={doc.id} doc={doc} onSelect={() => setSelectedDoc(doc)} />
                            ))}
                        </div>
                         {loading && <div className="text-center py-4">Loading...</div>}
                         {!loading && !hasMore && <div className="text-center py-4 text-gray-500">End of results.</div>}
                    </div>
                )}
            </main>

            {/* Preview Pane */}
            <PreviewPane document={selectedDoc} onClose={() => setSelectedDoc(null)} />
            <CommandPalette
                isOpen={isCommandPaletteOpen}
                onClose={() => setIsCommandPaletteOpen(false)}
                applyFilters={applyFilters}
            />
        </div>
    );
};

export default DocumentBrowserV2;
