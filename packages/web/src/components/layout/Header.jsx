import React from 'react';
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

    // A helper to get the role name from the permission level ID
    const getRoleName = (levelId) => {
        switch (levelId) {
            case 10: return 'Admin';
            case 5: return 'Manager';
            case 1: return 'Clerk';
            default: return 'User';
        }
    };

    return (
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 sm:px-6">
            <button onClick={onMenuClick} className="md:hidden text-gray-600 hover:text-gray-800">
                <Icon path={ICONS.menu} />
            </button>
            <div className="flex-1"></div>
            <div className="flex items-center">
                <div className="h-8 w-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold mr-3">
                    {getInitials(user.first_name + ' ' + user.last_name)}
                </div>
                <span className="hidden sm:inline text-sm text-gray-600 mr-4">
                    Welcome, <strong>{user.first_name}</strong> ({getRoleName(user.permission_level_id)})
                </span>
                <button onClick={onLogout} className="text-gray-500 hover:text-red-600 transition">
                    <Icon path={ICONS.logout} className="h-5 w-5" />
                </button>
            </div>
        </header>
    );
};

export default Header;
