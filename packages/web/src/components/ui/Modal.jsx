// using inline SVG for the close icon to avoid unused-import linter issues

/**
 * `header` optionally replaces the plain <h2> title with arbitrary content.
 * A rich header (identity block, badges) cannot live in `title` because that
 * renders inside an <h2>, where block elements are invalid HTML. Both props are
 * optional, so every existing caller is unaffected.
 */
const Modal = ({ isOpen, onClose, title, header, children, maxWidth = 'max-w-md', bodyClassName = 'p-6' }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-neutral-800/50 z-40 flex items-center justify-center p-4">
            {/* The change is on this line: using the new maxWidth prop and constraining height */}
            <div className={`bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full ${maxWidth} max-h-[calc(100vh-2rem)] flex flex-col`}>
                <div className="p-4 border-b border-gray-200 dark:border-slate-700 flex justify-between items-start gap-4">
                    {header || <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{title}</h2>}
                    <button onClick={onClose} aria-label="Close"
                        className="flex-shrink-0 text-gray-500 dark:text-slate-500 hover:text-gray-800 dark:hover:text-slate-300 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 011.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>
                {/* Body grows and scrolls when content is too tall. A caller that
                    manages its own scrolling (to keep an action bar pinned below
                    the scroll region) passes bodyClassName="p-0" and lays out a
                    full-height flex column itself. */}
                <div className={`${bodyClassName} overflow-y-auto min-h-0 flex-1`}>
                    {children}
                </div>
            </div>
        </div>
    );
};

export default Modal;
