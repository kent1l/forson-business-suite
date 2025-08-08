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
                    <label className="block text-sm font-medium text-gray-700 mb-1">Sale Price</label>
                    <input
                        ref={priceInputRef}
                        type="number"
                        step="0.01"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-lg"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
                    <input
                        type="number"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-lg"
                        min="1"
                    />
                </div>
            </div>
            <div className="mt-6 flex justify-end">
                <button type="submit" className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    Add to Sale
                </button>
            </div>
        </form>
    );
};

export default PriceQuantityModal;
