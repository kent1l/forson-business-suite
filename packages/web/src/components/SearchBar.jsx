import React, { forwardRef } from 'react';

// Controlled search bar with an in-input clear (X) button.
// Props:
// - value: string
// - onChange: (value: string) => void
// - onClear: () => void
// - placeholder: string
// - disabled: boolean
// - className: string
const SearchBar = forwardRef(({
    value = '',
    onChange = () => {},
    onClear = () => {},
    placeholder = 'Search...',
    disabled = false,
    className = ''
}, ref) => {
    const showClear = value && value.length > 0 && !disabled;

    return (
        <div className={`relative ${className}`}>
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z" />
            </svg>
            <input
                ref={ref}
                type="text"
                role="searchbox"
                aria-label={placeholder}
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder}
                disabled={disabled}
                className="w-full px-3 py-2 pl-10 pr-10 border border-gray-300 rounded-lg"
            />

            <button
                type="button"
                onClick={() => { onClear(); }}
                aria-label="Clear search"
                className={`absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded-md focus:outline-none ${showClear ? 'text-gray-600 hover:bg-gray-100' : 'hidden'}`}
            >
                {/* simple X icon */}
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path fillRule="evenodd" d="M10 8.586L15.293 3.293a1 1 0 011.414 1.414L11.414 10l5.293 5.293a1 1 0 01-1.414 1.414L10 11.414l-5.293 5.293a1 1 0 01-1.414-1.414L8.586 10 3.293 4.707A1 1 0 014.707 3.293L10 8.586z" clipRule="evenodd" />
                </svg>
            </button>
        </div>
    );
});

export default SearchBar;
