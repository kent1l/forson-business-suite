import api from '../api';
import toast from 'react-hot-toast';

export const downloadFile = async (url, filename) => {
    const toastId = toast.loading('Generating Document...');
    try {
        const response = await api.get(url, { responseType: 'blob' });

        const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = blobUrl;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        
        link.parentNode.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
        
        toast.success('Download successful!', { id: toastId });
    } catch (error) {
        console.error('Download error:', error);
        toast.error('Failed to download document.', { id: toastId });
    }
};
