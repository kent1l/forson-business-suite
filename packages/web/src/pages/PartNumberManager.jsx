import { useState, useEffect, useCallback } from 'react';
import api from '../api';
import toast from 'react-hot-toast';

// A simple spinner component for loading states
const Spinner = () => (
    <div className="flex justify-center items-center h-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-700"></div>
    </div>
);

// Up/Down Chevron Icons for reordering
const MoveUpIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
    </svg>
);

const MoveDownIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
);


const PartNumberManager = ({ part, onSave, onCancel }) => {
    const [numbers, setNumbers] = useState([]);
    const [newNumbersString, setNewNumbersString] = useState('');
    const [loading, setLoading] = useState(true);

    const fetchNumbers = useCallback(async () => {
        if (part) {
            setLoading(true);
            try {
                const response = await api.get(`/parts/${part.part_id}/numbers`);
                setNumbers(response.data);
            } catch (err) {
                console.error("Failed to fetch part numbers", err);
                toast.error("Could not load part numbers.");
            } finally {
                setLoading(false);
            }
        }
    }, [part]);

    useEffect(() => {
        fetchNumbers();
    }, [fetchNumbers]);

    const handleAddNumbers = async (e) => {
        e.preventDefault();
        if (!newNumbersString.trim()) return;

        const promise = api.post(`/parts/${part.part_id}/numbers`, {
            numbersString: newNumbersString,
        });

        toast.promise(promise, {
            loading: 'Adding numbers...',
            success: (response) => {
                setNumbers(response.data);
                setNewNumbersString('');
                onSave(); // Refresh the parent component's data
                return 'Numbers added successfully!';
            },
            error: 'Failed to add numbers.'
        });
    };
    
    const moveNumber = (index, direction) => {
        const newNumbers = [...numbers];
        const [movedItem] = newNumbers.splice(index, 1);
        newNumbers.splice(index + direction, 0, movedItem);
        setNumbers(newNumbers);
    };

    const handleSaveOrder = async () => {
        const orderedIds = numbers.map(num => num.part_number_id);
        const promise = api.put(`/parts/${part.part_id}/numbers/reorder`, { orderedIds });

        toast.promise(promise, {
            loading: 'Saving order...',
            success: () => {
                onSave(); // Refresh the parent component's data
                return 'Order saved successfully!';
            },
            error: 'Failed to save order.'
        });
    };

    return (
        // Use a more spacious and consistent padding and vertical gap
        <div className="p-6 flex flex-col gap-6 bg-white">
            {/* Section for displaying existing numbers */}
            <div>
                <h3 className="text-sm font-medium text-slate-800 mb-1">Existing Numbers ({numbers.length})</h3>
                <div className="border rounded-lg bg-slate-50 max-h-60 overflow-y-auto">
                    {loading ? (
                        <Spinner />
                    ) : (
                        <ul className="divide-y divide-slate-200">
                            {numbers.length > 0 ? (
                                numbers.map((num, index) => (
                                    <li key={num.part_number_id} className="flex justify-between items-center p-3 text-sm group hover:bg-slate-100 transition-colors">
                                        <span className="font-mono text-slate-700">{num.part_number}</span>
                                        {/* Reorder controls, more subtle and appear on group hover */}
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                type="button"
                                                title="Move up"
                                                aria-label={`Move ${num.part_number} up`}
                                                onClick={() => moveNumber(index, -1)}
                                                disabled={index === 0}
                                                className="p-1 rounded text-slate-500 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
                                            >
                                                <MoveUpIcon />
                                            </button>
                                            <button
                                                type="button"
                                                title="Move down"
                                                aria-label={`Move ${num.part_number} down`}
                                                onClick={() => moveNumber(index, 1)}
                                                disabled={index === numbers.length - 1}
                                                className="p-1 rounded text-slate-500 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
                                            >
                                               <MoveDownIcon />
                                            </button>
                                        </div>
                                    </li>
                                ))
                            ) : (
                                <p className="p-8 text-center text-sm text-slate-500">No part numbers found.</p>
                            )}
                        </ul>
                    )}
                </div>
            </div>

            {/* Form for adding new numbers */}
            <form onSubmit={handleAddNumbers} className="space-y-3">
                 <div>
                    <label htmlFor="new-numbers-input" className="block text-sm font-medium text-slate-800">Add New Numbers</label>
                    <p className="text-xs text-slate-500 mt-1">Enter numbers separated by commas, semicolons, or new lines.</p>
                </div>
                <textarea
                    id="new-numbers-input"
                    value={newNumbersString}
                    onChange={(e) => setNewNumbersString(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                    rows="3"
                    placeholder="e.g., OEM123, MFG456; ALT789"
                />
                <div className="flex justify-end">
                    <button 
                      type="submit" 
                      className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                    >
                      Add Numbers
                    </button>
                </div>
            </form>

            {/* Modal footer with action buttons */}
            <div className="flex justify-end items-center gap-4 pt-4 border-t border-slate-200">
                <button
                    type="button"
                    onClick={onCancel}
                    className="py-2 px-4 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={handleSaveOrder}
                    disabled={numbers.length < 2}
                    className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Save Order
                </button>
            </div>
        </div>
    );
};

export default PartNumberManager;
