import { useState, useMemo, useRef, useEffect } from 'react';

const Combobox = ({ options, value, onChange, placeholder, allowCreate = false, onCreate }) => {
    const [inputValue, setInputValue] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const inputRef = useRef(null);
    const listRef = useRef(null);

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

    // Reset highlighted index when options change
    useEffect(() => {
        setHighlightedIndex(-1);
    }, [filteredOptions]);

    // Scroll highlighted option into view
    useEffect(() => {
        if (highlightedIndex >= 0 && listRef.current) {
            const highlightedElement = listRef.current.children[highlightedIndex];
            if (highlightedElement) {
                highlightedElement.scrollIntoView({
                    block: 'nearest',
                    behavior: 'smooth'
                });
            }
        }
    }, [highlightedIndex]);

    const handleKeyDown = (e) => {
        if (!isOpen) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIsOpen(true);
                setHighlightedIndex(0);
            }
            return;
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setHighlightedIndex(prev => 
                    prev < filteredOptions.length - 1 ? prev + 1 : 0
                );
                break;
            case 'ArrowUp':
                e.preventDefault();
                setHighlightedIndex(prev => 
                    prev > 0 ? prev - 1 : filteredOptions.length - 1
                );
                break;
            case 'Enter':
                e.preventDefault();
                if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
                    handleSelect(filteredOptions[highlightedIndex]);
                } else if (allowCreate && inputValue.trim() !== '' && !exactMatch) {
                    handleCreate();
                }
                break;
            case 'Escape':
                e.preventDefault();
                setIsOpen(false);
                setHighlightedIndex(-1);
                setInputValue('');
                inputRef.current?.blur();
                break;
            default:
                break;
        }
    };

    const handleSelect = (option) => {
        onChange(option.value);
        setInputValue('');
        setIsOpen(false);
        setHighlightedIndex(-1);
    };

    const handleCreate = () => {
        if (onCreate && inputValue.trim() !== '') {
            onCreate(inputValue.trim());
            setInputValue('');
            setIsOpen(false);
            setHighlightedIndex(-1);
        }
    };

    const handleInputChange = (e) => {
        setInputValue(e.target.value);
        if (!isOpen) setIsOpen(true);
        setHighlightedIndex(-1); // Reset highlight when typing
    };

    const handleFocus = () => {
        setIsOpen(true);
    };

    const handleBlur = () => {
        // Delay to allow click events to fire
        setTimeout(() => {
            setIsOpen(false);
            setHighlightedIndex(-1);
        }, 200);
    };

    return (
        <div className="relative">
            <input
                ref={inputRef}
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={isOpen ? inputValue : selectedLabel}
                onChange={handleInputChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                role="combobox"
                aria-expanded={isOpen}
                aria-haspopup="listbox"
                aria-autocomplete="list"
            />
            {isOpen && (
                <ul 
                    ref={listRef}
                    className="absolute z-10 w-full bg-white border rounded-md mt-1 shadow-lg max-h-60 overflow-y-auto"
                    role="listbox"
                >
                    {filteredOptions.map((option, index) => (
                        <li
                            key={option.value}
                            className={`px-4 py-2 cursor-pointer ${
                                index === highlightedIndex 
                                    ? 'bg-blue-100 text-blue-900' 
                                    : 'hover:bg-blue-50'
                            }`}
                            onMouseDown={() => handleSelect(option)}
                            onMouseEnter={() => setHighlightedIndex(index)}
                            role="option"
                            aria-selected={index === highlightedIndex}
                        >
                            {option.label}
                        </li>
                    ))}
                    {filteredOptions.length === 0 && (
                        <li className="px-4 py-2 text-gray-500" role="option">
                            No options found
                        </li>
                    )}

                    {allowCreate && inputValue.trim() !== '' && !exactMatch && (
                        <li
                            className={`px-4 py-2 cursor-pointer ${
                                highlightedIndex === filteredOptions.length 
                                    ? 'bg-green-100 text-green-800' 
                                    : 'hover:bg-green-50 text-green-600'
                            }`}
                            onMouseDown={handleCreate}
                            onMouseEnter={() => setHighlightedIndex(filteredOptions.length)}
                            role="option"
                            aria-selected={highlightedIndex === filteredOptions.length}
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
