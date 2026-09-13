import { useRef, useState } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';

const PONLPBar = ({ onResults, onOpenBatch }) => {
    const [value, setValue] = useState('');
    const [loading, setLoading] = useState(false);
    const inputRef = useRef(null);

    const submit = async () => {
        const line = value.trim();
        if (!line || loading) return;
        setLoading(true);
        try {
            const { data } = await api.post('/purchase-orders/parse-lines', { lines: [line] });
            onResults(data || []);
            setValue('');
            requestAnimationFrame(() => inputRef.current?.focus());
        } catch (error) {
            toast.error(error?.response?.data?.message || 'Could not parse that line.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Quick add from supplier text</label>
            <div className="flex gap-2">
                <input
                    ref={inputRef}
                    value={value}
                    onChange={event => setValue(event.target.value)}
                    onKeyDown={event => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            submit();
                        }
                    }}
                    disabled={loading}
                    placeholder="10 NGK CPR8EA-9 @ 135"
                    className="min-w-0 flex-1 px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <button type="button" onClick={submit} disabled={loading || !value.trim()} className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium disabled:opacity-50">
                    {loading ? 'Parsing…' : 'Add'}
                </button>
                <button type="button" onClick={onOpenBatch} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-slate-600 text-sm font-medium text-gray-700 dark:text-slate-200">
                    Paste List
                </button>
            </div>
            {loading && <div className="h-8 rounded bg-gray-100 dark:bg-slate-800 animate-pulse" aria-label="Parsing purchase order line" />}
        </div>
    );
};

export default PONLPBar;
