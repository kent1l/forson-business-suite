import React, { useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import api from '../api';
import Icon from '../components/ui/Icon';
import BrandLogo from '../components/ui/BrandLogo';
import { ICONS } from '../constants';
import { useTheme } from '../contexts/ThemeContext';

const LoginScreen = ({ onLogin }) => {
    const { mode, toggleMode } = useTheme() || {};
    const [username, setUsername] = useState(''); // Removed hard-coded username
    const [password, setPassword] = useState(''); // Removed hard-coded password
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const response = await api.post('/login', { username, password });
            onLogin(response.data); 
        } catch (err) {
            setError(err.response?.data?.message || 'Login failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-slate-100 dark:bg-slate-950 min-h-screen flex items-center justify-center font-sans p-4 relative">
            {toggleMode && (
                <button
                    type="button"
                    onClick={toggleMode}
                    aria-label="Toggle dark mode"
                    className="absolute top-4 right-4 p-2 rounded-full text-gray-500 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-800"
                >
                    {mode === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                </button>
            )}
            <div className="w-full max-w-sm">
                 <div className="text-center mb-6">
                    <BrandLogo
                        variant="full"
                        className="h-12 mx-auto mb-2 object-contain"
                        fallback={<h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100">Forson Business Suite</h1>}
                    />
                    <p className="text-gray-500 dark:text-slate-400 mt-1">Please sign in to continue</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm p-8">
                    <form onSubmit={handleLogin}>
                        <div className="mb-4">
                             <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Username</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Icon path={ICONS.user} className="h-5 w-5 text-gray-400" /></div>
                                <input
                                    type="text"
                                    placeholder="e.g. kent.pilar"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="w-full px-3 py-2 pl-10 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                                />
                            </div>
                        </div>
                        <div className="mb-6">
                             <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Password</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Icon path={ICONS.password} className="h-5 w-5 text-gray-400" /></div>
                                <input
                                    type="password"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full px-3 py-2 pl-10 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                                />
                            </div>
                        </div>
                        {error && <p className="text-danger-600 text-xs text-center mb-4">{error}</p>}
                        <button type="submit" disabled={loading} className="w-full bg-primary-600 text-white py-2.5 rounded-lg hover:bg-primary-700 transition duration-300 font-semibold disabled:opacity-50">
                            {loading ? 'Signing In...' : 'Sign In'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default LoginScreen;
