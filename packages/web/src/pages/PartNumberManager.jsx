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
        <div>
            <h3 className="text-md font-medium text-gray-800 mb-2">Part Numbers</h3>
            {loading ? <p>Loading...</p> : (
                <div className="bg-gray-50 p-3 rounded-md mb-4 h-32 overflow-y-auto">
                    {numbers.map((num, index) => (
                        <div key={num.part_number_id} className="flex justify-between items-center py-1 text-sm">
                            <span>{num.part_number}</span>
                            <div className="flex space-x-2">
                                <button onClick={() => moveNumber(index, -1)} disabled={index === 0} className="disabled:opacity-25">↑</button>
                                <button onClick={() => moveNumber(index, 1)} disabled={index === numbers.length - 1} className="disabled:opacity-25">↓</button>
                            </div>
                        </div>
                    ))}
                    {numbers.length === 0 && <p className="text-sm text-gray-500">No part numbers added yet.</p>}
                </div>
            )}

            <form onSubmit={handleAddNumbers}>
                <label className="block text-sm font-medium text-gray-700 mb-1">Add New Numbers</label>
                <p className="text-xs text-gray-500 mb-2">Enter one or more part numbers, separated by commas or semicolons.</p>
                <textarea
                    value={newNumbersString}
                    onChange={(e) => setNewNumbersString(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    rows="3"
                    placeholder="OEM123, MFG456; ALT789"
                />
                 <div className="mt-2 flex justify-end">
                    <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">Add Numbers</button>
                </div>
            </form>
            <div className="mt-6 flex justify-between items-center pt-4 border-t">
                <button type="button" onClick={handleSaveOrder} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">Save Order</button>
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Close</button>
            </div>
        </div>
    );
};

export default PartNumberManager;
