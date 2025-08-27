import React, { useRef, useEffect } from 'react';
import { DocumentMetadata, DocumentStatus } from './types';
import { IconFile, IconDownload, IconShare } from './Icons';

const DocumentCard: React.FC<{ doc: DocumentMetadata, onSelect: () => void }> = ({ doc, onSelect }) => {
    const statusColors: Record<DocumentStatus, string> = {
        Draft: 'bg-gray-200 text-gray-800',
        Final: 'bg-green-100 text-green-800',
        Cancelled: 'bg-red-100 text-red-800',
        Archived: 'bg-indigo-100 text-indigo-800',
    };

    return (
        <div onClick={onSelect} className="bg-white border rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-pointer p-4 space-y-3">
            <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                    <IconFile className="h-6 w-6 text-blue-500" />
                    <div>
                        <p className="font-semibold text-gray-900">{doc.referenceId}</p>
                        <p className="text-xs text-gray-500">{doc.type}</p>
                    </div>
                </div>
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[doc.status]}`}>{doc.status}</span>
            </div>
            <p className="text-sm text-gray-600">
                {new Date(doc.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
             <div className="flex items-center justify-end space-x-2 pt-2 border-t -mx-4 px-4">
                <button className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full"><IconShare className="h-5 w-5"/></button>
                <button className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full"><IconDownload className="h-5 w-5"/></button>
            </div>
        </div>
    );
};

export const DocumentGrid: React.FC<{ documents: DocumentMetadata[]; loading: boolean; error: string | null; hasMore: boolean; onSelectDoc: (d: DocumentMetadata) => void; onLoadMore: () => void }> = ({ documents, loading, error, hasMore, onSelectDoc, onLoadMore }) => {
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = container;
            if (scrollHeight - scrollTop - clientHeight < 200 && !loading && hasMore) {
                onLoadMore();
            }
        };
        container.addEventListener('scroll', handleScroll);
        return () => container.removeEventListener('scroll', handleScroll);
    }, [loading, hasMore, onLoadMore]);

    return (
        <div ref={scrollContainerRef} className="flex-1 p-4 overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {documents.map(doc => <DocumentCard key={doc.id} doc={doc} onSelect={() => onSelectDoc(doc)} />)}
            </div>
            {loading && <div className="text-center py-4">Loading more documents...</div>}
            {!loading && !hasMore && documents.length > 0 && <div className="text-center py-4 text-gray-500">End of documents.</div>}
            {error && <div className="text-center py-4 text-red-500">{error}</div>}
        </div>
    );
};
