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
                className="text-gray-500 hover:text-gray-800 focus:outline-none"
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
                <Popover.Panel className="absolute z-20 right-0 mt-2 w-48 bg-white rounded-lg shadow-xl border">
                    <div className="p-3">
                        <h4 className="text-sm font-semibold text-gray-800 mb-2 border-b pb-1">Tags</h4>
                        {tagList.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                                {tagList.map((tag, index) => (
                                    <span key={index} className="bg-blue-100 text-blue-800 text-xs font-medium px-2 py-0.5 rounded-full">
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <p className="text-xs text-gray-500">No tags assigned.</p>
                        )}
                    </div>
                </Popover.Panel>
            </Transition>
        </Popover>
    );
};

export default TagPopover;
