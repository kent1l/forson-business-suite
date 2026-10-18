import { useEffect, useCallback } from 'react';
import Modal from '../ui/Modal';

/**
 * Reusable duplicate part resolution dialog.
 * Presents a side-by-side comparison between the proposed new part and
 * the matched existing catalog part, with three explicit actions:
 * 1. Use existing part
 * 2. Create separate part
 * 3. Back to editing (also triggered by Close / Escape)
 */
const PartDuplicateModal = ({
    isOpen,
    candidate,
    submitted,
    isSubmitting = false,
    onResolve,
}) => {
    const handleClose = useCallback(() => {
        if (!isSubmitting && onResolve) {
            onResolve('cancel');
        }
    }, [isSubmitting, onResolve]);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                handleClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, handleClose]);

    if (!isOpen || !candidate) return null;

    const confidencePct = Math.round(Number(candidate.confidence || 0) * 100);
    const isHighBand = candidate.band === 'high' || confidencePct >= 92;

    const submittedNumbers = submitted?.part_numbers_string || submitted?.part_numbers || '';
    const candidateNumbers = candidate?.part_numbers || '';

    const formatBarcodes = (bc) => {
        if (!bc) return '';
        if (Array.isArray(bc)) return bc.join(', ');
        return String(bc);
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            title="Duplicate Part Check"
            maxWidth="max-w-2xl"
            zIndexClass="z-50"
        >
            <div className="space-y-5">
                {/* Confidence notice banner */}
                <div
                    className={`p-4 rounded-xl border ${
                        isHighBand
                            ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                            : 'bg-sky-50 dark:bg-sky-950/30 border-sky-300 dark:border-sky-800 text-sky-900 dark:text-sky-200'
                    }`}
                >
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <span className="inline-block text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full mb-1 bg-white/70 dark:bg-black/30">
                                {isHighBand ? 'High Match' : 'Potential Match'} &bull; {confidencePct}% Confidence
                            </span>
                            <p className="text-sm font-medium">
                                {isHighBand
                                    ? 'A part with very similar details already exists in the catalog. Reusing the existing part is strongly recommended unless this is a distinct item.'
                                    : 'A similar catalog part was found. Please compare the details below to determine if this is the same part.'}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Comparison Grid */}
                <div className="border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden text-sm">
                    <div className="grid grid-cols-12 bg-gray-100 dark:bg-slate-700/60 font-semibold text-gray-700 dark:text-slate-200 py-2.5 px-3 border-b border-gray-200 dark:border-slate-700">
                        <div className="col-span-3">Attribute</div>
                        <div className="col-span-4 text-primary-700 dark:text-primary-300">Proposed New Part</div>
                        <div className="col-span-5 text-emerald-700 dark:text-emerald-300">Existing Catalog Part</div>
                    </div>

                    <div className="divide-y divide-gray-100 dark:divide-slate-700/60 text-gray-800 dark:text-slate-200">
                        {/* Description / Detail */}
                        <div className="grid grid-cols-12 py-2.5 px-3 items-start">
                            <div className="col-span-3 font-medium text-gray-500 dark:text-slate-400">Description</div>
                            <div className="col-span-4 font-semibold break-words pr-2">{submitted?.detail || '—'}</div>
                            <div className="col-span-5 font-semibold text-gray-900 dark:text-slate-100 break-words">
                                {candidate?.detail || candidate?.display_name || '—'}
                            </div>
                        </div>

                        {/* Part Numbers */}
                        <div className="grid grid-cols-12 py-2.5 px-3 items-start">
                            <div className="col-span-3 font-medium text-gray-500 dark:text-slate-400">Part Numbers</div>
                            <div className="col-span-4 font-mono text-xs break-words pr-2">{submittedNumbers || '—'}</div>
                            <div className="col-span-5 font-mono text-xs break-words">{candidateNumbers || '—'}</div>
                        </div>

                        {/* Brand */}
                        <div className="grid grid-cols-12 py-2.5 px-3 items-start">
                            <div className="col-span-3 font-medium text-gray-500 dark:text-slate-400">Brand</div>
                            <div className="col-span-4 pr-2">{submitted?.brand_name || '—'}</div>
                            <div className="col-span-5">{candidate?.brand_name || '—'}</div>
                        </div>

                        {/* Group */}
                        <div className="grid grid-cols-12 py-2.5 px-3 items-start">
                            <div className="col-span-3 font-medium text-gray-500 dark:text-slate-400">Group</div>
                            <div className="col-span-4 pr-2">{submitted?.group_name || '—'}</div>
                            <div className="col-span-5">{candidate?.group_name || '—'}</div>
                        </div>

                        {/* SKU */}
                        <div className="grid grid-cols-12 py-2.5 px-3 items-start">
                            <div className="col-span-3 font-medium text-gray-500 dark:text-slate-400">SKU</div>
                            <div className="col-span-4 text-xs italic text-gray-500 dark:text-slate-400 pr-2">Will be generated</div>
                            <div className="col-span-5 font-mono font-medium">{candidate?.internal_sku || '—'}</div>
                        </div>

                        {/* Barcodes if available */}
                        {(formatBarcodes(submitted?.barcodes) || candidate?.barcodes) && (
                            <div className="grid grid-cols-12 py-2.5 px-3 items-start">
                                <div className="col-span-3 font-medium text-gray-500 dark:text-slate-400">Barcodes</div>
                                <div className="col-span-4 font-mono text-xs break-words pr-2">{formatBarcodes(submitted?.barcodes) || '—'}</div>
                                <div className="col-span-5 font-mono text-xs break-words">{formatBarcodes(candidate?.barcodes) || '—'}</div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2.5 pt-3 border-t border-gray-200 dark:border-slate-700">
                    <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => onResolve('cancel')}
                        className="px-4 py-2 rounded-lg border border-gray-300 dark:border-slate-600 text-sm font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 transition order-3 sm:order-1 disabled:opacity-50"
                    >
                        Back to editing
                    </button>

                    <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => onResolve('create_new')}
                        className="px-4 py-2 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-semibold text-gray-800 dark:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-700 transition order-2 disabled:opacity-50"
                    >
                        {isSubmitting ? 'Processing…' : 'Create separate part'}
                    </button>

                    <button
                        type="button"
                        autoFocus
                        disabled={isSubmitting}
                        onClick={() => onResolve('use_existing')}
                        className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-sm font-semibold text-white shadow-xs transition order-1 sm:order-3 disabled:opacity-50"
                    >
                        {isSubmitting ? 'Processing…' : 'Use existing part'}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default PartDuplicateModal;
