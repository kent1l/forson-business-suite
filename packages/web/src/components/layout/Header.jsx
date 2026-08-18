import React, { useState, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';
import { useTheme } from '../../contexts/ThemeContext';

const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);

const Header = ({ user, onLogout, onMenuClick, onOpenSearch }) => {
    const { mode, toggleMode } = useTheme() || {};

    const getInitials = (name) => {
        if (!name) return '';
        const names = name.split(' ');
        if (names.length > 1) {
            return `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase();
        }
        return name[0].toUpperCase();
    }

    // live date/time
    const [dateTime, setDateTime] = useState(() => new Date());

    useEffect(() => {
        const t = setInterval(() => setDateTime(new Date()), 1000);
        return () => clearInterval(t);
    }, []);

    const formatDateTime = (dt) => {
        try {
            const date = dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
            const time = dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
            return `${date} ${time}`;
        } catch {
            return dt.toString();
        }
    };


    return (
        <header className="h-16 bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between px-4 sm:px-6">
            <button onClick={onMenuClick} className="md:hidden text-gray-600 dark:text-slate-300 hover:text-gray-800 dark:hover:text-white">
                <Icon path={ICONS.menu} />
            </button>
            <div className="hidden sm:inline text-sm text-gray-600 dark:text-slate-400 ml-3">
                <span className="text-xs text-gray-500 dark:text-slate-500">{formatDateTime(dateTime)}</span>
            </div>
            <div className="flex-1 flex justify-center">
                {onOpenSearch && (
                    <button
                        onClick={onOpenSearch}
                        className="hidden sm:flex items-center gap-2 w-full max-w-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 hover:border-gray-300 dark:hover:border-slate-600 transition-colors"
                    >
                        <Icon path={ICONS.search} className="h-4 w-4 shrink-0" />
                        <span className="text-sm flex-1 text-left">Search...</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded text-[10px] font-mono">
                            {isMac ? '⌘K' : 'Ctrl K'}
                        </kbd>
                    </button>
                )}
            </div>
            <div className="flex items-center">
                {toggleMode && (
                    <button
                        onClick={toggleMode}
                        aria-label="Toggle dark mode"
                        title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                        className="h-8 w-8 rounded-full flex items-center justify-center text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-800 dark:hover:text-white transition mr-3"
                    >
                        {mode === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                    </button>
                )}
                <div className="h-8 w-8 rounded-full bg-primary-600 text-white flex items-center justify-center text-xs font-bold mr-3">
                    {getInitials(user.first_name + ' ' + user.last_name)}
                </div>
                    <div className="hidden sm:flex sm:flex-col text-sm text-gray-600 dark:text-slate-400 mr-4">
                        <span>Welcome, <strong className="dark:text-slate-200">{user.first_name}</strong></span>
                    </div>
                <button onClick={onLogout} className="text-gray-500 dark:text-slate-400 hover:text-danger-600 transition">
                    <Icon path={ICONS.logout} className="h-5 w-5" />
                </button>
            </div>
        </header>
    );
};

export default Header;
