import React, { useState, useEffect } from 'react';
import axios from 'axios';

const PartNumberManager = ({ part, onSave, onCancel }) => {
    const [numbers, setNumbers] = useState([]);
    const [newNumbersString, setNewNumbersString] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchNumbers = async () => {
            if (part) {
                setLoading(true);
                try {
                    const response = await axios.get(`http://localhost:3001/api/parts/${part.part_id}/numbers`);
                    setNumbers(response.data);
                } catch (err) {
                    console.error("Failed to fetch part numbers", err);
                } finally {
                    setLoading(false);
                }
            }
        };
        fetchNumbers();
    }, [part]);

    const handleAddNumbers = async (e) => {
        e.preventDefault();
        if (!newNumbersString.trim()) return;

        try {
            const response = await axios.post(`http://localhost:3001/api/parts/${part.part_id}/numbers`, {
                numbersString: newNumbersString,
            });
            setNumbers(response.data); // Update the list with the response from the server
            setNewNumbersString(''); // Clear the input field
        } catch (err) {
            alert('Failed to add part numbers.');
            console.error(err);
        }
    };

    return (
        <div>
            <h3 className="text-md font-medium text-gray-800 mb-2">Existing Part Numbers</h3>
            {loading ? <p>Loading...</p> : (
                <ul className="list-disc list-inside bg-gray-50 p-3 rounded-md mb-4 h-32 overflow-y-auto">
                    {numbers.map(num => (
                        <li key={num.part_number_id} className="text-sm">{num.part_number}</li>
                    ))}
                    {numbers.length === 0 && <li className="text-sm text-gray-500">No part numbers added yet.</li>}
                </ul>
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
                <div className="mt-4 flex justify-end space-x-4">
                    <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Close</button>
                    <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Add Numbers</button>
                </div>
            </form>
        </div>
    );
};

export default PartNumberManager;
