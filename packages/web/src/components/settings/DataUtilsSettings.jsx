/* eslint-disable no-unused-vars */
import { useState, useRef } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import Modal from '../ui/Modal';

const ExportCard = ({ entity, title, fields }) => {
    const handleExport = async () => {
        try {
            const response = await api.get(`/data/export/${entity}`, {
                responseType: 'blob', // Important for file downloads
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
                return res.data.message; // Display the detailed message from the backend
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


const DataUtilsSettings = () => {
    const [isSyncing, setIsSyncing] = useState(false);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [selectedMode, setSelectedMode] = useState('full');

    const handleSync = () => {
        setIsSyncing(true);
        const promise = api.post(`/data/repair-search-index?mode=${selectedMode}`);

        toast.promise(promise, {
            loading: selectedMode === 'dry' ? 'Running dry-run check...' : 'Repairing search index (apply settings + sync parts)...',
            success: (res) => {
                setIsSyncing(false);
                setShowConfirmModal(false);
                return res.data.message || 'Operation completed successfully!';
            },
            error: (err) => {
                setIsSyncing(false);
                setShowConfirmModal(false);
                return err.response?.data?.message || 'Failed to repair search index.';
            }
        });
    };

    const handleConfirm = () => {
        handleSync();
    };

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
                    <p className="text-sm text-gray-600 mb-3">Fix search issues by applying index settings and re-syncing all parts to Meilisearch.</p>
                    <button
                        onClick={() => setShowConfirmModal(true)}
                        disabled={isSyncing}
                        className="bg-purple-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-purple-700 transition disabled:bg-purple-300"
                    >
                        {isSyncing ? 'Processing...' : 'Repair Search Index'}
                    </button>
                </div>
            </div>

            <Modal isOpen={showConfirmModal} onClose={() => setShowConfirmModal(false)} title="Confirm Search Index Repair">
                <div className="space-y-4">
                    <p className="text-sm text-gray-600">
                        This will repair the search index by applying settings and re-syncing parts. Choose the mode:
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
                            <span className="text-sm">Dry-run: Check connectivity and count parts (no changes)</span>
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
                            Cancel
                        </button>
                        <button
                            onClick={handleConfirm}
                            className="px-4 py-2 bg-purple-600 text-white rounded-lg"
                        >
                            {selectedMode === 'dry' ? 'Run Dry-run' : 'Start Repair'}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default DataUtilsSettings;
