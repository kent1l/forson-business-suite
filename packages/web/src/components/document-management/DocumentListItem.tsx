import React from 'react';
import { DocumentMetadata, DocumentStatus } from './types';
import { IconFile } from './Icons';

export const DocumentListItem: React.FC<{ doc: DocumentMetadata, onSelect: () => void }> = ({ doc, onSelect }) => {
    const statusColors: Record<DocumentStatus, string> = {
        Draft: 'bg-gray-200 text-gray-800',
        Final: 'bg-green-100 text-green-800',
        Cancelled: 'bg-red-100 text-red-800',
        Archived: 'bg-indigo-100 text-indigo-800',
    };

    return (
        <div onClick={onSelect} className="flex items-center p-2 rounded-md hover:bg-gray-100 cursor-pointer w-full text-left">
            <div className="flex-shrink-0 mr-3">
                <IconFile className="h-6 w-6 text-gray-400" />
            </div>
            <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">{doc.referenceId}</p>
            </div>
            <div className="w-40 px-2 text-sm text-gray-500">{doc.type}</div>
            <div className="w-28 px-2">
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[doc.status]}`}>{doc.status}</span>
            </div>
            <div className="w-48 px-2 text-sm text-gray-500 text-right">
                {new Date(doc.date).toLocaleDateString()}
            </div>
        </div>
    );
};

export default DocumentListItem;
