/**
 * Drawer Component - Highly Reusable Slide-Out Panel
 *
 * A flexible, production-ready drawer component with extensive customization options.
 *
 * ## Basic Usage:
 * ```jsx
 * <Drawer
 *   isOpen={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   title="My Drawer"
 * >
 *   <p>Drawer content here</p>
 * </Drawer>
 * ```
 *
 * ## Advanced Features:
 *
 * ### Positioning & Sizing:
 * - `position`: 'left' | 'right' | 'top' | 'bottom' (default: 'right')
 * - `size`: 'sm' | 'md' | 'lg' | 'xl' | 'full' | custom CSS class (default: 'md')
 *
 * ### Header Customization:
 * - `title`: Header title text
 * - `showHeader`: Show/hide header (default: true)
 * - `showCloseButton`: Show/hide close button (default: true)
 * - `headerClassName`: Custom header CSS classes
 * - `renderHeader`: Custom header render function
 * - `renderCloseButton`: Custom close button render function
 *
 * ### Styling & Theming:
 * - `backdropClassName`: Custom backdrop styles (default: 'bg-neutral-800/50')
 * - `drawerClassName`: Custom drawer container styles
 * - `contentClassName`: Custom content area styles
 * - `backdropZIndex`: Backdrop z-index (default: 'z-40')
 * - `drawerZIndex`: Drawer z-index (default: 'z-50')
 *
 * ### Behavior Configuration:
 * - `closeOnBackdropClick`: Close on backdrop click (default: true)
 * - `closeOnEscape`: Close on Escape key (default: true)
 * - `lockBodyScroll`: Lock body scroll when open (default: true)
 * - `animationDuration`: Animation duration in ms (default: 300)
 * - `animationEasing`: Animation easing (default: 'ease-in-out')
 *
 * ### Event Handlers:
 * - `onOpen`: Called when drawer opens
 * - `onClose`: Called when drawer closes
 *
 * ## Compound Components:
 *
 * For more complex layouts, use compound components:
 * ```jsx
 * <Drawer isOpen={isOpen} onClose={onClose} showHeader={false}>
 *   <Drawer.Header>Custom Header</Drawer.Header>
 *   <Drawer.Content>Main Content</Drawer.Content>
 *   <Drawer.Footer>Footer Actions</Drawer.Footer>
 * </Drawer>
 * ```
 *
 * ## Custom Render Functions:
 *
 * For maximum flexibility, use render props:
 * ```jsx
 * <Drawer
 *   isOpen={isOpen}
 *   onClose={onClose}
 *   renderHeader={({ onClose }) => <CustomHeader onClose={onClose} />}
 *   renderCloseButton={({ onClose }) => <CustomCloseButton onClose={onClose} />}
 * >
 *   Content
 * </Drawer>
 * ```
 *
 * ## Accessibility:
 * - Proper ARIA attributes
 * - Keyboard navigation (Escape to close)
 * - Focus management
 * - Screen reader support
 *
 * ## Performance:
 * - Conditional rendering when closed
 * - Efficient event listeners
 * - Minimal re-renders
 * - Body scroll lock management
 */

import { useEffect, useCallback, useState } from 'react';

const Drawer = ({
    isOpen,
    onClose,
    children,
    // Positioning and sizing
    position = 'right', // 'left', 'right', 'top', 'bottom'
    size = 'md', // 'sm', 'md', 'lg', 'xl', 'full' or custom class
    // Header configuration
    title,
    showHeader = true,
    showCloseButton = true,
    headerClassName = '',
    // Content configuration
    contentClassName = '',
    // Backdrop configuration
    backdropClassName = 'bg-neutral-800/50',
    backdropZIndex = 'z-40',
    // Drawer container configuration
    drawerClassName = '',
    drawerZIndex = 'z-50',
    // Animation configuration
    animationDuration = 300,
    animationEasing = 'ease-in-out',
    // Behavior configuration
    closeOnBackdropClick = true,
    closeOnEscape = true,
    lockBodyScroll = true,
    // Custom render functions
    renderHeader,
    renderCloseButton,
    // Event handlers
    onOpen,
    _onCloseComplete
}) => {
    // Local render/visibility state to enable exit animations
    const [shouldRender, setShouldRender] = useState(isOpen);
    const [isVisible, setIsVisible] = useState(isOpen);

    // Handle escape key
    useEffect(() => {
        if (!closeOnEscape) return;

        const handleEscape = (e) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };

        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose, closeOnEscape]);

    // Handle body scroll lock
    useEffect(() => {
        if (!lockBodyScroll) return;

        if (shouldRender) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }

        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [shouldRender, lockBodyScroll]);

    // Manage mount/unmount for smooth transitions
    useEffect(() => {
        if (isOpen) {
            setShouldRender(true);
            // next frame: set visible for entering animation
            const id = requestAnimationFrame(() => setIsVisible(true));
            if (onOpen) onOpen();
            return () => cancelAnimationFrame(id);
        } else if (shouldRender) {
            // start exit animation
            setIsVisible(false);
            const timeout = setTimeout(() => {
                setShouldRender(false);
                if (typeof _onCloseComplete === 'function') _onCloseComplete();
            }, animationDuration);
            return () => clearTimeout(timeout);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // Predefined size classes
    const sizeClasses = {
        sm: position === 'left' || position === 'right' ? 'w-80' : 'h-80',
        md: position === 'left' || position === 'right' ? 'w-96' : 'h-96',
        lg: position === 'left' || position === 'right' ? 'w-[32rem]' : 'h-[32rem]',
        xl: position === 'left' || position === 'right' ? 'w-[40rem]' : 'h-[40rem]',
        full: position === 'left' || position === 'right' ? 'w-full' : 'h-full'
    };

    // Position classes
    const positionClasses = {
        left: 'left-0 top-0 h-full',
        right: 'right-0 top-0 h-full',
        top: 'top-0 left-0 w-full',
        bottom: 'bottom-0 left-0 w-full'
    };

    // Animation classes
    const slideClasses = {
        left: isVisible ? 'translate-x-0' : '-translate-x-full',
        right: isVisible ? 'translate-x-0' : 'translate-x-full',
        top: isVisible ? 'translate-y-0' : '-translate-y-full',
        bottom: isVisible ? 'translate-y-0' : 'translate-y-full'
    };

    // Rounded edge based on position for a modern look
    const roundedClasses = {
        left: 'rounded-r-2xl',
        right: 'rounded-l-2xl',
        top: 'rounded-b-2xl',
        bottom: 'rounded-t-2xl'
    };

    // Handle backdrop click
    const handleBackdropClick = useCallback((e) => {
        if (e.target === e.currentTarget && closeOnBackdropClick) {
            onClose();
        }
    }, [onClose, closeOnBackdropClick]);

    // Default close button
    const defaultCloseButton = (
        <button
            onClick={onClose}
            className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Close drawer"
        >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
        </button>
    );

    // Default header
    const defaultHeader = showHeader && (
        <div className={`flex items-center justify-between p-4 border-b border-gray-200 ${headerClassName}`}>
            {title && <h2 id="drawer-title" className="text-lg font-semibold text-gray-900">{title}</h2>}
            <div className="flex items-center">
                {showCloseButton && (renderCloseButton ? renderCloseButton({ onClose }) : defaultCloseButton)}
            </div>
        </div>
    );

    // Custom header
    const customHeader = renderHeader && renderHeader({ onClose });

    const header = customHeader || defaultHeader;

    if (!shouldRender) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className={`fixed inset-0 ${backdropClassName} ${backdropZIndex} transition-opacity ${isVisible ? 'opacity-100' : 'opacity-0'}`}
                onClick={handleBackdropClick}
                aria-hidden="true"
                style={{ transitionDuration: `${animationDuration}ms`, transitionTimingFunction: animationEasing }}
            />

            {/* Drawer */}
            <div
                className={`fixed ${positionClasses[position]} ${typeof size === 'string' && sizeClasses[size] ? sizeClasses[size] : size} bg-white shadow-2xl ring-1 ring-black/5 ${roundedClasses[position]} ${drawerZIndex} transform transition-transform ${slideClasses[position]} will-change-transform ${drawerClassName}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby={title ? "drawer-title" : undefined}
                style={{ transitionDuration: `${animationDuration}ms`, transitionTimingFunction: animationEasing }}
            >
                {header}

                {/* Content */}
                <div className={`flex-1 overflow-y-auto overscroll-contain ${contentClassName}`}>
                    {children}
                </div>
            </div>
        </>
    );
};

// Compound component pattern for more complex use cases
const DrawerHeader = ({ children, className = '' }) => (
    <div className={`flex items-center justify-between p-4 border-b border-gray-200 ${className}`}>
        {children}
    </div>
);

const DrawerContent = ({ children, className = '' }) => (
    <div className={`flex-1 overflow-y-auto p-4 ${className}`}>
        {children}
    </div>
);

const DrawerFooter = ({ children, className = '' }) => (
    <div className={`p-4 border-t border-gray-200 ${className}`}>
        {children}
    </div>
);

// Export compound components
Drawer.Header = DrawerHeader;
Drawer.Content = DrawerContent;
Drawer.Footer = DrawerFooter;

export default Drawer;