import React, { Fragment } from 'react';
import { Popover, Transition } from '@headlessui/react';
import Icon from './Icon';
import { ICONS } from '../../constants';

const TagPopover = ({ tags }) => {
    const tagList = tags ? tags.split(',').map(t => t.trim()) : [];

    return (
        <Popover className="relative">
            <Popover.Button 
                title="View Tags" 
                className="text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200 focus:outline-none transition-colors"
            >
                <Icon path={ICONS.tag} className="h-5 w-5" />
            </Popover.Button>

            <Transition
                as={Fragment}
                enter="transition ease-out duration-200"
                enterFrom="opacity-0 translate-y-1"
                enterTo="opacity-100 translate-y-0"
                leave="transition ease-in duration-150"
                leaveFrom="opacity-100 translate-y-0"
                leaveTo="opacity-0 translate-y-1"
            >
                <Popover.Panel className="absolute z-20 right-0 mt-2 w-48 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-gray-200 dark:border-slate-700">
                    <div className="p-3">
                        <h4 className="text-sm font-semibold text-gray-800 dark:text-slate-100 mb-2 border-b border-gray-200 dark:border-slate-700 pb-1">Tags</h4>
                        {tagList.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                                {tagList.map((tag, index) => (
                                    <span key={index} className="bg-primary-100 dark:bg-primary-900/40 text-primary-800 dark:text-primary-300 text-xs font-medium px-2 py-0.5 rounded-full">
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <p className="text-xs text-gray-500 dark:text-slate-400">No tags assigned.</p>
                        )}
                    </div>
                </Popover.Panel>
            </Transition>
        </Popover>
    );
};

export default TagPopover;
