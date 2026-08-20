import { useState, useEffect, useCallback } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';

// A simple spinner component for loading states
// eslint-disable-next-line no-unused-vars -- Referenced in JSX below
const Spinner = () => (
    <div className="flex justify-center items-center h-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-700"></div>
    </div>
);

// Up/Down Chevron Icons for reordering
// eslint-disable-next-line no-unused-vars -- Referenced in JSX below
const MoveUpIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
    </svg>
);

// eslint-disable-next-line no-unused-vars -- Referenced in JSX below
const MoveDownIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
);


// eslint-disable-next-line no-unused-vars -- Referenced in JSX below
const TrashIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM8 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 10-2 0v6a1 1 0 102 0V8z" clipRule="evenodd" />
    </svg>
);

const PartNumberManager = ({ part, onSave, onCancel }) => {
    const [numbers, setNumbers] = useState([]);
    const [newNumbersString, setNewNumbersString] = useState('');
    const [loading, setLoading] = useState(true);
    const [confirming, setConfirming] = useState(null); // part_number object pending removal
    const [removingId, setRemovingId] = useState(null);
    const { hasPermission } = useAuth();

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

    const handleRemove = async () => {
        if (!confirming) return;
        setRemovingId(confirming.part_number_id);
        try {
            await api.delete(`/parts/${part.part_id}/numbers/${confirming.part_number_id}`);
            toast.success('Part number removed');
            // Optimistic update
            setNumbers(prev => prev.filter(n => n.part_number_id !== confirming.part_number_id));
            setConfirming(null);
            onSave();
        } catch (err) {
            if (err?.response?.status === 400) {
                toast.error(err.response.data.message || 'Cannot remove last part number');
            } else if (err?.response?.status === 404) {
                toast.error('Part number already removed');
            } else {
                toast.error('Failed to remove part number');
            }
        } finally {
            setRemovingId(null);
        }
    };

    return (
        // Use a more spacious and consistent padding and vertical gap
        <div className="p-6 flex flex-col gap-6 bg-white dark:bg-slate-800">
            {/* Section for displaying existing numbers */}
            <div>
                <h3 className="text-sm font-medium text-slate-800 dark:text-slate-100 mb-1">Existing Numbers ({numbers.length})</h3>
                <div className="border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900/50 max-h-60 overflow-y-auto">
                    {loading ? (
                        <Spinner />
                    ) : (
                        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
                            {numbers.length > 0 ? (
                                numbers.map((num, index) => (
                                    <li key={num.part_number_id} className="flex justify-between items-center p-3 text-sm group hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors">
                                        <span className="font-mono text-slate-800 dark:text-slate-200" title={index === 0 ? 'Primary alias (top order)' : undefined}>{num.part_number}</span>
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                type="button"
                                                title="Move up"
                                                aria-label={`Move ${num.part_number} up`}
                                                onClick={() => moveNumber(index, -1)}
                                                disabled={index === 0}
                                                className="p-1 rounded text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 disabled:hover:bg-transparent"
                                            >
                                                <MoveUpIcon />
                                            </button>
                                            <button
                                                type="button"
                                                title="Move down"
                                                aria-label={`Move ${num.part_number} down`}
                                                onClick={() => moveNumber(index, 1)}
                                                disabled={index === numbers.length - 1}
                                                className="p-1 rounded text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 disabled:hover:bg-transparent"
                                            >
                                               <MoveDownIcon />
                                            </button>
                                            {hasPermission('parts:edit') && (
                                                <button
                                                    type="button"
                                                    title="Remove part number"
                                                    aria-label={`Remove ${num.part_number}`}
                                                    onClick={() => setConfirming(num)}
                                                    className="p-1 rounded text-danger-500 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/30 hover:text-danger-600"
                                                >
                                                    <TrashIcon />
                                                </button>
                                            )}
                                        </div>
                                    </li>
                                ))
                            ) : (
                                <p className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">No part numbers found.</p>
                            )}
                        </ul>
                    )}
                </div>
            </div>

            {/* Form for adding new numbers */}
            <form onSubmit={handleAddNumbers} className="space-y-3">
                 <div>
                    <label htmlFor="new-numbers-input" className="block text-sm font-medium text-slate-800 dark:text-slate-100">Add New Numbers</label>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Enter numbers separated by commas, semicolons, or new lines.</p>
                </div>
                <textarea
                    id="new-numbers-input"
                    value={newNumbersString}
                    onChange={(e) => setNewNumbersString(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 rounded-lg shadow-xs font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 transition"
                    rows="3"
                    placeholder="e.g., OEM123, MFG456; ALT789"
                />
                <div className="flex justify-end">
                    <button 
                      type="submit" 
                      className="inline-flex justify-center py-2 px-4 border border-transparent shadow-xs text-sm font-medium rounded-lg text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors"
                    >
                      Add Numbers
                    </button>
                </div>
            </form>

            {/* Modal footer with action buttons */}
            <div className="flex justify-end items-center gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
                <button
                    type="button"
                    onClick={onCancel}
                    className="py-2 px-4 text-sm font-medium text-slate-700 dark:text-slate-200 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 border border-slate-300 dark:border-slate-600 rounded-lg shadow-xs transition-colors"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={handleSaveOrder}
                    disabled={numbers.length < 2}
                    className="inline-flex justify-center py-2 px-4 border border-transparent shadow-xs text-sm font-medium rounded-lg text-white bg-success-600 hover:bg-success-700 focus:outline-none focus:ring-2 focus:ring-success-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    Save Order
                </button>
            </div>

            {confirming && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-xl w-full max-w-md p-6 space-y-4">
                        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Remove Part Number</h4>
                        <p className="text-sm text-slate-600 dark:text-slate-300">
                            Remove alias <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{confirming.part_number}</span> from this item?
                            The item remains available. This action cannot be undone.
                        </p>
                        {numbers.length === 1 && (
                            <p className="text-xs text-danger-600 dark:text-danger-400 font-medium">You must keep at least one part number.</p>
                        )}
                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => setConfirming(null)}
                                className="px-4 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={numbers.length === 1 || removingId === confirming.part_number_id}
                                onClick={handleRemove}
                                className="px-4 py-2 text-sm rounded-lg bg-danger-600 text-white hover:bg-danger-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-xs"
                            >
                                {removingId === confirming.part_number_id ? 'Removing...' : 'Remove'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PartNumberManager;
