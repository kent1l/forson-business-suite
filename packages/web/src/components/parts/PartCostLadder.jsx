import React from 'react';
import InfoTip from '../ui/InfoTip';
import { formatCurrency } from '../../utils/currency';

/**
 * The four figures that describe what a part costs and what it sells for, shown in the
 * order money actually moves through them:
 *
 *   supplier unit cost → landed cost → weighted average cost → sale price
 *
 * Each is a *last recorded* value, not a live calculation, and each comes from a
 * different place — so the component also carries where it came from and when. That
 * provenance is the point: a landed cost from a receipt six months ago and a WAC that
 * moved yesterday look identical as bare numbers, and staff pricing an item off the
 * shelf need to be able to tell them apart.
 *
 * Kept as its own component because the same ladder belongs anywhere a part is
 * inspected (power search, inventory, the parts form), and those views should not each
 * invent their own labels and rounding for the same four numbers.
 */

const formatDate = (value) => {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
};

/** Treats null, undefined and the 0.00 default as "never recorded" — the column
 *  defaults to 0.00 for every legacy part, so a bare 0 is not evidence of a price. */
const hasValue = (value) => value !== null && value !== undefined && Number(value) !== 0;

const Figure = ({ label, value, hint, source, tone = 'default' }) => (
    <div className="flex-1 min-w-[8.5rem]">
        <div className="text-xs font-medium text-gray-500 dark:text-slate-400 uppercase flex items-center gap-1">
            {label}
            {hint && <InfoTip label={label}>{hint}</InfoTip>}
        </div>
        <div
            className={`font-mono font-semibold mt-0.5 ${
                tone === 'price'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-gray-900 dark:text-slate-100'
            }`}
        >
            {hasValue(value) ? formatCurrency(value) : <span className="text-gray-400 dark:text-slate-500">—</span>}
        </div>
        {source && <div className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">{source}</div>}
    </div>
);

const PartCostLadder = ({ part, className = '' }) => {
    if (!part) return null;

    const receiptDate = formatDate(part.last_receipt_date);
    const receiptSource = part.last_receipt_grn_number
        ? [part.last_receipt_grn_number, receiptDate].filter(Boolean).join(' · ')
        : null;

    // part.last_cost is the landed cost of the most recent StockIn of any kind, which
    // is not always a purchase. Prefer the receipt line when one exists, and say so.
    const landedCost = hasValue(part.last_receipt_landed_cost)
        ? part.last_receipt_landed_cost
        : part.last_cost;
    const landedSource = hasValue(part.last_receipt_landed_cost)
        ? receiptSource
        : formatDate(part.last_cost_date);

    return (
        <div
            className={`flex flex-wrap gap-x-6 gap-y-4 bg-gray-50 dark:bg-slate-900/50 p-4 rounded-xl border border-gray-100 dark:border-slate-700 ${className}`}
        >
            <Figure
                label="Unit Cost"
                value={part.last_receipt_unit_cost}
                source={receiptSource}
                hint="What the supplier invoiced per unit on the most recent posted receipt, before freight and discounts."
            />
            <Figure
                label="Landed Cost"
                value={landedCost}
                source={landedSource}
                hint="Unit cost after line discounts, this part's share of the delivery charge, and the receipt's overall discount. This is the figure that posts to inventory and drives WAC."
            />
            <Figure
                label="WAC"
                value={part.wac_cost}
                source={formatDate(part.last_cost_date)}
                hint="Weighted Average Cost — the average landed cost across the units on hand, recalculated every time stock is received at a different price."
            />
            <Figure
                label="Sale Price"
                value={part.last_sale_price}
                tone="price"
                source={formatDate(part.last_sale_price_date)}
                hint="The current shelf price. Set on the receipt that last synced prices to the catalogue, or edited directly on the part."
            />
        </div>
    );
};

export default PartCostLadder;
