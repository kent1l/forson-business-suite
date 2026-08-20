import React, { useState, useEffect, useRef } from 'react';

const PriceQuantityModal = ({ item, onConfirm, onCancel }) => {
    const [price, setPrice] = useState(item.sale_price || 0);
    const [quantity, setQuantity] = useState(1);
    const priceInputRef = useRef(null);

    useEffect(() => {
        if (priceInputRef.current) {
            priceInputRef.current.select();
        }
    }, []);

    const handleSubmit = (e) => {
        e.preventDefault();
        onConfirm({ ...item, sale_price: parseFloat(price), quantity: parseInt(quantity, 10) });
    };

    return (
        <form onSubmit={handleSubmit}>
            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Sale Price</label>
                    <input
                        ref={priceInputRef}
                        type="number"
                        step="0.01"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 text-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Quantity</label>
                    <input
                        type="number"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 text-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                        min="1"
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
