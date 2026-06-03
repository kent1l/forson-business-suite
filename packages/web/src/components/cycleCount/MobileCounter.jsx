import React, { useState, useEffect, useRef } from 'react';
import { X, Check, Search } from 'lucide-react';
import api from '../../api';

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

    const handleSearch = async (e) => {
        const query = e.target.value;
        setSearchQuery(query);

        if (query.length < 3) {
            setSearchResults([]);
            return;
        }

        setSearching(true);
        try {
            // Re-using the parts search endpoint
            const res = await api.get(`/parts?search=${encodeURIComponent(query)}&limit=10`);
            setSearchResults(res.data.data || []);
        } catch (err) {
            console.error('Search failed', err);
        } finally {
            setSearching(false);
        }
    };

    const handleSelectPart = (part) => {
        setSelectedPart(part);
        setSearchQuery('');
        setSearchResults([]);
    };

    const handleNumpadClick = (num) => {
        if (inputValue === '0' && num !== '.') {
            setInputValue(num.toString());
        } else {
            setInputValue(prev => prev + num.toString());
        }
    };

    const handleClear = () => {
        setInputValue('');
    };

    const handleDelete = () => {
        setInputValue(prev => prev.slice(0, -1));
    };

    const handleSubmitClick = () => {
        if (!inputValue) return;

        const qty = parseFloat(inputValue);
        if (isNaN(qty) || qty < 0) return;

        if (isUnassigned) {
            if (!selectedPart) return;
            onSubmit(selectedPart.part_id, qty);
        } else {
            onSubmit(qty);
        }
    };

    const numpadButtons = [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
        ['C', 0, '⌫']
    ];

    return (
        <div className="flex flex-col h-full max-w-lg mx-auto bg-gray-50 border-x border-gray-200">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shadow-sm z-10">
                <button
                    onClick={onCancel}
                    className="p-2 -ml-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full"
                >
                    <X className="w-6 h-6" />
                </button>
                <div className="text-center font-medium text-gray-800">
                    {isUnassigned ? 'Unassigned Find' : `Item ${itemNumber} of ${totalItems}`}
                </div>
                <div className="w-10"></div> {/* Spacer to center title */}
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col">

                {/* Part Identification Area */}
                {isUnassigned && !selectedPart ? (
                    <div className="flex-1">
                        <div className="relative mb-4">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <Search className="h-5 w-5 text-gray-400" />
                            </div>
                            <input
                                ref={searchInputRef}
                                type="text"
                                className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-lg"
                                placeholder="Scan barcode or type SKU..."
                                value={searchQuery}
                                onChange={handleSearch}
                            />
                        </div>
                        {searching && <div className="text-center py-4 text-gray-500">Searching...</div>}
                        <div className="space-y-2">
                            {searchResults.map(part => (
                                <button
                                    key={part.part_id}
                                    onClick={() => handleSelectPart(part)}
                                    className="w-full text-left p-4 bg-white border border-gray-200 rounded-lg hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                                >
                                    <div className="font-bold text-gray-900">{part.internal_sku}</div>
                                    <div className="text-sm text-gray-600 truncate">{part.detail}</div>
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6 text-center">
                        <h2 className="text-3xl font-black text-gray-900 mb-2 tracking-tight">
                            {isUnassigned ? selectedPart.internal_sku : task.internal_sku}
                        </h2>
                        <p className="text-lg text-gray-600">
                            {isUnassigned ? selectedPart.detail : task.detail}
                        </p>
                        {isUnassigned && (
                            <button
                                onClick={() => setSelectedPart(null)}
                                className="mt-4 text-sm text-blue-600 hover:text-blue-800 font-medium"
                            >
                                Change Item
                            </button>
                        )}
                    </div>
                )}

                {/* Numpad Area (only show if we have a task or a selected part) */}
                {(!isUnassigned || selectedPart) && (
                    <div className="mt-auto">
                        {/* Display Input */}
                        <div className="bg-white border-2 border-blue-200 rounded-xl mb-4 p-4 text-center">
                            <span className={`text-5xl font-mono tracking-wider ${inputValue ? 'text-gray-900 font-bold' : 'text-gray-300'}`}>
                                {inputValue || '0'}
                            </span>
                        </div>

                        {/* Large Numpad */}
                        <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
                            {numpadButtons.flat().map((btn, idx) => {
                                const isAction = typeof btn === 'string';
                                return (
                                    <button
                                        key={idx}
                                        onClick={() => {
                                            if (btn === 'C') handleClear();
                                            else if (btn === '⌫') handleDelete();
                                            else handleNumpadClick(btn);
                                        }}
                                        className={`
                                            h-16 sm:h-20 rounded-xl text-2xl font-semibold transition-colors active:scale-95 shadow-sm
                                            ${isAction ? 'bg-gray-200 text-gray-700 hover:bg-gray-300' : 'bg-white border border-gray-200 text-gray-900 hover:bg-gray-50'}
                                        `}
                                    >
                                        {btn}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Submit Button */}
                        <button
                            onClick={handleSubmitClick}
                            disabled={!inputValue}
                            className={`w-full py-5 rounded-xl font-bold text-2xl flex items-center justify-center space-x-2 shadow-md transition-colors ${
                                inputValue ? 'bg-green-600 hover:bg-green-700 text-white active:scale-95' : 'bg-gray-300 text-gray-500 cursor-not-allowed'
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
