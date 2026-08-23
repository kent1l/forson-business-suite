import React, { useState } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Icon from '../ui/Icon';
import InfoTip from '../ui/InfoTip';
import { ICONS } from '../../constants';

export default function ExpenseQuickEntry({ onParsed }) {
    const [text, setText] = useState('');
    const [loading, setLoading] = useState(false);

    // A pending question means the AI could not tell whether this is an operating
    // expense at all. The draft is held here until the user answers or skips it.
    const [pending, setPending] = useState(null); // { question, parsed, text }
    const [answer, setAnswer] = useState('');

    const clearPending = () => {
        setPending(null);
        setAnswer('');
    };

    const runParse = async (sourceText, clarifying) => {
        setLoading(true);
        try {
            const response = await api.post('/expenses/parse', {
                text: sourceText,
                ...(clarifying ? { clarifying_question: clarifying.question, clarifying_answer: clarifying.answer } : {})
            });

            const parsed = response.data?.parsed;
            if (!parsed) {
                toast.error('Could not extract expense details. Falling back to manual entry.');
                return;
            }

            if (parsed.clarifying_question && !clarifying) {
                setPending({ question: parsed.clarifying_question, parsed, text: sourceText });
                setAnswer('');
                return;
            }

            clearPending();
            toast.success('AI successfully extracted expense details!');
            onParsed(parsed, sourceText, clarifying || null);
        } catch (error) {
            console.error('AI Quick Entry error:', error);
            const msg = error.response?.data?.error || error.response?.data?.message || 'AI service unavailable';
            toast.error(`${msg}. Falling back to manual entry.`, { duration: 4000 });
        } finally {
            setLoading(false);
        }
    };

    const handleParse = (e) => {
        e?.preventDefault();
        if (!text || text.trim().length < 3) {
            toast.error('Please enter a natural language expense description (min 3 characters).');
            return;
        }
        runParse(text.trim(), null);
    };

    const handleAnswer = (e) => {
        e?.preventDefault();
        if (!answer.trim() || !pending) return;
        runParse(pending.text, { question: pending.question, answer: answer.trim() });
    };

    // Skipping keeps the draft the AI already produced — the question is advisory,
    // so it must never be the thing standing between the user and their entry.
    const handleSkip = () => {
        if (!pending) return;
        const { parsed, text: sourceText } = pending;
        clearPending();
        onParsed(parsed, sourceText, null);
    };

    return (
        <div className="bg-slate-900 text-white rounded-xl p-5 shadow-md border border-slate-800 mb-6">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                    <span className="p-1.5 bg-blue-600/30 text-blue-400 rounded-lg border border-blue-500/30">
                        <Icon path={ICONS.star} className="w-5 h-5 text-blue-400" />
                    </span>
                    <h3 className="text-base font-semibold tracking-wide text-slate-100 flex items-center gap-1">
                        <span>Quick Entry <span className="text-xs font-normal text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">AI Assisted</span></span>
                        <InfoTip label="Quick Entry">
                            Type an expense in plain, everyday language and the system will try to extract the amount, date, category, payee, and payment method for you to review before saving. Treat its output as a draft, especially anything flagged low-confidence.
                        </InfoTip>
                    </h3>
                </div>
                <span className="text-xs text-slate-400">Powered by LLM</span>
            </div>

            <p className="text-xs text-slate-400 mb-3">
                Type in natural language (e.g. <span className="italic text-slate-300">"Bayad 4,500 sa fibeco para sa kuryente gahapon, Cash"</span>) to auto-fill form fields.
            </p>

            <form onSubmit={handleParse} className="flex flex-col sm:flex-row items-stretch gap-2">
                <div className="relative flex-1">
                    <input
                        type="text"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="Describe expense details here..."
                        disabled={loading}
                        className="w-full px-4 py-2.5 pr-9 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                    />
                    {text && !loading && (
                        <button
                            type="button"
                            onClick={() => setText('')}
                            aria-label="Clear expense description"
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                        >
                            <Icon path={ICONS.close} className="w-4 h-4" />
                        </button>
                    )}
                </div>
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

            {pending && (
                <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/40 rounded-lg">
                    <div className="flex items-start gap-2">
                        <Icon path={ICONS.warning} className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                        <div className="flex-1">
                            <p className="text-xs font-semibold text-amber-200">One quick question before filling the form</p>
                            <p className="text-sm text-amber-100 mt-1">{pending.question}</p>

                            <form onSubmit={handleAnswer} className="flex flex-col sm:flex-row items-stretch gap-2 mt-2">
                                <input
                                    type="text"
                                    value={answer}
                                    onChange={(e) => setAnswer(e.target.value)}
                                    placeholder="Type your answer..."
                                    disabled={loading}
                                    autoFocus
                                    className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors"
                                />
                                <button
                                    type="submit"
                                    disabled={loading || !answer.trim()}
                                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                                >
                                    {loading ? 'Re-checking...' : 'Answer & Re-parse'}
                                </button>
                            </form>

                            <button
                                type="button"
                                onClick={handleSkip}
                                disabled={loading}
                                className="mt-2 text-xs text-amber-300/80 hover:text-amber-200 underline underline-offset-2 cursor-pointer disabled:opacity-50"
                            >
                                Skip — I'll classify it myself
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
