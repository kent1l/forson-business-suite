import React from 'react';
import DocumentBrowserV2 from '../components/document-management/DocumentBrowserV2';

const DocumentsPage: React.FC = () => {
    return (
        <div className="h-full">
            <h2 className="text-xl font-semibold mb-4">Documents</h2>
            <div className="h-[calc(100vh-160px)] border rounded bg-white">
                <DocumentBrowserV2 />
            </div>
        </div>
    );
};

export default DocumentsPage;
