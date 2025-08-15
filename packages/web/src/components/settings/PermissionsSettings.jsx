import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';

const PermissionsSettings = () => {
    const [roles, setRoles] = useState([]);
    const [permissions, setPermissions] = useState({});
    const [selectedRole, setSelectedRole] = useState('');
    const [rolePermissions, setRolePermissions] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchInitialData = useCallback(async () => {
        try {
            setLoading(true);
            const [rolesRes, permissionsRes] = await Promise.all([
                api.get('/roles'),
                api.get('/permissions')
            ]);
            setRoles(rolesRes.data);
            setPermissions(permissionsRes.data);
            if (rolesRes.data.length > 0) {
                setSelectedRole(rolesRes.data[0].permission_level_id);
            }
        } catch (error) {
            toast.error('Failed to load roles and permissions.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchInitialData();
    }, [fetchInitialData]);

    useEffect(() => {
        if (selectedRole) {
            const fetchRolePermissions = async () => {
                try {
                    const response = await api.get(`/roles/${selectedRole}/permissions`);
                    setRolePermissions(response.data);
                } catch (error) {
                    toast.error('Failed to load permissions for the selected role.');
                }
            };
            fetchRolePermissions();
        }
    }, [selectedRole]);

    const handlePermissionChange = (permissionKey) => {
        setRolePermissions(prev => 
            prev.includes(permissionKey)
                ? prev.filter(p => p !== permissionKey)
                : [...prev, permissionKey]
        );
    };

    const handleSave = () => {
        const promise = api.put(`/roles/${selectedRole}/permissions`, { permissions: rolePermissions });
        toast.promise(promise, {
            loading: 'Saving permissions...',
            success: 'Permissions updated successfully!',
            error: 'Failed to save permissions.'
        });
    };

    if (loading) {
        return <p>Loading...</p>;
    }

    return (
        <div className="space-y-6">
            <div>
                <label htmlFor="role-select" className="block text-sm font-medium text-gray-700 mb-1">Select a Role to Edit</label>
                <select
                    id="role-select"
                    value={selectedRole}
                    onChange={(e) => setSelectedRole(e.target.value)}
                    className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg"
                >
                    {roles.map(role => (
                        <option key={role.permission_level_id} value={role.permission_level_id}>
                            {role.level_name}
                        </option>
                    ))}
                </select>
            </div>

            <div className="space-y-4">
                {Object.entries(permissions).map(([category, perms]) => (
                    <div key={category}>
                        <h4 className="text-md font-semibold text-gray-800 border-b pb-2 mb-2">{category}</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2">
                            {perms.map(perm => (
                                <div key={perm.permission_key} className="flex items-center">
                                    <input
                                        type="checkbox"
                                        id={perm.permission_key}
                                        checked={rolePermissions.includes(perm.permission_key)}
                                        onChange={() => handlePermissionChange(perm.permission_key)}
                                        className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                                    />
                                    <label htmlFor={perm.permission_key} className="ml-2 block text-sm text-gray-900">
                                        {perm.description}
                                    </label>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
            
            <div className="pt-4 flex justify-end mt-6 border-t">
                <button 
                    onClick={handleSave} 
                    className="bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-blue-700 transition"
                >
                    Save Permissions
                </button>
            </div>
        </div>
    );
};

export default PermissionsSettings;
