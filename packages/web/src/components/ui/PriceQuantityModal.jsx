import React, { useState } from 'react';
import MathExpressionInput from './MathExpressionInput';

const PriceQuantityModal = ({ item, onConfirm, onCancel }) => {
    const [price, setPrice] = useState(item.sale_price || 0);
    const [quantity, setQuantity] = useState(1);

    const handleSubmit = (e) => {
        e.preventDefault();
        const p = typeof price === 'number' ? price : (parseFloat(price) || 0);
        const q = typeof quantity === 'number' ? quantity : (parseFloat(quantity) || 1);
        onConfirm({ ...item, sale_price: p, quantity: q });
    };

    return (
        <form onSubmit={handleSubmit}>
            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Sale Price</label>
                    <MathExpressionInput
                        precision={2}
                        value={price}
                        onChange={(val) => setPrice(val)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 text-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Quantity</label>
                    <MathExpressionInput
                        precision={2}
                        value={quantity}
                        onChange={(val) => setQuantity(val)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 text-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                        min={1}
                    />
                </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200 rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600 transition"
                    >
                        Cancel
                    </button>
                )}
                <button type="submit" className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition">
                    Add to Sale
                </button>
            </div>
        </form>
    );
};

export default PriceQuantityModal;
