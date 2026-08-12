import Icon from './Icon';
import { ICONS } from '../../constants';

const SortableHeader = ({ children, column, sortConfig, onSort, className = '' }) => {
    const isSorted = sortConfig.key === column;
    const isAsc = sortConfig.direction === 'ASC';

    const getIcon = () => {
        if (!isSorted) return ICONS.chevronDown; // neutral indicator when not sorted
        return isAsc ? ICONS.chevronUp : ICONS.chevronDown;
    };

    const getNextDirection = () => {
        if (!isSorted) return 'ASC';
        return isAsc ? 'DESC' : 'ASC';
    };

    return (
        <th className={`p-3 text-sm font-semibold text-gray-600 dark:text-slate-300 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 select-none ${className}`} onClick={() => onSort(column, getNextDirection())}>
            <div className="flex items-center justify-between gap-1 min-w-0">
                <span className="truncate">{children}</span>
                <Icon path={getIcon()} className={`h-4 w-4 shrink-0 ${isSorted ? 'text-primary-600 dark:text-primary-400' : 'text-gray-300 dark:text-slate-600'}`} />
            </div>
        </th>
    );
};

export default SortableHeader;
