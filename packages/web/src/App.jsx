import React, { useState, useEffect } from 'react';
import axios from 'axios';

// --- SVG ICONS (self-contained for portability) ---
const Icon = ({ path, className = "h-6 w-6" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d={path} />
  </svg>
);

const ICONS = {
  user: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  password: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z",
  dashboard: "M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z",
  suppliers: "M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10l2-2h8a1 1 0 001-1z",
  parts: "M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4",
  receipt: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  logout: "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1",
  menu: "M4 6h16M4 12h16M4 18h16",
  box: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
  warning: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
  truck: "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M9 11a1 1 0 100-2 1 1 0 000 2z",
  edit: "M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.536l12.232-12.232z",
  trash: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
  close: "M6 18L18 6M6 6l12 12",
  search: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
};

// --- REUSABLE MODAL COMPONENT ---
const Modal = ({ isOpen, onClose, title, children }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-40 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
                <div className="p-4 border-b flex justify-between items-center">
                    <h2 className="text-lg font-semibold">{title}</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800"><Icon path={ICONS.close} /></button>
                </div>
                <div className="p-6">{children}</div>
            </div>
        </div>
    );
};


// --- PAGE COMPONENTS ---

const DashboardCard = ({ title, value, icon, color }) => (
    <div className="bg-white p-6 rounded-lg border border-gray-200 flex items-center space-x-4 transition-all hover:shadow-md hover:-translate-y-1">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${color.bg}`}>
            <Icon path={icon} className={`h-6 w-6 ${color.text}`} />
        </div>
        <div>
            <h3 className="text-sm font-medium text-gray-500">{title}</h3>
            <p className="text-2xl font-bold text-gray-800 mt-1">{value}</p>
        </div>
    </div>
);

const Dashboard = () => {
    const stats = {
        totalParts: 1250,
        lowStockItems: 15,
        pendingOrders: 4,
    };

    return (
        <div>
            <h1 className="text-2xl font-semibold text-gray-800 mb-6">Dashboard</h1>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                <DashboardCard title="Total Parts" value={stats.totalParts.toLocaleString()} icon={ICONS.box} color={{bg: 'bg-blue-100', text: 'text-blue-600'}} />
                <DashboardCard title="Low Stock Items" value={stats.lowStockItems} icon={ICONS.warning} color={{bg: 'bg-yellow-100', text: 'text-yellow-600'}} />
                <DashboardCard title="Pending Orders" value={stats.pendingOrders} icon={ICONS.truck} color={{bg: 'bg-red-100', text: 'text-red-600'}} />
            </div>
        </div>
    );
};

const SuppliersPage = () => {
    const [suppliers, setSuppliers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentSupplier, setCurrentSupplier] = useState(null);

    const fetchSuppliers = async () => {
        try {
            setError('');
            setLoading(true);
            const response = await axios.get('http://localhost:3001/api/suppliers');
            setSuppliers(response.data);
        } catch (err) {
            setError('Failed to fetch suppliers.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSuppliers();
    }, []);

    const handleAdd = () => {
        setCurrentSupplier(null);
        setIsModalOpen(true);
    };

    const handleEdit = (supplier) => {
        setCurrentSupplier(supplier);
        setIsModalOpen(true);
    };

    const handleDelete = async (supplierId) => {
        if (window.confirm('Are you sure you want to delete this supplier?')) {
            try {
                await axios.delete(`http://localhost:3001/api/suppliers/${supplierId}`);
                fetchSuppliers();
            } catch (err) {
                alert('Failed to delete supplier.');
            }
        }
    };

    const handleSave = async (supplierData) => {
        try {
            if (currentSupplier) {
                await axios.put(`http://localhost:3001/api/suppliers/${currentSupplier.supplier_id}`, supplierData);
            } else {
                await axios.post('http://localhost:3001/api/suppliers', supplierData);
            }
            setIsModalOpen(false);
            fetchSuppliers();
        } catch (err) {
            alert('Failed to save supplier.');
        }
    };

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-semibold text-gray-800">Suppliers</h1>
                <button onClick={handleAdd} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition">
                    Add Supplier
                </button>
            </div>
            <div className="bg-white p-6 rounded-xl border border-gray-200">
                {loading && <p>Loading suppliers...</p>}
                {error && <p className="text-red-500">{error}</p>}
                {!loading && !error && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b">
                                <tr>
                                    <th className="p-3 text-sm font-semibold text-gray-600">ID</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Name</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 hidden sm:table-cell">Contact Person</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 hidden md:table-cell">Phone</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {suppliers.map(supplier => (
                                    <tr key={supplier.supplier_id} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-sm">{supplier.supplier_id}</td>
                                        <td className="p-3 text-sm font-medium text-gray-800">{supplier.supplier_name}</td>
                                        <td className="p-3 text-sm hidden sm:table-cell">{supplier.contact_person}</td>
                                        <td className="p-3 text-sm hidden md:table-cell">{supplier.phone}</td>
                                        <td className="p-3 text-sm text-right">
                                            <button onClick={() => handleEdit(supplier)} className="text-blue-600 hover:text-blue-800 mr-4"><Icon path={ICONS.edit} className="h-5 w-5"/></button>
                                            <button onClick={() => handleDelete(supplier.supplier_id)} className="text-red-600 hover:text-red-800"><Icon path={ICONS.trash} className="h-5 w-5"/></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={currentSupplier ? 'Edit Supplier' : 'Add New Supplier'}>
                <SupplierForm supplier={currentSupplier} onSave={handleSave} onCancel={() => setIsModalOpen(false)} />
            </Modal>
        </div>
    );
};

const SupplierForm = ({ supplier, onSave, onCancel }) => {
    const [formData, setFormData] = useState({
        supplier_name: '', contact_person: '', phone: '', email: '', address: ''
    });

    useEffect(() => {
        if (supplier) {
            setFormData(supplier);
        } else {
             setFormData({ supplier_name: '', contact_person: '', phone: '', email: '', address: '' });
        }
    }, [supplier]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave(formData);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier Name</label>
                <input type="text" name="supplier_name" value={formData.supplier_name} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
                <input type="text" name="contact_person" value={formData.contact_person} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input type="text" name="phone" value={formData.phone} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div className="mt-6 flex justify-end space-x-4">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save</button>
            </div>
        </form>
    );
};


const PartsPage = () => {
    const [parts, setParts] = useState([]);
    const [brands, setBrands] = useState([]);
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentPart, setCurrentPart] = useState(null);

    const fetchData = async () => {
        try {
            setLoading(true);
            setError('');
            const [partsRes, brandsRes, groupsRes] = await Promise.all([
                axios.get('http://localhost:3001/api/parts'),
                axios.get('http://localhost:3001/api/brands'),
                axios.get('http://localhost:3001/api/groups')
            ]);
            setParts(partsRes.data);
            setBrands(brandsRes.data);
            setGroups(groupsRes.data);
        } catch (err) {
            setError('Failed to fetch data.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleAdd = () => {
        setCurrentPart(null);
        setIsModalOpen(true);
    };

    const handleEdit = (part) => {
        setCurrentPart(part);
        setIsModalOpen(true);
    };

    const handleDelete = async (partId) => {
        if (window.confirm('Are you sure you want to delete this part?')) {
            try {
                await axios.delete(`http://localhost:3001/api/parts/${partId}`);
                fetchData();
            } catch (err) {
                alert('Failed to delete part.');
            }
        }
    };

    const handleSave = async (partData) => {
        try {
            if (currentPart) {
                await axios.put(`http://localhost:3001/api/parts/${currentPart.part_id}`, partData);
            } else {
                await axios.post('http://localhost:3001/api/parts', partData);
            }
            setIsModalOpen(false);
            fetchData();
        } catch (err) {
            alert('Failed to save part.');
        }
    };

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-semibold text-gray-800">Parts</h1>
                <button onClick={handleAdd} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition">
                    Add Part
                </button>
            </div>
            <div className="bg-white p-6 rounded-xl border border-gray-200">
                {loading && <p>Loading parts...</p>}
                {error && <p className="text-red-500">{error}</p>}
                {!loading && !error && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b">
                                <tr>
                                    <th className="p-3 text-sm font-semibold text-gray-600">SKU</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Detail</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Brand</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Group</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {parts.map(part => (
                                    <tr key={part.part_id} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-sm font-mono">{part.internal_sku}</td>
                                        <td className="p-3 text-sm font-medium text-gray-800">{part.detail}</td>
                                        <td className="p-3 text-sm">{part.brand_name}</td>
                                        <td className="p-3 text-sm">{part.group_name}</td>
                                        <td className="p-3 text-sm text-right">
                                            <button onClick={() => handleEdit(part)} className="text-blue-600 hover:text-blue-800 mr-4"><Icon path={ICONS.edit} className="h-5 w-5"/></button>
                                            <button onClick={() => handleDelete(part.part_id)} className="text-red-600 hover:text-red-800"><Icon path={ICONS.trash} className="h-5 w-5"/></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={currentPart ? 'Edit Part' : 'Add New Part'}>
                <PartForm part={currentPart} brands={brands} groups={groups} onSave={handleSave} onCancel={() => setIsModalOpen(false)} />
            </Modal>
        </div>
    );
};

const PartForm = ({ part, brands, groups, onSave, onCancel }) => {
    const [formData, setFormData] = useState({ detail: '', brand_id: '', group_id: '' });

    useEffect(() => {
        if (part) {
            setFormData(part);
        } else {
            setFormData({ detail: '', brand_id: '', group_id: '' });
        }
    }, [part]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave(formData);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Part Detail</label>
                <input type="text" name="detail" value={formData.detail} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Brand</label>
                <select name="brand_id" value={formData.brand_id} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required>
                    <option value="">Select a Brand</option>
                    {brands.map(brand => <option key={brand.brand_id} value={brand.brand_id}>{brand.brand_name}</option>)}
                </select>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Group</label>
                <select name="group_id" value={formData.group_id} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required>
                    <option value="">Select a Group</option>
                    {groups.map(group => <option key={group.group_id} value={group.group_id}>{group.group_name}</option>)}
                </select>
            </div>
            <div className="mt-6 flex justify-end space-x-4">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save</button>
            </div>
        </form>
    );
};

const GoodsReceiptPage = ({ user }) => {
    const [suppliers, setSuppliers] = useState([]);
    const [parts, setParts] = useState([]);
    const [lines, setLines] = useState([]);
    const [selectedSupplier, setSelectedSupplier] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true);
                const [suppliersRes, partsRes] = await Promise.all([
                    axios.get('http://localhost:3001/api/suppliers'),
                    axios.get('http://localhost:3001/api/parts')
                ]);
                setSuppliers(suppliersRes.data);
                setParts(partsRes.data);
            } catch (err) {
                console.error("Failed to fetch initial data for goods receipt", err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    useEffect(() => {
        if (searchTerm.trim() === '') {
            setSearchResults([]);
            return;
        }
        setSearchResults(
            parts.filter(p =>
                p.detail.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (p.internal_sku && p.internal_sku.toLowerCase().includes(searchTerm.toLowerCase()))
            ).slice(0, 5)
        );
    }, [searchTerm, parts]);

    const addPartToLines = (part) => {
        const existingLine = lines.find(line => line.part_id === part.part_id);
        if (existingLine) {
            setLines(lines.map(line =>
                line.part_id === part.part_id ? { ...line, quantity: Number(line.quantity) + 1 } : line
            ));
        } else {
            setLines([...lines, { ...part, part_id: part.part_id, quantity: 1, cost_price: part.last_cost || 0 }]);
        }
        setSearchTerm('');
    };

    const handleLineChange = (partId, field, value) => {
        const numericValue = parseFloat(value) || 0;
        setLines(lines.map(line =>
            line.part_id === partId ? { ...line, [field]: numericValue } : line
        ));
    };

    const removeLine = (partId) => {
        setLines(lines.filter(line => line.part_id !== partId));
    };

    const handlePostTransaction = async () => {
        if (!selectedSupplier || lines.length === 0) {
            alert('Please select a supplier and add at least one item.');
            return;
        }

        const payload = {
            supplier_id: selectedSupplier,
            received_by: user.employee_id,
            lines: lines.map(line => ({
                part_id: line.part_id,
                quantity: line.quantity,
                cost_price: line.cost_price,
            })),
        };

        try {
            await axios.post('http://localhost:3001/api/goods-receipts', payload);
            alert('Goods receipt created successfully!');
            setLines([]);
            setSelectedSupplier('');
        } catch (err) {
            alert('Failed to create goods receipt.');
        }
    };

    if (loading) return <p>Loading data...</p>;

    return (
        <div>
            <h1 className="text-2xl font-semibold text-gray-800 mb-6">New Goods Receipt</h1>
            <div className="bg-white p-6 rounded-xl border border-gray-200 space-y-6">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                    <select value={selectedSupplier} onChange={e => setSelectedSupplier(e.target.value)} className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg">
                        <option value="">Select a Supplier</option>
                        {suppliers.map(s => <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name}</option>)}
                    </select>
                </div>
                
                <div className="relative">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Add Part</label>
                    <div className="relative">
                        <Icon path={ICONS.search} className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search by part name or SKU..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full px-3 py-2 pl-10 border border-gray-300 rounded-lg"
                        />
                    </div>
                    {searchResults.length > 0 && (
                        <ul className="absolute z-10 w-full bg-white border rounded-md mt-1 shadow-lg">
                            {searchResults.map(part => (
                                <li key={part.part_id} onClick={() => addPartToLines(part)} className="px-4 py-2 hover:bg-blue-50 cursor-pointer">
                                    <strong>{part.detail}</strong> ({part.internal_sku})
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="border-b">
                            <tr>
                                <th className="p-3 text-sm font-semibold text-gray-600">Part Detail</th>
                                <th className="p-3 text-sm font-semibold text-gray-600 w-28">Quantity</th>
                                <th className="p-3 text-sm font-semibold text-gray-600 w-32">Cost Price</th>
                                <th className="p-3 text-sm font-semibold text-gray-600 w-16 text-center"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {lines.map(line => (
                                <tr key={line.part_id} className="border-b">
                                    <td className="p-2 text-sm font-medium text-gray-800">{line.detail}</td>
                                    <td className="p-2"><input type="number" value={line.quantity} onChange={e => handleLineChange(line.part_id, 'quantity', e.target.value)} className="w-full p-1 border rounded-md" /></td>
                                    <td className="p-2"><input type="number" value={line.cost_price} onChange={e => handleLineChange(line.part_id, 'cost_price', e.target.value)} className="w-full p-1 border rounded-md" /></td>
                                    <td className="p-2 text-center"><button onClick={() => removeLine(line.part_id)} className="text-red-500 hover:text-red-700"><Icon path={ICONS.trash} className="h-5 w-5"/></button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="flex justify-end pt-4 border-t">
                    <button onClick={handlePostTransaction} className="bg-green-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-green-700 transition">
                        Post Transaction
                    </button>
                </div>
            </div>
        </div>
    );
};


// --- LAYOUT COMPONENT ---

const Sidebar = ({ onNavigate, currentPage, isOpen, setIsOpen }) => {
    const navItems = [
        { name: 'Dashboard', icon: ICONS.dashboard, page: 'dashboard' },
        { name: 'Suppliers', icon: ICONS.suppliers, page: 'suppliers' },
        { name: 'Parts', icon: ICONS.parts, page: 'parts' },
        { name: 'Goods Receipt', icon: ICONS.receipt, page: 'goods_receipt' },
    ];

    return (
        <>
            <div className={`fixed inset-0 bg-black bg-opacity-50 z-20 md:hidden ${isOpen ? 'block' : 'hidden'}`} onClick={() => setIsOpen(false)}></div>
            <div className={`fixed top-0 left-0 h-full bg-white border-r border-gray-200 flex flex-col z-30 w-64 md:w-60 md:relative md:translate-x-0 transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                <div className="h-16 flex items-center px-6 text-lg font-bold text-blue-600">Forson Suite</div>
                <nav className="flex-1 px-4 py-4 space-y-1">
                    {navItems.map(item => (
                        <a
                            key={item.name}
                            href="#"
                            onClick={(e) => { e.preventDefault(); onNavigate(item.page); setIsOpen(false); }}
                            className={`flex items-center px-3 py-2.5 rounded-lg transition-colors duration-200 text-sm font-medium ${currentPage === item.page ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'}`}
                        >
                            <Icon path={item.icon} className="h-5 w-5" />
                            <span className="ml-3">{item.name}</span>
                        </a>
                    ))}
                </nav>
            </div>
        </>
    );
};

const Header = ({ user, onLogout, onMenuClick }) => {
    const getInitials = (name) => {
        if (!name) return '';
        const names = name.split(' ');
        if (names.length > 1) {
            return `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase();
        }
        return name[0].toUpperCase();
    }

    return (
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 sm:px-6">
            <button onClick={onMenuClick} className="md:hidden text-gray-600 hover:text-gray-800">
                <Icon path={ICONS.menu} />
            </button>
            <div className="flex-1"></div>
            <div className="flex items-center">
                <div className="h-8 w-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold mr-3">
                    {getInitials(user.first_name + ' ' + user.last_name)}
                </div>
                <span className="hidden sm:inline text-sm text-gray-600 mr-4">Welcome, <strong>{user.first_name}</strong></span>
                <button onClick={onLogout} className="text-gray-500 hover:text-red-600 transition">
                    <Icon path={ICONS.logout} className="h-5 w-5" />
                </button>
            </div>
        </header>
    );
};

const MainLayout = ({ user, onLogout, onNavigate, currentPage }) => {
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const renderPage = () => {
        switch (currentPage) {
            case 'dashboard': return <Dashboard />;
            case 'suppliers': return <SuppliersPage />;
            case 'parts': return <PartsPage />;
            case 'goods_receipt': return <GoodsReceiptPage user={user} />;
            default: return <Dashboard />;
        }
    };

    return (
        <div className="flex h-screen bg-slate-50 font-sans text-gray-800">
            <Sidebar onNavigate={onNavigate} currentPage={currentPage} isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
            <div className="flex-1 flex flex-col overflow-hidden">
                <Header user={user} onLogout={onLogout} onMenuClick={() => setSidebarOpen(true)} />
                <main className="flex-1 overflow-x-hidden overflow-y-auto bg-slate-50 p-4 sm:p-6 md:p-8">
                    {renderPage()}
                </main>
            </div>
        </div>
    );
};


// --- LOGIN COMPONENT ---

const LoginScreen = ({ onLogin }) => {
    const [username, setUsername] = useState('kent.pilar');
    const [password, setPassword] = useState('password123');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const response = await axios.post('http://localhost:3001/api/login', { username, password });
            onLogin(response.data.user);
        } catch (err) {
            setError(err.response?.data?.message || 'Login failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-slate-100 min-h-screen flex items-center justify-center font-sans p-4">
            <div className="w-full max-w-sm">
                 <div className="text-center mb-6">
                    <h1 className="text-2xl font-bold text-gray-800">Forson Business Suite</h1>
                    <p className="text-gray-500 mt-1">Please sign in to continue</p>
                </div>
                <div className="bg-white rounded-xl shadow-sm p-8">
                    <form onSubmit={handleLogin}>
                        <div className="mb-4">
                             <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Icon path={ICONS.user} className="h-5 w-5 text-gray-400" /></div>
                                <input
                                    type="text"
                                    placeholder="e.g. kent.pilar"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="w-full px-3 py-2 pl-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                        </div>
                        <div className="mb-6">
                             <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Icon path={ICONS.password} className="h-5 w-5 text-gray-400" /></div>
                                <input
                                    type="password"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full px-3 py-2 pl-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                        </div>
                        {error && <p className="text-red-500 text-xs text-center mb-4">{error}</p>}
                        <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-700 transition duration-300 font-semibold disabled:bg-blue-400">
                            {loading ? 'Signing In...' : 'Sign In'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};


// --- MAIN APP COMPONENT ---

function App() {
    const [user, setUser] = useState(null);
    const [currentPage, setCurrentPage] = useState('dashboard');

    if (!user) {
        return <LoginScreen onLogin={setUser} />;
    }

    return (
        <MainLayout
            user={user}
            onLogout={() => setUser(null)}
            currentPage={currentPage}
            onNavigate={setCurrentPage}
        />
    );
}

export default App;
