import React, { useState } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';

export default function ExpenseQuickEntry({ onParsed }) {
    const [text, setText] = useState('');
    const [loading, setLoading] = useState(false);

    const handleParse = async (e) => {
        e?.preventDefault();
        if (!text || text.trim().length < 3) {
            toast.error('Please enter a natural language expense description (min 3 characters).');
            return;
        }

        setLoading(true);
        try {
            const response = await api.post('/expenses/parse', { text: text.trim() });
            if (response.data && response.data.parsed) {
                toast.success('AI successfully extracted expense details!');
                onParsed(response.data.parsed, text.trim());
            } else {
                toast.error('Could not extract expense details. Falling back to manual entry.');
            }
        } catch (error) {
            console.error('AI Quick Entry error:', error);
            const msg = error.response?.data?.error || error.response?.data?.message || 'AI service unavailable';
            toast.error(`${msg}. Falling back to manual entry.`, { duration: 4000 });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-slate-900 text-white rounded-xl p-5 shadow-md border border-slate-800 mb-6">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                    <span className="p-1.5 bg-blue-600/30 text-blue-400 rounded-lg border border-blue-500/30">
                        <Icon path={ICONS.star} className="w-5 h-5 text-blue-400" />
                    </span>
                    <h3 className="text-base font-semibold tracking-wide text-slate-100">
                        Quick Entry <span className="text-xs font-normal text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">AI Assisted</span>
                    </h3>
                </div>
                <span className="text-xs text-slate-400">Powered by LLM</span>
            </div>

            <p className="text-xs text-slate-400 mb-3">
                Type in natural language (e.g. <span className="italic text-slate-300">"Bayad 4,500 sa fibeco para sa kuryente gahapon, Cash"</span>) to auto-fill form fields.
            </p>

            <form onSubmit={handleParse} className="flex flex-col sm:flex-row items-stretch gap-2">
                <input
                    type="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Describe expense details here..."
                    disabled={loading}
                    className="flex-1 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                />
                <button
                    type="submit"
                    disabled={loading || !text.trim()}
                    className="inline-flex items-center justify-center px-5 py-2.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg shadow transition-colors whitespace-nowrap cursor-pointer"
                >
                    {loading ? (
                        <>
                            <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <span>Analyzing...</span>
                        </>
                    ) : (
                        <>
                            <Icon path={ICONS.star} className="w-4 h-4 mr-1.5 text-blue-200" />
                            <span>Parse with AI</span>
                        </>
                    )}
                </button>
            </form>
        </div>
    );
}
