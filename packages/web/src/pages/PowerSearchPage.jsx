import React, { useState, useEffect } from 'react';
import api from '../api'; // Use the configured api instance

const PowerSearchPage = () => {
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [hasSearched, setHasSearched] = useState(false);

    const [filters, setFilters] = useState({
        keyword: '',
        brand: '',
        group: '',
        application: '',
        year: '',
    });

    const handleFilterChange = (e) => {
        const { name, value } = e.target;
        setFilters(prev => ({ ...prev, [name]: value }));
    };

    useEffect(() => {
        const fetchResults = async () => {
            const activeFilters = Object.values(filters).some(val => val.trim() !== '');
            if (!activeFilters) {
                setResults([]);
                setHasSearched(false);
                return;
            }

            try {
                setLoading(true);
                setError('');
                setHasSearched(true);
                
                const queryParams = new URLSearchParams();
                if (filters.keyword) queryParams.append('keyword', filters.keyword);
                if (filters.brand) queryParams.append('brand', filters.brand);
                if (filters.group) queryParams.append('group', filters.group);
                if (filters.application) queryParams.append('application', filters.application);
                if (filters.year) queryParams.append('year', filters.year);

                const response = await api.get(`/power-search/parts?${queryParams.toString()}`);
                setResults(response.data);

            } catch (err) {
                setError('An error occurred during the search.');
                console.error(err);
            } finally {
                setLoading(false);
            }
        };

        const debounceTimer = setTimeout(() => {
            fetchResults();
        }, 500);

        return () => clearTimeout(debounceTimer);
    }, [filters]);

    return (
        <div>
            <h1 className="text-2xl font-semibold text-gray-800 mb-6">Power Search</h1>
            
            <div className="bg-white p-6 rounded-xl border border-gray-200 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                    <input 
                        type="text"
                        name="keyword"
                        placeholder="Keyword (SKU, Name, Number)..."
                        value={filters.keyword}
                        onChange={handleFilterChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    />
                    <input 
                        type="text"
                        name="brand"
                        placeholder="Brand..."
                        value={filters.brand}
                        onChange={handleFilterChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    />
                    <input 
                        type="text"
                        name="group"
                        placeholder="Group..."
                        value={filters.group}
                        onChange={handleFilterChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    />
                    <input 
                        type="text"
                        name="application"
                        placeholder="Application (Make/Model)..."
                        value={filters.application}
                        onChange={handleFilterChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    />
                    <input 
                        type="number"
                        name="year"
                        placeholder="Year..."
                        value={filters.year}
                        onChange={handleFilterChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    />
                </div>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200">
                {loading && <p>Searching...</p>}
                {error && <p className="text-red-500">{error}</p>}
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
                                        <td colSpan="3" className="p-3 text-center text-gray-500">Type in any filter box to begin searching.</td>
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
