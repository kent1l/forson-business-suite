import Icon from './Icon';
import { ICONS } from '../../constants';

// Shared "nothing to show" placeholder for tables, lists, and drill-downs.
const EmptyState = ({ title = 'No records found', description, icon = ICONS.documents, action, className = '' }) => (
    <div className={`flex flex-col items-center justify-center gap-2 py-12 text-center ${className}`}>
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 dark:bg-slate-800">
            <Icon path={icon} className="h-6 w-6 text-neutral-400 dark:text-slate-500" />
        </div>
        <p className="text-sm font-medium text-neutral-600 dark:text-slate-300">{title}</p>
        {description && <p className="max-w-sm text-xs text-neutral-400 dark:text-slate-500">{description}</p>}
        {action && <div className="mt-2">{action}</div>}
    </div>
);

export default EmptyState;
