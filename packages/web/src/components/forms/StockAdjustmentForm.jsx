import React, { useState } from 'react';
import toast from 'react-hot-toast';

const StockAdjustmentForm = ({ part, user, onSave, onCancel }) => {
    const [quantity, setQuantity] = useState('');
    const [notes, setNotes] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        
        const numericQuantity = parseFloat(quantity);
        if (isNaN(numericQuantity) || numericQuantity === 0) {
            return toast.error('Please enter a valid, non-zero quantity.');
        }

        const payload = {
            part_id: part.part_id,
            quantity: numericQuantity,
            notes,
            employee_id: user.employee_id, // This will now work correctly
        };
        onSave(payload);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    Adjustment Quantity
                </label>
                <p className="text-xs text-gray-500 mb-2">Enter a positive number to add stock (e.g., 5) or a negative number to remove stock (e.g., -2).</p>
                <input 
                    type="number"
                    step="any"
                    value={quantity} 
                    onChange={(e) => setQuantity(e.target.value)} 
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg" 
                    required 
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason / Notes</label>
                <textarea 
                    value={notes} 
                    onChange={(e) => setNotes(e.target.value)} 
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg" 
                    rows="3"
                    placeholder="e.g., Stock count correction, Damaged item"
                ></textarea>
            </div>
            <div className="mt-6 flex justify-end space-x-4">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save Adjustment</button>
            </div>
        </form>
    );
};

export default StockAdjustmentForm;
