import React from 'react';
import { DocumentMetadata } from './types';
import PreviewComponent from './PreviewComponent';

interface PreviewPaneProps {
    document: DocumentMetadata | null;
    onClose: () => void;
}

export const PreviewPane: React.FC<PreviewPaneProps> = ({ document, onClose }) => {
    return (
        <aside className={`transition-all duration-300 ease-in-out bg-white border-l border-gray-200 overflow-hidden ${document ? 'w-96 p-4' : 'w-0'}`}>
            {document && (
                <div>
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold">Preview</h3>
                        <button onClick={onClose} className="text-sm font-semibold text-blue-600 hover:underline">Close</button>
                    </div>
                    <PreviewComponent documentId={document.id} />
                </div>
            )}
        </aside>
    );
};
