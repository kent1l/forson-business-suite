import React from 'react';
import Icon from './Icon';
import { ICONS } from '../../constants';

const Modal = ({ isOpen, onClose, title, children, maxWidth = 'max-w-md' }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-neutral-800/50 z-40 flex items-center justify-center p-4">
            {/* The change is on this line: using the new maxWidth prop */}
            <div className={`bg-white rounded-lg shadow-xl w-full ${maxWidth}`}>
                <div className="p-4 border-b flex justify-between items-center">
                    <h2 className="text-lg font-semibold">{title}</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800">
                        <Icon path={ICONS.close} />
                    </button>
                </div>
                <div className="p-6">
                    {children}
                </div>
            </div>
        </div>
    );
};

export default Modal;
