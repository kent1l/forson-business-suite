import Icon from './Icon';
import { ICONS } from '../../constants';

const SortableHeader = ({ children, column, sortConfig, onSort }) => {
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
    <th className="p-3 text-sm font-semibold text-gray-600 cursor-pointer hover:bg-gray-50 select-none" onClick={() => onSort(column, getNextDirection())}>
            <div className="flex items-center justify-between">
                <span>{children}</span>
        <Icon path={getIcon()} className={`h-4 w-4 ${isSorted ? 'text-blue-600' : 'text-gray-300'}`} />
            </div>
        </th>
    );
};

export default SortableHeader;
