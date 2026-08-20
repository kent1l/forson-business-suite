import { useCallback, useEffect, useRef, useState } from 'react';

// How long the highlight stays up once the row is actually on screen. Long
// enough to find with your eyes, short enough that it never reads as permanent
// state — a highlight that outstays its welcome gets mistaken for a status.
const VISIBLE_MS = 4000;

// If the rows never arrive — the record is on another page, or a filter excludes
// it — give up rather than leaving the highlight armed indefinitely.
const GIVE_UP_MS = 10000;

/**
 * Draws attention to the specific rows a notification points at.
 *
 * Filtering a list down to the right rows is not the same as showing someone
 * which row to act on, and the gap grows with the size of the result set. This
 * takes a `{ type, ids }` payload carried by a deep link and gives the table a
 * per-row prop bundle that scrolls the first match into view, moves focus to it,
 * and tints it briefly.
 *
 * Focus is moved deliberately, not just the scroll position: a purely visual
 * flash is invisible to a screen reader, and leaves a keyboard user tabbing from
 * the top of the page to reach the row everyone else was just shown.
 *
 * Usage:
 *   const { getHighlightProps } = useHighlight(highlight, items.length);
 *   <tr key={item.id} {...getHighlightProps(item.id, 'hover:bg-gray-50')}>
 */
const useHighlight = (spec, rowsToken) => {
    const [activeIds, setActiveIds] = useState(null);
    const nodesRef = useRef(new Map());
    const appliedSpecRef = useRef(null);
    const settledRef = useRef(false);

    // Arm on a new payload. Identity-keyed for the same reason useDeepLink is:
    // clicking the same notification twice should highlight twice.
    useEffect(() => {
        if (!spec || !Array.isArray(spec.ids) || spec.ids.length === 0) return;
        if (appliedSpecRef.current === spec) return;
        appliedSpecRef.current = spec;
        settledRef.current = false;
        setActiveIds(new Set(spec.ids.map(String)));
    }, [spec]);

    // Reveal once the rows exist. The list is usually still loading when the
    // deep link lands, so this re-runs as `rowsToken` changes and waits for a
    // match rather than firing once against an empty table.
    useEffect(() => {
        if (!activeIds || settledRef.current) return;

        const target = [...activeIds]
            .map((id) => nodesRef.current.get(id))
            .find(Boolean);
        if (!target) return;

        settledRef.current = true;
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
        // preventScroll: the scrollIntoView above already positioned the row;
        // letting focus scroll again fights it and lands the row at the edge.
        target.focus({ preventScroll: true });

        const timer = setTimeout(() => setActiveIds(null), VISIBLE_MS);
        return () => clearTimeout(timer);
    }, [activeIds, rowsToken]);

    // Backstop for the "row never showed up" case.
    useEffect(() => {
        if (!activeIds) return;
        const timer = setTimeout(() => {
            if (!settledRef.current) setActiveIds(null);
        }, GIVE_UP_MS);
        return () => clearTimeout(timer);
    }, [activeIds]);

    // Takes the row's own classes and returns them merged, so spreading the
    // result cannot silently drop the row's existing styling.
    const getHighlightProps = useCallback((id, baseClassName = '') => {
        const key = String(id);
        const isActive = !!activeIds && activeIds.has(key);
        return {
            ref: (node) => {
                if (node) nodesRef.current.set(key, node);
                else nodesRef.current.delete(key);
            },
            className: isActive ? `${baseClassName} row-highlight`.trim() : baseClassName,
            // Rows are not normally focusable; -1 makes this one a programmatic
            // focus target without inserting it into the tab order permanently.
            tabIndex: isActive ? -1 : undefined,
        };
    }, [activeIds]);

    return { getHighlightProps, isHighlighting: !!activeIds };
};

export default useHighlight;
