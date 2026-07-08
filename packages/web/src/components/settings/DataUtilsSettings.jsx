/* eslint-disable no-unused-vars */
import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import Modal from '../ui/Modal';

const ExportCard = ({ entity, title, fields }) => {
    const handleExport = async () => {
        try {
            const response = await api.get(`/data/export/${entity}`, {
                responseType: 'blob',
            });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `${entity}-export-${format(toZonedTime(new Date(), 'Asia/Manila'), 'yyyy-MM-dd')}.csv`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            toast.success(`${title} data exported successfully!`);
        } catch (error) {
            toast.error(`Failed to export ${title}.`);
            console.error(error);
        }
    };

    const handleDownloadTemplate = () => {
        const csvHeader = fields.join(',');
        const blob = new Blob([csvHeader], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `${entity}-template.csv`);
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    return (
        <div className="p-4 border rounded-lg">
            <h4 className="font-semibold text-gray-800">{title}</h4>
            <div className="flex space-x-2 mt-3">
                <button onClick={handleExport} className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700">Export Data</button>
                <button onClick={handleDownloadTemplate} className="text-sm bg-gray-200 text-gray-800 px-3 py-1.5 rounded-md hover:bg-gray-300">Download Template</button>
            </div>
        </div>
    );
};

const ImportCard = ({ entity, title }) => {
    const [file, setFile] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef(null);

    const handleFileChange = (event) => {
        setFile(event.target.files[0]);
    };

    const handleImport = async () => {
        if (!file) {
            return toast.error('Please select a file to import.');
        }

        const formData = new FormData();
        formData.append('file', file);
        setIsUploading(true);

        const promise = api.post(`/data/import/${entity}`, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });

        toast.promise(promise, {
            loading: `Importing ${title}...`,
            success: (res) => {
                setIsUploading(false);
                setFile(null);
                if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                }
                return res.data.message;
            },
            error: (err) => {
                setIsUploading(false);
                return err.response?.data?.message || `Failed to import ${title}.`;
            },
        });
    };

    return (
        <div className="p-4 border rounded-lg bg-gray-50">
            <h4 className="font-semibold text-gray-800">{title}</h4>
            <div className="mt-3">
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFileChange}
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
            </div>
            <div className="mt-4">
                <button
                    onClick={handleImport}
                    disabled={isUploading || !file}
                    className="w-full bg-green-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-green-700 transition disabled:bg-green-300"
                >
                    {isUploading ? 'Uploading...' : `Import ${title}`}
                </button>
            </div>
        </div>
    );
};

const formatEta = (seconds) => {
    if (seconds == null) return 'Estimating…';
    if (seconds <= 60) return `${seconds}s remaining`;
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60) return `${minutes}m remaining`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m remaining`;
};

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

const DedupeWorkerSettings = () => {
    const [workerStatus, setWorkerStatus] = useState({ enabled: true, pending: 0, processing: 0 });
    const [workerLoading, setWorkerLoading] = useState(false);

    const fetchWorkerStatus = async () => {
        try {
            const res = await api.get('/parts/merge/worker-status');
            setWorkerStatus(res.data);
        } catch (e) {
            console.error('Failed to fetch worker status', e);
        }
    };

    const toggleWorker = async () => {
        try {
            setWorkerLoading(true);
            const res = await api.post('/parts/merge/worker-toggle', { enabled: !workerStatus.enabled });
            setWorkerStatus(prev => ({ ...prev, enabled: res.data.enabled }));
            toast.success(`Background worker ${res.data.enabled ? 'enabled' : 'disabled'}`);
        } catch (e) {
            toast.error('Failed to toggle background worker');
        } finally {
            setWorkerLoading(false);
        }
    };

    useEffect(() => {
        fetchWorkerStatus();
        const interval = setInterval(fetchWorkerStatus, 10000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div>
            <h3 className="text-lg font-medium text-gray-900">Background AI Deduplication Scan</h3>
            <div className="p-4 border rounded-lg mt-4 flex justify-between items-center bg-gray-50">
                <div>
                    <h4 className="font-semibold text-gray-900 flex items-center gap-2">
                        🤖 AI Exclusion Worker
                    </h4>
                    <p className="text-sm text-gray-500 mt-1">
                        Continuously scans for potential duplicates and uses AI to discard false positives. 
                        <span className="ml-2 px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded-full text-xs font-medium">Pending: {workerStatus.pending}</span>
                        <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">Processing: {workerStatus.processing}</span>
                    </p>
                </div>
                <div className="flex items-center">
                    <label className="flex items-center cursor-pointer">
                        <div className="relative">
                            <input 
                                type="checkbox" 
                                className="sr-only" 
                                checked={workerStatus.enabled}
                                onChange={toggleWorker}
                                disabled={workerLoading}
                            />
                            <div className={`block w-14 h-8 rounded-full ${workerStatus.enabled ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                            <div className={`dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition ${workerStatus.enabled ? 'transform translate-x-6' : ''}`}></div>
                        </div>
                        <div className="ml-3 text-sm font-medium text-gray-700">
                            {workerStatus.enabled ? 'Active' : 'Paused'}
                        </div>
                    </label>
                </div>
            </div>
        </div>
    );
};

const DataUtilsSettings = () => {
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [showProgressModal, setShowProgressModal] = useState(false);
    const [selectedMode, setSelectedMode] = useState('full');
    const [activeJobId, setActiveJobId] = useState(null);
    const [jobStatus, setJobStatus] = useState(null);
    const [isCancelling, setIsCancelling] = useState(false);

    const isSyncing = useMemo(() => {
        if (!jobStatus) return false;
        return ['pending', 'processing', 'cancelling'].includes(jobStatus.status);
    }, [jobStatus]);

    useEffect(() => {
        if (!activeJobId) return undefined;

        let mounted = true;
        let timer;

        const poll = async () => {
            try {
                const res = await api.get(`/data/repair-search-index/${activeJobId}`);
                if (!mounted) return;
                setJobStatus(res.data);

                if (TERMINAL_STATUSES.includes(res.data.status)) {
                    if (res.data.status === 'completed') {
                        toast.success('Search repair completed successfully.');
                    } else if (res.data.status === 'failed') {
                        toast.error(res.data.error || 'Search repair failed.');
                    } else if (res.data.status === 'cancelled') {
                        toast('Search repair cancelled.');
                    }
                    return;
                }
            } catch (err) {
                if (!mounted) return;
                toast.error(err.response?.data?.message || 'Failed to load repair progress.');
            }

            timer = setTimeout(poll, 3000);
        };

        poll();

        return () => {
            mounted = false;
            if (timer) clearTimeout(timer);
        };
    }, [activeJobId]);

    const handleStartRepair = async () => {
        try {
            const res = await api.post(`/data/repair-search-index?mode=${selectedMode}`);
            setShowConfirmModal(false);
            setActiveJobId(res.data.job_id);
            setShowProgressModal(true);
            toast.success(`Repair job #${res.data.job_id} queued.`);
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to enqueue repair job.');
        }
    };

    const handleCancelJob = async () => {
        if (!activeJobId) return;
        try {
            setIsCancelling(true);
            const res = await api.post(`/data/repair-search-index/${activeJobId}/cancel`);
            toast.success(res.data.message || 'Cancellation requested.');
            const statusRes = await api.get(`/data/repair-search-index/${activeJobId}`);
            setJobStatus(statusRes.data);
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to cancel repair job.');
        } finally {
            setIsCancelling(false);
        }
    };

    const progressPct = jobStatus?.progress_pct || 0;
    const canRetry = TERMINAL_STATUSES.includes(jobStatus?.status) && jobStatus?.status !== 'processing';

    return (
        <div className="space-y-8">
            <div>
                <h3 className="text-lg font-medium text-gray-900">Export Data</h3>
                <p className="text-sm text-gray-500 mt-1">Download your existing data as a CSV file or get a blank template for importing.</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                    <ExportCard entity="parts" title="Parts" fields={['internal_sku', 'detail', 'brand_name', 'group_name', 'part_numbers', 'barcode', 'is_active', 'last_cost', 'last_sale_price', 'reorder_point', 'warning_quantity', 'measurement_unit', 'is_tax_inclusive_price', 'is_price_change_allowed', 'is_using_default_quantity', 'is_service', 'low_stock_warning']} />
                    <ExportCard entity="customers" title="Customers" fields={['first_name', 'last_name', 'company_name', 'phone', 'email', 'address', 'is_active']} />
                    <ExportCard entity="suppliers" title="Suppliers" fields={['supplier_name', 'contact_person', 'phone', 'email', 'address', 'is_active']} />
                </div>
            </div>

            <div>
                <h3 className="text-lg font-medium text-gray-900">Import Data</h3>
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800 mt-2">
                    <strong>Warning:</strong> Importing a file will update existing records that match the unique key (e.g., SKU, Email) and create new records for those that don't. Please use the templates provided.
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                    <ImportCard entity="parts" title="Parts" />
                    <ImportCard entity="customers" title="Customers" />
                    <ImportCard entity="suppliers" title="Suppliers" />
                </div>
            </div>

            <div>
                <h3 className="text-lg font-medium text-gray-900">Search Index</h3>
                <div className="p-4 border rounded-lg mt-4">
                    <p className="text-sm text-gray-600 mb-3">Repair search index via background jobs with live progress tracking and cancellation.</p>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setShowConfirmModal(true)}
                            disabled={isSyncing}
                            className="bg-purple-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-purple-700 transition disabled:bg-purple-300"
                        >
                            {isSyncing ? 'Processing...' : 'Repair Search Index'}
                        </button>
                        {activeJobId && (
                            <button
                                onClick={() => setShowProgressModal(true)}
                                className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg font-semibold hover:bg-gray-300"
                            >
                                View Progress
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <DedupeWorkerSettings />

            <Modal isOpen={showConfirmModal} onClose={() => setShowConfirmModal(false)} title="Confirm Search Index Repair">
                <div className="space-y-4">
                    <p className="text-sm text-gray-600">
                        This runs a background repair job. You can monitor progress and cancel it at any time.
                    </p>
                    <div className="space-y-2">
                        <label className="flex items-center">
                            <input
                                type="radio"
                                value="dry"
                                checked={selectedMode === 'dry'}
                                onChange={(e) => setSelectedMode(e.target.value)}
                                className="mr-2"
                            />
                            <span className="text-sm">Dry-run: Check connectivity and counts only</span>
                        </label>
                        <label className="flex items-center">
                            <input
                                type="radio"
                                value="full"
                                checked={selectedMode === 'full'}
                                onChange={(e) => setSelectedMode(e.target.value)}
                                className="mr-2"
                            />
                            <span className="text-sm">Full repair: Apply settings and reindex all parts</span>
                        </label>
                    </div>
                    <div className="flex justify-end space-x-4 mt-6">
                        <button
                            onClick={() => setShowConfirmModal(false)}
                            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg"
                        >
                            Close
                        </button>
                        <button
                            onClick={handleStartRepair}
                            className="px-4 py-2 bg-purple-600 text-white rounded-lg"
                        >
                            {selectedMode === 'dry' ? 'Queue Dry-run' : 'Queue Repair'}
                        </button>
                    </div>
                </div>
            </Modal>

            <Modal
                isOpen={showProgressModal}
                onClose={() => setShowProgressModal(false)}
                title={`Search Repair Progress${activeJobId ? ` #${activeJobId}` : ''}`}
                maxWidth="max-w-xl"
            >
                {!jobStatus && <p className="text-sm text-gray-600">Waiting for status...</p>}
                {jobStatus && (
                    <div className="space-y-4">
                        <div>
                            <div className="flex justify-between text-sm text-gray-600 mb-1">
                                <span>Status: <strong className="capitalize">{jobStatus.status}</strong></span>
                                <span>{progressPct}%</span>
                            </div>
                            <div className="w-full h-2 bg-gray-200 rounded">
                                <div className="h-2 bg-purple-600 rounded" style={{ width: `${Math.min(100, progressPct)}%` }} />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                            <p>Total: <strong>{jobStatus.total}</strong></p>
                            <p>Processed: <strong>{jobStatus.processed}</strong></p>
                            <p>Success: <strong>{jobStatus.success}</strong></p>
                            <p>Failed: <strong>{jobStatus.failed}</strong></p>
                        </div>
                        <p className="text-sm text-gray-600">ETA: {formatEta(jobStatus.estimated_remaining_seconds)}</p>
                        {jobStatus.error && <p className="text-sm text-red-600">{jobStatus.error}</p>}
                        <div className="flex justify-end gap-2">
                            {isSyncing && (
                                <button
                                    onClick={handleCancelJob}
                                    disabled={isCancelling}
                                    className="px-3 py-2 bg-red-600 text-white rounded-lg disabled:bg-red-300"
                                >
                                    {isCancelling ? 'Cancelling...' : 'Cancel Job'}
                                </button>
                            )}
                            {canRetry && (
                                <button
                                    onClick={() => {
                                        setShowProgressModal(false);
                                        setShowConfirmModal(true);
                                    }}
                                    className="px-3 py-2 bg-purple-600 text-white rounded-lg"
                                >
                                    Retry Repair
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default DataUtilsSettings;
