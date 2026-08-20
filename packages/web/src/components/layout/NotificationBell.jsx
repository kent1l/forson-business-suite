import React from 'react';
import { Popover } from '@headlessui/react';
import { Bell } from 'lucide-react';
import useNotifications from '../../hooks/useNotifications';
import NotificationPanel from './NotificationPanel';

const NotificationBell = ({ onNavigate }) => {
    const hook = useNotifications();
    const { unreadCount } = hook;
    // API caps at 100; show 99+ so the badge doesn't imply an exact count above that.
    const badgeLabel = unreadCount >= 100 ? '99+' : String(unreadCount);

    return (
        <Popover className="relative">
            {({ open }) => (
                <>
                    <Popover.Button
                        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
                        aria-haspopup="dialog"
                        aria-expanded={open}
                        className="relative h-8 w-8 rounded-full flex items-center justify-center text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-800 dark:hover:text-white transition mr-3"
                    >
                        <Bell className="h-4 w-4" />
                        {unreadCount > 0 && (
                            <span
                                aria-hidden="true"
                                className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 flex items-center justify-center rounded-full bg-danger-600 text-white text-[9px] font-bold leading-none"
                            >
                                {badgeLabel}
                            </span>
                        )}
                    </Popover.Button>

                    <Popover.Panel
                        anchor={{ to: 'bottom end', gap: 8, padding: 12 }}
                        transition
                        className="z-50 transition duration-150 ease-out data-[closed]:opacity-0 data-[closed]:-translate-y-1"
                    >
                        {({ close }) => (
                            <NotificationPanel
                                {...hook}
                                onNavigate={onNavigate}
                                onClose={close}
                            />
                        )}
                    </Popover.Panel>
                </>
            )}
        </Popover>
    );
};

export default NotificationBell;
