import { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';
import Combobox from '../ui/Combobox';
import { useSettings } from '../../contexts/SettingsContext';
import TagInput from '../ui/TagInput'; // <-- Import TagInput
import ApplicationSearchCombobox from '../applications/ApplicationSearchCombobox';
import PartApplicationManager from '../../pages/PartApplicationManager';

const BrandGroupForm = ({ type, onSave, onCancel, initialName = '' }) => {
    const [name, setName] = useState(initialName || '');
    const [code, setCode] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (initialName) setName(initialName);
    }, [initialName]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const endpoint = type === 'Brand' ? '/brands' : '/groups';
        // Let the server generate the code for both Brand and Group
        const payload = type === 'Brand' ? { brand_name: name } : { group_name: name };
        try {
            setSaving(true);
            const { data } = await api.post(endpoint, payload);
            // If server returned the generated code, show/update it locally
            if (type === 'Brand' && data?.brand_code) setCode(data.brand_code);
            if (type === 'Group' && data?.group_code) setCode(data.group_code);
            // reset the name so next open is fresh
            setName('');
            onSave(data);
        } catch (err) {
            console.error(err);
            toast.error(`Failed to add ${type}.`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{type} Name</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{type} Code (max 10 chars)</label>
                <input type="text" value={code} readOnly className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500" placeholder="Will be generated" />
            </div>
            <div className="mt-6 flex justify-end space-x-4">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">{saving ? 'Saving…' : 'Save'}</button>
            </div>
        </form>
    );
};

const PartForm = ({ part, brands, groups, onSave, onCancel, onBrandGroupAdded, isBulkEdit = false, selectedCount: _selectedCount = 0 }) => {
    const { settings } = useSettings();
    const [tags, setTags] = useState([]); // <-- State for tags
    const [selectedApps, setSelectedApps] = useState([]); // <-- State for linked applications

    // helper to display an application label
    const labelForApp = (app) => [app?.make, app?.model, app?.engine].filter(Boolean).join(' ');

    const [isAppManagerOpen, setIsAppManagerOpen] = useState(false);

    // fetch existing linked applications for the part when editing
    const fetchSelectedApps = useCallback(async () => {
        if (isBulkEdit) { setSelectedApps([]); return; }
        if (!part) { setSelectedApps([]); return; }
        try {
            const res = await api.get(`/parts/${part.part_id}/applications`);
            setSelectedApps(Array.isArray(res.data) ? res.data : []);
        } catch (error) {
            console.error(error);
            toast.error('Could not load part applications.');
        }
    }, [part, isBulkEdit]);

    useEffect(() => { fetchSelectedApps(); }, [fetchSelectedApps]);

    const addApplication = (app) => {
        if (!app || !app.application_id) return;
        setSelectedApps(prev => {
            if (prev.find(a => a.application_id === app.application_id)) return prev;
            return [...prev, app];
        });
    };

    const removeApplication = (id) => setSelectedApps(prev => prev.filter(a => a.application_id !== id));

    const getInitialState = useCallback(() => {
        if (isBulkEdit) {
            return {
                brand_id: '', group_id: '',
                reorder_point: '', warning_quantity: '', last_cost: '', last_sale_price: '', barcode: '', measurement_unit: '', tax_rate_id: '',
                is_active: 'unchanged', is_price_change_allowed: 'unchanged', is_using_default_quantity: 'unchanged',
                is_service: 'unchanged', low_stock_warning: 'unchanged', is_tax_inclusive_price: 'unchanged'
            };
        }
        return {
            detail: '', brand_id: '', group_id: '', part_numbers_string: '',
            reorder_point: 1, warning_quantity: 1, is_active: true,
            last_cost: 0, last_sale_price: 0, barcode: '', measurement_unit: 'pcs', tax_rate_id: '',
            is_price_change_allowed: true, is_using_default_quantity: true,
            is_service: false, low_stock_warning: true, 
            is_tax_inclusive_price: settings?.DEFAULT_IS_TAX_INCLUSIVE !== 'false' // Default to true unless explicitly set to false
        };
    }, [isBulkEdit, settings]);

    const [formData, setFormData] = useState(getInitialState());
    const [taxRates, setTaxRates] = useState([]);
    const [isBrandModalOpen, setIsBrandModalOpen] = useState(false);
    const [initialBrandName, setInitialBrandName] = useState('');
    const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);

    const brandOptions = useMemo(() => brands.map(b => ({ value: b.brand_id, label: b.brand_name, code: b.brand_code })), [brands]);
    const groupOptions = useMemo(() => groups.map(g => ({ value: g.group_id, label: g.group_name, code: g.group_code })), [groups]);
    const [initialGroupName, setInitialGroupName] = useState('');

    useEffect(() => {
        const fetchTaxRates = async () => {
            try {
                const response = await api.get('/tax-rates');
                setTaxRates(response.data);
            } catch (error) {
                console.error(error);
                toast.error("Could not load tax rates.");
            }
        };
        fetchTaxRates();
    }, []);

    useEffect(() => {
        if (isBulkEdit) {
            setFormData(getInitialState());
            return;
        }

        if (part) {
            setFormData({
                detail: part.detail || '',
                brand_id: part.brand_id || '',
                group_id: part.group_id || '',
                part_numbers_string: '',
                reorder_point: part.reorder_point || 0,
                warning_quantity: part.warning_quantity || 0,
                is_active: part.is_active,
                last_cost: part.last_cost || 0,
                last_sale_price: part.last_sale_price || 0,
                barcode: part.barcode || '',
                measurement_unit: part.measurement_unit || 'pcs',
                tax_rate_id: part.tax_rate_id || '',
                is_price_change_allowed: part.is_price_change_allowed,
                is_using_default_quantity: part.is_using_default_quantity,
                is_service: part.is_service,
                low_stock_warning: part.low_stock_warning,
                is_tax_inclusive_price: part.is_tax_inclusive_price,
            });
            // Fetch existing tags for the part being edited
            api.get(`/parts/${part.part_id}/tags`).then(res => {
                setTags(res.data.map(t => t.tag_name));
            }).catch((error) => { console.error(error); toast.error('Could not load part tags.') });

        } else {
            const initialState = getInitialState();
            if (taxRates.length > 0) {
                const defaultRate = taxRates.find(r => r.is_default);
                if (defaultRate) {
                    initialState.tax_rate_id = defaultRate.tax_rate_id;
                }
            }
            setFormData(initialState);
            setTags([]); // Clear tags for new part
        }
    }, [part, isBulkEdit, taxRates, settings, getInitialState]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };
    
    const handleComboboxChange = (name, value) => {
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave({ ...formData, tags, applications: selectedApps }); // include linked applications
    };
    
    const handleNewBrandGroup = (newItem, type) => {
        onBrandGroupAdded();
        if(type === 'Brand') {
            setFormData(prev => ({...prev, brand_id: newItem.brand_id}));
            setIsBrandModalOpen(false);
        } else {
            setFormData(prev => ({...prev, group_id: newItem.group_id}));
            setIsGroupModalOpen(false);
        }
    };

    // BooleanSelect used for bulk edit dropdowns
    function BooleanSelect({ name, label }) {
        return (
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                <select name={name} value={formData[name]} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                    <option value="unchanged">No Change</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                </select>
            </div>
        );
    }

    return (
        <>
            <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto p-1">
                {!part && !isBulkEdit && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Part Numbers (optional)</label>
                        <textarea name="part_numbers_string" value={formData.part_numbers_string} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" rows="2" placeholder="OEM123, MFG456; ALT789"></textarea>
                    </div>
                )}

                <div className="flex items-end space-x-2">
                    <div className="flex-grow">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Brand</label>
                        <Combobox
                            options={brandOptions}
                            value={formData.brand_id}
                            onChange={(value) => handleComboboxChange('brand_id', value)}
                            placeholder={isBulkEdit ? 'No Change' : 'Select a Brand'}
                            allowCreate={true}
                            onCreate={(typedName) => {
                                // open the brand modal and prefill name
                                setInitialBrandName(typedName);
                                setIsBrandModalOpen(true);
                            }}
                        />
                    </div>
                    {/* Read-only lighter brand code display */}
                    <div className="ml-2">
                        <label className="block text-xs text-gray-500 mb-1">Code</label>
                        <input 
                            type="text" 
                            readOnly 
                            tabIndex="-1"
                            value={(brandOptions.find(b => b.value === formData.brand_id)?.code) || ''} 
                            className="px-2 py-1 border border-gray-200 rounded-lg bg-gray-50 text-gray-500 text-sm w-28 pointer-events-none" 
                        />
                    </div>
                </div>

                <div className="flex items-end space-x-2">
                    <div className="flex-grow">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Group</label>
                         <Combobox
                            options={groupOptions}
                            value={formData.group_id}
                            onChange={(value) => handleComboboxChange('group_id', value)}
                            placeholder={isBulkEdit ? 'No Change' : 'Select a Group'}
                            allowCreate={true}
                            onCreate={(typedName) => { setInitialGroupName(typedName); setIsGroupModalOpen(true); }}
                        />
                    </div>
                    {/* Read-only lighter group code display */}
                    <div className="ml-2">
                        <label className="block text-xs text-gray-500 mb-1">Code</label>
                        <input 
                            type="text" 
                            readOnly 
                            tabIndex="-1"
                            value={(groupOptions.find(g => g.value === formData.group_id)?.code) || ''} 
                            className="px-2 py-1 border border-gray-200 rounded-lg bg-gray-50 text-gray-500 text-sm w-28 pointer-events-none" 
                        />
                    </div>
                </div>

                {!isBulkEdit && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Part Detail</label>
                        <input type="text" name="detail" value={formData.detail} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                )}

                {/* --- NEW: Application linker (search + add) --- */}
                {/* Show applications only when editing an existing part (hide for New Part) */}
                {!isBulkEdit && part && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Applications</label>
                        <div className="flex items-center space-x-2">
                            <div className="flex-grow">
                                <ApplicationSearchCombobox value={null} onChange={(app) => addApplication(app)} placeholder="Search make model engine" />
                            </div>
                            {part && (
                                <button type="button" onClick={() => setIsAppManagerOpen(true)} className="px-2 py-1 border rounded text-sm text-gray-700 hover:bg-gray-100">Manage</button>
                            )}
                        </div>
                        <div className="mt-2">
                            <div className="flex flex-wrap items-center gap-2">
                                {selectedApps.slice(0, 6).map(app => (
                                    <div key={app.application_id} className="inline-flex items-center space-x-2 bg-gray-50 border rounded-full px-3 py-1 text-xs">
                                        <span className="truncate max-w-[16rem]">{labelForApp(app)}</span>
                                        <button type="button" onClick={() => removeApplication(app.application_id)} className="text-gray-400 hover:text-red-600 ml-1">{'\u00d7'}</button>
                                    </div>
                                ))}
                                {selectedApps.length > 6 && (
                                    <div className="inline-flex items-center text-xs text-gray-500">+{selectedApps.length - 6} more</div>
                                )}
                                {selectedApps.length === 0 && (
                                    <div className="text-sm text-gray-500">No linked applications</div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {!isBulkEdit && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
                        <TagInput value={tags} onChange={setTags} />
                    </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Last Cost</label>
                        <input
                            type="text"
                            name="last_cost"
                            value={formData.last_cost}
                            onChange={(e) => {
                                const value = e.target.value;
                                // Allow empty string, numbers, and decimal numbers
                                if (value === '' || /^\d*\.?\d*$/.test(value)) {
                                    handleChange(e);
                                }
                            }}
                            onFocus={(e) => e.target.select()}
                            placeholder={isBulkEdit ? 'No Change' : '0.00'}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Last Sale Price</label>
                        <input
                            type="text"
                            name="last_sale_price"
                            value={formData.last_sale_price}
                            onChange={(e) => {
                                const value = e.target.value;
                                // Allow empty string, numbers, and decimal numbers
                                if (value === '' || /^\d*\.?\d*$/.test(value)) {
                                    handleChange(e);
                                }
                            }}
                            onFocus={(e) => e.target.select()}
                            placeholder={isBulkEdit ? 'No Change' : '0.00'}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        />
                    </div>
                </div>

                <div className="pt-4 border-t">
                    <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="text-sm font-medium text-blue-600 hover:text-blue-800">
                        {showAdvanced ? 'Hide Advanced Options' : 'Show Advanced Options'}
                    </button>
                    <div className={`transition-all duration-300 ease-in-out overflow-hidden ${showAdvanced ? 'max-h-[500px] mt-4' : 'max-h-0'}`}>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Barcode</label>
                                    <input type="text" name="barcode" value={formData.barcode} onChange={handleChange} placeholder={isBulkEdit ? 'No Change' : ''} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                                    <input type="text" name="measurement_unit" value={formData.measurement_unit} onChange={handleChange} placeholder={isBulkEdit ? 'No Change' : 'pcs'} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Reorder Point</label>
                                    <input type="number" name="reorder_point" value={formData.reorder_point} onChange={handleChange} placeholder={isBulkEdit ? 'No Change' : '1'} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Warning Qty</label>
                                    <input type="number" name="warning_quantity" value={formData.warning_quantity} onChange={handleChange} placeholder={isBulkEdit ? 'No Change' : '1'} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Tax Rate</label>
                                    <select name="tax_rate_id" value={formData.tax_rate_id} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                                        <option value="">{isBulkEdit ? 'No Change' : 'Select a Tax Rate'}</option>
                                        {taxRates.map(rate => <option key={rate.tax_rate_id} value={rate.tax_rate_id}>{rate.rate_name} ({(rate.rate_percentage * 100).toFixed(2)}%)</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t">
                                {isBulkEdit ? (
                                    <>
                                        <BooleanSelect name="is_active" label="Active" />
                                        <BooleanSelect name="is_service" label="Is Service" />
                                        <BooleanSelect name="low_stock_warning" label="Low Stock Warning" />
                                        <BooleanSelect name="is_price_change_allowed" label="Price Change Allowed" />
                                        <BooleanSelect name="is_using_default_quantity" label="Use Default Qty" />
                                        <BooleanSelect name="is_tax_inclusive_price" label="Price is Tax Inclusive" />
                                    </>
                                ) : (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 col-span-2">
                                        <div className="flex items-center"><input type="checkbox" name="is_active" checked={formData.is_active} onChange={handleChange} className="h-4 w-4" /><label className="ml-2 text-sm">Active</label></div>
                                        <div className="flex items-center"><input type="checkbox" name="is_service" checked={formData.is_service} onChange={handleChange} className="h-4 w-4" /><label className="ml-2 text-sm">Is Service</label></div>
                                        <div className="flex items-center"><input type="checkbox" name="low_stock_warning" checked={formData.low_stock_warning} onChange={handleChange} className="h-4 w-4" /><label className="ml-2 text-sm">Low Stock Warning</label></div>
                                        <div className="flex items-center"><input type="checkbox" name="is_price_change_allowed" checked={formData.is_price_change_allowed} onChange={handleChange} className="h-4 w-4" /><label className="ml-2 text-sm">Price Change Allowed</label></div>
                                        <div className="flex items-center"><input type="checkbox" name="is_using_default_quantity" checked={formData.is_using_default_quantity} onChange={handleChange} className="h-4 w-4" /><label className="ml-2 text-sm">Use Default Qty</label></div>
                                        <div className="flex items-center"><input type="checkbox" name="is_tax_inclusive_price" checked={formData.is_tax_inclusive_price} onChange={handleChange} className="h-4 w-4" /><label className="ml-2 text-sm">Price is Tax Inclusive</label></div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-6 flex justify-end space-x-4 pt-4 border-t">
                    <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancel</button>
                    <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save</button>
                </div>
            </form>
            <Modal isOpen={isBrandModalOpen} onClose={() => { setIsBrandModalOpen(false); setInitialBrandName(''); }} title="Add New Brand">
                <BrandGroupForm type="Brand" onSave={(newBrand) => handleNewBrandGroup(newBrand, 'Brand')} onCancel={() => { setIsBrandModalOpen(false); setInitialBrandName(''); }} initialName={initialBrandName} />
            </Modal>
            <Modal isOpen={isGroupModalOpen} onClose={() => { setIsGroupModalOpen(false); setInitialGroupName(''); }} title="Add New Group">
                <BrandGroupForm type="Group" onSave={(newGroup) => handleNewBrandGroup(newGroup, 'Group')} onCancel={() => { setIsGroupModalOpen(false); setInitialGroupName(''); }} initialName={initialGroupName} />
            </Modal>
            <Modal isOpen={isAppManagerOpen} onClose={() => { setIsAppManagerOpen(false); fetchSelectedApps(); }} title={`Manage Applications for: ${part?.detail || part?.display_name || ''}`}>
                <PartApplicationManager part={part} onCancel={() => { setIsAppManagerOpen(false); fetchSelectedApps(); }} />
            </Modal>
        </>
    );
};

export default PartForm;
