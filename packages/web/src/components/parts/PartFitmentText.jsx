import { useMemo } from 'react';
import { formatSearchFitments } from '../../helpers/searchFitmentText.js';

export default function PartFitmentText({ part, multiline = false, className = '' }) {
    const text = useMemo(() => formatSearchFitments(part, { multiline }), [part, multiline]);
    const fullText = useMemo(() => formatSearchFitments(part, { compact: false, multiline: true }), [part]);
    if (!text) return null;
    return (
        <span title={fullText} className={`part-fitment-text block text-xs leading-5 text-gray-500 dark:text-slate-400 ${multiline ? 'whitespace-pre-line break-words' : 'line-clamp-2'} ${className}`}>
            <span aria-hidden="true">{text}</span>
            <span className="sr-only">{fullText}</span>
        </span>
    );
}
