import React, { useState, useEffect } from 'react';
import api from '../api'; // Use the configured api instance
import Icon from '../components/ui/Icon'; // Import the Icon component
import { ICONS } from '../constants'; // Import the icon paths

const PowerSearchPage = () => {
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [keyword, setKeyword] = useState('');
    const [hasSearched, setHasSearched] = useState(false);

    useEffect(() => {
        // Do not search if the keyword is empty
        if (keyword.trim() === '') {
            setResults([]);
            setHasSearched(false);
            return;
        }

        const fetchResults = async () => {
            try {
                setLoading(true);
                setError('');
                setHasSearched(true);
                
                // The API call is now much simpler
                const response = await api.get(`/power-search/parts`, {
                    params: { keyword }
                });
                setResults(response.data);

            } catch (err) {
                setError('An error occurred during the search.');
                console.error(err);
            } finally {
                setLoading(false);
            }
        };

        // Use a debounce timer to search only after the user stops typing
        const debounceTimer = setTimeout(() => {
            fetchResults();
        }, 300); // 300ms delay

        return () => clearTimeout(debounceTimer);
    }, [keyword]);

    return (
        <div>
            <h1 className="text-2xl font-semibold text-gray-800 mb-6">Power Search</h1>
            
            {/* --- The New, Simplified Search Bar --- */}
            <div className="bg-white p-4 rounded-xl border border-gray-200 mb-6">
                <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Icon path={ICONS.search} className="h-5 w-5 text-gray-400" />
                    </div>
                    <input 
                        type="text"
                        name="keyword"
                        placeholder="Search by SKU, Name, Part Number, Brand, or Application..."
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg text-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200">
                {loading && <p className="text-center text-gray-500">Searching...</p>}
                {error && <p className="text-center text-red-500">{error}</p>}
                {!loading && !error && (
                     <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b">
                                <tr>
                                    <th className="p-3 text-sm font-semibold text-gray-600">SKU</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Display Name</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Applications</th>
                                </tr>
                            </thead>
                            <tbody>
                                {results.map(part => (
                                    <tr key={part.part_id} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-sm font-mono align-top">{part.internal_sku}</td>
                                        <td className="p-3 text-sm font-medium text-gray-800 align-top">{part.display_name}</td>
                                        <td className="p-3 text-sm text-gray-600 align-top">{part.applications}</td>
                                    </tr>
                                ))}
                                {hasSearched && results.length === 0 && (
                                    <tr>
                                        <td colSpan="3" className="p-3 text-center text-gray-500">No results found for your query.</td>
                                    </tr>
                                )}
                                {!hasSearched && (
                                     <tr>
                                        <td colSpan="3" className="p-3 text-center text-gray-500">Type in the search box to begin.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PowerSearchPage;