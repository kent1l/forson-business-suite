import React, { useState, useEffect } from 'react';
import api from '../api';
import toast from 'react-hot-toast'; // Use the configured api instance
import Icon from '../components/ui/Icon'; // Import the Icon component
import InfoTip from '../components/ui/InfoTip';
import { ICONS } from '../constants'; // Import the icon paths
import SearchBar from '../components/SearchBar';
import Modal from '../components/ui/Modal';
import { formatApplicationText } from '../helpers/applicationTextHelper';
import PartCostLadder from '../components/parts/PartCostLadder';
import { formatCurrency } from '../utils/currency';

/** A money cell that distinguishes "no value recorded" from a genuine zero. The cost
 *  columns default to 0.00 for every part imported before costing existed, so showing
 *  a bare 0 there would read as a real price. */
const MoneyCell = ({ value, className = '' }) => {
    const recorded = value !== null && value !== undefined && Number(value) !== 0;
    return (
        <td className={`p-3 text-sm align-top font-mono text-right whitespace-nowrap ${className}`}>
            {recorded ? formatCurrency(value) : <span className="text-gray-400 dark:text-slate-500">—</span>}
        </td>
    );
};

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

    const openPartDetail = async (searchRow) => {
        try {
            setDetailLoading(true);
            const res = await api.get(`/parts/${searchRow.part_id}`);
            // parts_view carries the cost columns but neither their dates nor the
            // originating receipt, so the search row is kept underneath the detail
            // rather than replaced by it.
            setSelectedPartDetail({ ...searchRow, ...res.data });
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
        <div className="space-y-6">
            <h1 className="text-2xl font-semibold text-gray-800 dark:text-slate-100 flex items-center gap-1.5">
                Power Search
                <InfoTip label="Power Search">
                    Finds parts only — by SKU, name, part number, brand, or vehicle application. It does not search
                    invoices or customers; use Sales History for those.
                </InfoTip>
            </h1>

            {/* --- The Simplified Search Bar --- */}
            <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-gray-200 dark:border-slate-700 shadow-card">
                <SearchBar
                    value={keyword}
                    onChange={setKeyword}
                    onClear={() => { setKeyword(''); setResults([]); }}
                    placeholder="Search by SKU, Name, Part Number, Brand, or Application..."
                />
            </div>

            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700 shadow-card">
                {loading && <p className="text-center text-gray-500 dark:text-slate-400">Searching...</p>}
                {error && <p className="text-center text-danger-500 dark:text-danger-400">{error}</p>}
                {!loading && !error && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-700/40">
                                <tr>
                                    <th className="p-3 text-sm font-semibold text-gray-600 dark:text-slate-300">SKU</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 dark:text-slate-300">Display Name</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 dark:text-slate-300">Applications</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 dark:text-slate-300 text-right">Stock</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 dark:text-slate-300 text-right whitespace-nowrap">
                                        <span className="inline-flex items-center gap-1 justify-end">
                                            Unit Cost
                                            <InfoTip label="Unit Cost" align="right">
                                                Supplier's invoiced price per unit on the most recent posted receipt,
                                                before freight and discounts.
                                            </InfoTip>
                                        </span>
                                    </th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 dark:text-slate-300 text-right whitespace-nowrap">
                                        <span className="inline-flex items-center gap-1 justify-end">
                                            Landed Cost
                                            <InfoTip label="Landed Cost" align="right">
                                                Unit cost plus this part's share of freight, less line and overall
                                                discounts. This is what posts to inventory and drives WAC.
                                            </InfoTip>
                                        </span>
                                    </th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 dark:text-slate-300 text-right whitespace-nowrap">
                                        <span className="inline-flex items-center gap-1 justify-end">
                                            WAC
                                            <InfoTip label="WAC" align="right">
                                                Weighted Average Cost — the average landed cost of the units on hand,
                                                recalculated as stock arrives at different prices.
                                            </InfoTip>
                                        </span>
                                    </th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 dark:text-slate-300 text-right">Sale Price</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-slate-700/60">
                                {sortedResults.map(part => (
                                    <tr key={part.part_id} className="hover:bg-gray-50 dark:hover:bg-slate-700/40 cursor-pointer text-gray-800 dark:text-slate-200 transition-colors" onClick={() => openPartDetail(part)}>
                                        <td className="p-3 text-sm font-mono text-gray-900 dark:text-slate-100 align-top">{part.internal_sku}</td>
                                        <td className="p-3 text-sm font-medium text-gray-900 dark:text-slate-100 align-top">{part.display_name}</td>
                                        <td className="p-3 text-sm text-gray-600 dark:text-slate-400 align-top">
                                            {part.applications ? (
                                                <div className="whitespace-pre-line">
                                                    {formatApplicationText(part.applications, { style: 'multilineFull' })}
                                                </div>
                                            ) : ''}
                                        </td>
                                        <td className="p-3 text-sm text-gray-700 dark:text-slate-300 align-top font-mono text-right">{typeof part.stock_on_hand !== 'undefined' ? Number(part.stock_on_hand).toFixed(2) : '-'}</td>
                                        <MoneyCell value={part.last_receipt_unit_cost} className="text-gray-600 dark:text-slate-400" />
                                        <MoneyCell value={part.last_receipt_landed_cost ?? part.last_cost} className="text-gray-700 dark:text-slate-300" />
                                        <MoneyCell value={part.wac_cost} className="text-gray-700 dark:text-slate-300" />
                                        <MoneyCell value={part.last_sale_price} className="text-gray-900 dark:text-slate-100 font-semibold" />
                                    </tr>
                                ))}
                                {hasSearched && sortedResults.length === 0 && (
                                    <tr>
                                        <td colSpan="9" className="p-6 text-center text-gray-500 dark:text-slate-400">No results found for your query.</td>
                                    </tr>
                                )}
                                {!hasSearched && (
                                    <tr>
                                        <td colSpan="9" className="p-6 text-center text-gray-500 dark:text-slate-400">Type in the search box to begin.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <Modal isOpen={isDetailOpen} onClose={() => setIsDetailOpen(false)} title={selectedPartDetail ? selectedPartDetail.display_name : 'Part Details'}>
                {detailLoading && <p className="text-gray-500 dark:text-slate-400">Loading...</p>}
                {!detailLoading && selectedPartDetail && (
                    <div className="space-y-4">
                        <div className="flex flex-wrap gap-6 bg-gray-50 dark:bg-slate-900/50 p-4 rounded-xl border border-gray-100 dark:border-slate-700">
                            <div>
                                <div className="text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">SKU</div>
                                <div className="font-mono font-semibold text-gray-900 dark:text-slate-100 mt-0.5">{selectedPartDetail.internal_sku}</div>
                            </div>
                            <div>
                                <div className="text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">Stock</div>
                                <div className="font-semibold text-gray-900 dark:text-slate-100 font-mono mt-0.5">{typeof selectedPartDetail.stock_on_hand !== 'undefined' ? Number(selectedPartDetail.stock_on_hand).toFixed(2) : '-'}</div>
                            </div>
                        </div>
                        <PartCostLadder part={selectedPartDetail} />
                        <div>
                            <div className="text-xs font-medium text-gray-500 dark:text-slate-400 uppercase mb-1">Part Numbers</div>
                            <div className="text-sm text-gray-800 dark:text-slate-200 font-mono bg-gray-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-gray-100 dark:border-slate-700">{selectedPartDetail.part_numbers || 'None'}</div>
                        </div>
                        <div>
                            <div className="text-xs font-medium text-gray-500 dark:text-slate-400 uppercase mb-1">Detail</div>
                            <div className="text-sm text-gray-800 dark:text-slate-200 bg-gray-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-gray-100 dark:border-slate-700">{selectedPartDetail.detail || 'None'}</div>
                        </div>
                        <div className="pt-4 border-t border-gray-200 dark:border-slate-700 flex justify-end">
                            <button
                                onClick={async () => {
                                    try {
                                        await api.post('/inventory/cycle-count/request-audit', { part_id: selectedPartDetail.part_id });
                                        toast.success('Inventory audit requested for ' + selectedPartDetail.internal_sku);
                                    } catch (err) {
                                        toast.error('Failed to request audit');
                                    }
                                }}
                                className="px-4 py-2 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 hover:bg-amber-100 dark:hover:bg-amber-900/50 rounded-lg text-sm font-medium transition-colors"
                            >
                                Request Inventory Audit
                            </button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default PowerSearchPage;