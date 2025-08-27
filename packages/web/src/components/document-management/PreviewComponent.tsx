import React, { useEffect, useState } from 'react';
import api from '../../api';

const PreviewComponent: React.FC<{ documentId: string }> = ({ documentId }) => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [html, setHtml] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true); setError(null);
            try {
                const res = await api.get(`/documents/${documentId}/preview`);
                if (cancelled) return;
                setHtml(res.data.html || '<div>No preview available</div>');
            } catch (err: any) {
                setError(err?.message || 'Failed to load preview');
            } finally {
                setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, [documentId]);

    if (loading) return <div>Loading preview...</div>;
    if (error) return <div className="text-red-500">{error}</div>;
    return <div dangerouslySetInnerHTML={{ __html: html || '' }} />;
};

export default PreviewComponent;
