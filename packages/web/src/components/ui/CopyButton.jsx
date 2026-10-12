import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Copy, Check } from 'lucide-react';
import { copyToClipboard } from '../../utils/clipboard';

const CopyButton = ({
    text,
    label = '',
    title = '',
    className = '',
    iconClassName = 'h-3.5 w-3.5',
    successDuration = 1500,
    showToast = true,
}) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const valueToCopy = typeof text === 'function' ? text() : text;
        if (valueToCopy === null || valueToCopy === undefined || valueToCopy === '') {
            return;
        }
        try {
            const success = await copyToClipboard(valueToCopy);
            if (success) {
                setCopied(true);
                if (showToast) {
                    toast.success(label ? `Copied ${label} to clipboard` : 'Copied to clipboard');
                }
                setTimeout(() => setCopied(false), successDuration);
            } else {
                toast.error('Failed to copy to clipboard');
            }
        } catch {
            toast.error('Failed to copy to clipboard');
        }
    }, [text, label, showToast, successDuration]);

    const buttonTitle = title || (copied ? 'Copied!' : (label ? `Copy ${label} to clipboard` : 'Copy to clipboard'));

    return (
        <button
            type="button"
            onClick={handleCopy}
            title={buttonTitle}
            aria-label={buttonTitle}
            className={`inline-flex items-center justify-center p-1 rounded text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-500 ${className}`}
        >
            {copied ? (
                <Check className={`${iconClassName} text-success-600 dark:text-success-400`} />
            ) : (
                <Copy className={iconClassName} />
            )}
        </button>
    );
};

export default CopyButton;
