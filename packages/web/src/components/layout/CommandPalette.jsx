import { useState, useEffect, useMemo, useRef } from 'react';
import Fuse from 'fuse.js';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';
import { useAuth } from '../../contexts/AuthContext';
import { getAllNavItems } from '../../config/navigation';
import useRecentPages from '../../hooks/useRecentPages';

const Kbd = ({ children }) => (
    <kbd className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-[10px] font-mono text-slate-500 dark:text-slate-400">
        {children}
    </kbd>
);

// ─── One result row ──────────────────────────────────────────────────────
function ResultRow({ item, isHighlighted, onSelect, setHighlighted, listIndex }) {
    return (
        <li
            role="option"
            aria-selected={isHighlighted}
            data-index={listIndex}
            onMouseDown={(e) => { e.preventDefault(); onSelect(item); }}
            onMouseEnter={() => setHighlighted(listIndex)}
            className={[
                'flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer select-none',
                isHighlighted ? 'bg-primary-600 text-white' : 'text-slate-700 dark:text-slate-200',
            ].join(' ')}
        >
            <Icon
                path={item.icon}
                className={['h-4 w-4 shrink-0', isHighlighted ? 'text-white' : 'text-slate-400 dark:text-slate-500'].join(' ')}
            />
            <span className="flex-1 truncate text-sm font-medium">{item.name}</span>
            {item.categoryTitle && (
                <span className={['text-[11px] shrink-0', isHighlighted ? 'text-white/70' : 'text-slate-400 dark:text-slate-500'].join(' ')}>
                    {item.categoryTitle}
                </span>
            )}
            {item.external && (
                <Icon path={ICONS.chevronRight} className={['h-3 w-3 shrink-0 -rotate-45', isHighlighted ? 'text-white/70' : 'text-slate-400'].join(' ')} />
            )}
        </li>
    );
}

// ─── Group section (Recent / Frequent / category headers) ──────────────
function ResultGroup({ label, items, highlightedIndex, onSelect, setHighlighted, indexOffset }) {
    if (items.length === 0) return null;
    return (
        <div className="mb-2">
            <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                {label}
            </div>
            <ul role="group">
                {items.map((item, i) => (
                    <ResultRow
                        key={item.id}
                        item={item}
                        listIndex={indexOffset + i}
                        isHighlighted={highlightedIndex === indexOffset + i}
                        onSelect={onSelect}
                        setHighlighted={setHighlighted}
                    />
                ))}
            </ul>
        </div>
    );
}

const CommandPalette = ({ isOpen, setIsOpen, onNavigate }) => {
    const { hasPermission } = useAuth();
    const { recent, frequent } = useRecentPages();
    const [query, setQuery] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const inputRef = useRef(null);
    const listRef = useRef(null);

    const permittedItems = useMemo(
        () => getAllNavItems().filter(item => hasPermission(item.permission)),
        [hasPermission]
    );

    const fuse = useMemo(() => new Fuse(permittedItems, {
        keys: [
            { name: 'name', weight: 1 },
            { name: 'keywords', weight: 0.6 },
            { name: 'categoryTitle', weight: 0.3 },
        ],
        threshold: 0.4,
        ignoreLocation: true,
    }), [permittedItems]);

    const searchResults = useMemo(() => {
        if (!query.trim()) return null;
        return fuse.search(query.trim()).map(result => result.item);
    }, [fuse, query]);

    // Grouped sections to render, each { label, items } — flattened for keyboard indexing.
    const groups = useMemo(() => {
        if (searchResults) {
            const byCategory = new Map();
            for (const item of searchResults) {
                const key = item.categoryTitle || 'Quick Access';
                if (!byCategory.has(key)) byCategory.set(key, []);
                byCategory.get(key).push(item);
            }
            return [...byCategory.entries()].map(([label, items]) => ({ label, items }));
        }

        const sections = [];
        if (recent.length) sections.push({ label: 'Recent', items: recent });
        if (frequent.length) sections.push({ label: 'Frequent', items: frequent });
        if (sections.length === 0) sections.push({ label: 'Quick Access', items: permittedItems.slice(0, 8) });
        return sections;
    }, [searchResults, recent, frequent, permittedItems]);

    const flatItems = useMemo(() => groups.flatMap(g => g.items), [groups]);

    useEffect(() => {
        setHighlightedIndex(0);
    }, [groups]);

    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setHighlightedIndex(0);
            // Autofocus after the element mounts.
            const id = setTimeout(() => inputRef.current?.focus(), 0);
            return () => clearTimeout(id);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!listRef.current) return;
        const el = listRef.current.querySelector(`[data-index="${highlightedIndex}"]`);
        el?.scrollIntoView({ block: 'nearest' });
    }, [highlightedIndex]);

    useEffect(() => {
        const handler = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setIsOpen(o => !o);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [setIsOpen]);

    const handleSelect = (item) => {
        if (item.external) {
            window.open(item.href, '_blank', 'noopener,noreferrer');
        } else {
            onNavigate(item.page);
        }
        setIsOpen(false);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            setIsOpen(false);
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlightedIndex(prev => (flatItems.length ? (prev + 1) % flatItems.length : 0));
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightedIndex(prev => (flatItems.length ? (prev - 1 + flatItems.length) % flatItems.length : 0));
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            const item = flatItems[highlightedIndex];
            if (item) handleSelect(item);
        }
    };

    if (!isOpen) return null;

    let runningIndex = 0;

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] sm:pt-[15vh] bg-slate-900/40 dark:bg-slate-950/60 backdrop-blur-sm px-4"
            onMouseDown={() => setIsOpen(false)}
            role="presentation"
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Search tools"
                onMouseDown={(e) => e.stopPropagation()}
                className="w-full max-w-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl shadow-2xl flex flex-col overflow-hidden"
            >
                {/* ── Input row ─────────────────────────────────────── */}
                <div className="flex items-center gap-3 px-4 h-14 border-b border-slate-100 dark:border-slate-800 shrink-0">
                    <Icon path={ICONS.search} className="h-4 w-4 text-slate-400 shrink-0" />
                    <input
                        ref={inputRef}
                        type="text"
                        role="combobox"
                        aria-expanded="true"
                        aria-controls="command-palette-list"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Search tools & pages..."
                        className="flex-1 bg-transparent outline-none text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
                    />
                    <Kbd>Esc</Kbd>
                </div>

                {/* ── Results ───────────────────────────────────────── */}
                <div id="command-palette-list" ref={listRef} role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
                    {flatItems.length === 0 && (
                        <div className="px-3 py-8 text-center text-sm text-slate-400">No tools match "{query}"</div>
                    )}
                    {groups.map((group) => {
                        const offset = runningIndex;
                        runningIndex += group.items.length;
                        return (
                            <ResultGroup
                                key={group.label}
                                label={group.label}
                                items={group.items}
                                indexOffset={offset}
                                highlightedIndex={highlightedIndex}
                                onSelect={handleSelect}
                                setHighlighted={setHighlightedIndex}
                            />
                        );
                    })}
                </div>

                {/* ── Footer hints ──────────────────────────────────── */}
                <div className="flex items-center gap-4 px-4 h-10 border-t border-slate-100 dark:border-slate-800 shrink-0 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> Navigate</span>
                    <span className="flex items-center gap-1"><Kbd>↵</Kbd> Select</span>
                    <span className="flex items-center gap-1"><Kbd>Esc</Kbd> Close</span>
                </div>
            </div>
        </div>
    );
};

export default CommandPalette;
