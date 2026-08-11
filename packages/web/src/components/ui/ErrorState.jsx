import Icon from './Icon';
import { ICONS } from '../../constants';

// Shared "something failed" placeholder, distinct from EmptyState so users
// can tell "no data" apart from "the request failed" at a glance.
const ErrorState = ({ title = 'Something went wrong', description = 'Failed to load this data. Please try again.', onRetry, className = '' }) => (
    <div className={`flex flex-col items-center justify-center gap-2 py-12 text-center ${className}`}>
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-50">
            <Icon path={ICONS.warning} className="h-6 w-6 text-danger-600" />
        </div>
        <p className="text-sm font-medium text-danger-700">{title}</p>
        {description && <p className="max-w-sm text-xs text-neutral-400">{description}</p>}
        {onRetry && (
            <button
                type="button"
                onClick={onRetry}
                className="mt-2 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 transition-colors hover:bg-neutral-50"
            >
                Retry
            </button>
        )}
    </div>
);

export default ErrorState;
