// using inline SVG for the close icon to avoid unused-import linter issues

const Modal = ({ isOpen, onClose, title, children, maxWidth = 'max-w-md' }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-neutral-800/50 z-40 flex items-center justify-center p-4">
            {/* The change is on this line: using the new maxWidth prop and constraining height */}
            <div className={`bg-white rounded-lg shadow-xl w-full ${maxWidth} max-h-[calc(100vh-2rem)] flex flex-col`}>
                <div className="p-4 border-b flex justify-between items-center">
                    <h2 className="text-lg font-semibold">{title}</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 011.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>
                {/* make the body grow and scroll when content is too tall */}
                <div className="p-6 overflow-y-auto min-h-0 flex-1">
                    {children}
                </div>
            </div>
        </div>
    );
};

export default Modal;
