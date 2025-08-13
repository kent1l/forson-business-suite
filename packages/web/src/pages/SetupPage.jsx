import React, { useState } from 'react';
import api from '../api'; // 👈 1. Import your configured api instance
import toast from 'react-hot-toast';

const SetupPage = ({ onSetupComplete }) => {
    const [formData, setFormData] = useState({
        first_name: '',
        last_name: '',
        username: '',
        password: '',
    });
    const [loading, setLoading] = useState(false);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            // 👇 2. Use the 'api' instance with a relative path
            await api.post('/setup/create-admin', formData);
            toast.success('Admin account created successfully! Please log in.');
            onSetupComplete(); // Tell the main App component to refresh its state
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to create admin account.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-slate-100 min-h-screen flex items-center justify-center font-sans p-4">
            <div className="w-full max-w-md">
                <div className="text-center mb-6">
                    <h1 className="text-2xl font-bold text-gray-800">Welcome to Forson Business Suite</h1>
                    <p className="text-gray-500 mt-1">Let's set up your primary administrator account.</p>
                </div>
                <div className="bg-white rounded-xl shadow-sm p-8">
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
                            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                            <input type="password" name="password" value={formData.password} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
                        </div>
                        <div className="pt-2">
                            <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-700 transition duration-300 font-semibold disabled:bg-blue-400">
                                {loading ? 'Creating Account...' : 'Create Admin Account'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default SetupPage;
