import { useMemo, useState } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';

const CHIP = {
    exact: 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300',
    ai: 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300',
    fuzzy: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    ambiguous: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    unresolved: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
};

const POBatchPasteModal = ({ isOpen, onClose, onAccept }) => {
    const [text, setText] = useState('');
    const [results, setResults] = useState([]);
    const [selected, setSelected] = useState(new Set());
    const [loading, setLoading] = useState(false);
    const lines = useMemo(() => text.split(/\r?\n/).map(line => line.trim()).filter(Boolean), [text]);

    const parse = async () => {
        if (!lines.length) return;
        setLoading(true);
        try {
            const { data } = await api.post('/purchase-orders/parse-lines', { lines });
            setResults(data || []);
            setSelected(new Set((data || []).map((_, index) => index)));
        } catch (error) {
            toast.error(error?.response?.data?.message || 'Could not parse the pasted list.');
        } finally {
            setLoading(false);
        }
    };

    const close = () => {
        setText('');
        setResults([]);
        setSelected(new Set());
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={close} title="Paste purchase-order lines" maxWidth="max-w-3xl">
            <div className="space-y-4">
                {!results.length ? (
                    <textarea value={text} onChange={event => setText(event.target.value)} rows="10" placeholder="One item per line" className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg text-sm font-mono" />
                ) : (
                    <div className="max-h-80 overflow-y-auto divide-y divide-gray-100 dark:divide-slate-700 border border-gray-200 dark:border-slate-700 rounded-lg">
                        {results.map((result, index) => (
                            <label key={`${result.raw}-${index}`} className="flex items-center gap-3 p-3 text-sm">
                                <input type="checkbox" checked={selected.has(index)} onChange={() => setSelected(current => {
                                    const next = new Set(current);
                                    if (next.has(index)) next.delete(index); else next.add(index);
                                    return next;
                                })} />
                                <span className="flex-1 text-gray-800 dark:text-slate-200">{result.raw}</span>
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CHIP[result.match_status] || CHIP.unresolved}`}>{result.match_status === 'unresolved' ? 'draft' : result.match_status}</span>
                            </label>
                        ))}
                    </div>
                )}
                <div className="flex justify-end gap-2">
                    <button type="button" onClick={close} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-slate-600 text-sm">Cancel</button>
                    {!results.length ? (
                        <button type="button" onClick={parse} disabled={loading || !lines.length} className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium disabled:opacity-50">{loading ? 'Parsing…' : `Parse ${lines.length || ''} lines`}</button>
                    ) : (
                        <button type="button" onClick={() => { onAccept(results.filter((_, index) => selected.has(index))); close(); }} disabled={!selected.size} className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium disabled:opacity-50">Add selected</button>
                    )}
                </div>
            </div>
        </Modal>
    );
};

export default POBatchPasteModal;
