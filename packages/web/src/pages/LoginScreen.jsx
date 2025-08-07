import React, { useState } from 'react';
import api from '../api'; // Use the new api helper
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';

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
            const response = await api.post('/login', { username, password });
            // onLogin now receives the full response data: { user: {...}, token: '...' }
            onLogin(response.data); 
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

export default LoginScreen;
