import React from 'react';
import DocumentBrowser from '../components/document-management/DocumentBrowser';

const DocumentsPage: React.FC = () => {
    return (
        <div className="h-full">
            <h2 className="text-xl font-semibold mb-4">Documents</h2>
            <div className="h-[calc(100vh-160px)] border rounded bg-white">
                <DocumentBrowser />
            </div>
        </div>
    );
};

export default DocumentsPage;
