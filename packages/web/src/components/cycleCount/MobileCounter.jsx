import React, { useState, useEffect, useRef } from 'react';
import { X, Check, Search } from 'lucide-react';
import api from '../../api';
import toast from 'react-hot-toast';

const getPartDisplayName = (part) => part?.display_name || part?.detail || part?.internal_sku || part?.part_number || 'Unnamed item';
const getPartSecondaryLabel = (part) => part?.internal_sku || part?.part_number || '';

const MobileCounter = ({ task, onSubmit, onCancel, itemNumber, totalItems, isUnassigned = false }) => {
    const [inputValue, setInputValue] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [selectedPart, setSelectedPart] = useState(null);
    const [searching, setSearching] = useState(false);

    const searchInputRef = useRef(null);

    // If it's an unassigned find, we need to search for the part first
    useEffect(() => {
        if (isUnassigned && searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, [isUnassigned]);

    useEffect(() => {
        if (!isUnassigned || selectedPart) return undefined;

        const query = searchQuery.trim();
        if (query.length < 2) {
            setSearchResults([]);
            setSearching(false);
            return undefined;
        }

        const controller = new AbortController();
        const debounceTimer = setTimeout(async () => {
            setSearching(true);
            try {
                const res = await api.get('/power-search/parts', {
                    params: { keyword: query, status: 'active' },
                    signal: controller.signal,
                });
                const results = Array.isArray(res.data) ? res.data : (res.data?.data || []);
                setSearchResults(results);
            } catch (err) {
                if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return;
                console.error('Search failed', err);
                setSearchResults([]);
                toast.error('Unable to search parts. Please try again.');
            } finally {
                if (!controller.signal.aborted) {
                    setSearching(false);
                }
            }
        }, 300);

        return () => {
            controller.abort();
            clearTimeout(debounceTimer);
        };
    }, [isUnassigned, searchQuery, selectedPart]);

    const handleSearchChange = (e) => {
        setSearchQuery(e.target.value);
    };

    const handleSelectPart = (part) => {
        setSelectedPart(part);
        setSearchQuery('');
        setSearchResults([]);
    };

    const handleClear = () => {
        setInputValue('');
    };

    const handleAdjustment = (amount) => {
        const currentValue = Number.parseFloat(inputValue);
        const nextValue = Math.max(0, (Number.isFinite(currentValue) ? currentValue : 0) + amount);
        // Inventory quantities use four decimal places. Rounding here avoids
        // exposing floating-point artefacts after repeated helper-button clicks.
        setInputValue(String(Number(nextValue.toFixed(4))));
    };

    const handleSubmitClick = () => {
        const normalizedInput = inputValue.trim();
        if (!normalizedInput) return;

        const qty = Number(normalizedInput);
        if (!Number.isFinite(qty) || qty < 0) {
            toast.error('Enter a valid quantity of zero or more.');
            return;
        }

        if (isUnassigned) {
            if (!selectedPart) return;
            onSubmit(selectedPart.part_id, qty);
        } else {
            onSubmit(qty);
        }

        setInputValue('');
    };

    const activePart = isUnassigned ? selectedPart : task;
    const activeDisplayName = getPartDisplayName(activePart);
    const activeSecondaryLabel = getPartSecondaryLabel(activePart);

    return (
        <div className="flex flex-col h-full max-w-lg mx-auto bg-gray-50 dark:bg-slate-900 border-x border-gray-200 dark:border-slate-700">
            {/* Header */}
            <div className="bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 px-4 py-3 flex items-center justify-between shadow-sm z-10">
                <button
                    onClick={onCancel}
                    className="p-2 -ml-2 text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-full cursor-pointer"
                >
                    <X className="w-6 h-6" />
                </button>
                <div className="text-center font-medium text-gray-800 dark:text-slate-100">
                    {isUnassigned ? 'Unassigned Find' : `Item ${itemNumber} of ${totalItems}`}
                </div>
                <div className="w-10"></div> {/* Spacer to center title */}
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col">

                {/* Part Identification Area */}
                {isUnassigned && !selectedPart ? (
                    <div className="flex-1">
                        <div className="relative mb-2">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <Search className="h-5 w-5 text-gray-400 dark:text-slate-500" />
                            </div>
                            <input
                                ref={searchInputRef}
                                type="text"
                                className="block w-full pl-10 pr-3 py-3 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:ring-primary-500 focus:border-primary-500 text-lg"
                                placeholder="Scan barcode or type item name/SKU..."
                                value={searchQuery}
                                onChange={handleSearchChange}
                            />
                        </div>
                        {searchQuery.trim().length > 0 && searchQuery.trim().length < 2 && (
                            <div className="text-sm text-gray-500 dark:text-slate-400 mb-3">Type at least 2 characters to search.</div>
                        )}
                        {searching && <div className="text-center py-4 text-gray-500 dark:text-slate-400">Searching...</div>}
                        {!searching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                            <div className="text-center py-4 text-gray-500 dark:text-slate-400">No matching parts found.</div>
                        )}
                        <div className="space-y-2">
                            {searchResults.map(part => (
                                <button
                                    key={part.part_id}
                                    onClick={() => handleSelectPart(part)}
                                    className="w-full text-left p-4 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg hover:bg-primary-50 dark:hover:bg-slate-700/60 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors cursor-pointer"
                                >
                                    <div className="font-bold text-gray-900 dark:text-slate-100 whitespace-normal break-words line-clamp-3">{getPartDisplayName(part)}</div>
                                    {getPartSecondaryLabel(part) && (
                                        <div className="text-sm text-gray-600 dark:text-slate-400 whitespace-normal break-words">{getPartSecondaryLabel(part)}</div>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-6 mb-6 text-center">
                        <h2 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-slate-100 mb-2 tracking-tight whitespace-normal break-words line-clamp-3">
                            {activeDisplayName}
                        </h2>
                        {activeSecondaryLabel && (
                            <p className="text-lg text-gray-600 dark:text-slate-400 whitespace-normal break-words">
                                {activeSecondaryLabel}
                            </p>
                        )}
                        {isUnassigned && (
                            <button
                                onClick={() => setSelectedPart(null)}
                                className="mt-4 text-sm text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300 font-medium cursor-pointer"
                            >
                                Change Item
                            </button>
                        )}
                    </div>
                )}

                {/* Quantity entry (only show if we have a task or a selected part) */}
                {(!isUnassigned || selectedPart) && (
                    <div className="mt-auto">
                        <label htmlFor="cycle-count-quantity" className="block mb-2 text-sm font-semibold text-gray-700 dark:text-slate-300">
                            Counted quantity
                        </label>
                        <div className="bg-white dark:bg-slate-800 border-2 border-primary-200 dark:border-primary-800/60 rounded-xl mb-3">
                            <input
                                id="cycle-count-quantity"
                                type="text"
                                inputMode="decimal"
                                autoComplete="off"
                                autoFocus
                                value={inputValue}
                                onChange={(event) => {
                                    const nextValue = event.target.value;
                                    if (/^\d*(?:\.\d*)?$/.test(nextValue)) {
                                        setInputValue(nextValue);
                                    }
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault();
                                        handleSubmitClick();
                                    }
                                }}
                                placeholder="0"
                                aria-describedby="cycle-count-quantity-help"
                                className="w-full p-4 text-center text-5xl font-mono font-bold tracking-wider text-gray-900 dark:text-slate-100 bg-transparent placeholder:text-gray-300 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500 rounded-xl"
                            />
                        </div>
                        <p id="cycle-count-quantity-help" className="mb-3 text-sm text-gray-500 dark:text-slate-400">
                            Type a whole or decimal quantity. Press Enter to submit.
                        </p>

                        {/* Quick helpers keep common count adjustments one click away. */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-4">
                            <button type="button" onClick={handleClear} className="min-h-12 rounded-xl font-semibold bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-300 dark:hover:bg-slate-600 cursor-pointer">
                                Clear
                            </button>
                            <button type="button" onClick={() => handleAdjustment(-1)} className="min-h-12 rounded-xl font-semibold bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-900 dark:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-700/60 cursor-pointer">
                                −1
                            </button>
                            <button type="button" onClick={() => setInputValue('0')} className="min-h-12 rounded-xl font-semibold bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-900 dark:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-700/60 cursor-pointer">
                                0
                            </button>
                            <button type="button" onClick={() => handleAdjustment(1)} className="min-h-12 rounded-xl font-semibold bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-900 dark:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-700/60 cursor-pointer">
                                +1
                            </button>
                        </div>

                        {/* Submit Button */}
                        <button
                            onClick={handleSubmitClick}
                            disabled={!inputValue.trim()}
                            className={`w-full py-5 rounded-xl font-bold text-2xl flex items-center justify-center space-x-2 shadow-md transition-colors cursor-pointer ${inputValue.trim() ? 'bg-success-600 hover:bg-success-700 text-white active:scale-95' : 'bg-gray-300 dark:bg-slate-700 text-gray-500 dark:text-slate-500 cursor-not-allowed opacity-60'
                                }`}
                        >
                            <span>Submit Count</span>
                            <Check className="w-8 h-8" />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default MobileCounter;
