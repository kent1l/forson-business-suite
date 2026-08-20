import React from 'react';
import { Info, AlertTriangle, AlertCircle, X, ArrowRight } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';

// The -500 status tokens are re-tuned for dark surfaces in index.css's `.dark`
// block, so these need no `dark:` variant of their own.
const SEVERITY_CONFIG = {
    info:     { Icon: Info,          iconCls: 'text-primary-500', dotCls: 'bg-primary-500' },
    warning:  { Icon: AlertTriangle, iconCls: 'text-warning-500', dotCls: 'bg-warning-500' },
    critical: { Icon: AlertCircle,   iconCls: 'text-danger-500',  dotCls: 'bg-danger-500'  },
};

const NotificationItem = ({ notification, onMarkRead, onDismiss, onNavigate, onClose }) => {
    const { notification_id, severity, title, body, link_page, link_state, created_at, is_read } = notification;
    const cfg = SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.info;
    const relativeTime = formatDistanceToNowStrict(new Date(created_at), { addSuffix: true });
    const absTime = new Date(created_at).toLocaleString();
    const isClickable = !!link_page;

    const handleClick = () => {
        if (!is_read) onMarkRead(notification_id);
        onClose();
        // A fresh object every click: the target page applies a deep link once
        // per payload identity, so reusing this row's object would make a second
        // click on the same notification do nothing.
        onNavigate(link_page, link_state ? { ...link_state } : null);
    };

    const bodyCls = [
        'flex items-start gap-3 w-full text-left pl-5 pr-10 py-3 transition-colors',
        isClickable ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/60' : '',
    ].join(' ');

    const content = (
        <>
            <cfg.Icon aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${cfg.iconCls}`} />
            <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium leading-tight truncate
                    ${is_read ? 'text-gray-700 dark:text-slate-300' : 'text-gray-900 dark:text-slate-100'}`}>
                    {title}
                </p>
                {body && (
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                        {body}
                    </p>
                )}
                <span className="mt-1 flex items-center gap-1 text-[10px] text-gray-400 dark:text-slate-500">
                    <span title={absTime}>{relativeTime}</span>
                    {isClickable && (
                        // Tells the reader the row goes somewhere before they
                        // click, which a bare hover tint does not.
                        <span className="flex items-center gap-0.5 text-primary-600 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                            · Open <ArrowRight className="h-2.5 w-2.5" aria-hidden="true" />
                        </span>
                    )}
                </span>
            </div>
        </>
    );

    // The dismiss control sits outside the clickable region rather than inside
    // it: nesting a <button> inside a <button> is invalid HTML, and browsers
    // resolve it inconsistently.
    return (
        <div className={`group relative ${!is_read ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`}>
            {/* Unread marker. A dot as well as a tint, so the state does not
                depend on colour perception alone. */}
            {!is_read && (
                <span
                    aria-hidden="true"
                    className={`absolute left-1.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full ${cfg.dotCls}`}
                />
            )}

            {isClickable ? (
                <button type="button" className={bodyCls} onClick={handleClick}>
                    {content}
                </button>
            ) : (
                <div className={bodyCls}>{content}</div>
            )}

            <button
                type="button"
                onClick={() => onDismiss(notification_id)}
                aria-label={`Dismiss notification: ${title}`}
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 focus:opacity-100 h-5 w-5 flex items-center justify-center rounded text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-200 dark:hover:bg-slate-700 transition"
            >
                <X className="h-3 w-3" />
            </button>
        </div>
    );
};

export default NotificationItem;
