import React, { useState, useMemo } from 'react';

const Combobox = ({ options, value, onChange, placeholder, allowCreate = false, onCreate }) => {
    const [inputValue, setInputValue] = useState('');
    const [isOpen, setIsOpen] = useState(false);

    const filteredOptions = useMemo(() => {
        if (!inputValue) return options;
        return options.filter(option =>
            option.label.toLowerCase().includes(inputValue.toLowerCase())
        );
    }, [inputValue, options]);

    const selectedLabel = useMemo(() => {
        return options.find(opt => opt.value === value)?.label || '';
    }, [value, options]);

    const exactMatch = options.some(option => option.label.toLowerCase() === inputValue.trim().toLowerCase());

    return (
        <div className="relative">
            <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={isOpen ? inputValue : selectedLabel}
                onChange={(e) => {
                    setInputValue(e.target.value);
                    if (!isOpen) setIsOpen(true);
                }}
                onFocus={() => setIsOpen(true)}
                onBlur={() => setTimeout(() => setIsOpen(false), 200)} // Delay to allow click
                placeholder={placeholder}
            />
            {isOpen && (
                <ul className="absolute z-10 w-full bg-white border rounded-md mt-1 shadow-lg max-h-60 overflow-y-auto">
                    {filteredOptions.map(option => (
                        <li
                            key={option.value}
                            className="px-4 py-2 hover:bg-blue-50 cursor-pointer"
                            onMouseDown={() => { // Use onMouseDown to fire before onBlur
                                onChange(option.value);
                                setInputValue('');
                                setIsOpen(false);
                            }}
                        >
                            {option.label}
                        </li>
                    ))}
                    {filteredOptions.length === 0 && (
                        <li className="px-4 py-2 text-gray-500">No options found</li>
                    )}

                    {allowCreate && inputValue.trim() !== '' && !exactMatch && (
                        <li
                            className="px-4 py-2 hover:bg-green-50 cursor-pointer text-green-600"
                            onMouseDown={() => {
                                onCreate && onCreate(inputValue.trim());
                                setInputValue('');
                                setIsOpen(false);
                            }}
                        >
                            Create "{inputValue.trim()}"
                        </li>
                    )}
                </ul>
            )}
        </div>
    );
};

export default Combobox;
