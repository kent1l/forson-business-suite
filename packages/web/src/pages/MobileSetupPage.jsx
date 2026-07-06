import React, { useState, useEffect } from 'react';
import { Download, CheckCircle, Smartphone, AlertCircle, Settings } from 'lucide-react';
import api from '../api';

export default function MobileSetupPage() {
    const [version, setVersion] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchVersion = async () => {
            try {
                // Use a public endpoint that doesn't require authentication
                const response = await api.get('/setup/mobile-version');
                setVersion(response.data.version);
            } catch (err) {
                console.error("Failed to fetch mobile version", err);
                setVersion('1.0.0'); // Fallback
            } finally {
                setLoading(false);
            }
        };
        fetchVersion();
    }, []);

    const handleDownload = () => {
        // Point to the static volume mount
        window.location.href = '/downloads/forson-erp-latest.apk';
    };

    return (
        <div className="min-h-screen bg-gray-900 text-gray-100 flex items-center justify-center p-4 font-sans">
            <div className="max-w-md w-full bg-gray-800 rounded-2xl shadow-2xl border border-gray-700 overflow-hidden">
                {/* Header Graphic */}
                <div className="bg-gradient-to-br from-yellow-400 to-yellow-600 p-8 text-center text-gray-900">
                    <Smartphone className="w-16 h-16 mx-auto mb-4 opacity-90" />
                    <h1 className="text-3xl font-extrabold tracking-tight">Forson ERP</h1>
                    <p className="font-medium opacity-80 mt-1">Mobile Suite Setup</p>
                </div>

                <div className="p-8">
                    {loading ? (
                        <div className="flex justify-center p-8">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-500"></div>
                        </div>
                    ) : (
                        <>
                            <div className="text-center mb-8">
                                <div className="inline-flex items-center justify-center bg-green-900/30 text-green-400 border border-green-800/50 rounded-full px-4 py-1.5 mb-6 shadow-inner">
                                    <CheckCircle className="w-4 h-4 mr-2" />
                                    <span className="text-sm font-semibold tracking-wide">Version {version} Available</span>
                                </div>
                                <h2 className="text-xl font-bold text-gray-100 mb-2">Ready to Install</h2>
                                <p className="text-gray-400 text-sm leading-relaxed">
                                    Download the latest Android application bundle to access the warehouse scanner and inventory tools.
                                </p>
                            </div>

                            <button 
                                onClick={handleDownload}
                                className="w-full flex items-center justify-center space-x-3 bg-yellow-500 hover:bg-yellow-400 text-gray-900 font-bold py-4 px-6 rounded-xl transition-all duration-200 transform hover:scale-[1.02] active:scale-95 shadow-lg shadow-yellow-500/20"
                            >
                                <Download className="w-5 h-5" />
                                <span>Download App (.apk)</span>
                            </button>
                        </>
                    )}

                    {/* Instructions List */}
                    <div className="mt-10 bg-gray-900/50 rounded-xl p-5 border border-gray-700/50">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-4 flex items-center">
                            <AlertCircle className="w-4 h-4 mr-2" />
                            Installation Guide
                        </h3>
                        <ul className="space-y-4 text-sm text-gray-300">
                            <li className="flex items-start">
                                <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-gray-700 text-gray-300 text-xs font-bold mr-3 mt-0.5">1</span>
                                <p>Tap <strong className="text-gray-200">Download</strong> and wait for the file to finish downloading.</p>
                            </li>
                            <li className="flex items-start">
                                <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-gray-700 text-gray-300 text-xs font-bold mr-3 mt-0.5">2</span>
                                <p>Open the downloaded <code className="bg-gray-800 px-1.5 py-0.5 rounded text-yellow-500 text-xs font-mono">.apk</code> file from your notifications or Downloads folder.</p>
                            </li>
                            <li className="flex items-start">
                                <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-gray-700 text-gray-300 text-xs font-bold mr-3 mt-0.5">3</span>
                                <p>If prompted by security, tap <strong className="text-gray-200">Settings</strong> and toggle <strong className="text-yellow-500">Allow from this source</strong>, then go back and tap Install.</p>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}
