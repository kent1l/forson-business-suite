import React from 'react';
import Icon from './Icon';
import { ICONS } from '../../constants';

const QuantityInput = ({ value, onChange, onFocus, onMouseUp, className = '' }) => {
    const handleIncrement = () => {
        onChange(parseInt(value, 10) + 1);
    };

    const handleDecrement = () => {
        onChange(Math.max(1, parseInt(value, 10) - 1)); // Prevent going below 1
    };

    const handleChange = (e) => {
        const intValue = parseInt(e.target.value, 10);
        onChange(isNaN(intValue) ? 1 : intValue);
    };

    return (
        <div className={`flex items-center justify-center space-x-1 ${className}`}>
            <button
                type="button"
                onClick={handleDecrement}
                className="p-1.5 rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label="Decrease quantity"
            >
                <Icon path={ICONS.minus} className="h-4 w-4" />
            </button>
            <input
                type="number"
                value={value}
                onChange={handleChange}
                onFocus={onFocus}
                onMouseUp={onMouseUp}
                className="w-16 p-1 border border-gray-300 rounded-md text-center font-semibold"
                min="1"
            />
            <button
                type="button"
                onClick={handleIncrement}
                className="p-1.5 rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label="Increase quantity"
            >
                <Icon path={ICONS.plus} className="h-4 w-4" />
            </button>
        </div>
    );
};

export default QuantityInput;
