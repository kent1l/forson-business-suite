import React, { useState, useEffect } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Modal from '../components/ui/Modal';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import FilterBar from '../components/ui/FilterBar'; // Import the new component

const EmployeeForm = ({ employee, onSave, onCancel }) => {
    const [formData, setFormData] = useState({
        first_name: '',
        last_name: '',
        username: '',
        position_title: '',
        permission_level_id: 1,
        is_active: true,
        password: ''
    });

    useEffect(() => {
        if (employee) {
            setFormData({
                first_name: employee.first_name || '',
                last_name: employee.last_name || '',
                username: employee.username || '',
                position_title: employee.position_title || '',
                permission_level_id: employee.permission_level_id || 1,
                is_active: employee.is_active,
                password: '' // Always clear password field for security
            });
        } else {
            setFormData({
                first_name: '', last_name: '', username: '',
                position_title: '', permission_level_id: 1, is_active: true, password: ''
            });
        }
    }, [employee]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave(formData);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                    <input type="text" name="first_name" value={formData.first_name} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                    <input type="text" name="last_name" value={formData.last_name} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
                </div>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                <input type="text" name="username" value={formData.username} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
            </div>
             <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Position Title</label>
                <input type="text" name="position_title" value={formData.position_title} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                <input type="password" name="password" value={formData.password} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder={employee ? "Leave blank to keep unchanged" : ""} required={!employee} />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Permission Level</label>
                <select name="permission_level_id" value={formData.permission_level_id} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                    <option value={1}>Clerk</option>
                    <option value={5}>Manager</option>
                    <option value={10}>Admin</option>
                </select>
            </div>
            <div className="flex items-center">
                <input type="checkbox" name="is_active" checked={formData.is_active} onChange={handleChange} className="h-4 w-4 text-blue-600 border-gray-300 rounded" />
                <label className="ml-2 block text-sm text-gray-900">Account is Active</label>
            </div>
            <div className="mt-6 flex justify-end space-x-4">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save Employee</button>
            </div>
        </form>
    );
};

const EmployeesPage = ({ user }) => {
    const [employees, setEmployees] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentEmployee, setCurrentEmployee] = useState(null);
    const [statusFilter, setStatusFilter] = useState('active'); // State for the filter

    const filterTabs = [
        { key: 'active', label: 'Active' },
        { key: 'inactive', label: 'Inactive' },
        { key: 'all', label: 'All' },
    ];

    const fetchEmployees = async () => {
        try {
            setLoading(true);
            // Pass the statusFilter in the request params
            const response = await api.get('/employees', { params: { status: statusFilter } });
            setEmployees(response.data);
        } catch (err) {
            setError('Failed to fetch employees.');
        } finally {
            setLoading(false);
        }
    };

    // Re-fetch data when the statusFilter changes
    useEffect(() => {
        if (user.permission_level_id === 10) {
            fetchEmployees();
        }
    }, [user.permission_level_id, statusFilter]);

    const handleAdd = () => {
        setCurrentEmployee(null);
        setIsModalOpen(true);
    };

    const handleEdit = (employee) => {
        setCurrentEmployee(employee);
        setIsModalOpen(true);
    };

    const handleSave = async (employeeData) => {
        const promise = currentEmployee
            ? api.put(`/employees/${currentEmployee.employee_id}`, employeeData)
            : api.post('/employees', employeeData);

        toast.promise(promise, {
            loading: 'Saving employee...',
            success: () => {
                setIsModalOpen(false);
                fetchEmployees();
                return 'Employee saved successfully!';
            },
            error: (err) => err.response?.data?.message || 'Failed to save employee.',
        });
    };
    
    if (user.permission_level_id !== 10) {
        return (
            <div className="text-center p-8">
                <h1 className="text-2xl font-bold text-red-600">Access Denied</h1>
                <p className="text-gray-600 mt-2">You do not have permission to view this page.</p>
            </div>
        );
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-semibold text-gray-800">Employee Management</h1>
                <button onClick={handleAdd} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition">
                    Add Employee
                </button>
            </div>

            {/* Use the new FilterBar component */}
            <FilterBar
                tabs={filterTabs}
                activeTab={statusFilter}
                onTabClick={setStatusFilter}
            />

            <div className="bg-white p-6 rounded-xl border border-gray-200">
                {loading && <p>Loading employees...</p>}
                {error && <p className="text-red-500">{error}</p>}
                {!loading && !error && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b">
                                <tr>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Name</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Username</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Position</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-center">Status</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {employees.map(emp => (
                                    <tr key={emp.employee_id} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-sm font-medium text-gray-800">{emp.first_name} {emp.last_name}</td>
                                        <td className="p-3 text-sm">{emp.username}</td>
                                        <td className="p-3 text-sm">{emp.position_title}</td>
                                        <td className="p-3 text-sm text-center">
                                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${emp.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                                {emp.is_active ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                        <td className="p-3 text-sm text-right">
                                            <button onClick={() => handleEdit(emp)} className="text-blue-600 hover:text-blue-800"><Icon path={ICONS.edit} className="h-5 w-5"/></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={currentEmployee ? 'Edit Employee' : 'Add New Employee'}>
                <EmployeeForm employee={currentEmployee} onSave={handleSave} onCancel={() => setIsModalOpen(false)} />
            </Modal>
        </div>
    );
};

export default EmployeesPage;