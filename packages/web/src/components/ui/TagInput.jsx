import React, { useState, useEffect } from 'react';
import api from '../../api';
import Icon from './Icon';
import { ICONS } from '../../constants';

const TagInput = ({ value, onChange }) => {
    const [inputValue, setInputValue] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [allTags, setAllTags] = useState([]);

    useEffect(() => {
        // Fetch all available tags once for autocomplete suggestions
        api.get('/tags').then(res => {
            setAllTags(res.data.map(t => t.tag_name));
        });
    }, []);

    const handleInputChange = (e) => {
        const newInputValue = e.target.value;
        setInputValue(newInputValue);

        if (newInputValue) {
            const filtered = allTags.filter(tag => 
                tag.toLowerCase().includes(newInputValue.toLowerCase()) && !value.includes(tag)
            );
            setSuggestions(filtered);
        } else {
            setSuggestions([]);
        }
    };

    const addTag = (tag) => {
        const trimmedTag = tag.trim();
        if (trimmedTag && !value.includes(trimmedTag)) {
            onChange([...value, trimmedTag]);
        }
        setInputValue('');
        setSuggestions([]);
    };

    const removeTag = (tagToRemove) => {
        onChange(value.filter(tag => tag !== tagToRemove));
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addTag(inputValue);
        } else if (e.key === 'Backspace' && !inputValue) {
            removeTag(value[value.length - 1]);
        }
    };

    return (
        <div className="relative">
            <div className="w-full px-3 py-2 border border-gray-300 rounded-lg flex flex-wrap items-center gap-2">
                {value.map((tag, index) => (
                    <span key={index} className="bg-blue-100 text-blue-800 text-sm font-medium px-2.5 py-0.5 rounded-full flex items-center">
                        {tag}
                        <button
                            type="button"
                            className="ml-2 text-blue-600 hover:text-blue-800"
                            onClick={() => removeTag(tag)}
                        >
                            <Icon path={ICONS.cancel} className="h-3 w-3" />
                        </button>
                    </span>
                ))}
                <input
                    type="text"
                    value={inputValue}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    className="flex-grow bg-transparent outline-none text-sm"
                    placeholder="Add tags..."
                />
            </div>
            {suggestions.length > 0 && (
                <ul className="absolute z-10 w-full bg-white border rounded-md mt-1 shadow-lg max-h-48 overflow-y-auto">
                    {suggestions.map((suggestion, index) => (
                        <li
                            key={index}
                            onClick={() => addTag(suggestion)}
                            className="px-4 py-2 hover:bg-blue-50 cursor-pointer text-sm"
                        >
                            {suggestion}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default TagInput;
