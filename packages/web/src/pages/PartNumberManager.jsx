import { useState, useEffect, useCallback } from 'react';
import api from '../api';
import toast from 'react-hot-toast';

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
                onSave();
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
                onSave();
                return 'Order saved successfully!';
            },
            error: 'Failed to save order.'
        });
    };

    return (
        <div className="p-4 space-y-4">
            <div className="text-xs text-gray-500">Total numbers: {numbers.length}</div>
            {loading ? (
                <div className="text-sm text-gray-500">Loading numbers...</div>
            ) : (
                <div className="bg-gray-50 p-3 rounded-md max-h-56 min-h-24 overflow-y-auto">
                    {numbers.length > 0 ? (
                        numbers.map((num, index) => (
                            <div key={num.part_number_id} className="flex justify-between items-center py-2 text-sm border-b last:border-b-0">
                                <span className="font-mono">{num.part_number}</span>
                                <div className="flex gap-1">
                                    <button
                                        type="button"
                                        title="Move up"
                                        aria-label={`Move ${num.part_number} up`}
                                        onClick={() => moveNumber(index, -1)}
                                        disabled={index === 0}
                                        className="p-1 rounded hover:bg-gray-100 disabled:opacity-40"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                                            <path fillRule="evenodd" d="M3.22 12.78a.75.75 0 0 1 0-1.06l6-6a.75.75 0 0 1 1.06 0l6 6a.75.75 0 1 1-1.06 1.06L10 7.56l-5.72 5.72a.75.75 0 0 1-1.06 0Z" clipRule="evenodd" />
                                        </svg>
                                    </button>
                                    <button
                                        type="button"
                                        title="Move down"
                                        aria-label={`Move ${num.part_number} down`}
                                        onClick={() => moveNumber(index, 1)}
                                        disabled={index === numbers.length - 1}
                                        className="p-1 rounded hover:bg-gray-100 disabled:opacity-40"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                                            <path fillRule="evenodd" d="M16.78 7.22a.75.75 0 0 1 0 1.06l-6 6a.75.75 0 0 1-1.06 0l-6-6A.75.75 0 0 1 4.72 7.22L10 12.5l5.28-5.28a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        ))
                    ) : (
                        <p className="text-sm text-gray-500">No part numbers added yet.</p>
                    )}
                </div>
            )}

            <form onSubmit={handleAddNumbers} className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Add New Numbers</label>
                <p className="text-xs text-gray-500">Enter one or more part numbers, separated by commas or semicolons.</p>
                <textarea
                    value={newNumbersString}
                    onChange={(e) => setNewNumbersString(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    rows="3"
                    placeholder="OEM123, MFG456; ALT789"
                />
                <div className="flex justify-end">
                    <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">Add Numbers</button>
                </div>
            </form>

            <div className="flex justify-between items-center pt-4 border-t">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-4 py-2 bg-gray-200 text-gray-800 text-sm rounded-lg hover:bg-gray-300"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={handleSaveOrder}
                    disabled={numbers.length < 2}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-40"
                >
                    Save Order
                </button>
            </div>
        </div>
    );
};

export default PartNumberManager;