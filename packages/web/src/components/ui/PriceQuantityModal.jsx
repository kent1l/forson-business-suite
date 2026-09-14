import React, { useState, useEffect, useRef } from 'react';
import MathExpressionInput from './MathExpressionInput';
import api from '../../api';

const PriceQuantityModal = ({ item, onConfirm, onCancel }) => {
    const [price, setPrice] = useState(item.sale_price || 0);
    const [quantity, setQuantity] = useState(1);
    const [stockOnHand, setStockOnHand] = useState(
        item.stock_on_hand != null ? Number(item.stock_on_hand) : null
    );
    const priceInputRef = useRef(null);
    const priceValueRef = useRef(price);
    const quantityValueRef = useRef(quantity);

    useEffect(() => {
        priceValueRef.current = item.sale_price || 0;
        quantityValueRef.current = 1;
        setPrice(priceValueRef.current);
        setQuantity(quantityValueRef.current);
    }, [item.part_id, item.sale_price]);

    const wacCost = parseFloat(item?.wac_cost ?? 0);
    const isBelowWac = wacCost > 0 && typeof price === 'number' && price < wacCost - 0.005;

    // Selling below zero stays allowed — it is how walk-in sales of not-yet-received
    // stock get recorded — but the cashier should see it, since unexplained negative
    // stock is what makes an item's cost untrustworthy later.
    useEffect(() => {
        if (item.stock_on_hand != null || !item.part_id) return;
        let cancelled = false;
        api.get(`/parts/${item.part_id}`)
            .then(res => { if (!cancelled) setStockOnHand(Number(res.data?.stock_on_hand ?? 0)); })
            .catch(() => { /* the warning is advisory; never block adding an item on it */ });
        return () => { cancelled = true; };
    }, [item.part_id, item.stock_on_hand]);

    // This is the cashier's fastest path: replace the suggested price and press
    // Enter. MathExpressionInput selects on focus, so selecting here also makes
    // the existing price immediately replaceable.
    useEffect(() => {
        const frame = requestAnimationFrame(() => priceInputRef.current?.focus());
        return () => cancelAnimationFrame(frame);
    }, [item.part_id]);

    const handleSubmit = (e) => {
        e.preventDefault();
        const currentPrice = priceValueRef.current;
        const currentQuantity = quantityValueRef.current;
        if (wacCost > 0 && Number(currentPrice) < wacCost - 0.005) return;
        const p = typeof currentPrice === 'number' ? currentPrice : (parseFloat(currentPrice) || 0);
        const q = typeof currentQuantity === 'number' ? currentQuantity : (parseFloat(currentQuantity) || 1);
        onConfirm({ ...item, sale_price: p, quantity: q });
    };

    return (
        <form
            onSubmit={handleSubmit}
            onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    // MathExpressionInput normally consumes Enter to commit its
                    // expression. Submit explicitly so the POS flow remains a
                    // single keypress from either price or quantity.
                    e.preventDefault();
                    e.currentTarget.requestSubmit();
                }
            }}
        >
            <div className="space-y-4">
                {stockOnHand != null && stockOnHand - quantity < 0 && (
                    <div className="rounded-lg border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                        Stock on hand is {stockOnHand}. This sale will leave it at {stockOnHand - quantity}.
                        You can still proceed — post the goods receipt afterwards so the item&apos;s cost stays accurate.
                    </div>
                )}
                {isBelowWac && (
                    <div className="rounded-lg border border-red-300 dark:border-red-700/60 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-800 dark:text-red-200">
                        ₱{Number(price).toFixed(2)} is below this item&apos;s WAC (₱{wacCost.toFixed(2)}). Adjust the price.
                    </div>
                )}
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Sale Price</label>
                    <MathExpressionInput
                        ref={priceInputRef}
                        precision={2}
                        value={price}
                        onChange={(val) => {
                            priceValueRef.current = val;
                            setPrice(val);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 text-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Quantity</label>
                    <MathExpressionInput
                        precision={2}
                        value={quantity}
                        onChange={(val) => {
                            quantityValueRef.current = val;
                            setQuantity(val);
                        }}
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
                <button
                    type="submit"
                    disabled={isBelowWac}
                    className={`px-6 py-2 rounded-lg transition text-white ${isBelowWac ? 'bg-primary-400 dark:bg-primary-800 cursor-not-allowed opacity-60' : 'bg-primary-600 hover:bg-primary-700'}`}
                >
                    Add to Sale
                </button>
            </div>
        </form>
    );
};

export default PriceQuantityModal;
