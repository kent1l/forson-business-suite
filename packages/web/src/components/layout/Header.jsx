import React, { useState, useEffect } from 'react';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';

const Header = ({ user, onLogout, onMenuClick }) => {
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
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 sm:px-6">
            <button onClick={onMenuClick} className="md:hidden text-gray-600 hover:text-gray-800">
                <Icon path={ICONS.menu} />
            </button>
            <div className="hidden sm:inline text-sm text-gray-600 ml-3">
                <span className="text-xs text-gray-500">{formatDateTime(dateTime)}</span>
            </div>
            <div className="flex-1"></div>
            <div className="flex items-center">
                <div className="h-8 w-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold mr-3">
                    {getInitials(user.first_name + ' ' + user.last_name)}
                </div>
                    <div className="hidden sm:flex sm:flex-col text-sm text-gray-600 mr-4">
                        <span>Welcome, <strong>{user.first_name}</strong></span>
                    </div>
                <button onClick={onLogout} className="text-gray-500 hover:text-red-600 transition">
                    <Icon path={ICONS.logout} className="h-5 w-5" />
                </button>
            </div>
        </header>
    );
};

export default Header;
