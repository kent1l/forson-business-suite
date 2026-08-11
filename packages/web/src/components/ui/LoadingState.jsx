// Shared loading indicator for async page/section content.
// Use instead of ad hoc "Loading..." text or one-off spinners so every
// loading moment in the app looks and feels the same.
const LoadingState = ({ label = 'Loading...', className = '', compact = false }) => (
    <div className={`flex items-center justify-center gap-2 text-neutral-500 ${compact ? 'py-4' : 'py-12'} ${className}`}>
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-200 border-t-primary-600" />
        <span className="text-sm">{label}</span>
    </div>
);

export default LoadingState;
