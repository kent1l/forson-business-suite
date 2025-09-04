import { useState, useCallback, useEffect } from 'react';

// useTypeahead - centralized keyboard navigation and ARIA wiring for typeahead/listbox dropdowns
// options: { items: array, onSelect: (item) => void, inputId: string, listboxId: string }
export default function useTypeahead({ items = [], onSelect = () => {}, inputId = 'typeahead-input', listboxId = 'typeahead-listbox' } = {}) {
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  // clamp highlighted index when items change
  useEffect(() => {
    if (!items || items.length === 0) {
      setHighlightedIndex(-1);
    } else if (highlightedIndex >= items.length) {
      setHighlightedIndex(items.length - 1);
    }
  }, [items, highlightedIndex]);

  const handleKeyDown = useCallback((e) => {
    if (!items || items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < items.length) {
        onSelect(items[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      // clear highlight on escape (caller may clear results)
      setHighlightedIndex(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setHighlightedIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setHighlightedIndex(items.length - 1);
    }
  }, [items, highlightedIndex, onSelect]);

  const getInputProps = useCallback(() => ({
    id: inputId,
    onKeyDown: handleKeyDown,
    'aria-controls': listboxId,
    'aria-expanded': items && items.length > 0,
    'aria-activedescendant': highlightedIndex >= 0 ? `${listboxId}-item-${highlightedIndex}` : undefined,
  }), [inputId, listboxId, handleKeyDown, items, highlightedIndex]);

  const getItemProps = useCallback((index) => ({
    id: `${listboxId}-item-${index}`,
    role: 'option',
    'aria-selected': index === highlightedIndex,
    onMouseEnter: () => setHighlightedIndex(index),
    onClick: () => {
      setHighlightedIndex(-1);
      onSelect(items[index]);
    }
  }), [listboxId, highlightedIndex, onSelect, items]);

  const reset = useCallback(() => setHighlightedIndex(-1), []);

  return { highlightedIndex, setHighlightedIndex, getInputProps, getItemProps, reset, listboxId, inputId };
}
