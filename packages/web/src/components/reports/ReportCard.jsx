import React from 'react';
import { useSettings } from '../../contexts/SettingsContext';
import Icon from '../ui/Icon';

const ReportCard = ({ title, value, icon, color, isCurrency = false, footer = null, emptyLabel = 'No data' }) => {
    const { settings } = useSettings();
    // A null value means "not measurable", which must not render as 0.00 -- that reads as
    // "broke even" when the truth is "we don't know".
    const hasValue = value !== null && value !== undefined && value !== '' && !Number.isNaN(Number(value));

    return (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-lg border border-gray-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center space-x-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${color.bg}`}>
                    <Icon path={icon} className={`h-6 w-6 ${color.text}`} />
                </div>
                <div className="min-w-0">
                    <h3 className="text-sm font-medium text-gray-500 dark:text-slate-400">{title}</h3>
                    <p className={`text-2xl font-bold mt-1 tnum ${hasValue ? 'text-gray-800 dark:text-slate-100' : 'text-gray-400 dark:text-slate-500'}`}>
                        {!hasValue
                            ? emptyLabel
                            : isCurrency
                                ? `${settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : Number(value).toLocaleString()}
                    </p>
                </div>
            </div>
            {footer}
        </div>
    );
};

export default ReportCard;
