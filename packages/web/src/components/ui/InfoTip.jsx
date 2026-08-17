import React from 'react';
import { Popover } from '@headlessui/react';
import Icon from './Icon';
import { ICONS } from '../../constants';

/**
 * Inline "guide mark" — click the (i) icon to reveal a short explanation of the
 * field/button/section it sits next to. Content should be a short (1-3 sentence)
 * excerpt from the matching page's manual (docs/manuals/*_manual.md — usually its
 * Field Reference or Key Concepts section), not separately authored copy, so the
 * manual stays the single source of truth. Keep it short: this is a hint, not a
 * substitute for the manual's How To sections.
 *
 * Positioning uses Headless UI's `anchor` (Floating UI under the hood): the panel
 * is portaled to <body> and auto-flips/shifts to stay inside the viewport, so it
 * can't be clipped by a `overflow-x-auto` table wrapper or run off a screen edge.
 * `align` is just the *preferred* side — treat it as a hint, not a guarantee, since
 * the browser may flip it when there isn't room.
 */
const InfoTip = ({ label, children, align = 'left', className = '' }) => {
    return (
        <Popover className={`relative inline-flex align-middle ${className}`}>
            <Popover.Button
                type="button"
                aria-label={label ? `Help: ${label}` : 'Help'}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center justify-center h-4 w-4 rounded-full text-slate-400 hover:text-primary-600 dark:text-slate-500 dark:hover:text-primary-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 transition-colors"
            >
                <Icon path={ICONS.info} className="h-4 w-4" />
            </Popover.Button>

            <Popover.Panel
                anchor={{ to: align === 'right' ? 'bottom end' : 'bottom start', gap: 8, padding: 12 }}
                transition
                onClick={(e) => e.stopPropagation()}
                className="z-[60] w-[min(18rem,calc(100vw-1.5rem))] transition duration-150 ease-out data-[closed]:opacity-0 data-[closed]:-translate-y-1"
            >
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl p-3 text-left">
                    {label && (
                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 mb-1">{label}</p>
                    )}
                    <div className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{children}</div>
                </div>
            </Popover.Panel>
        </Popover>
    );
};

export default InfoTip;
