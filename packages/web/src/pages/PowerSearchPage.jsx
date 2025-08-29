import React, { useState, useEffect } from 'react';
import api from '../api'; // Use the configured api instance
import Icon from '../components/ui/Icon'; // Import the Icon component
import { ICONS } from '../constants'; // Import the icon paths
import Modal from '../components/ui/Modal';

const PowerSearchPage = () => {
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [keyword, setKeyword] = useState('');
    const [hasSearched, setHasSearched] = useState(false);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const [detailLoading, setDetailLoading] = useState(false);
    const [selectedPartDetail, setSelectedPartDetail] = useState(null);

    // The backend now handles MeiliSearch ordering. Use the results array directly.
    const sortedResults = results;

    const openPartDetail = async (partId) => {
        try {
            setDetailLoading(true);
            const res = await api.get(`/parts/${partId}`);
            setSelectedPartDetail(res.data);
            setIsDetailOpen(true);
        } catch (err) {
            console.error('Failed to load part detail', err);
        } finally {
            setDetailLoading(false);
        }
    };

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
                                <tr className="bg-gray-100 border-t border-b border-gray-300">
                                    <th className="p-3 text-sm font-semibold text-gray-600">SKU</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Display Name</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Applications</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Stock</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Sale Price</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedResults.map(part => (
                                    <tr key={part.part_id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => openPartDetail(part.part_id)}>
                                        <td className="p-3 text-sm font-mono align-top">{part.internal_sku}</td>
                                        <td className="p-3 text-sm font-medium text-gray-800 align-top">{part.display_name}</td>
                                        <td className="p-3 text-sm text-gray-600 align-top">{part.applications}</td>
                                        <td className="p-3 text-sm text-gray-700 align-top">{typeof part.stock_on_hand !== 'undefined' ? Number(part.stock_on_hand).toFixed(2) : '-'}</td>
                                        <td className="p-3 text-sm text-gray-800 font-semibold align-top">{part.last_sale_price ? (Number(part.last_sale_price).toFixed(2)) : '-'}</td>
                                    </tr>
                                ))}
                                {hasSearched && sortedResults.length === 0 && (
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

            <Modal isOpen={isDetailOpen} onClose={() => setIsDetailOpen(false)} title={selectedPartDetail ? selectedPartDetail.display_name : 'Part Details'}>
                {detailLoading && <p>Loading...</p>}
                {!detailLoading && selectedPartDetail && (
                    <div className="space-y-3">
                        <div className="flex flex-wrap gap-6 justify-between">
                            <div>
                                <div className="text-sm text-gray-500">SKU</div>
                                <div className="font-mono font-semibold">{selectedPartDetail.internal_sku}</div>
                            </div>
                            <div>
                                <div className="text-sm text-gray-500">Stock</div>
                                <div className="font-semibold">{typeof selectedPartDetail.stock_on_hand !== 'undefined' ? Number(selectedPartDetail.stock_on_hand).toFixed(2) : '-'}</div>
                            </div>
                            <div>
                                <div className="text-sm text-gray-500">Sale Price</div>
                                <div className="font-semibold">{selectedPartDetail.last_sale_price ? Number(selectedPartDetail.last_sale_price).toFixed(2) : '-'}</div>
                            </div>
                            <div>
                                <div className="text-sm text-gray-500">Last Cost</div>
                                <div className="font-semibold">{selectedPartDetail.last_cost ? Number(selectedPartDetail.last_cost).toFixed(2) : '-'}</div>
                            </div>
                            <div>
                                <div className="text-sm text-gray-500">WAC</div>
                                <div className="font-semibold">{selectedPartDetail.wac_cost ? Number(selectedPartDetail.wac_cost).toFixed(2) : '-'}</div>
                            </div>
                        </div>
                        <div>
                            <div className="text-sm text-gray-500">Part Numbers</div>
                            <div className="text-sm">{selectedPartDetail.part_numbers}</div>
                        </div>
                        <div>
                            <div className="text-sm text-gray-500">Detail</div>
                            <div className="text-sm">{selectedPartDetail.detail}</div>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default PowerSearchPage;